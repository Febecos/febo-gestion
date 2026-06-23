import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Lista en vivo: nunca cachear (sin esto, Next.js sirve una respuesta estática y
// los pedidos nuevos NO aparecen hasta un nuevo build).
export const dynamic = "force-dynamic";
export const revalidate = 0;

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
               fp.factura_numero, fp.proveedor_confirmado, fp.pagos_recibidos,
               pr.public_token AS presup_token,
               COALESCE(NULLIF(c.nombre,''), NULLIF(c.razon_social,'')) AS cliente_crm
        FROM fv_pedidos fp
        LEFT JOIN presupuestos pr ON pr.numero = fp.payload->>'presupuesto_numero'
        LEFT JOIN clientes c ON c.id = pr.cliente_id AND (c.crm_eliminado IS NULL OR c.crm_eliminado = false)
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
        // Regla canónica: el total = neto + IVA (nunca el `total` entero que pudo guardar el
        // cotizador). Así el listado coincide con presupuesto/factura/cta cte al peso.
        const tt = pl.totales || {};
        const ivaSum = Array.isArray(tt.iva_detalle) ? tt.iva_detalle.reduce((a: number, d: any) => a + (Number(d.monto ?? d.importe) || 0), 0) : 0;
        const netoN = Number(tt.neto);
        const totalReal = (!isNaN(netoN) && Array.isArray(tt.iva_detalle) && tt.iva_detalle.length) ? +(netoN + ivaSum).toFixed(2) : (Number(tt.total) || 0);
        return {
          origen: "fv", ref: p.numero, numero: p.numero,
          cliente: p.cliente_crm || pl.revendedor?.nombre || pl.cliente?.nombre || "—",
          detalle: (pl.items?.length ? `${pl.items.length} ítem(s)` : "FV"),
          total: totalReal, moneda: pl.totales?.moneda || "USD", tc: pl.totales?.tc || null,
          estado: p.estado || "—", fecha: null,
          token: p.presup_token || p.public_token,
          presup: pl.presupuesto_numero || null,
          // Semáforo de avance del pedido del cliente
          prov_confirmado: !!p.proveedor_confirmado,
          pagado: ["pagado", "enviado"].includes(p.estado) || (p.pagos_recibidos || pl.pagos_recibidos || []).length > 0,
          factura_numero: p.factura_numero || null,
          remito_numero: pl.remito_numero || null,
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
