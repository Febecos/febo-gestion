import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Pool } from "@neondatabase/serverless";

// GET /api/ventas?tipo=&estado=&q=  → lista de comprobantes
export async function GET(req: NextRequest) {
  try {
    const sql = getDb();
    const sp = req.nextUrl.searchParams;
    const tipo = (sp.get("tipo") || "").trim();
    const estado = (sp.get("estado") || "").trim();
    const q = (sp.get("q") || "").trim().toLowerCase();
    const like = `%${q}%`;
    const rows = await sql`
      SELECT id, tipo, estado, numero, cliente_id, cliente_nombre, cliente_cuit,
             ref_id, fecha, total, moneda, token, created_at
      FROM fg_comprobantes
      WHERE (${tipo} = '' OR tipo = ${tipo})
        AND (${estado} = '' OR estado = ${estado})
        AND (${q} = '' OR lower(coalesce(cliente_nombre,'')||' '||coalesce(numero,'')||' '||coalesce(cliente_cuit,'')) LIKE ${like})
      ORDER BY created_at DESC LIMIT 200`;
    return NextResponse.json({ ok: true, comprobantes: rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// POST /api/ventas  → crea un comprobante (default presupuesto) con sus ítems.
// Body: { tipo?, cliente_id, cliente_nombre, cliente_cuit?, fecha?, notas?, condiciones_pago?, items:[{descripcion,cantidad,precio_unitario,descuento_pct}] }
export async function POST(req: NextRequest) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const b = await req.json();
    const items = Array.isArray(b.items) ? b.items : [];
    if (!b.cliente_id && !b.cliente_nombre) return NextResponse.json({ ok: false, error: "Falta el cliente" }, { status: 400 });
    if (!items.length) return NextResponse.json({ ok: false, error: "Agregá al menos un ítem" }, { status: 400 });

    const calcItem = (it: any) => {
      const cant = Number(it.cantidad) || 0, pu = Number(it.precio_unitario) || 0, d = Number(it.descuento_pct) || 0;
      return Math.round(cant * pu * (1 - d / 100) * 100) / 100;
    };
    const subtotal = items.reduce((a: number, it: any) => a + calcItem(it), 0);
    const tipo = b.tipo || "presupuesto";

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // numeración simple por tipo: P-000001 / etc
      const pref = { presupuesto: "P", pedido: "PED", factura: "F", remito: "R" }[tipo as string] || "C";
      const num = (await client.query(`SELECT COUNT(*)::int n FROM fg_comprobantes WHERE tipo=$1`, [tipo])).rows[0].n + 1;
      const numero = `${pref}-${String(num).padStart(6, "0")}`;

      const comp = (await client.query(
        `INSERT INTO fg_comprobantes (tipo, estado, numero, cliente_id, cliente_nombre, cliente_cuit, fecha, subtotal, total, notas, condiciones_pago, forma_pago, plazo_entrega, lugar_entrega, created_by)
         VALUES ($1,'emitido',$2,$3,$4,$5,COALESCE($6,now()),$7,$7,$8,$9,$10,$11,$12,$13) RETURNING id, numero`,
        [tipo, numero, b.cliente_id || null, b.cliente_nombre || null, b.cliente_cuit || null, b.fecha || null, subtotal, b.notas || null, b.condiciones_pago || null, b.forma_pago || null, b.plazo_entrega || null, b.lugar_entrega || null, b.created_by || null]
      )).rows[0];

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        await client.query(
          `INSERT INTO fg_items (comprobante_id, producto_codigo, descripcion, cantidad, precio_unitario, descuento_pct, total, orden)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [comp.id, it.producto_codigo || null, it.descripcion || "", Number(it.cantidad) || 0, Number(it.precio_unitario) || 0, Number(it.descuento_pct) || 0, calcItem(it), i]
        );
      }
      // Comprobante creado directo (presupuesto) = cabeza de su propia operación.
      await client.query(`UPDATE fg_comprobantes SET operacion_id = id, token = COALESCE(token, gen_random_uuid()::text) WHERE id = $1`, [comp.id]);
      await client.query("COMMIT");
      return NextResponse.json({ ok: true, id: comp.id, numero: comp.numero });
    } catch (e) { await client.query("ROLLBACK"); throw e; }
    finally { client.release(); }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  } finally { await pool.end(); }
}
