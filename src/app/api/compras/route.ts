import { NextRequest, NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
import { getDb } from "@/lib/db";

// Compras directas a proveedor (reposición de stock, sin cliente).
// POST crea la compra + envía Excel/email (reusa el endpoint del selector).
// PATCH "recibir" suma las cantidades al stock de fg_productos.
async function ensure(sql: any) {
  await sql`CREATE TABLE IF NOT EXISTS fg_compras (
    id SERIAL PRIMARY KEY,
    proveedor_id INT,
    proveedor_nombre TEXT,
    items JSONB NOT NULL,
    total_costo_usd NUMERIC,
    email_destinatario TEXT,
    mensaje TEXT,
    gsa_numero INT,
    estado TEXT DEFAULT 'enviado',
    recibido_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
}

export async function GET(req: NextRequest) {
  try {
    const sql = getDb(); await ensure(sql);
    const pid = Number(req.nextUrl.searchParams.get("proveedor_id"));
    const rows = pid
      ? await sql`SELECT * FROM fg_compras WHERE proveedor_id=${pid} ORDER BY created_at DESC`
      : await sql`SELECT * FROM fg_compras ORDER BY created_at DESC LIMIT 200`;
    return NextResponse.json({ ok: true, compras: rows });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}

// POST { proveedor_id, proveedor_nombre, email, mensaje, items:[{codigo,descripcion,cantidad,costo_usd}] }
export async function POST(req: NextRequest) {
  try {
    const sql = getDb(); await ensure(sql);
    const b = await req.json();
    const items = (b.items || []).filter((it: any) => it.codigo && Number(it.cantidad) > 0);
    if (!b.proveedor_nombre || !items.length) return NextResponse.json({ ok: false, error: "proveedor e ítems requeridos" }, { status: 400 });
    const total = items.reduce((a: number, it: any) => a + (Number(it.costo_usd) || 0) * (Number(it.cantidad) || 1), 0);
    const r = await sql`INSERT INTO fg_compras (proveedor_id, proveedor_nombre, items, total_costo_usd, email_destinatario, mensaje, estado)
      VALUES (${b.proveedor_id || null}, ${b.proveedor_nombre}, ${JSON.stringify(items)}::jsonb, ${+total.toFixed(2)}, ${b.email || null}, ${b.mensaje || null}, 'enviado') RETURNING id`;
    const id = r[0].id;

    // Enviar Excel + email vía el selector (igual que el pedido a proveedor). Solo si hay email.
    let envio: any = { ok: true, sin_email: true };
    if (b.email) {
      const internal = process.env.INTERNAL_SERVICE_SECRET; const fvTok = process.env.FV_ADMIN_TOKEN;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (internal) headers["Authorization"] = "Bearer " + internal; else if (fvTok) headers["X-Admin-Token"] = fvTok;
      try {
        const er = await fetch("https://febecos.com/api/admin?action=pedido-proveedor", {
          method: "POST", headers,
          body: JSON.stringify({ fv_numero: "COMPRA-" + id, proveedor: b.proveedor_nombre, email_destinatario: b.email, mensaje: b.mensaje || "Compra para stock", items }),
        });
        envio = await er.json().catch(() => ({ ok: false, error: "respuesta no-JSON" }));
        if (envio?.gsa_numero) await sql`UPDATE fg_compras SET gsa_numero=${envio.gsa_numero} WHERE id=${id}`;
      } catch (e: any) { envio = { ok: false, error: e.message }; }
    }
    return NextResponse.json({ ok: true, id, envio });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}

// PATCH { id, accion:'recibir' }  → suma cantidades al stock y marca recibida
export async function PATCH(req: NextRequest) {
  try {
    const sql = getDb(); await ensure(sql);
    const { id, accion } = await req.json();
    if (!id) return NextResponse.json({ ok: false, error: "id requerido" }, { status: 400 });
    const c = (await sql`SELECT items, estado FROM fg_compras WHERE id=${id}` as any[])[0];
    if (!c) return NextResponse.json({ ok: false, error: "compra no encontrada" }, { status: 404 });
    if (accion === "recibir") {
      if (c.estado === "recibido") return NextResponse.json({ ok: false, error: "ya estaba recibida" }, { status: 409 });
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      try {
        await pool.query(`ALTER TABLE fg_productos ADD COLUMN IF NOT EXISTS stock NUMERIC`).catch(() => {});
        for (const it of (c.items || [])) {
          const cant = Number(it.cantidad) || 0; if (!it.codigo || cant <= 0) continue;
          await pool.query(`UPDATE fg_productos SET stock = COALESCE(stock,0) + $1 WHERE codigo = $2`, [cant, it.codigo]);
        }
      } finally { await pool.end(); }
      await sql`UPDATE fg_compras SET estado='recibido', recibido_at=now() WHERE id=${id}`;
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "acción inválida" }, { status: 400 });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}
