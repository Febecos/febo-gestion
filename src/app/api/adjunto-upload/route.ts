import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// POST /api/adjunto-upload  { filename, content_type?, data_b64 } → { ok, url }
// Proxy server↔server a fv-febecos/api/adjunto-upload (Bearer FV_BRIDGE_SECRET). Sube UN adjunto por
// request (chico) para el mail de presupuesto → devuelve la URL que Resend usa como `path`. Así se
// pueden adjuntar varios datasheets sin meter todo en base64 en un solo body (evita el 413 de Vercel).
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b?.filename || !b?.data_b64) return NextResponse.json({ ok: false, error: "filename y data_b64 requeridos" }, { status: 400 });
    const secret = process.env.FV_BRIDGE_SECRET || process.env.INTERNAL_SERVICE_SECRET;
    if (!secret) return NextResponse.json({ ok: false, error: "FV_BRIDGE_SECRET no configurado en gestión" }, { status: 500 });
    const r = await fetch("https://fv.febecos.com/api/adjunto-upload", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + secret },
      body: JSON.stringify({ filename: b.filename, content_type: b.content_type || null, data_b64: b.data_b64 }),
    });
    const d = await r.json().catch(() => ({ ok: false, error: "respuesta no-JSON de fv" }));
    return NextResponse.json(d, { status: r.ok ? 200 : r.status });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}
