import { NextRequest, NextResponse } from "next/server";

// Proxy al maestro de transportistas (logistics.carriers, en el selector).
// La data es compartida; reusamos el CRUD ya existente (carriers + contactos + zonas).
// Protegido por el middleware de gestión (requiere sesión). Escrituras con secreto interno.
export const dynamic = "force-dynamic";
const SELECTOR = "https://febecos.com/api/transportistas";

function svcHeaders(json = false): Record<string, string> {
  const h: Record<string, string> = {};
  const internal = process.env.INTERNAL_SERVICE_SECRET; const fvTok = process.env.FV_ADMIN_TOKEN;
  if (internal) h["Authorization"] = "Bearer " + internal; else if (fvTok) h["X-Admin-Token"] = fvTok;
  if (json) h["Content-Type"] = "application/json";
  return h;
}

export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.search || "";
    const r = await fetch(SELECTOR + qs, { headers: svcHeaders() });
    return NextResponse.json(await r.json(), { status: r.status });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 502 }); }
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const r = await fetch(SELECTOR, { method: "POST", headers: svcHeaders(true), body });
    return NextResponse.json(await r.json(), { status: r.status });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 502 }); }
}
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.text();
    const r = await fetch(SELECTOR, { method: "PATCH", headers: svcHeaders(true), body });
    return NextResponse.json(await r.json(), { status: r.status });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 502 }); }
}
export async function DELETE(req: NextRequest) {
  try {
    const qs = req.nextUrl.search || "";
    const r = await fetch(SELECTOR + qs, { method: "DELETE", headers: svcHeaders() });
    return NextResponse.json(await r.json(), { status: r.status });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 502 }); }
}
