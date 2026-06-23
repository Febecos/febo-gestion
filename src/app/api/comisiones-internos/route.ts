import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/comisiones-internos?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Comisión de VENDEDORES INTERNOS por la tabla comisiones_tramos (tipo='vendedor_interno').
// La comisión es sobre la FACTURACIÓN TOTAL del período: se suma lo facturado por cada
// vendedor en pesos, se ubica el tramo alcanzado y se aplica ese % al total del período.
// (Los revendedores externos NO van acá: su comisión se registra por factura en su cta cte.)
export async function GET(req: NextRequest) {
  try {
    const sql = getDb();
    const sp = req.nextUrl.searchParams;
    const hoy = new Date();
    const desde = sp.get("desde") || `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-01`;
    const hasta = sp.get("hasta") || hoy.toISOString().slice(0, 10);

    // Dólar para convertir facturas en USD a pesos (los tramos están en $).
    let dolar = 0;
    try { const cfg = await sql`SELECT data FROM fv_config WHERE id=1` as any[]; dolar = Number(cfg[0]?.data?.dolar) || 0; } catch { /* */ }

    // Facturas del período con vendedor asignado (excluye anuladas).
    const facs = await sql`
      SELECT vendedor, total, moneda, tc
      FROM fg_comprobantes
      WHERE tipo='factura' AND coalesce(estado,'') NOT IN ('anulada','anulado')
        AND vendedor IS NOT NULL AND btrim(vendedor) <> ''
        AND fecha >= ${desde}::date AND fecha <= ${hasta}::date` as any[];

    // Suma por vendedor en PESOS.
    const porVendedor: Record<string, { facturado: number; nFacturas: number }> = {};
    for (const f of facs) {
      const v = String(f.vendedor).trim();
      const esArs = f.moneda === "ARS" || f.moneda === "$";
      const tc = Number(f.tc) || dolar || 0;
      const pesos = esArs ? Number(f.total) || 0 : (Number(f.total) || 0) * tc;
      if (!porVendedor[v]) porVendedor[v] = { facturado: 0, nFacturas: 0 };
      porVendedor[v].facturado += pesos;
      porVendedor[v].nFacturas += 1;
    }

    // Tramos vendedor interno (ordenados).
    const tramos = (await sql`
      SELECT nivel, desde_monto, hasta_monto, porcentaje
      FROM comisiones_tramos WHERE tipo='vendedor_interno' AND activo IS NOT FALSE
      ORDER BY desde_monto` as any[]).map((t) => ({
        nivel: t.nivel, desde: Number(t.desde_monto) || 0,
        hasta: t.hasta_monto == null ? null : Number(t.hasta_monto), pct: Number(t.porcentaje) || 0,
      }));

    const tramoDe = (monto: number) =>
      tramos.find((t) => monto >= t.desde && (t.hasta == null || monto <= t.hasta)) || null;

    const filas = Object.entries(porVendedor).map(([vendedor, d]) => {
      const t = tramoDe(d.facturado);
      const pct = t?.pct || 0;
      const comision = +(d.facturado * pct / 100).toFixed(2);
      return { vendedor, facturado: +d.facturado.toFixed(2), n_facturas: d.nFacturas, nivel: t?.nivel || "—", pct, comision };
    }).sort((a, b) => b.facturado - a.facturado);

    return NextResponse.json({ ok: true, desde, hasta, dolar, tramos, filas });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
