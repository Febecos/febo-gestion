import { alicIvaId } from "./afip-codigos";

// Desglose de IVA/neto para AFIP, compartido por la emisión real y la revisión previa (dry-run),
// para garantizar que los números de la revisión sean IDÉNTICOS a los que se mandan a AFIP.
//
// - `items`: ítems del pedido (cada uno con subtotal SIN IVA y iva_pct).
// - `conv`: convierte un importe a la moneda de la factura (USD→USD redondeo 2; ARS→*tc redondeo entero).
// - `netoConv`: neto de la operación YA convertido (con descuento general aplicado si lo hubiera).
// - `esFacturaC`: en Factura C no se discrimina IVA (todo va al total, sin alícuotas).
export function desglosarIva(opts: {
  items: any[];
  conv: (n: any) => number;
  netoConv: number;
  esFacturaC: boolean;
}): {
  neto: number;
  baseByPct: Record<string, number>;
  ivaArr: { id: number; base: number; importe: number }[];
  impIVA: number;
  total: number;
} {
  const { items, conv, netoConv: neto, esFacturaC } = opts;
  // Bases de IVA por alícuota a partir del subtotal por ítem (sin IVA).
  const byPct: Record<string, number> = {};
  for (const it of items) { const pct = String(Number(it.iva_pct ?? 21)); byPct[pct] = (byPct[pct] || 0) + conv(it.subtotal); }
  const pcts = Object.keys(byPct);
  const brutoBases = pcts.reduce((a, p) => a + byPct[p], 0);
  // Si hay descuento general (neto < Σ bases), se prorratea en cada alícuota para que
  // Σ BaseImp == ImpNeto (lo exige AFIP) y el IVA se calcule SOBRE el precio con descuento.
  const factor = brutoBases > 0 ? neto / brutoBases : 1;
  const baseByPct: Record<string, number> = {}; let accBase = 0;
  for (const p of pcts) { const b = +(byPct[p] * factor).toFixed(2); baseByPct[p] = b; accBase += b; }
  // Ajuste de redondeo: el residuo va al bucket de mayor base → Σ base == neto exacto.
  if (pcts.length) { const diff = +(neto - accBase).toFixed(2); if (Math.abs(diff) >= 0.01) { const big = pcts.reduce((a, b) => (baseByPct[b] > baseByPct[a] ? b : a)); baseByPct[big] = +(baseByPct[big] + diff).toFixed(2); } }
  const ivaArr = esFacturaC ? [] : pcts.map((pct) => ({ id: alicIvaId(+pct), base: baseByPct[pct], importe: +(baseByPct[pct] * (+pct) / 100).toFixed(2) }));
  const impIVA = +ivaArr.reduce((a, x) => a + x.importe, 0).toFixed(2);
  // ImpTotal debe ser EXACTAMENTE ImpNeto + ImpIVA (requisito AFIP).
  const total = esFacturaC ? neto : +(neto + impIVA).toFixed(2);
  return { neto, baseByPct, ivaArr, impIVA, total };
}

// Desglose ANCLADO a los totales YA pactados del pedido (`tot`): neto, IVA por alícuota y total
// salen EXACTAMENTE de lo que vio el cliente en el presupuesto (no se recalcula desde los ítems).
// Garantiza presupuesto == pedido == factura. Las BaseImp (campo interno de AFIP) se ajustan con un
// residuo para que Σ BaseImp == ImpNeto, sin tocar los IVA ni el total que ve el cliente.
export function desglosarDesdeTotales(opts: {
  ivaDetalle: { pct: number; monto: number }[];
  conv: (n: any) => number;
  netoUsd: number;
  esFacturaC: boolean;
}): {
  neto: number;
  ivaArr: { id: number; base: number; importe: number }[];
  impIVA: number;
  total: number;
} {
  const { ivaDetalle, conv, netoUsd, esFacturaC } = opts;
  const neto = conv(netoUsd);
  if (esFacturaC) return { neto, ivaArr: [], impIVA: 0, total: neto };
  // Importe de IVA por alícuota = el del presupuesto convertido. Base = importe / (alícuota).
  const arr = (ivaDetalle || []).filter((d) => Number(d.monto) || Number(d.pct)).map((d) => {
    const pct = Number(d.pct) || 0; const importe = conv(d.monto);
    const base = pct > 0 ? +(importe / (pct / 100)).toFixed(2) : 0;
    return { id: alicIvaId(pct), pct, base, importe };
  });
  // Residuo: que Σ BaseImp == ImpNeto exacto (lo exige AFIP) → al bucket de mayor base.
  const accBase = +arr.reduce((a, x) => a + x.base, 0).toFixed(2);
  const diff = +(neto - accBase).toFixed(2);
  if (arr.length && Math.abs(diff) >= 0.01) { const big = arr.reduce((a, b) => (b.base > a.base ? b : a)); big.base = +(big.base + diff).toFixed(2); }
  const impIVA = +arr.reduce((a, x) => a + x.importe, 0).toFixed(2);
  const total = +(neto + impIVA).toFixed(2);
  return { neto, ivaArr: arr.map(({ id, base, importe }) => ({ id, base, importe })), impIVA, total };
}

// Elige el método: si el pedido tiene `iva_detalle` pactado → ancla a él (presupuesto==factura);
// si no (pedidos viejos sin desglose) → recalcula desde los ítems.
export function desglosarFactura(opts: { items: any[]; tot: any; conv: (n: any) => number; esFacturaC: boolean }) {
  const { items, tot, conv, esFacturaC } = opts;
  const det = Array.isArray(tot?.iva_detalle) ? tot.iva_detalle : null;
  if (det && det.length) return desglosarDesdeTotales({ ivaDetalle: det, conv, netoUsd: Number(tot.neto ?? tot.total ?? 0), esFacturaC });
  return desglosarIva({ items, conv, netoConv: conv(tot?.neto ?? tot?.total ?? 0), esFacturaC });
}
