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

// POST /api/ventas/:id  → acciones. Body: { accion: 'confirmar'|'estado', estado? }
//  - confirmar: presupuesto → genera PEDIDO (copia items, ref al presupuesto)
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
      if (b.accion === "confirmar") {
        await client.query("BEGIN");
        const p = (await client.query(`SELECT * FROM fg_comprobantes WHERE id=$1`, [id])).rows[0];
        if (!p) throw new Error("presupuesto no encontrado");
        if (p.tipo !== "presupuesto") throw new Error("solo se confirma un presupuesto");
        const num = (await client.query(`SELECT COUNT(*)::int n FROM fg_comprobantes WHERE tipo='pedido'`)).rows[0].n + 1;
        const numero = `PED-${String(num).padStart(6, "0")}`;
        const ped = (await client.query(
          `INSERT INTO fg_comprobantes (tipo, estado, numero, cliente_id, cliente_nombre, cliente_cuit, ref_id, fecha, subtotal, total, notas, condiciones_pago, forma_pago, plazo_entrega, lugar_entrega, created_by)
           SELECT 'pedido','confirmado',$1, cliente_id, cliente_nombre, cliente_cuit, id, now(), subtotal, total, notas, condiciones_pago, forma_pago, plazo_entrega, lugar_entrega, created_by
           FROM fg_comprobantes WHERE id=$2 RETURNING id`,
          [numero, id]
        )).rows[0];
        await client.query(
          `INSERT INTO fg_items (comprobante_id, producto_codigo, descripcion, cantidad, precio_unitario, descuento_pct, total, orden)
           SELECT $1, producto_codigo, descripcion, cantidad, precio_unitario, descuento_pct, total, orden FROM fg_items WHERE comprobante_id=$2`,
          [ped.id, id]
        );
        await client.query(`UPDATE fg_comprobantes SET estado='confirmado', updated_at=now() WHERE id=$1`, [id]);
        await client.query("COMMIT");
        return NextResponse.json({ ok: true, pedido_id: ped.id, numero });
      }
      return NextResponse.json({ ok: false, error: "acción inválida" }, { status: 400 });
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
    finally { client.release(); }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  } finally { await pool.end(); }
}
