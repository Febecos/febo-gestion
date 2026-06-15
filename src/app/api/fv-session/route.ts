import { NextResponse } from "next/server";

// GET /api/fv-session  → token efímero para abrir el visor/cotizador FV en modo INTERNO
// (con todos los botones). Protegido por la sesión de gestión (middleware fg_token).
// Server↔server: usa INTERNAL_SERVICE_SECRET, que NUNCA llega al navegador.
export async function GET() {
  try {
    const secret = process.env.INTERNAL_SERVICE_SECRET;
    if (!secret) return NextResponse.json({ ok: false, error: "INTERNAL_SERVICE_SECRET no configurado en gestión" }, { status: 500 });
    const r = await fetch("https://fv.febecos.com/api/internal-session", {
      headers: { Authorization: "Bearer " + secret },
      cache: "no-store",
    });
    const d = await r.json().catch(() => ({ ok: false, error: "respuesta no-JSON de fv" }));
    return NextResponse.json(d, { status: r.ok ? 200 : r.status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
  }
}
