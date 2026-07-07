import { NextRequest, NextResponse } from "next/server";

// GET /api/consultar-cuit?cuit=XXXXXXXXXXX
// Proxy al endpoint oficial del selector (certificado ARCA real). No reimplementamos
// el cert acá: reusamos `febecos.com/api/admin?action=consultar_cuit` (público).
// El 1er llamado en frío al cert AFIP (vía selector) suele tardar más que un timeout corto;
// el 2do (conexión/token ya caliente) responde rápido. En vez de que el usuario tenga que
// hacer 2 clicks a mano, reintentamos una vez acá adentro — transparente para el cliente
// (reportado 07/07: 1er click "timeout", 2do click sí trae los datos).
async function consultarUpstream(cuit: string, timeoutMs: number) {
  const r = await fetch(`https://febecos.com/api/admin?action=consultar_cuit&cuit=${cuit}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  const d = await r.json();
  return { ok: r.ok, d };
}

export async function GET(req: NextRequest) {
  const cuit = (req.nextUrl.searchParams.get("cuit") || "").replace(/\D/g, "");
  if (cuit.length !== 11) return NextResponse.json({ ok: false, error: "CUIT inválido (11 dígitos)" }, { status: 400 });
  try {
    const { ok, d } = await consultarUpstream(cuit, 15000);
    return NextResponse.json(d, { status: ok ? 200 : 502 });
  } catch {
    // timeout/abort en frío → 1 reintento (la 2da conexión suele ir caliente)
    try {
      const { ok, d } = await consultarUpstream(cuit, 15000);
      return NextResponse.json(d, { status: ok ? 200 : 502 });
    } catch (e2: any) {
      return NextResponse.json({ ok: false, error: "No pudimos consultar ARCA: " + e2.message }, { status: 502 });
    }
  }
}
