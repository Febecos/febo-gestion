// Smoke-test de la LÓGICA crítica de plata/stock. Corre la lógica REAL (no copias).
// Uso: npm run smoke   (corre con tsx). Si algo falla, sale con código 1 → no deployar.
// Cubre lo que más duele si se rompe: cálculo factura (presupuesto==factura + identidades AFIP),
// mapeos AFIP (letra / condición IVA / alícuota), y el cotizador fv (flete SIN markup).
import { desglosarDesdeTotales, desglosarIva, desglosarFactura } from "../src/lib/factura-calc";
import { condicionIvaReceptorId, alicIvaId, tipoCbteAfip } from "../src/lib/afip-codigos";
import { letraFacturaPara } from "../src/lib/talonarios";

let fail = 0, pass = 0;
const eq = (a: any, b: any, name: string) => { if (a === b) { pass++; } else { fail++; console.error(`  ✗ ${name}: esperado ${b}, obtuvo ${a}`); } };
const ok = (cond: boolean, name: string) => { if (cond) { pass++; } else { fail++; console.error(`  ✗ ${name}`); } };

console.log("— factura-calc: presupuesto == factura (anclado a totales) —");
{
  const conv = (n: any) => Math.round((Number(n) || 0) * 1500); // ARS @ TC 1500
  const r = desglosarDesdeTotales({ ivaDetalle: [{ pct: 10.5, monto: 53.79 }, { pct: 21, monto: 492.01 }], conv, netoUsd: 2855.2, esFacturaC: false });
  eq(r.neto, 4282800, "neto pesos");
  // IVA = base × alícuota EXACTO (AFIP error 10051 si no). Difiere centavos del IVA redondeado
  // del presupuesto — el total de la factura puede no ser idéntico al del cotizador.
  eq(r.impIVA, 818703, "IVA total pesos (exacto base×alícuota)");
  eq(r.total, 5101503, "total pesos (neto + IVA exacto)");
  const iva105 = r.ivaArr.find((x) => x.id === 4)!; const iva21 = r.ivaArr.find((x) => x.id === 5)!;
  eq(iva105.importe, 80685, "IVA 10,5% importe");
  eq(iva21.importe, 738018, "IVA 21% importe");
  const sumBases = +r.ivaArr.reduce((a, x) => a + x.base, 0).toFixed(2);
  eq(sumBases, r.neto, "Σ bases == neto (AFIP)");
  eq(+(r.neto + r.impIVA).toFixed(2), r.total, "total == neto + IVA (AFIP)");
  // Identidad clave que pedía AFIP (10051): cada Importe == Base × alícuota.
  for (const x of r.ivaArr) { const pctMap: any = { 4: 10.5, 5: 21, 6: 27, 8: 5, 9: 2.5, 3: 0 }; eq(x.importe, +(x.base * pctMap[x.id] / 100).toFixed(2), `AlicIVA id=${x.id}: importe == base×%`); }
}

console.log("— factura-calc: desglosarIva desde ítems (identidades AFIP) —");
{
  const conv = (n: any) => +(Number(n) || 0).toFixed(2); // USD
  const items = [{ subtotal: 708.18, iva_pct: 21 }, { subtotal: 640.32, iva_pct: 10.5 }, { subtotal: 100, iva_pct: 21 }];
  const neto = 708.18 + 640.32 + 100;
  const r = desglosarIva({ items, conv, netoConv: conv(neto), esFacturaC: false });
  const sumBases = +r.ivaArr.reduce((a, x) => a + x.base, 0).toFixed(2);
  eq(sumBases, r.neto, "Σ bases == neto");
  eq(+(r.neto + r.impIVA).toFixed(2), r.total, "total == neto + IVA");
}

console.log("— factura-calc: desglosarFactura elige totales si hay iva_detalle —");
{
  const conv = (n: any) => Math.round((Number(n) || 0) * 1500);
  const tot = { neto: 2855.2, total: 3401, moneda: "ARS", tc: 1500, iva_detalle: [{ pct: 10.5, monto: 53.79 }, { pct: 21, monto: 492.01 }] };
  const r = desglosarFactura({ items: [], tot, conv, esFacturaC: false });
  eq(r.total, 5101503, "desglosarFactura total anclado");
}

console.log("— AFIP: mapeos letra / condición IVA / alícuota —");
eq(letraFacturaPara("responsable_inscripto"), "A", "RI → Factura A");
eq(letraFacturaPara("monotributo"), "A", "Monotributo → Factura A");
eq(letraFacturaPara("exento"), "B", "Exento → Factura B");
eq(letraFacturaPara("consumidor final"), "B", "CF → Factura B");
eq(letraFacturaPara("exterior"), "E", "Exterior → Factura E");
eq(condicionIvaReceptorId("responsable_inscripto"), 1, "condIVA RI = 1");
eq(condicionIvaReceptorId("consumidor final"), 5, "condIVA CF = 5");
eq(alicIvaId(21), 5, "alícuota 21% = id 5");
eq(alicIvaId(10.5), 4, "alícuota 10,5% = id 4");
eq(tipoCbteAfip("factura", "A"), 1, "cbteTipo Factura A = 1");
eq(tipoCbteAfip("factura", "B"), 6, "cbteTipo Factura B = 6");

(async () => {
  console.log("— Cotizador FV: flete SIN markup, producto CON markup —");
  try {
    const m: any = await import("../../fv-febecos/lib/catalogo.mjs");
    const cfg = { markup_cf_pct: 74, markup_global_pct: 40, dolar: 1500 };
    const flete = m.calcular({ codigo: "Flete Interno", categoria: "VARIOS", descripcion: "Flete interno a transporte", costo_usd: 30, iva_pct: 21 }, cfg, 74);
    eq(flete.pvp_sin_iva_usd, 30, "flete pvp == costo (markup 0)");
    const panel = m.calcular({ codigo: "PAN-470", categoria: "PANELES SOLARES", descripcion: "Panel 470w", costo_usd: 78, iva_pct: 10.5 }, cfg, 74);
    eq(panel.pvp_sin_iva_usd, +(78 * 1.74).toFixed(2), "panel pvp con markup 74%");
    ok(typeof m.esFlete === "function" && m.esFlete({ descripcion: "Flete interno" }) === true, "esFlete detecta flete");
  } catch (e: any) { console.error("  ⚠️ no se pudo cargar fv-febecos/lib/catalogo.mjs:", e.message); }

  console.log(`\n${fail === 0 ? "✅" : "❌"} smoke-test: ${pass} OK, ${fail} fallas`);
  process.exit(fail === 0 ? 0 : 1);
})();
