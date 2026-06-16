import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Datos en vivo: no cachear (Next cachea GET sin request → datos viejos).
export const dynamic = "force-dynamic";

// GET /api/clientes/[id]/operaciones
// Devuelve todas las operaciones del cliente (presupuestos/pedidos/facturas/remitos)
// + un resumen de cuenta corriente (facturado / pagado / saldo) y estado derivado.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const sql = getDb();
    const id = Number(params.id);
    if (!id) return NextResponse.json({ ok: false, error: "id inválido" }, { status: 400 });

    // Datos del cliente para relacionar con presupuestos (no hay FK: se matchea por CUIT/email/teléfono/nombre)
    const cl = await sql`SELECT cuit, email, whatsapp, razon_social, nombre FROM clientes WHERE id = ${id} LIMIT 1`;
    const cuit = (cl[0]?.cuit || "").trim();
    const email = (cl[0]?.email || "").trim().toLowerCase();
    const tel10 = (cl[0]?.whatsapp || "").replace(/\D/g, "").slice(-10);
    const razon = (cl[0]?.razon_social || "").trim();
    const nom = (cl[0]?.nombre || "").trim();

    // Presupuestos REALES (tabla `presupuestos`, la de revendedores/coti) del cliente.
    // Siempre corre: el match por cliente_id vale aunque el cliente no tenga cuit/email/tel
    // (ej. "Consumidor Final"). Los demás criterios suman presupuestos no enlazados por ID.
    const presupuestos = await sql`
        SELECT id, numero, COALESCE(tipo,'bomba') AS tipo, estado,
               bomba_codigo, bomba_descripcion, precio_ofrecido, precio_publico,
               public_token, revendedor_token, revendedor_nombre, created_at
        FROM presupuestos
        WHERE cliente_id = ${id}
           OR (${cuit} <> '' AND cliente_cuit = ${cuit})
           OR (${email} <> '' AND lower(cliente_email) = ${email})
           OR (${tel10} <> '' AND length(${tel10}) >= 8 AND right(regexp_replace(coalesce(cliente_telefono,''),'\D','','g'),10) = ${tel10})
           OR (${razon} <> '' AND lower(cliente_razon_social) = lower(${razon}))
           OR (${nom} <> '' AND lower(cliente_nombre) = lower(${nom}))
        ORDER BY created_at DESC` as any[];

    // PEDIDOS REALES (fv_pedidos) del cliente → número propio PED-NNNN (no el PREV del presupuesto).
    // Se relacionan vía el presupuesto_numero guardado en el payload del pedido.
    const presupNums = (presupuestos as any[]).map((p) => p.numero).filter(Boolean);
    let pedidos: any[] = [];
    if (presupNums.length) {
      try {
        const fvped = await sql`
          SELECT fp.numero AS numero, fp.estado, fp.public_token AS pedido_token,
                 pr.public_token AS presup_token, pr.numero AS presup_numero,
                 COALESCE(pr.tipo,'fv') AS tipo, pr.precio_ofrecido,
                 pr.bomba_codigo, pr.bomba_descripcion, pr.created_at
          FROM fv_pedidos fp
          JOIN presupuestos pr ON pr.numero = fp.payload->>'presupuesto_numero'
          WHERE fp.payload->>'presupuesto_numero' = ANY(${presupNums})
          ORDER BY fp.numero DESC` as any[];
        pedidos = fvped.map((p) => ({
          id: p.numero, numero: p.numero, tipo: p.tipo,
          bomba_codigo: p.bomba_codigo, bomba_descripcion: p.bomba_descripcion,
          precio_ofrecido: p.precio_ofrecido, created_at: p.created_at,
          estado: p.estado || "pedido", public_token: p.presup_token, presup_numero: p.presup_numero,
        }));
      } catch { pedidos = []; }
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

    // Totales por MONEDA (bombas = ARS, FV = USD) y separando presupuestos vs pedidos.
    // "Pedido" = presupuesto con estado pedido/convertido (se convirtió en pedido).
    const esPedido = (p: any) => ["pedido", "convertido"].includes((p.estado || "").toLowerCase());
    const ps = presupuestos as any[];
    const sum = (arr: any[], pred: (p: any) => boolean) => arr.filter(pred).reduce((a, p) => a + num(p.precio_ofrecido), 0);
    const coti_ars = sum(ps, (p) => p.tipo !== "fv");
    const coti_usd = sum(ps, (p) => p.tipo === "fv");
    const ped_ars = sum(ps, (p) => p.tipo !== "fv" && esPedido(p));
    const ped_usd = sum(ps, (p) => p.tipo === "fv" && esPedido(p));
    const presup_count = ps.length;
    const pedidos_count = ps.filter(esPedido).length;

    const tipos = new Set((comprobantes as any[]).map((c) => c.tipo));
    const tieneCompra = tipos.has("factura") || (compras as any[]).length > 0 || pedidos_count > 0;
    const tieneCotiza = presup_count > 0 || tipos.has("presupuesto");
    const estado_derivado = tieneCompra ? "compro" : tieneCotiza ? "cotizo" : "sin_operaciones";

    return NextResponse.json({
      ok: true,
      presupuestos,
      pedidos,
      comprobantes,
      pagos,
      compras,
      resumen: {
        facturado, pagado, saldo: facturado - pagado, estado_derivado,
        cantidad: (presupuestos as any[]).length + (compras as any[]).length,
        coti_ars, coti_usd, ped_ars, ped_usd, presup_count, pedidos_count,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
