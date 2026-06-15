import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// GET /api/operaciones?estado=&q=
// Cockpit del circuito interno — VISTA DE SOLO LECTURA derivada de la MISMA fuente
// que Pedidos (`pedidos` + `fv_pedidos`). NO tiene estado propio: el estado se calcula
// en vivo desde el pedido real, así Pedidos y Operaciones nunca se desincronizan y no
// hay doble facturación (el avance del circuito se hace en el modal de Pedidos).

// Circuito: pedido_proveedor → reservado_proveedor → confirmado_cliente → pagado_cliente → facturado
function estadoFv(fp: any): string {
  const e = String(fp.estado || "").toLowerCase();
  if (e === "cancelado") return "anulado";
  if (fp.factura_numero || e === "facturado") return "facturado";
  if (fp.pago_proveedor) return "pagado_proveedor";
  if (e === "pagado" || e === "enviado") return "pagado_cliente";
  if (fp.proveedor_confirmado) return "confirmado_cliente";
  if (e === "aprobado") return "reservado_proveedor";
  return "pedido_proveedor";
}
function estadoBomba(p: any): string {
  const e = String(p.estado || "").toLowerCase();
  if (e === "cancelado" || e === "anulado") return "anulado";
  if (e === "facturado") return "facturado";
  if (e === "pagado" || e === "enviado") return "pagado_cliente";
  if (e === "confirmado" || e === "aprobado") return "confirmado_cliente";
  if (e === "reservado") return "reservado_proveedor";
  return "pedido_proveedor";
}

export async function GET(req: NextRequest) {
  try {
    const sql = getDb();
    const sp = req.nextUrl.searchParams;
    const estado = (sp.get("estado") || "").trim();
    const q = (sp.get("q") || "").trim().toLowerCase();

    const bombas = await sql`
      SELECT id, numero, revendedor_nombre, precio_final, estado, created_at
      FROM pedidos ORDER BY created_at DESC LIMIT 300` as any[];

    let fv: any[] = [];
    try {
      fv = await sql`
        SELECT fp.numero, fp.estado, fp.payload, fp.proveedor_confirmado, fp.factura_numero, fp.recibido, fp.pago_proveedor,
               (SELECT pr.vendedor FROM presupuestos pr WHERE pr.numero = fp.payload->>'presupuesto_numero' LIMIT 1) AS vendedor
        FROM fv_pedidos fp ORDER BY fp.numero DESC LIMIT 300` as any[];
    } catch { fv = []; }

    let rows = [
      ...bombas.map((p) => ({
        origen: "bomba", ref: String(p.id), numero: p.numero || ("PED-" + p.id),
        cliente_nombre: p.revendedor_nombre || "—", vendedor: null,
        total: Number(p.precio_final) || 0, moneda: "ARS",
        estado: estadoBomba(p), factura_numero: null, created_at: p.created_at,
      })),
      ...fv.map((p) => {
        const pl = p.payload || {};
        return {
          origen: "fv", ref: p.numero, numero: p.numero,
          cliente_nombre: pl.revendedor?.nombre || pl.cliente?.nombre || "—",
          vendedor: p.vendedor || null,
          total: Number(pl.totales?.total) || 0, moneda: pl.totales?.moneda || "USD",
          estado: estadoFv(p), factura_numero: p.factura_numero || null, created_at: p.recibido,
        };
      }),
    ];

    if (estado) rows = rows.filter((r) => r.estado === estado);
    if (q) rows = rows.filter((r) => (String(r.numero || "") + " " + String(r.cliente_nombre || "")).toLowerCase().includes(q));
    const numOf = (x: any) => { const m = String(x.numero || "").match(/(\d+)\s*$/); return m ? parseInt(m[1], 10) : 0; };
    rows.sort((a, b) => numOf(b) - numOf(a));

    return NextResponse.json({ ok: true, operaciones: rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
