import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/proyecto-generar-opciones { form_inputs, cliente, cliente_id?, proyecto_id? }
// Proxy al orquestador (fv-febecos/api/proyecto-generar-opciones): genera las 3 opciones REALES
// (dimensiona + PREV por modo) y devuelve las 3 + recomendación. Lo llama el botón "Generar las 3
// opciones". JSON siempre (si upstream da HTML/timeout → status+snippet).
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const secret = process.env.FV_BRIDGE_SECRET || process.env.INTERNAL_SERVICE_SECRET;
    if (!secret) return NextResponse.json({ ok: false, error: "FV_BRIDGE_SECRET no configurado en gestión" }, { status: 500 });
    const r = await fetch("https://fv.febecos.com/api/proyecto-generar-opciones", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + secret },
      body: JSON.stringify(b),
    });
    const txt = await r.text();
    let d: any;
    try { d = JSON.parse(txt); }
    catch {
      return NextResponse.json({
        ok: false,
        error: `El generador (fv.febecos.com/api/proyecto-generar-opciones) devolvió una respuesta no-JSON (HTTP ${r.status}).`,
        upstream_status: r.status, upstream_snippet: txt.slice(0, 300),
      }, { status: 502 });
    }
    return NextResponse.json(d, { status: r.ok ? 200 : r.status });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}
