import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Pedidos a proveedor (tabla pedidos_proveedores, compartida con el admin del selector).
// GET ?id= → detalle · GET → lista (filtros proveedor/estado/q)
// PATCH { id, accion: 'estado'|'recibir'|'pago' }
async function ensure(sql: any) {
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS numero_remito TEXT`.catch(() => {});
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS items_recibidos JSONB`.catch(() => {});
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS total_recibido_usd NUMERIC`.catch(() => {});
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS notas_recepcion TEXT`.catch(() => {});
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS pagado_archivo JSONB`.catch(() => {});
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS pagado_fecha TIMESTAMPTZ`.catch(() => {});
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS origen TEXT DEFAULT 'fv'`.catch(() => {});
}

export async function GET(req: NextRequest) {
  try {
    const sql = getDb(); await ensure(sql);
    const sp = req.nextUrl.searchParams;
    const id = Number(sp.get("id"));
    if (id) {
      const r = await sql`SELECT * FROM pedidos_proveedores WHERE id=${id} LIMIT 1` as any[];
      if (!r.length) return NextResponse.json({ ok: false, error: "no encontrado" }, { status: 404 });
      return NextResponse.json({ ok: true, pedido: r[0] });
    }
    const prov = (sp.get("proveedor") || "").trim();
    const estado = (sp.get("estado") || "").trim();
    const q = (sp.get("q") || "").trim().toLowerCase();
    const like = `%${q}%`;
    const rows = await sql`
      SELECT id, proveedor, fv_numero, items, total_costo_usd, email_destinatario, gsa_numero, estado,
             COALESCE(origen,'fv') AS origen, numero_remito, total_recibido_usd, pagado_fecha, created_at
      FROM pedidos_proveedores
      WHERE (${prov} = '' OR proveedor = ${prov})
        AND (${estado} = '' OR estado = ${estado})
        AND (${q} = '' OR lower(coalesce(proveedor,'')||' '||coalesce(fv_numero,'')||' '||coalesce(gsa_numero::text,'')) LIKE ${like})
      ORDER BY id DESC LIMIT 400`;
    return NextResponse.json({ ok: true, pedidos: rows });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}

const ESTADOS = ["pendiente", "confirmado", "pagado", "recibido_ok", "recibido_diferencias", "enviado"];

export async function PATCH(req: NextRequest) {
  try {
    const sql = getDb(); await ensure(sql);
    const b = await req.json();
    const { id, accion } = b;
    if (!id) return NextResponse.json({ ok: false, error: "id requerido" }, { status: 400 });

    if (accion === "estado") {
      if (!ESTADOS.includes(b.estado)) return NextResponse.json({ ok: false, error: "estado inválido" }, { status: 400 });
      await sql`UPDATE pedidos_proveedores SET estado=${b.estado} WHERE id=${id}`;
      return NextResponse.json({ ok: true });
    }
    if (accion === "recibir") {
      const its = Array.isArray(b.items_recibidos) ? b.items_recibidos : [];
      const totalRec = its.reduce((s: number, it: any) => s + (Number(it.costo_usd || 0) * Number(it.cantidad || 0)), 0);
      const estado = b.con_diferencias ? "recibido_diferencias" : "recibido_ok";
      await sql`UPDATE pedidos_proveedores SET estado=${estado}, items_recibidos=${JSON.stringify(its)}::jsonb,
        total_recibido_usd=${+totalRec.toFixed(2)}, numero_remito=${b.numero_remito || null}, notas_recepcion=${b.notas || null} WHERE id=${id}`;
      return NextResponse.json({ ok: true, estado });
    }
    if (accion === "pago") {
      await sql`UPDATE pedidos_proveedores SET estado='pagado', pagado_fecha=now(),
        pagado_archivo=${b.archivo ? JSON.stringify(b.archivo) : null}::jsonb WHERE id=${id}`;
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "acción inválida" }, { status: 400 });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}

// POST → "Cargar a Compras": crea un pedido a proveedor (pendiente) desde el detalle del pedido.
// El envío real al proveedor se hace desde el módulo Compras. Autocontenido.
export async function POST(req: NextRequest) {
  try {
    const sql = getDb(); await ensure(sql);
    const b = await req.json();
    const items = (b.items || []).filter((it: any) => it.codigo && Number(it.cantidad) > 0);
    if (!b.proveedor || !items.length) return NextResponse.json({ ok: false, error: "proveedor e ítems requeridos" }, { status: 400 });
    const total = items.reduce((a: number, it: any) => a + (Number(it.costo_usd) || 0) * (Number(it.cantidad) || 1), 0);
    const ccStr = (Array.isArray(b.cc) ? b.cc : []).map((x: any) => String(x || "").trim()).filter((x: string) => /\S+@\S+\.\S+/.test(x)).join(", ") || null;
    const r = await sql`INSERT INTO pedidos_proveedores (proveedor, fv_numero, items, total_costo_usd, email_destinatario, mensaje, cc_emails, estado, origen, creado_por)
      VALUES (${b.proveedor}, ${b.fv_numero || null}, ${JSON.stringify(items)}::jsonb, ${+total.toFixed(2)}, ${b.email_destinatario || null}, ${b.mensaje || null}, ${ccStr}, 'pendiente', ${b.origen || "compra"}, ${b.creado_por || null}) RETURNING id` as any[];
    return NextResponse.json({ ok: true, id: r[0].id, estado: "pendiente" });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}
