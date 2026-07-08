import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// POST /api/presupuesto-email  { numero, email, link, tipo:'rev'|'cliente', nombre?, mensaje?, preview? }
// Manda el email con NOTA + botón al presupuesto (PDF exacto) vía fv-febecos (Resend + FV_BRIDGE_SECRET).
// (El adjunto PDF server-side quedó pendiente: chromium no corre en este Vercel — ver SECURITY/HANDOFF.)
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.email || !b.link) return NextResponse.json({ ok: false, error: "email y link requeridos" }, { status: 400 });
    const secret = process.env.FV_BRIDGE_SECRET || process.env.INTERNAL_SERVICE_SECRET;
    if (!secret) return NextResponse.json({ ok: false, error: "FV_BRIDGE_SECRET no configurado en gestión" }, { status: 500 });
    const r = await fetch("https://fv.febecos.com/api/enviar-presupuesto-link", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + secret },
      body: JSON.stringify({ email: b.email, nombre: b.nombre || "", numero: b.numero || "", link: b.link, tipo: b.tipo || "rev", mensaje: b.mensaje || "", preview: !!b.preview, pdf_b64: b.pdf_b64 || null, pdf_nombre: b.pdf_nombre || null, adjuntos: Array.isArray(b.adjuntos) ? b.adjuntos : [] }),
    });
    const d = await r.json().catch(() => ({ ok: false, error: "respuesta no-JSON de fv" }));
    return NextResponse.json(d, { status: r.ok ? 200 : r.status });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}
