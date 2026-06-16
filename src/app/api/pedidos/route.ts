import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// GET /api/pedidos  → pedidos UNIFICADOS: bombas (`pedidos`) + fotovoltaico (`fv_pedidos`).
// Normaliza ambos a una sola forma para listarlos juntos.
export async function GET(_req: NextRequest) {
  try {
    const sql = getDb();

    const bombas = await sql`
      SELECT id, numero, revendedor_nombre, bomba_codigo, bomba_descripcion,
             precio_final, estado, tipo_comprador, created_at
      FROM pedidos ORDER BY created_at DESC LIMIT 300` as any[];

    let fv: any[] = [];
    try {
      fv = await sql`
        SELECT fp.numero, fp.estado, fp.public_token, fp.payload, fp.metodo_pago,
               pr.public_token AS presup_token
        FROM fv_pedidos fp
        LEFT JOIN presupuestos pr ON pr.numero = fp.payload->>'presupuesto_numero'
        ORDER BY fp.numero DESC LIMIT 300` as any[];
    } catch { fv = []; }

    const lista = [
      ...bombas.map((p) => ({
        origen: "bomba", ref: p.id, numero: p.numero || null,
        cliente: p.revendedor_nombre || "—",
        detalle: p.bomba_codigo || p.bomba_descripcion || "—",
        total: Number(p.precio_final) || 0, moneda: "$",
        estado: p.estado || "—", fecha: p.created_at, token: null, presup: null,
      })),
      ...fv.map((p) => {
        const pl = p.payload || {};
        return {
          origen: "fv", ref: p.numero, numero: p.numero,
          cliente: pl.revendedor?.nombre || pl.cliente?.nombre || "—",
          detalle: (pl.items?.length ? `${pl.items.length} ítem(s)` : "FV"),
          total: Number(pl.totales?.total) || 0, moneda: pl.totales?.moneda || "USD", tc: pl.totales?.tc || null,
          estado: p.estado || "—", fecha: null,
          token: p.presup_token || p.public_token,
          presup: pl.presupuesto_numero || null,
        };
      }),
    ];
    // Ordenar por NÚMERO de pedido (PED-NNNN) descendente
    const numOf = (x: any) => { const m = String(x.numero || "").match(/(\d+)\s*$/); return m ? parseInt(m[1], 10) : 0; };
    lista.sort((a, b) => numOf(b) - numOf(a));

    return NextResponse.json({ ok: true, pedidos: lista });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
