import { NextRequest, NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";

// Lee el PDF de una proforma de proveedor y trata de extraer su N° de proforma
// y el monto total. Heurístico (cada proveedor formatea distinto) — el dato
// vuelve como sugerencia EDITABLE; no decide nada por sí solo.

function buscarNumero(texto: string): string {
  const t = texto.replace(/\r/g, "");
  // 1) Rótulo explícito "Proforma Nº: 91999660" (Multiradio/Multisolar y la mayoría de los SAP/sistemas).
  //    Captura el token COMPLETO (no truncar dígitos).
  const m1 = t.match(/(?:pro[\s-]?forma|presupuesto|cotizaci[oó]n|factura\s+proforma)\s*(?:n[°ºo.]*|nro\.?|#)?\s*[:\-]?\s*([A-Z]{0,4}[-\s]?\d{4,}(?:[-/]\d{2,})?)/i);
  if (m1) return m1[1].replace(/\s+/g, "").toUpperCase();
  // 2) Formato AFIP típico "0001-00001234"
  const m2 = t.match(/\b\d{4}[-\s]\d{6,8}\b/);
  if (m2) return m2[0].replace(/\s+/g, "");
  // 3) "N° 1234" suelto cerca del inicio
  const m3 = t.slice(0, 600).match(/n[°ºo.]\s*[:\-]?\s*(\d{3,8})/i);
  if (m3) return m3[1];
  return "";
}

function buscarMonto(texto: string): { monto: number; moneda: string } | null {
  // último número con formato de importe (suele ser el total)
  const nums = texto.match(/(?:USD|U\$S|US\$|\$)?\s*\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2}/g) || [];
  if (!nums.length) return null;
  const ultimo = nums[nums.length - 1];
  const moneda = /USD|U\$S|US\$/i.test(ultimo) ? "USD" : "ARS";
  const val = Number(ultimo.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(val) && val > 0 ? { monto: val, moneda } : null;
}

export async function POST(req: NextRequest) {
  try {
    const { b64, tipo } = await req.json();
    if (!b64) return NextResponse.json({ ok: false, error: "sin archivo" }, { status: 400 });
    if (!/pdf/i.test(String(tipo || ""))) {
      // imágenes: no parseamos acá (requiere OCR/IA). Devolvemos vacío sin error.
      return NextResponse.json({ ok: true, numero: "", monto: null });
    }
    const buf = Buffer.from(String(b64).split(",").pop() || "", "base64");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return NextResponse.json({ ok: true, numero: buscarNumero(text), monto: buscarMonto(text), texto: String(text || "").slice(0, 4000) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
