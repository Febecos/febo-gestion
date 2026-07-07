import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// GET /api/lista-precios?proveedor=&categoria=
// Genera los datos de una LISTA DE PRECIOS PARA REVENDEDORES (pedido de Guille 07/07).
//
// ⚠️⚠️ CRÍTICO (privacidad comercial): la respuesta NUNCA incluye el NOMBRE DEL PROVEEDOR ni el
// COSTO. El revendedor no puede ver de dónde sacamos el producto ni a cuánto lo compramos. El
// `proveedor`/`categoria` de la query se usan SOLO para filtrar server-side; no se devuelven por ítem.
//
// PRECIOS (⚠️ base a CONFIRMAR con Guille — es plata; por eso está parametrizado acá arriba):
//  - precio_publico = costo × (1 + markup_publico/100) × (1 + IVA) × dólar
//        markup_publico = markup_cf_pct de fv_config (el "PVP público" del catálogo, cliente final).
//  - precio_reventa = costo × (1 + MARKUP_REVENTA_PCT/100) × (1 + IVA) × dólar
//        MARKUP_REVENTA_PCT = 40 (reventa = costo + 40%). Si Guille confirma que el 40% es un
//        DESCUENTO sobre el público (y no un markup sobre el costo), cambiar SOLO la línea de abajo.
const MARKUP_REVENTA_PCT = 40; // ⚠️ TO-CONFIRM. reventa = costo × (1 + 40/100). Único lugar a tocar.

// Datos que fg_productos ya mirrorea del catálogo FV (origen='fv', con costo_usd/categoria/iva).
export async function GET(req: NextRequest) {
  try {
    const sql = getDb();
    const sp = req.nextUrl.searchParams;
    const proveedor = (sp.get("proveedor") || "").trim();
    const categoria = (sp.get("categoria") || "").trim();
    const soloStock = sp.get("stock") === "1";

    // dólar + markup público vigente desde fv_config (misma fuente que el cotizador)
    let dolar = 0, markupPublico = 74;
    try {
      const cfg = await sql`SELECT data FROM fv_config WHERE id = 1`;
      const d = (cfg[0] as any)?.data || {};
      dolar = Number(d.dolar) || 0;
      if (d.markup_cf_pct != null && d.markup_cf_pct !== "") markupPublico = Number(d.markup_cf_pct);
    } catch { /* usa defaults */ }
    if (!dolar) return NextResponse.json({ ok: false, error: "No hay cotización del dólar configurada (fv_config)." }, { status: 500 });

    const rows = await sql`
      SELECT codigo, descripcion, categoria, costo_usd, iva_pct, disponibilidad
      FROM fg_productos
      WHERE activo = true AND origen = 'fv' AND costo_usd IS NOT NULL AND COALESCE(sin_precio, false) = false
        AND (${proveedor} = '' OR proveedor = ${proveedor})
        AND (${categoria} = '' OR categoria = ${categoria})
        AND (${soloStock ? "1" : ""} = '' OR (disponibilidad ILIKE '%stock%' AND disponibilidad NOT ILIKE '%sin stock%'))
      ORDER BY categoria, descripcion` as any[];

    const fRev = 1 + MARKUP_REVENTA_PCT / 100;
    const fPub = 1 + markupPublico / 100;
    const productos = rows
      // flete = costo puro (sin markup) → no es un producto de reventa, se excluye del listado.
      .filter((p) => !/flete/i.test(String(p.codigo || "") + " " + String(p.descripcion || "") + " " + String(p.categoria || "")))
      .map((p) => {
        const iva = 1 + Number(p.iva_pct || 21) / 100;
        const costo = Number(p.costo_usd);
        return {
          codigo: p.codigo || "",
          descripcion: p.descripcion || "",
          categoria: p.categoria || "VARIOS",
          precio_reventa: Math.round(costo * fRev * iva * dolar),
          precio_publico: Math.round(costo * fPub * iva * dolar),
        };
      });

    return NextResponse.json({
      ok: true,
      productos,
      total: productos.length,
      meta: { dolar, markup_reventa_pct: MARKUP_REVENTA_PCT, markup_publico_pct: markupPublico },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
