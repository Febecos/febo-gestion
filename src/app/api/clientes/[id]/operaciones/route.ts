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

    // Datos del cliente para relacionar con presupuestos (no hay FK: se matchea por CUIT/email)
    const cl = await sql`SELECT cuit, email FROM clientes WHERE id = ${id} LIMIT 1`;
    const cuit = (cl[0]?.cuit || "").trim();
    const email = (cl[0]?.email || "").trim().toLowerCase();

    // Presupuestos REALES (tabla `presupuestos`, la de revendedores/coti) del cliente.
    let presupuestos: any[] = [];
    if (cuit || email) {
      presupuestos = await sql`
        SELECT id, numero, COALESCE(tipo,'bomba') AS tipo, estado,
               bomba_codigo, bomba_descripcion, precio_ofrecido, precio_publico,
               public_token, revendedor_nombre, created_at
        FROM presupuestos
        WHERE (${cuit} <> '' AND cliente_cuit = ${cuit})
           OR (${email} <> '' AND lower(cliente_email) = ${email})
        ORDER BY created_at DESC` as any[];
    }

    // Downstream ERP (factura/remito/pago) — fg_comprobantes (se llena al avanzar la operación)
    const comprobantes = await sql`
      SELECT id, tipo, estado, numero, ref_id, operacion_id, token, fecha, total, moneda, created_at
      FROM fg_comprobantes
      WHERE cliente_id = ${id}
      ORDER BY created_at ASC`;

    let pagos: any[] = [];
    try {
      pagos = await sql`
        SELECT id, comprobante_id, fecha, monto, medio, notas, created_at
        FROM fg_pagos WHERE cliente_id = ${id} ORDER BY created_at DESC` as any[];
    } catch { pagos = []; }

    // Compras / facturas externas (facturación Tango registrada manualmente en el admin)
    let compras: any[] = [];
    try {
      compras = await sql`
        SELECT id, monto, fecha, nro_factura, descripcion, origen, created_at,
               (archivo IS NOT NULL) AS tiene_archivo
        FROM compras_clientes WHERE cliente_id = ${id}
        ORDER BY fecha DESC NULLS LAST, created_at DESC` as any[];
    } catch { compras = []; }

    const num = (v: any) => Number(v) || 0;
    const facturadoFg = (comprobantes as any[]).filter((c) => c.tipo === "factura").reduce((a, c) => a + num(c.total), 0);
    const facturadoExt = (compras as any[]).reduce((a, c) => a + num(c.monto), 0);
    const facturado = facturadoFg + facturadoExt;
    const pagado = (pagos as any[]).reduce((a, p) => a + num(p.monto), 0);

    const tipos = new Set((comprobantes as any[]).map((c) => c.tipo));
    const tieneCompra = tipos.has("factura") || tipos.has("pedido") || (compras as any[]).length > 0;
    const tieneCotiza = (presupuestos as any[]).length > 0 || tipos.has("presupuesto");
    const estado_derivado = tieneCompra ? "compro" : tieneCotiza ? "cotizo" : "sin_operaciones";

    return NextResponse.json({
      ok: true,
      presupuestos,
      comprobantes,
      pagos,
      compras,
      resumen: {
        facturado, pagado, saldo: facturado - pagado, estado_derivado,
        cantidad: (presupuestos as any[]).length + (compras as any[]).length,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
