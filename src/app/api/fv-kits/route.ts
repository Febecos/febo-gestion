import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Proxy a fv-febecos /api/fv-kits (plantillas de kits FV, dueño = fv-febecos) ─────────────
// Server↔server: firma un JWT corto (internal:true) con FV_BRIDGE_SECRET||INTERNAL_SERVICE_SECRET
// (mismo patrón que fv-session) para que isAdmin() de fv-febecos lo acepte. El secret NUNCA
// llega al navegador.
function tokenServicio(): string | null {
  const secret = process.env.FV_BRIDGE_SECRET || process.env.INTERNAL_SERVICE_SECRET;
  if (!secret) return null;
  return jwt.sign({ internal: true, src: "gestion" }, secret, { expiresIn: "5m" });
}

export async function GET(req: NextRequest) {
  const tok = tokenServicio();
  if (!tok) return NextResponse.json({ ok: false, error: "FV_BRIDGE_SECRET no configurado en gestión" }, { status: 500 });
  try {
    const qs = req.nextUrl.search || "";
    const r = await fetch("https://fv.febecos.com/api/fv-kits" + qs, { headers: { Authorization: "Bearer " + tok }, cache: "no-store" });
    const d = await r.json().catch(() => ({ ok: false, error: "respuesta no-JSON de fv" }));
    return NextResponse.json(d, { status: r.status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const tok = tokenServicio();
  if (!tok) return NextResponse.json({ ok: false, error: "FV_BRIDGE_SECRET no configurado en gestión" }, { status: 500 });
  try {
    const body = await req.text();
    const r = await fetch("https://fv.febecos.com/api/fv-kits", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body });
    const d = await r.json().catch(() => ({ ok: false, error: "respuesta no-JSON de fv" }));
    return NextResponse.json(d, { status: r.status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
  }
}
