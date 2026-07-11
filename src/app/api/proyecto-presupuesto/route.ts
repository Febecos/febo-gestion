import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/proyecto-presupuesto — proxy server↔server al generador de presupuesto automático del
// Proyecto FV (fv-febecos valoriza la BOM con el cotizador y crea el PREV). Devuelve JSON SIEMPRE
// (si el upstream responde HTML/timeout, status+snippet — mismo patrón que /api/dimensionar).
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const secret = process.env.FV_BRIDGE_SECRET || process.env.INTERNAL_SERVICE_SECRET;
    if (!secret) return NextResponse.json({ ok: false, error: "FV_BRIDGE_SECRET no configurado en gestión" }, { status: 500 });
    const r = await fetch("https://fv.febecos.com/api/proyecto-presupuesto", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + secret },
      body: JSON.stringify(b),
    });
    const txt = await r.text();
    let d: any;
    try { d = JSON.parse(txt); }
    catch { return NextResponse.json({ ok: false, error: `presupuesto automático: respuesta no-JSON (HTTP ${r.status})`, upstream_status: r.status, upstream_snippet: txt.slice(0, 300) }, { status: 502 }); }
    return NextResponse.json(d, { status: r.ok ? 200 : r.status });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}
