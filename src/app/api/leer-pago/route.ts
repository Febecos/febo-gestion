import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/leer-pago { b64, tipo }  → lee el CONTENIDO de un comprobante de pago (imagen o PDF)
// con visión de Claude y devuelve { medio, monto, moneda, banco, numero, fecha }.
// Sin ANTHROPIC_API_KEY responde { ok:false, sin_key:true } y el front cae al OCR local.
const PROMPT = `Sos un lector de comprobantes de pago argentinos (transferencias, cheques/e-cheq, depósitos, Mercado Pago).
Devolvé EXCLUSIVAMENTE un objeto JSON válido, sin texto alrededor, con estas claves:
- "medio": uno de "Transferencia","Cheque","Efectivo","Depósito","Mercado Pago" (el que corresponda al comprobante).
- "monto": número (importe del pago, sin separadores de miles; usá punto decimal). null si no se ve.
- "moneda": "ARS" o "USD".
- "banco": nombre del banco emisor si aparece, si no null.
- "numero": el N° de cheque (conservá los ceros a la izquierda como string) o el N° de operación/comprobante de la transferencia. null si no hay.
- "fecha": fecha de pago/acreditación/emisión en formato "YYYY-MM-DD". null si no se ve.
Importante: el "numero" NO es el importe. Para un cheque tomá exactamente el "N° de Cheque".`;

export async function POST(req: NextRequest) {
  try {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return NextResponse.json({ ok: false, sin_key: true, error: "Falta ANTHROPIC_API_KEY" });
    const { b64, tipo } = await req.json();
    const data = String(b64 || "").split(",").pop() || "";
    if (!data) return NextResponse.json({ ok: false, error: "sin archivo" }, { status: 400 });

    const esPdf = /pdf/i.test(String(tipo || ""));
    const media = esPdf ? "application/pdf" : (String(tipo || "image/jpeg").replace(/;.*/, "") || "image/jpeg");
    const fileBlock = esPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: media, data } };

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages: [{ role: "user", content: [fileBlock, { type: "text", text: PROMPT }] }],
      }),
    });
    if (!r.ok) { const t = await r.text(); return NextResponse.json({ ok: false, error: `Claude ${r.status}: ${t.slice(0, 200)}` }, { status: 502 }); }
    const j = await r.json();
    const txt = (j?.content || []).map((c: any) => c?.text || "").join("").trim();
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ ok: false, error: "respuesta sin JSON" });
    let parsed: any; try { parsed = JSON.parse(m[0]); } catch { return NextResponse.json({ ok: false, error: "JSON inválido" }); }
    const medios = ["Transferencia", "Cheque", "Efectivo", "Depósito", "Mercado Pago"];
    const out = {
      medio: medios.includes(parsed.medio) ? parsed.medio : null,
      monto: parsed.monto != null && !isNaN(Number(parsed.monto)) ? Number(parsed.monto) : null,
      moneda: parsed.moneda === "USD" ? "USD" : "ARS",
      banco: parsed.banco ? String(parsed.banco).slice(0, 40) : null,
      numero: parsed.numero ? String(parsed.numero).replace(/[^0-9A-Za-z-]/g, "").slice(0, 30) : null,
      fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.fecha || "")) ? parsed.fecha : null,
    };
    return NextResponse.json({ ok: true, data: out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
