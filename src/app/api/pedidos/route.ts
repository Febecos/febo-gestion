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
               fac.fac_token, fac.nc_numero, fac.nc_token,
               c.id AS cliente_id,
               COALESCE(NULLIF(c.nombre,''), NULLIF(c.razon_social,'')) AS cliente_crm
        FROM fv_pedidos fp
        LEFT JOIN presupuestos pr ON pr.numero = fp.payload->>'presupuesto_numero'
        -- Resolver el cliente del CRM como en Presupuestos: por id, y si el presupuesto no quedó
        -- enlazado, por cuit/email/teléfono/nombre. Así el 👤 (ficha CRM) aparece igual.
        LEFT JOIN LATERAL (
          SELECT cc.id, cc.nombre, cc.razon_social FROM clientes cc
          WHERE (cc.crm_eliminado IS NULL OR cc.crm_eliminado = false) AND (
                cc.id = pr.cliente_id
             OR (coalesce(pr.cliente_cuit,'') <> '' AND cc.cuit = pr.cliente_cuit)
             OR (coalesce(pr.cliente_email,'') <> '' AND lower(cc.email) = lower(pr.cliente_email))
             OR (coalesce(pr.cliente_telefono,'') <> '' AND length(regexp_replace(coalesce(cc.whatsapp,''),'\D','','g')) >= 8
                 AND right(regexp_replace(cc.whatsapp,'\D','','g'),10) = right(regexp_replace(pr.cliente_telefono,'\D','','g'),10))
             OR (coalesce(pr.cliente_nombre,'') <> '' AND lower(cc.nombre) = lower(pr.cliente_nombre)))
          ORDER BY (cc.id = pr.cliente_id) DESC, (cc.cuit = pr.cliente_cuit) DESC NULLS LAST, cc.id ASC
          LIMIT 1
        ) c ON true
        -- Factura emitida del pedido (por número) + su Nota de Crédito si existe (operacion_id = factura.id)
        LEFT JOIN LATERAL (
          SELECT f.token AS fac_token, nc.numero AS nc_numero, nc.token AS nc_token
          FROM fg_comprobantes f
          LEFT JOIN LATERAL (
            SELECT n.numero, n.token FROM fg_comprobantes n
            WHERE n.operacion_id = f.id AND n.tipo = 'nota_credito' ORDER BY n.id DESC LIMIT 1
          ) nc ON true
          WHERE f.tipo = 'factura' AND coalesce(fp.factura_numero,'') <> '' AND f.numero = fp.factura_numero
          ORDER BY f.id DESC LIMIT 1
        ) fac ON true
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
        // neto+IVA cuando está poblado (>0); si no (algunos pedidos guardan total pero neto=0),
        // caer al total guardado para no mostrar "0".
        const sumNI = (!isNaN(netoN) && Array.isArray(tt.iva_detalle) && tt.iva_detalle.length) ? +(netoN + ivaSum).toFixed(2) : 0;
        const totalReal = sumNI > 0 ? sumNI : (Number(tt.total) || 0);
        return {
          origen: "fv", ref: p.numero, numero: p.numero,
          cliente_id: p.cliente_id ? Number(p.cliente_id) : null,
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
          factura_token: p.fac_token || null,
          nc_numero: p.nc_numero || null,
          nc_token: p.nc_token || null,
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
