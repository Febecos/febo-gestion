import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// GET /api/lista-precios?proveedor=&categoria=&moneda=
// Genera los datos de una LISTA DE PRECIOS PARA REVENDEDORES (pedido de Guille 07/07).
//
// ⚠️⚠️ CRÍTICO (privacidad comercial): la respuesta NUNCA incluye el NOMBRE DEL PROVEEDOR, el COSTO,
// ni el MARKUP %. El revendedor no puede ver de dónde sacamos el producto, a cuánto lo compramos, ni
// el margen. Los niveles por volumen se exponen como % de DESCUENTO sobre el precio de lista (relativo),
// que NO permite despejar el costo (a diferencia del markup, que sí: costo = precio/(1+markup)).
//
// PRECIOS (⚠️ base a CONFIRMAR con Guille — es plata; parametrizado acá arriba):
//  - precio_publico = costo × (1 + markup_cf_pct/100)          → "PVP público" del catálogo (cliente final).
//  - precio_reventa = costo × (1 + markupBase/100)             → markupBase = 1er nivel por volumen
//        (compras chicas = mayor markup = precio de lista). Los niveles mejores salen en la tabla de volumen.
//  Moneda USD (default, la que va a revendedores): NETO por producto (+ IVA aparte según columna IVA).
//  Moneda ARS: × dólar, con IVA incluido, redondeo entero.
const MARKUP_REVENTA_PCT_FALLBACK = 40; // si no hay niveles por volumen configurados.

export async function GET(req: NextRequest) {
  try {
    const sql = getDb();
    const sp = req.nextUrl.searchParams;
    const proveedor = (sp.get("proveedor") || "").trim();
    const categoria = (sp.get("categoria") || "").trim();
    const soloStock = sp.get("stock") === "1";
    const moneda = sp.get("moneda") === "USD" ? "USD" : "ARS"; // USD = la lista para revendedores

    // dólar + markup público + niveles por volumen (markup_tramos) desde fv_config (misma fuente que el cotizador)
    let dolar = 0, markupPublico = 74, usarTramos = false;
    let tramos: { hasta_usd: number | null; markup_pct: number }[] = [];
    try {
      const cfg = await sql`SELECT data FROM fv_config WHERE id = 1`;
      const d = (cfg[0] as any)?.data || {};
      dolar = Number(d.dolar) || 0;
      if (d.markup_cf_pct != null && d.markup_cf_pct !== "") markupPublico = Number(d.markup_cf_pct);
      usarTramos = !!d.usar_tramos;
      tramos = (Array.isArray(d.markup_tramos) ? d.markup_tramos : [])
        .filter((t: any) => t && t.markup_pct != null && t.markup_pct !== "")
        .map((t: any) => ({ hasta_usd: (t.hasta_usd == null || t.hasta_usd === "") ? null : Number(t.hasta_usd), markup_pct: Number(t.markup_pct) }))
        .sort((a: any, b: any) => (a.hasta_usd ?? Infinity) - (b.hasta_usd ?? Infinity));
    } catch { /* usa defaults */ }
    if (!dolar) return NextResponse.json({ ok: false, error: "No hay cotización del dólar configurada (fv_config)." }, { status: 500 });

    // Markup de la LISTA = el del 1er nivel por volumen (compras chicas). Los demás niveles se muestran
    // como descuento en la tabla de volumen. Si no hay niveles, usa el fallback 40%.
    const markupBase = (usarTramos && tramos.length) ? tramos[0].markup_pct : MARKUP_REVENTA_PCT_FALLBACK;

    const rows = await sql`
      SELECT codigo, descripcion, categoria, costo_usd, iva_pct, disponibilidad
      FROM fg_productos
      WHERE activo = true AND origen = 'fv' AND costo_usd IS NOT NULL AND COALESCE(sin_precio, false) = false
        AND (${proveedor} = '' OR proveedor = ${proveedor})
        AND (${categoria} = '' OR categoria = ${categoria})
        AND (${soloStock ? "1" : ""} = '' OR (disponibilidad ILIKE '%stock%' AND disponibilidad NOT ILIKE '%sin stock%'))
      ORDER BY categoria, descripcion` as any[];

    // ⚠️ IVA en USD (TO-CONFIRM): la lista USD sale NETA (+ IVA aparte), consistente con "USD 1.200 + IVA".
    const USD_CON_IVA = false;
    const conIva = moneda === "USD" ? USD_CON_IVA : true; // ARS siempre con IVA (precio final)

    const fRev = 1 + markupBase / 100;
    const fPub = 1 + markupPublico / 100;
    const productos = rows
      // flete = costo puro (sin markup) → no es un producto de reventa, se excluye del listado.
      .filter((p) => !/flete/i.test(String(p.codigo || "") + " " + String(p.descripcion || "") + " " + String(p.categoria || "")))
      .map((p) => {
        const ivaPct = Number(p.iva_pct || 21);
        const ivaMul = conIva ? 1 + ivaPct / 100 : 1;
        const costo = Number(p.costo_usd);
        // USD: costo × markup (× IVA si USD_CON_IVA), 2 decimales — NO × dólar. ARS: × dólar, entero.
        const px = (f: number) => moneda === "USD"
          ? +(costo * f * ivaMul).toFixed(2)
          : Math.round(costo * f * ivaMul * dolar);
        return {
          codigo: p.codigo || "",
          descripcion: p.descripcion || "",
          categoria: p.categoria || "VARIOS",
          iva_pct: ivaPct,
          precio_reventa: px(fRev),
          precio_publico: px(fPub),
        };
      });

    // Niveles por volumen para la tabla del pie: el descuento es RELATIVO al precio de lista (markupBase),
    // no expone el markup absoluto ni el costo. desde/hasta en USD NETO de compra (el volumen del pedido).
    const nivelesVolumen = usarTramos && tramos.length > 1
      ? tramos.map((t, i) => ({
          desde_usd: i === 0 ? 0 : (tramos[i - 1].hasta_usd ?? 0),
          hasta_usd: t.hasta_usd, // null = sin tope
          descuento_pct: +(((1 - (1 + t.markup_pct / 100) / (1 + markupBase / 100)) * 100)).toFixed(1),
        }))
      : [];

    return NextResponse.json({
      ok: true,
      productos,
      total: productos.length,
      niveles_volumen: nivelesVolumen,
      meta: { dolar, moneda, con_iva: conIva, markup_publico_pct: markupPublico },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
