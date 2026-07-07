import { getDb } from "@/lib/db";

// Núcleo de cálculo de la LISTA DE PRECIOS PARA REVENDEDORES / VISOR PÚBLICO (pedido de Guille 07/07).
// Compartido por el endpoint interno (con auth, muestra reventa + público) y el endpoint público
// (visor, solo precio SUGERIDO a público). Centralizar acá evita que las reglas de markup ("es plata")
// queden duplicadas y se desincronicen.
//
// ⚠️⚠️ CRÍTICO (privacidad comercial): el resultado NUNCA incluye NOMBRE DE PROVEEDOR, COSTO ni MARKUP %.

export const MARKUP_REVENTA_PCT_FALLBACK = 40; // si no hay niveles por volumen configurados.

// Markup PÚBLICO por categoría (override del markup_cf global). Regla de Guille 07/07: termotanques
// (Innovasol) van al 60% público, NO al 74% global. Extensible por categoría.
export const MARKUP_PUBLICO_POR_CATEGORIA: Record<string, number> = {
  "TERMOTANQUES SOLARES": 60,
};

export type ProductoLista = {
  codigo: string;
  descripcion: string;
  categoria: string;
  iva_pct: number;
  precio_reventa: number;
  precio_publico: number;
};

export type NivelVolumen = { desde_usd: number; hasta_usd: number | null; descuento_pct: number };

export async function computarLista(opts: {
  proveedor?: string;
  categorias?: string[];     // multi-rubro; vacío = todos
  soloStock?: boolean;
  moneda?: "USD" | "ARS";
}): Promise<{
  ok: true; productos: ProductoLista[]; niveles_volumen: NivelVolumen[];
  meta: { dolar: number; moneda: "USD" | "ARS"; con_iva: boolean; markup_publico_pct: number };
} | { ok: false; error: string; status: number }> {
  const sql = getDb();
  const proveedor = (opts.proveedor || "").trim();
  const categorias = (opts.categorias || []).map((c) => c.trim()).filter(Boolean);
  const soloStock = !!opts.soloStock;
  const moneda = opts.moneda === "USD" ? "USD" : "ARS";

  // dólar + markup público + niveles por volumen (markup_tramos) — SIEMPRE en vivo de fv_config.
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
  if (!dolar) return { ok: false, error: "No hay cotización del dólar configurada (fv_config).", status: 500 };

  const markupBase = (usarTramos && tramos.length) ? tramos[0].markup_pct : MARKUP_REVENTA_PCT_FALLBACK;

  const rows = await sql`
    SELECT codigo, descripcion, categoria, costo_usd, iva_pct, disponibilidad
    FROM fg_productos
    WHERE activo = true AND origen = 'fv' AND costo_usd IS NOT NULL AND COALESCE(sin_precio, false) = false
      AND (${proveedor} = '' OR proveedor = ${proveedor})
      AND (${categorias.length === 0} OR categoria = ANY(${categorias}))
      AND (${soloStock ? "1" : ""} = '' OR (disponibilidad ILIKE '%stock%' AND disponibilidad NOT ILIKE '%sin stock%'))
    ORDER BY categoria, descripcion` as any[];

  // ⚠️ IVA en USD: la lista USD sale NETA (+ IVA aparte). ARS: con IVA incluido.
  const USD_CON_IVA = false;
  const conIva = moneda === "USD" ? USD_CON_IVA : true;

  const fRev = 1 + markupBase / 100;
  const productos: ProductoLista[] = rows
    .filter((p) => !/flete/i.test(String(p.codigo || "") + " " + String(p.descripcion || "") + " " + String(p.categoria || "")))
    .map((p) => {
      const ivaPct = Number(p.iva_pct || 21);
      const ivaMul = conIva ? 1 + ivaPct / 100 : 1;
      const costo = Number(p.costo_usd);
      const cat = p.categoria || "VARIOS";
      const fPub = 1 + (MARKUP_PUBLICO_POR_CATEGORIA[cat] ?? markupPublico) / 100;
      const px = (f: number) => moneda === "USD" ? +(costo * f * ivaMul).toFixed(2) : Math.round(costo * f * ivaMul * dolar);
      return { codigo: p.codigo || "", descripcion: p.descripcion || "", categoria: cat, iva_pct: ivaPct, precio_reventa: px(fRev), precio_publico: px(fPub) };
    });

  // Niveles por volumen (descuento RELATIVO al precio de lista, no expone markup ni costo).
  const nivelesVolumen: NivelVolumen[] = usarTramos && tramos.length > 1
    ? tramos.map((t, i) => ({
        desde_usd: i === 0 ? 0 : (tramos[i - 1].hasta_usd ?? 0),
        hasta_usd: t.hasta_usd,
        descuento_pct: +(((1 - (1 + t.markup_pct / 100) / (1 + markupBase / 100)) * 100)).toFixed(1),
      }))
    : [];

  return { ok: true, productos, niveles_volumen: nivelesVolumen, meta: { dolar, moneda, con_iva: conIva, markup_publico_pct: markupPublico } };
}
