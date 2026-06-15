// Catálogo de tipos de comprobante (igual a Táctica). electronica=true → AFIP (a futuro).
// grupo: operativo | factura | nc (nota crédito) | nd (nota débito)
export type TipoComprobante = { codigo: string; nombre: string; grupo: "operativo" | "factura" | "nc" | "nd"; electronica: boolean; letra?: string };

export const TIPOS_COMPROBANTE: TipoComprobante[] = [
  // Operativos (internos, no fiscales)
  { codigo: "PRESUP", nombre: "Presupuesto", grupo: "operativo", electronica: false },
  { codigo: "PED", nombre: "Pedido", grupo: "operativo", electronica: false },
  { codigo: "REM", nombre: "Remito", grupo: "operativo", electronica: false },

  // Facturas manuales (→ proforma hasta integrar AFIP)
  { codigo: "FAA", nombre: "Factura de Venta A", grupo: "factura", electronica: false, letra: "A" },
  { codigo: "FAB", nombre: "Factura de Venta B", grupo: "factura", electronica: false, letra: "B" },
  { codigo: "FAC", nombre: "Factura de Venta C", grupo: "factura", electronica: false, letra: "C" },
  { codigo: "FAM", nombre: "Factura de Venta A Tipo M", grupo: "factura", electronica: false, letra: "M" },
  { codigo: "FAI", nombre: "Factura de Venta A con CBU Informado", grupo: "factura", electronica: false, letra: "A" },
  { codigo: "FBI", nombre: "Factura de Venta B con CBU Informado", grupo: "factura", electronica: false, letra: "B" },
  { codigo: "FAE", nombre: "Factura de Venta E", grupo: "factura", electronica: false, letra: "E" },

  // Notas de crédito manuales
  { codigo: "NCA", nombre: "Nota de Crédito A", grupo: "nc", electronica: false, letra: "A" },
  { codigo: "NCB", nombre: "Nota de Crédito B", grupo: "nc", electronica: false, letra: "B" },
  { codigo: "NCC", nombre: "Nota de Crédito C", grupo: "nc", electronica: false, letra: "C" },
  { codigo: "NCE", nombre: "Nota de Crédito E", grupo: "nc", electronica: false, letra: "E" },

  // Notas de débito manuales
  { codigo: "NDA", nombre: "Nota de Débito A", grupo: "nd", electronica: false, letra: "A" },
  { codigo: "NDB", nombre: "Nota de Débito B", grupo: "nd", electronica: false, letra: "B" },
  { codigo: "NDC", nombre: "Nota de Débito C", grupo: "nd", electronica: false, letra: "C" },
  { codigo: "NDE", nombre: "Nota de Débito E", grupo: "nd", electronica: false, letra: "E" },

  // Electrónicas (AFIP) — facturas
  { codigo: "FEA", nombre: "Factura de Venta A - Electrónica", grupo: "factura", electronica: true, letra: "A" },
  { codigo: "FEB", nombre: "Factura de Venta B - Electrónica", grupo: "factura", electronica: true, letra: "B" },
  { codigo: "FEC", nombre: "Factura de Venta C - Electrónica", grupo: "factura", electronica: true, letra: "C" },
  { codigo: "FEE", nombre: "Factura de Venta E - Electrónica", grupo: "factura", electronica: true, letra: "E" },
  // Electrónicas — NC
  { codigo: "CEA", nombre: "Nota de Crédito A - Electrónica", grupo: "nc", electronica: true, letra: "A" },
  { codigo: "CEB", nombre: "Nota de Crédito B - Electrónica", grupo: "nc", electronica: true, letra: "B" },
  { codigo: "CEC", nombre: "Nota de Crédito C - Electrónica", grupo: "nc", electronica: true, letra: "C" },
  { codigo: "CEE", nombre: "Nota de Crédito E - Electrónica", grupo: "nc", electronica: true, letra: "E" },
  // Electrónicas — ND
  { codigo: "DEA", nombre: "Nota de Débito A - Electrónica", grupo: "nd", electronica: true, letra: "A" },
  { codigo: "DEB", nombre: "Nota de Débito B - Electrónica", grupo: "nd", electronica: true, letra: "B" },
  { codigo: "DEC", nombre: "Nota de Débito C - Electrónica", grupo: "nd", electronica: true, letra: "C" },
  { codigo: "DEE", nombre: "Nota de Débito E - Electrónica", grupo: "nd", electronica: true, letra: "E" },
];

export const tipoPorCodigo = (c: string) => TIPOS_COMPROBANTE.find((t) => t.codigo === c);
