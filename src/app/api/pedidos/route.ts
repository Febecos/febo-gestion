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
        SELECT numero, estado, public_token, payload, metodo_pago
        FROM fv_pedidos ORDER BY numero DESC LIMIT 300` as any[];
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
          total: Number(pl.totales?.total) || 0, moneda: pl.totales?.moneda || "USD",
          estado: p.estado || "—", fecha: null, token: p.public_token,
          presup: pl.presupuesto_numero || null,
        };
      }),
    ];
    // bombas tienen fecha; fv no → bombas primero por fecha, fv después por número
    lista.sort((a, b) => (b.fecha ? new Date(b.fecha).getTime() : 0) - (a.fecha ? new Date(a.fecha).getTime() : 0));

    return NextResponse.json({ ok: true, pedidos: lista });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
