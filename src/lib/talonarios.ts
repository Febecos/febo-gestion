import { tipoPorCodigo } from "@/lib/talonarios-tipos";

// Toma el próximo número de un talonario (atómico) y lo formatea estilo Táctica/AFIP:
//   "FA B 0001-00000123"  (prefijo por grupo + letra + pto.vta(4) + número(8))
// Devuelve null si el talonario no existe o está bloqueado.

// Letra de factura según ARCA (ex AFIP), siendo el EMISOR Responsable Inscripto.
//   Cliente Responsable Inscripto                 → A
//   Cliente Monotributo                           → A  (RG 5003/2021, con leyendas)
//   Exento / Consumidor Final / No categorizado   → B
//   Exterior / Exportación                        → E
//   Sin condición fiscal                          → null (no se puede facturar)
// IMPORTANTE: revisar normativa ARCA vigente al activar facturación electrónica (CAE/WSFE).
export function letraFacturaPara(condicion: string | null | undefined): "A" | "B" | "E" | null {
  const c = norm(condicion);
  if (!c) return null;
  if (c.includes("exterior") || c.includes("exportac")) return "E";
  if (c.includes("monotrib")) return "A";                                   // RG 5003: RI → Monotributo = Factura A
  if (c.includes("inscripto") && c.includes("responsable")) return "A";
  if (c === "ri") return "A";
  if (c.includes("exento")) return "B";
  if (c.includes("consumidor") || c.includes("final")) return "B";
  if (c.includes("no categoriz") || c.includes("no inscripto") || c.includes("sujeto no")) return "B";
  if (c.includes("inscripto")) return "A";
  return null;
}

function norm(s: string | null | undefined) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

// Leyendas obligatorias según la condición del receptor (RG 5003 / RG 5616).
export function leyendasFactura(condicion: string | null | undefined): string[] {
  const c = norm(condicion);
  const out: string[] = [];
  if (c.includes("monotrib")) {
    out.push("Receptor del comprobante – Responsable Monotributo");
    out.push("El monto del IVA discriminado no puede computarse como crédito fiscal (RG AFIP 5003/2021).");
  }
  return out;
}

// Texto de la condición frente al IVA del receptor (obligatorio en el comprobante, RG 5616/2024 vig. 15/04/2025).
export function condicionIvaReceptor(condicion: string | null | undefined): string {
  const c = norm(condicion);
  if (!c) return "";
  if (c.includes("monotrib")) return "Responsable Monotributo";
  if (c.includes("inscripto") && c.includes("responsable")) return "Responsable Inscripto";
  if (c === "ri") return "Responsable Inscripto";
  if (c.includes("exento")) return "IVA Exento";
  if (c.includes("consumidor") || c.includes("final")) return "Consumidor Final";
  if (c.includes("exterior") || c.includes("exportac")) return "Cliente del Exterior";
  if (c.includes("no categoriz") || c.includes("sujeto no")) return "IVA Sujeto No Categorizado";
  return String(condicion || "");
}

export async function numeroDesdeTalonario(sql: any, id: number): Promise<{
  numero: string; emitido: number; letra: string; tipo_codigo: string; electronica: boolean; talonario_id: number;
} | null> {
  const t = (await sql`SELECT id, tipo_codigo, sucursal, serie, proximo_numero, nro_hasta, bloqueado, activo, electronica FROM fg_talonarios WHERE id=${id} LIMIT 1` as any[])[0];
  if (!t) throw new Error("Talonario no encontrado");
  if (t.bloqueado) throw new Error("El talonario está bloqueado");
  if (t.activo === false) throw new Error("El talonario está inactivo");
  if (t.nro_hasta != null && Number(t.proximo_numero) > Number(t.nro_hasta)) throw new Error("El talonario llegó a su número final (" + t.nro_hasta + ")");

  // Incremento atómico: devuelve el número que se emite (el que estaba antes de sumar 1).
  const r = (await sql`UPDATE fg_talonarios SET proximo_numero = proximo_numero + 1, updated_at=now() WHERE id=${id} RETURNING (proximo_numero - 1) AS emitido` as any[])[0];
  const emitido = Number(r.emitido);

  const tipo = tipoPorCodigo(t.tipo_codigo);
  const letra = tipo?.letra || "";
  // Número = PtoVta(5) - Número(8), formato AFIP. El punto de venta sale del talonario (config).
  const pv = String(t.sucursal || "1").replace(/\D/g, "").padStart(5, "0").slice(-5);
  const num8 = String(emitido).padStart(8, "0");
  const numero = `${pv}-${num8}`;
  return { numero, emitido, letra, tipo_codigo: t.tipo_codigo, electronica: !!t.electronica, talonario_id: t.id };
}
