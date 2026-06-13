import { NextRequest, NextResponse } from "next/server";

// GET /api/consultar-cuit?cuit=XXXXXXXXXXX
// Proxy al endpoint oficial del selector (certificado ARCA real). No reimplementamos
// el cert acá: reusamos `febecos.com/api/admin?action=consultar_cuit` (público).
export async function GET(req: NextRequest) {
  const cuit = (req.nextUrl.searchParams.get("cuit") || "").replace(/\D/g, "");
  if (cuit.length !== 11) return NextResponse.json({ ok: false, error: "CUIT inválido (11 dígitos)" }, { status: 400 });
  try {
    const r = await fetch(`https://febecos.com/api/admin?action=consultar_cuit&cuit=${cuit}`, {
      signal: AbortSignal.timeout(12000),
    });
    const d = await r.json();
    return NextResponse.json(d, { status: r.ok ? 200 : 502 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "No pudimos consultar ARCA: " + e.message }, { status: 502 });
  }
}
