import { tipoPorCodigo } from "@/lib/talonarios-tipos";

// Toma el próximo número de un talonario (atómico) y lo formatea estilo Táctica/AFIP:
//   "FA B 0001-00000123"  (prefijo por grupo + letra + pto.vta(4) + número(8))
// Devuelve null si el talonario no existe o está bloqueado.
const PREFIJO: Record<string, string> = { factura: "FA", nc: "NC", nd: "ND", operativo: "" };

// Letra de factura según AFIP, siendo el EMISOR Responsable Inscripto.
//   Cliente Responsable Inscripto                         → A
//   Monotributo / Exento / Consumidor Final / No categ.   → B
//   Exterior / Exportación                                → E
//   Sin condición fiscal                                  → null (no se puede facturar)
export function letraFacturaPara(condicion: string | null | undefined): "A" | "B" | "E" | null {
  const c = String(condicion || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  if (!c) return null;
  if (c.includes("exterior") || c.includes("exportac")) return "E";
  if (c.includes("monotrib")) return "B";
  if (c.includes("inscripto") && c.includes("responsable")) return "A";
  if (c === "ri") return "A";
  if (c.includes("exento")) return "B";
  if (c.includes("consumidor") || c.includes("final")) return "B";
  if (c.includes("no categoriz") || c.includes("no inscripto") || c.includes("sujeto no")) return "B";
  if (c.includes("inscripto")) return "A";
  return null;
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
  const prefijo = PREFIJO[tipo?.grupo || "factura"] ?? "FA";
  const pv = String(t.sucursal || "0001").replace(/\D/g, "").padStart(4, "0").slice(-4);
  const num8 = String(emitido).padStart(8, "0");
  const numero = [prefijo, letra, `${pv}-${num8}`].filter(Boolean).join(" ");
  return { numero, emitido, letra, tipo_codigo: t.tipo_codigo, electronica: !!t.electronica, talonario_id: t.id };
}
