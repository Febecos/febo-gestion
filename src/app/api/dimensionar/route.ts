import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/dimensionar { inputs }  → { ok, sistema, bom, meta }
// Proxy server↔server al motor FV (fv-febecos/api/dimensionar, Bearer FV_BRIDGE_SECRET). Lo llama el
// botón "Dimensionar y cotizar" del formulario de proyecto. Devuelve el sistema + BOM (para precargar
// el cotizador) + meta (para el informe técnico). El motor NO valoriza: el cotizador pone precios.
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const secret = process.env.FV_BRIDGE_SECRET || process.env.INTERNAL_SERVICE_SECRET;
    if (!secret) return NextResponse.json({ ok: false, error: "FV_BRIDGE_SECRET no configurado en gestión" }, { status: 500 });
    const r = await fetch("https://fv.febecos.com/api/dimensionar", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + secret },
      body: JSON.stringify({ inputs: b.inputs || b }),
    });
    const d = await r.json().catch(() => ({ ok: false, error: "respuesta no-JSON del motor" }));
    return NextResponse.json(d, { status: r.ok ? 200 : r.status });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}
