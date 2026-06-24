import { NextRequest, NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
import { getDb } from "@/lib/db";
import { getUser, esOwner } from "@/lib/owner";

// Compras / pedidos a proveedor.
// - Cualquier vendedor CARGA un pedido → queda 'pendiente' (no se envía), con quién lo generó.
// - Solo el OWNER CONFIRMA → genera Excel/email al proveedor y pasa a 'enviado'.
// - 'recibir' suma las cantidades al stock.
async function ensure(sql: any) {
  await sql`CREATE TABLE IF NOT EXISTS fg_compras (
    id SERIAL PRIMARY KEY,
    proveedor_id INT, proveedor_nombre TEXT,
    items JSONB NOT NULL, total_costo_usd NUMERIC,
    email_destinatario TEXT, mensaje TEXT, gsa_numero INT,
    estado TEXT DEFAULT 'pendiente',
    creado_por TEXT, recibido_at TIMESTAMPTZ, enviado_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`ALTER TABLE fg_compras ADD COLUMN IF NOT EXISTS creado_por TEXT`.catch(() => {});
  await sql`ALTER TABLE fg_compras ADD COLUMN IF NOT EXISTS enviado_at TIMESTAMPTZ`.catch(() => {});
  await sql`ALTER TABLE fg_compras ADD COLUMN IF NOT EXISTS recepcion JSONB`.catch(() => {});
  await sql`ALTER TABLE fg_compras ADD COLUMN IF NOT EXISTS remito_archivo JSONB`.catch(() => {});
}

export async function GET(req: NextRequest) {
  try {
    const sql = getDb(); await ensure(sql);
    const sp = req.nextUrl.searchParams;
    const pid = Number(sp.get("proveedor_id"));
    const estado = (sp.get("estado") || "").trim();
    let rows;
    if (pid) rows = await sql`SELECT * FROM fg_compras WHERE proveedor_id=${pid} ORDER BY created_at DESC`;
    else if (estado) rows = await sql`SELECT * FROM fg_compras WHERE estado=${estado} ORDER BY created_at DESC LIMIT 300`;
    else rows = await sql`SELECT * FROM fg_compras ORDER BY created_at DESC LIMIT 300`;
    return NextResponse.json({ ok: true, compras: rows });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}

// POST → CARGA un pedido (queda 'pendiente'). No envía. Cualquier usuario logueado.
export async function POST(req: NextRequest) {
  try {
    const sql = getDb(); await ensure(sql);
    const b = await req.json();
    const u = await getUser(req);
    const items = (b.items || []).filter((it: any) => it.codigo && Number(it.cantidad) > 0);
    if (!b.proveedor_nombre || !items.length) return NextResponse.json({ ok: false, error: "proveedor e ítems requeridos" }, { status: 400 });
    const total = items.reduce((a: number, it: any) => a + (Number(it.costo_usd) || 0) * (Number(it.cantidad) || 1), 0);
    const r = await sql`INSERT INTO fg_compras (proveedor_id, proveedor_nombre, items, total_costo_usd, email_destinatario, mensaje, estado, creado_por)
      VALUES (${b.proveedor_id || null}, ${b.proveedor_nombre}, ${JSON.stringify(items)}::jsonb, ${+total.toFixed(2)}, ${b.email || null}, ${b.mensaje || null}, 'pendiente', ${u?.nombre || u?.email || "—"}) RETURNING id`;
    return NextResponse.json({ ok: true, id: r[0].id, estado: "pendiente" });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}

// PATCH { id, accion:'confirmar' (owner→envía) | 'recibir' (suma stock) | 'anular' }
export async function PATCH(req: NextRequest) {
  try {
    const sql = getDb(); await ensure(sql);
    const body = await req.json();
    const { id, accion } = body;
    if (!id) return NextResponse.json({ ok: false, error: "id requerido" }, { status: 400 });
    const c = (await sql`SELECT * FROM fg_compras WHERE id=${id}` as any[])[0];
    if (!c) return NextResponse.json({ ok: false, error: "compra no encontrada" }, { status: 404 });

    if (accion === "confirmar") {
      if (!(await esOwner(req))) return NextResponse.json({ ok: false, error: "Solo el administrador (owner) puede confirmar y enviar el pedido al proveedor." }, { status: 403 });
      if (c.estado !== "pendiente") return NextResponse.json({ ok: false, error: "El pedido ya fue " + c.estado }, { status: 409 });
      let envio: any = { ok: true, sin_email: true };
      if (c.email_destinatario) {
        const internal = process.env.INTERNAL_SERVICE_SECRET; const fvTok = process.env.FV_ADMIN_TOKEN;
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (internal) headers["Authorization"] = "Bearer " + internal; else if (fvTok) headers["X-Admin-Token"] = fvTok;
        try {
          const er = await fetch("https://febecos.com/api/admin?action=pedido-proveedor", {
            method: "POST", headers,
            body: JSON.stringify({ fv_numero: "COMPRA-" + id, proveedor: c.proveedor_nombre, email_destinatario: c.email_destinatario, mensaje: c.mensaje || "", items: c.items }),
          });
          envio = await er.json().catch(() => ({ ok: false, error: "respuesta no-JSON" }));
        } catch (e: any) { envio = { ok: false, error: e.message }; }
      }
      await sql`UPDATE fg_compras SET estado='enviado', enviado_at=now(), gsa_numero=${envio?.gsa_numero || null} WHERE id=${id}`;
      return NextResponse.json({ ok: true, envio });
    }

    if (accion === "recibir") {
      if (c.estado === "recibido" || c.estado === "recibido_dif") return NextResponse.json({ ok: false, error: "ya estaba recibida" }, { status: 409 });
      // recepcion: [{codigo, cant_recibida}] (checklist ítem por ítem). Si no viene, recibe todo.
      const recep = Array.isArray(body.recepcion) ? body.recepcion : null;
      const recMap: Record<string, number> = {};
      if (recep) for (const r of recep) recMap[r.codigo] = Number(r.cant_recibida) || 0;
      const remito = body.remito && body.remito.b64 ? { nombre: body.remito.nombre, b64: body.remito.b64, tipo: body.remito.tipo || "application/octet-stream", fecha: new Date().toISOString() } : null;
      let conDif = false;
      const detalle: any[] = [];
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      try {
        await pool.query(`ALTER TABLE fg_productos ADD COLUMN IF NOT EXISTS stock NUMERIC`).catch(() => {});
        for (const it of (c.items || [])) {
          const ped = Number(it.cantidad) || 0;
          const rec = recep ? (recMap[it.codigo] ?? 0) : ped;
          if (rec !== ped) conDif = true;
          detalle.push({ codigo: it.codigo, descripcion: it.descripcion, cant_pedida: ped, cant_recibida: rec });
          if (it.codigo && rec > 0) await pool.query(`UPDATE fg_productos SET stock = COALESCE(stock,0) + $1 WHERE codigo = $2`, [rec, it.codigo]);
        }
      } finally { await pool.end(); }
      const nuevoEstado = conDif ? "recibido_dif" : "recibido";
      await sql`UPDATE fg_compras SET estado=${nuevoEstado}, recibido_at=now(),
        recepcion=${JSON.stringify({ items: detalle, con_diferencia: conDif, fecha: new Date().toISOString() })}::jsonb,
        remito_archivo=${remito ? JSON.stringify(remito) : null}::jsonb WHERE id=${id}`;
      return NextResponse.json({ ok: true, estado: nuevoEstado, con_diferencia: conDif });
    }

    if (accion === "editar") {
      // Solo editable mientras está PENDIENTE.
      if (c.estado !== "pendiente") return NextResponse.json({ ok: false, error: "El pedido ya fue " + c.estado + ": no se puede editar." }, { status: 409 });
      const items = (body.items || []).filter((it: any) => it.codigo && Number(it.cantidad) > 0);
      if (!items.length) return NextResponse.json({ ok: false, error: "el pedido necesita al menos un ítem" }, { status: 400 });
      const total = items.reduce((a: number, it: any) => a + (Number(it.costo_usd) || 0) * (Number(it.cantidad) || 1), 0);
      await sql`UPDATE fg_compras SET items=${JSON.stringify(items)}::jsonb, total_costo_usd=${+total.toFixed(2)},
        email_destinatario=${body.email ?? c.email_destinatario}, mensaje=${body.mensaje ?? c.mensaje} WHERE id=${id}`;
      return NextResponse.json({ ok: true });
    }

    if (accion === "anular") {
      // Email destino editable (para pruebas); por defecto el del pedido.
      const emailAnula = (body.email && String(body.email).includes("@")) ? body.email : c.email_destinatario;
      // Si ya estaba enviado, avisar al proveedor con un email de ANULACIÓN.
      let aviso: any = undefined;
      if (c.estado === "enviado" && emailAnula) {
        const internal = process.env.INTERNAL_SERVICE_SECRET; const fvTok = process.env.FV_ADMIN_TOKEN;
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (internal) headers["Authorization"] = "Bearer " + internal; else if (fvTok) headers["X-Admin-Token"] = fvTok;
        try {
          const r = await fetch("https://febecos.com/api/admin?action=anular-pedido-proveedor", {
            method: "POST", headers,
            body: JSON.stringify({ email: emailAnula, proveedor: c.proveedor_nombre, gsa_numero: c.gsa_numero, items: c.items }),
          });
          aviso = await r.json().catch(() => ({ ok: false }));
        } catch (e: any) { aviso = { ok: false, error: e.message }; }
      }
      await sql`UPDATE fg_compras SET estado='anulado' WHERE id=${id}`;
      return NextResponse.json({ ok: true, aviso });
    }
    return NextResponse.json({ ok: false, error: "acción inválida" }, { status: 400 });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}
