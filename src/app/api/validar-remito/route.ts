import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/validar-remito { b64, tipo, numero, transporte }
// Lee el comprobante de despacho (remito sellado) con visión de Gemini (gratis) y valida:
//  - es_nuestro_remito: es el remito de FEBECOS con el número generado (compara el N°).
//  - tiene_firma_o_sello: tiene firma y/o sello del transporte/receptor.
//  - es_remito_transporte: es un remito propio del transporte (ej. Via Cargo), no el nuestro.
// Sin GEMINI_API_KEY responde { ok:false, sin_key:true } y el front carga el archivo sin validar.

const MIME_OK = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];

export async function POST(req: NextRequest) {
  try {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return NextResponse.json({ ok: false, sin_key: true });
    const { b64, tipo, numero, transporte } = await req.json();
    const data = String(b64 || "").split(",").pop() || "";
    if (!data) return NextResponse.json({ ok: false, error: "sin archivo" }, { status: 400 });
    const esPdf = /pdf/i.test(String(tipo || ""));
    const mime = esPdf ? "application/pdf" : (String(tipo || "image/jpeg").replace(/;.*/, "") || "image/jpeg");
    const mimeType = MIME_OK.includes(mime) ? mime : "image/jpeg";

    const PROMPT = `Sos un validador de remitos de despacho de la empresa FEBECOS.
El remito que generamos nosotros tiene el número: "${numero || ""}". El transporte esperado es: "${transporte || ""}".
Mirá el documento adjunto y devolvé EXCLUSIVAMENTE un JSON válido, sin texto alrededor, con estas claves:
- "numero_detectado": el número de remito/comprobante que figura en el documento (string), o null.
- "es_nuestro_remito": true si el documento es el remito de FEBECOS y su número coincide (aunque sea parcialmente) con "${numero || ""}".
- "tiene_firma_o_sello": true si se ve una firma manuscrita y/o un sello (de transporte o de quien recibió).
- "es_remito_transporte": true si es un remito/guía propio del transporte (por ejemplo Via Cargo, Andreani, Correo, etc.), distinto del remito de FEBECOS.
- "observacion": una frase corta describiendo qué es el documento.`;

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: mimeType, data } }, { text: PROMPT }] }], generationConfig: { maxOutputTokens: 300, temperature: 0 } }) }
    );
    const j = await r.json();
    if (!r.ok) return NextResponse.json({ ok: false, error: `Gemini ${r.status}` }, { status: 502 });
    const txt = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || "").join("").trim();
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ ok: false, error: "respuesta sin JSON" });
    let p: any; try { p = JSON.parse(m[0]); } catch { return NextResponse.json({ ok: false, error: "JSON inválido" }); }
    return NextResponse.json({
      ok: true,
      data: {
        numero_detectado: p.numero_detectado ? String(p.numero_detectado).slice(0, 40) : null,
        es_nuestro_remito: !!p.es_nuestro_remito,
        tiene_firma_o_sello: !!p.tiene_firma_o_sello,
        es_remito_transporte: !!p.es_remito_transporte,
        observacion: p.observacion ? String(p.observacion).slice(0, 200) : "",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
