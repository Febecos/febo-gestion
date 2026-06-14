import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Pool } from "@neondatabase/serverless";

// GET /api/ventas/:id  → comprobante + items + pagos
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    const sql = getDb();
    const comp = await sql`SELECT * FROM fg_comprobantes WHERE id = ${id}`;
    if (!comp.length) return NextResponse.json({ ok: false, error: "no encontrado" }, { status: 404 });
    const items = await sql`SELECT * FROM fg_items WHERE comprobante_id = ${id} ORDER BY orden`;
    const pagos = await sql`SELECT * FROM fg_pagos WHERE comprobante_id = ${id} ORDER BY fecha DESC`;
    return NextResponse.json({ ok: true, comprobante: comp[0], items, pagos });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// Reglas de la cadena: de qué tipo se puede derivar a cuál.
const DERIVA: Record<string, { tipo: string; estado: string; pref: string; desde: string[]; estado_origen: string }> = {
  confirmar: { tipo: "pedido", estado: "confirmado", pref: "PED", desde: ["presupuesto"], estado_origen: "confirmado" },
  facturar: { tipo: "factura", estado: "proforma", pref: "F", desde: ["pedido"], estado_origen: "facturado" },
  remitir: { tipo: "remito", estado: "emitido", pref: "R", desde: ["pedido", "factura"], estado_origen: "remitido" },
};

// POST /api/ventas/:id  → acciones de la cadena.
// Body: { accion: 'confirmar'|'facturar'|'remitir'|'pagar'|'estado', ... }
//  - confirmar/facturar/remitir: derivan un nuevo comprobante (copian ítems, ref_id + operacion_id heredados)
//  - pagar: registra un pago (fg_pagos) ligado al comprobante y al cliente
//  - estado: cambia el estado del comprobante
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const id = Number(params.id);
    const b = await req.json();
    const client = await pool.connect();
    try {
      if (b.accion === "estado") {
        await client.query(`UPDATE fg_comprobantes SET estado=$1, updated_at=now() WHERE id=$2`, [b.estado, id]);
        return NextResponse.json({ ok: true });
      }

      if (b.accion === "pagar") {
        const monto = Number(b.monto) || 0;
        if (monto <= 0) return NextResponse.json({ ok: false, error: "Monto inválido" }, { status: 400 });
        const c = (await client.query(`SELECT cliente_id FROM fg_comprobantes WHERE id=$1`, [id])).rows[0];
        if (!c) throw new Error("comprobante no encontrado");
        const pago = (await client.query(
          `INSERT INTO fg_pagos (comprobante_id, cliente_id, fecha, monto, medio, notas, created_by)
           VALUES ($1,$2,COALESCE($3,now()),$4,$5,$6,$7) RETURNING id`,
          [id, c.cliente_id || null, b.fecha || null, monto, b.medio || null, b.notas || null, b.created_by || null]
        )).rows[0];
        return NextResponse.json({ ok: true, pago_id: pago.id });
      }

      const regla = DERIVA[b.accion];
      if (!regla) return NextResponse.json({ ok: false, error: "acción inválida" }, { status: 400 });

      await client.query("BEGIN");
      const src = (await client.query(`SELECT * FROM fg_comprobantes WHERE id=$1`, [id])).rows[0];
      if (!src) throw new Error("comprobante no encontrado");
      if (!regla.desde.includes(src.tipo)) throw new Error(`no se puede ${b.accion} un ${src.tipo}`);
      const opId = src.operacion_id || src.id;

      const num = (await client.query(`SELECT COUNT(*)::int n FROM fg_comprobantes WHERE tipo=$1`, [regla.tipo])).rows[0].n + 1;
      const numero = `${regla.pref}-${String(num).padStart(6, "0")}`;
      const nuevo = (await client.query(
        `INSERT INTO fg_comprobantes (tipo, estado, numero, cliente_id, cliente_nombre, cliente_cuit, ref_id, operacion_id, fecha, subtotal, total, notas, condiciones_pago, forma_pago, plazo_entrega, lugar_entrega, created_by)
         SELECT $1,$2,$3, cliente_id, cliente_nombre, cliente_cuit, id, $4, now(), subtotal, total, notas, condiciones_pago, forma_pago, plazo_entrega, lugar_entrega, created_by
         FROM fg_comprobantes WHERE id=$5 RETURNING id`,
        [regla.tipo, regla.estado, numero, opId, id]
      )).rows[0];
      await client.query(
        `INSERT INTO fg_items (comprobante_id, producto_codigo, descripcion, cantidad, precio_unitario, descuento_pct, total, orden)
         SELECT $1, producto_codigo, descripcion, cantidad, precio_unitario, descuento_pct, total, orden FROM fg_items WHERE comprobante_id=$2`,
        [nuevo.id, id]
      );
      await client.query(`UPDATE fg_comprobantes SET token = gen_random_uuid()::text WHERE id=$1 AND token IS NULL`, [nuevo.id]);
      await client.query(`UPDATE fg_comprobantes SET estado=$1, updated_at=now() WHERE id=$2`, [regla.estado_origen, id]);
      await client.query("COMMIT");
      return NextResponse.json({ ok: true, nuevo_id: nuevo.id, numero, tipo: regla.tipo });
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
    finally { client.release(); }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  } finally { await pool.end(); }
}
