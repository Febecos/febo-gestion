import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// GET /api/clientes/[id]/operaciones
// Devuelve todas las operaciones del cliente (presupuestos/pedidos/facturas/remitos)
// + un resumen de cuenta corriente (facturado / pagado / saldo) y estado derivado.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const sql = getDb();
    const id = Number(params.id);
    if (!id) return NextResponse.json({ ok: false, error: "id inválido" }, { status: 400 });

    const comprobantes = await sql`
      SELECT id, tipo, estado, numero, ref_id, fecha, total, moneda, created_at
      FROM fg_comprobantes
      WHERE cliente_id = ${id}
      ORDER BY created_at DESC`;

    let pagos: any[] = [];
    try {
      pagos = await sql`
        SELECT id, comprobante_id, fecha, monto, medio, notas, created_at
        FROM fg_pagos WHERE cliente_id = ${id} ORDER BY created_at DESC` as any[];
    } catch { pagos = []; }

    const num = (v: any) => Number(v) || 0;
    const facturado = (comprobantes as any[])
      .filter((c) => c.tipo === "factura")
      .reduce((a, c) => a + num(c.total), 0);
    const pagado = (pagos as any[]).reduce((a, p) => a + num(p.monto), 0);

    const tipos = new Set((comprobantes as any[]).map((c) => c.tipo));
    const estado_derivado = (tipos.has("factura") || tipos.has("pedido"))
      ? "compro" : tipos.has("presupuesto") ? "cotizo" : "sin_operaciones";

    return NextResponse.json({
      ok: true,
      comprobantes,
      pagos,
      resumen: { facturado, pagado, saldo: facturado - pagado, estado_derivado, cantidad: (comprobantes as any[]).length },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
