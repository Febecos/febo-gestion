import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/leer-factura-luz
//   { b64, tipo }                    → modo UPLOAD (el front ya tiene el archivo)
//   { link }                         → modo LINK: baja el archivo de Dropbox/Drive UNA vez, lo lee y
//                                      lo DEVUELVE (archivo.b64) para que el front guarde una copia
//                                      propia (el link es solo el medio, NO el storage — plan FV).
// Lee una FACTURA DE LUZ con visión de Gemini (gratis, PDF e imagen nativo) y extrae el consumo para
// precargar el paso "consumo" del formulario de proyecto FV. Sin GEMINI_API_KEY → { ok:false, sin_key }.

const MIME_OK = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

// Convierte un link "de ver" de Dropbox/Drive a su URL DESCARGABLE directa.
function toDownloadUrl(link: string): string {
  let u = String(link || "").trim();
  // Google Drive: .../file/d/FILEID/view  |  ...?id=FILEID  → uc?export=download&id=FILEID
  const gd = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?[^]*?id=)([a-zA-Z0-9_-]{10,})/);
  if (gd) return `https://drive.google.com/uc?export=download&id=${gd[1]}`;
  // Dropbox: forzar descarga directa (dl.dropboxusercontent.com + dl=1)
  if (/dropbox\.com/i.test(u)) {
    u = u.replace(/^https?:\/\/(www\.)?dropbox\.com/i, "https://dl.dropboxusercontent.com");
    if (/[?&]dl=0/.test(u)) u = u.replace(/([?&])dl=0/, "$1dl=1");
    else if (!/[?&]dl=1/.test(u)) u += (u.includes("?") ? "&" : "?") + "dl=1";
    return u;
  }
  return u; // otro host: se intenta tal cual
}

async function bajarArchivo(link: string): Promise<{ b64: string; tipo: string } | { error: string }> {
  const url = toDownloadUrl(link);
  if (!/^https?:\/\//.test(url)) return { error: "El link no es una URL válida." };
  let r: Response;
  try { r = await fetch(url, { redirect: "follow" }); }
  catch { return { error: "No se pudo acceder al link (¿es público / 'cualquiera con el link'?)." }; }
  if (!r.ok) return { error: `El link no es accesible (HTTP ${r.status}). Compartilo público o subí el archivo.` };
  const ct = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) return { error: "El link no devolvió ningún archivo." };
  if (buf.length > MAX_BYTES) return { error: "El archivo del link es demasiado grande (máx 20 MB)." };
  const tipo = MIME_OK.includes(ct) ? ct : (/pdf/i.test(url) ? "application/pdf" : "image/jpeg");
  return { b64: buf.toString("base64"), tipo };
}

const PROMPT = `Sos un lector de FACTURAS DE ELECTRICIDAD de Argentina. Mirá el documento adjunto y devolvé EXCLUSIVAMENTE un JSON válido, sin texto alrededor, con estas claves:
- "distribuidora": nombre de la distribuidora (Edenor, Edesur, EPE, EDEA, EDEN, EDES, EDELAP, etc.) o null.
- "titular": nombre del titular de la cuenta o null.
- "kwh_mes": consumo del período facturado en kWh (número) o null.
- "kwh_meses": array de hasta 12 números con el consumo mensual histórico si la factura lo muestra (gráfico o tabla de consumos), o [].
- "potencia_contratada_kw": potencia contratada/demanda en kW si figura (número), o null.
- "tarifa": categoría tarifaria (T1, T2, T3, residencial, comercial, industrial, etc.) o null.
- "periodo": período facturado (ej "05/2026") o null.
- "importe": importe total de la factura (número, sin símbolos) o null.
Los números SIN separador de miles ni símbolos. Usá null (o [] para kwh_meses) si el dato no aparece.`;

export async function POST(req: NextRequest) {
  try {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return NextResponse.json({ ok: false, sin_key: true });
    const body = await req.json();

    // Resolver el archivo: del link (baja copia) o del upload directo.
    let data = "", tipo = "", devolverArchivo = false;
    if (body.link) {
      const baj = await bajarArchivo(String(body.link));
      if ("error" in baj) return NextResponse.json({ ok: false, error: baj.error, link_inaccesible: true });
      data = baj.b64; tipo = baj.tipo; devolverArchivo = true; // el front guarda esta copia
    } else {
      data = String(body.b64 || "").split(",").pop() || "";
      tipo = String(body.tipo || "image/jpeg");
    }
    if (!data) return NextResponse.json({ ok: false, error: "sin archivo" }, { status: 400 });

    const esPdf = /pdf/i.test(tipo);
    const mimeBase = esPdf ? "application/pdf" : tipo.replace(/;.*/, "");
    const mimeType = MIME_OK.includes(mimeBase) ? mimeBase : "image/jpeg";

    const parseJson = (txt: string) => { const m = txt.match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } };

    // ── Gemini con RETRY + BACKOFF en 429 (rate-limit transitorio del free tier) ──
    // Muchos 429 son bursts de RPM (Guille probando seguido) que pasan con un reintento.
    const geminiExtract = async (): Promise<{ p: any } | { err: string; status: number }> => {
      const delays = [0, 2000, 5000];
      let lastStatus = 0;
      for (let i = 0; i < delays.length; i++) {
        if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
          { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: mimeType, data } }, { text: PROMPT }] }], generationConfig: { maxOutputTokens: 500, temperature: 0 } }) }
        );
        if (r.status === 429) { lastStatus = 429; continue; } // rate-limit → reintento con backoff
        if (!r.ok) return { err: `Gemini ${r.status}`, status: r.status };
        const j = await r.json();
        const txt = (j?.candidates?.[0]?.content?.parts || []).map((x: any) => x?.text || "").join("").trim();
        const p = parseJson(txt);
        return p ? { p } : { err: "La IA no devolvió datos legibles de la factura.", status: 200 };
      }
      return { err: `Gemini ${lastStatus || 429}`, status: lastStatus || 429 };
    };

    // ── Fallback a Claude visión para IMÁGENES si Gemini sigue en 429 (Claude no acepta PDF acá) ──
    const claudeExtract = async (): Promise<{ p: any } | null> => {
      const ak = process.env.ANTHROPIC_API_KEY;
      if (!ak || esPdf) return null;
      try {
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", headers: { "x-api-key": ak, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 500, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mimeType, data } }, { type: "text", text: PROMPT }] }] }),
        });
        if (!r.ok) return null;
        const j = await r.json();
        const txt = (j?.content || []).map((x: any) => x?.text || "").join("").trim();
        const p = parseJson(txt);
        return p ? { p } : null;
      } catch { return null; }
    }

    let g = await geminiExtract();
    if ("err" in g && g.status === 429) {
      const c = await claudeExtract();
      if (c) g = c;
      else if (!process.env.ANTHROPIC_API_KEY)
        // Gemini sin cuota diaria (no bursts) y sin respaldo → lo reportamos explícito para el operador.
        return NextResponse.json({ ok: false, error: "Gemini agotó la cuota diaria y no hay respaldo automático (falta ANTHROPIC_API_KEY en gestión). Cargá el consumo a mano por hoy, o probá con un PDF más tarde.", cuota_gemini: true });
    }
    if ("err" in g) return NextResponse.json({ ok: false, error: g.err });
    const p = g.p;

    const num = (v: any) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
    const data_out = {
      distribuidora: p.distribuidora ? String(p.distribuidora).slice(0, 60) : null,
      titular: p.titular ? String(p.titular).slice(0, 100) : null,
      kwh_mes: num(p.kwh_mes),
      kwh_meses: Array.isArray(p.kwh_meses) ? p.kwh_meses.map(num).filter((x: any) => x != null).slice(0, 12) : [],
      potencia_contratada_kw: num(p.potencia_contratada_kw),
      tarifa: p.tarifa ? String(p.tarifa).slice(0, 30) : null,
      periodo: p.periodo ? String(p.periodo).slice(0, 20) : null,
      importe: num(p.importe),
    };
    return NextResponse.json({ ok: true, data: data_out, ...(devolverArchivo ? { archivo: { b64: data, tipo } } : {}) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
