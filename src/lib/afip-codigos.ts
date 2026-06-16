// Códigos AFIP/ARCA para WSFEv1 (FECAESolicitar). Fuente: manual ARCA-COMPG v4.0.

// Tipo de comprobante AFIP según letra + grupo (factura/nc/nd).
const TIPO_CBTE: Record<string, Record<string, number>> = {
  factura: { A: 1, B: 6, C: 11, M: 51, E: 19 },
  nc:      { A: 3, B: 8, C: 13, M: 53, E: 21 },
  nd:      { A: 2, B: 7, C: 12, M: 52, E: 20 },
};
export function tipoCbteAfip(grupo: string, letra: string): number | null {
  return TIPO_CBTE[grupo]?.[(letra || "").toUpperCase()] ?? null;
}

// Tipo de documento del receptor.
export const DOC = { CUIT: 80, CUIL: 86, CDI: 87, DNI: 96, CF: 99 } as const;
export function docTipoReceptor(cuit: string | null | undefined): { tipo: number; nro: number } {
  const d = String(cuit || "").replace(/\D/g, "");
  if (d.length === 11) return { tipo: DOC.CUIT, nro: Number(d) };
  if (d.length >= 7 && d.length <= 8) return { tipo: DOC.DNI, nro: Number(d) };
  return { tipo: DOC.CF, nro: 0 }; // Consumidor Final sin identificar
}

// Condición frente al IVA del receptor (RG 5616 — FEParamGetCondicionIvaReceptor).
// 1=Responsable Inscripto · 4=Exento · 5=Consumidor Final · 6=Responsable Monotributo
// 7=Sujeto No Categorizado · 8=Proveedor del Exterior · 9=Cliente del Exterior
// 10=IVA Liberado Ley 19.640 · 13=Monotributo Social · 15=IVA No Alcanzado · 16=Monotrib. Trab. Indep. Promovido
export function condicionIvaReceptorId(condicion: string | null | undefined): number | null {
  const c = String(condicion || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  if (!c) return null;
  if (c.includes("exterior") || c.includes("exportac")) return 9;
  if (c.includes("monotrib")) return c.includes("social") ? 13 : 6;
  if (c.includes("no alcanz")) return 15;
  if (c.includes("exento")) return 4;
  if (c.includes("inscripto") && c.includes("responsable")) return 1;
  if (c === "ri") return 1;
  if (c.includes("no categoriz") || c.includes("sujeto no")) return 7;
  if (c.includes("consumidor") || c.includes("final")) return 5;
  return null;
}

// Id de alícuota de IVA según el % (manual WSFE).
export function alicIvaId(pct: number): number {
  const p = Number(pct);
  if (p === 0) return 3;
  if (p === 10.5) return 4;
  if (p === 21) return 5;
  if (p === 27) return 6;
  if (p === 5) return 8;
  if (p === 2.5) return 9;
  return 5;
}

export const MONEDA = { ARS: "PES", USD: "DOL" } as const;
