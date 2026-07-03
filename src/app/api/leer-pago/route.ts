import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/leer-pago { b64, tipo }  → lee el CONTENIDO de un comprobante de pago (imagen o PDF)
// con visión de Gemini Flash (GRATIS, free tier de Google) y devuelve
// { medio, monto, moneda, banco, numero, fecha }.
// Sin GEMINI_API_KEY responde { ok:false, sin_key:true } y el front cae al OCR local (tesseract).
const PROMPT = `Sos un lector de comprobantes de pago argentinos: transferencias bancarias (home banking, apps de bancos),
cheques/e-cheq, depósitos, y Mercado Pago (capturas de la app o de WhatsApp, muchas veces recortadas o comprimidas).
Formatos frecuentes que tenés que reconocer:
- Mercado Pago app: el monto suele estar GRANDE arriba o al lado de "Le transferiste a...", "Pagaste", "Total", "$ X.XXX,XX". El "numero" es el "Nº de operación" (puede decir "Ver comprobante" cerca).
- Transferencia bancaria: "Importe transferido", "Monto", "Comprobante Nº", "CBU/CVU destino", nombre del banco emisor en el header/logo.
- Captura recortada o de baja resolución de WhatsApp: el monto puede estar cortado en el borde o parcialmente tapado; usá el número más grande y prominente de la pantalla como "monto" si no hay una etiqueta explícita.
Devolvé EXCLUSIVAMENTE un objeto JSON válido, sin texto alrededor, con estas claves (usá null en cualquier campo que NO puedas leer con certeza — NO inventes valores, pero SIEMPRE completá los que sí puedas leer aunque el resto sea null):
- "medio": uno de "Transferencia","Cheque","Efectivo","Depósito","Mercado Pago" (el que corresponda al comprobante).
- "monto": número (importe del pago, sin separadores de miles; usá punto decimal). null si de verdad no se ve ningún monto.
- "moneda": "ARS" o "USD".
- "banco": nombre del banco emisor si aparece, si no null.
- "numero": el N° de cheque (conservá los ceros a la izquierda como string) o el N° de operación/comprobante de la transferencia. null si no hay.
- "fecha": fecha de pago/acreditación/emisión en formato "YYYY-MM-DD". null si no se ve.
Importante: el "numero" NO es el importe. Para un cheque tomá exactamente el "N° de Cheque". Priorizá devolver datos PARCIALES antes que fallar todo el objeto.`;

const PROMPT_RETRY = `La imagen es un comprobante de pago argentino (posiblemente una captura de pantalla recortada o comprimida de WhatsApp/Mercado Pago).
Mirá TODA la imagen con cuidado, incluso números parciales o tapados a medias, y contestá SOLO este JSON (sin texto alrededor):
{"medio": uno de "Transferencia","Cheque","Efectivo","Depósito","Mercado Pago" o null, "monto": el número más grande/prominente que parezca un importe en pesos o dólares (aunque sea una aproximación de un dígito tapado), o null si REALMENTE no hay ningún número de importe visible, "moneda": "ARS" o "USD", "banco": string o null, "numero": string o null, "fecha": "YYYY-MM-DD" o null}
Preferí arriesgar una lectura aproximada del monto antes que devolver null.`;

// gemini-2.5-flash (subido desde 2.0-flash): visión más precisa para capturas recortadas/comprimidas
// de WhatsApp — pedido explícito de Guille ("tiene que leer TODO", no solo el fallback parcial).
const MODEL = "gemini-2.5-flash";

async function llamarGemini(key: string, mimeType: string, data: string, prompt: string) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: mimeType, data } }, { text: prompt }] }],
        generationConfig: { maxOutputTokens: 500, temperature: 0, responseMimeType: "application/json" },
      }),
    }
  );
  if (!r.ok) { const t = await r.text(); throw new Error(`Gemini ${r.status}: ${t.slice(0, 200)}`); }
  const j = await r.json();
  const txt = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || "").join("").trim();
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function normalizar(parsed: any) {
  const medios = ["Transferencia", "Cheque", "Efectivo", "Depósito", "Mercado Pago"];
  return {
    medio: medios.includes(parsed?.medio) ? parsed.medio : null,
    monto: parsed?.monto != null && !isNaN(Number(parsed.monto)) ? Number(parsed.monto) : null,
    moneda: parsed?.moneda === "USD" ? "USD" : "ARS",
    banco: parsed?.banco ? String(parsed.banco).slice(0, 40) : null,
    numero: parsed?.numero ? String(parsed.numero).replace(/[^0-9A-Za-z-]/g, "").slice(0, 30) : null,
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed?.fecha || "")) ? parsed.fecha : null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return NextResponse.json({ ok: false, sin_key: true, error: "Falta GEMINI_API_KEY" });
    const { b64, tipo } = await req.json();
    const data = String(b64 || "").split(",").pop() || "";
    if (!data) return NextResponse.json({ ok: false, error: "sin archivo" }, { status: 400 });

    const esPdf = /pdf/i.test(String(tipo || ""));
    const MIME_OK = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];
    const mime = esPdf ? "application/pdf" : (String(tipo || "image/jpeg").replace(/;.*/, "") || "image/jpeg");
    const mimeType = MIME_OK.includes(mime) ? mime : "image/jpeg";

    // Los 2 intentos (prompt normal + prompt permisivo) se disparan EN PARALELO, no en secuencia:
    // encadenarlos duplicaba la latencia de 2 llamadas de visión a Gemini y superaba el límite real
    // de la función en Vercel (el 502 reportado por Guille al reintentar) — en paralelo el total
    // queda acotado por la más lenta de las dos, no por la suma.
    const [r1, r2] = await Promise.allSettled([
      llamarGemini(key, mimeType, data, PROMPT),
      llamarGemini(key, mimeType, data, PROMPT_RETRY),
    ]);
    const parsed = r1.status === "fulfilled" ? r1.value : null;
    const parsed2 = r2.status === "fulfilled" ? r2.value : null;
    const intentoError = r1.status === "rejected" ? r1.reason?.message : null;

    const out1 = normalizar(parsed);
    const out2 = normalizar(parsed2);
    // Combinar: preferir lo que trajo el prompt normal, completar huecos con el permisivo.
    const out = {
      medio: out1.medio ?? out2.medio,
      monto: out1.monto ?? out2.monto,
      moneda: out1.monto != null ? out1.moneda : out2.moneda,
      banco: out1.banco ?? out2.banco,
      numero: out1.numero ?? out2.numero,
      fecha: out1.fecha ?? out2.fecha,
    };

    if (!parsed && !parsed2 && out.monto == null && out.medio == null) {
      return NextResponse.json({ ok: false, error: intentoError || "no se pudo leer el comprobante" }, { status: 502 });
    }
    // ok:true aunque sea parcial (ej. medio detectado pero monto null) — el front completa a mano lo que falte.
    return NextResponse.json({ ok: true, data: out, parcial: out.monto == null });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
