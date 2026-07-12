import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/proyecto-comparar { form_inputs } → { ok, opciones[3], recomendacion }
// Proxy al comparador de 3 opciones (fv-febecos/api/proyecto-comparar, Bearer FV_BRIDGE_SECRET):
// corre el motor 3× (on-grid / off-grid / híbrido) con la misma factura, valoriza cada BOM y
// recomienda la de menor repago. No crea presupuestos.
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const secret = process.env.FV_BRIDGE_SECRET || process.env.INTERNAL_SERVICE_SECRET;
    if (!secret) return NextResponse.json({ ok: false, error: "FV_BRIDGE_SECRET no configurado en gestión" }, { status: 500 });
    const r = await fetch("https://fv.febecos.com/api/proyecto-comparar", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + secret },
      body: JSON.stringify(b),
    });
    const txt = await r.text();
    let d: any;
    try { d = JSON.parse(txt); }
    catch {
      return NextResponse.json({
        ok: false,
        error: `El comparador (fv.febecos.com/api/proyecto-comparar) devolvió una respuesta no-JSON (HTTP ${r.status}).`,
        upstream_status: r.status, upstream_snippet: txt.slice(0, 300),
      }, { status: 502 });
    }
    return NextResponse.json(d, { status: r.ok ? 200 : r.status });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}
