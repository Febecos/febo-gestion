import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// GET /api/fv-session  → token efímero para abrir el visor/cotizador FV en modo INTERNO
// (con todos los botones). Protegido por la sesión de gestión (middleware fg_token).
// Server↔server: usa INTERNAL_SERVICE_SECRET, que NUNCA llega al navegador.
// Propaga el VENDEDOR (usuario interno logueado) al JWT efímero → el cotizador
// FV registra quién hizo cada cotización (comisiones).
export async function GET(req: NextRequest) {
  try {
    const secret = process.env.FV_BRIDGE_SECRET || process.env.INTERNAL_SERVICE_SECRET;
    if (!secret) return NextResponse.json({ ok: false, error: "FV_BRIDGE_SECRET no configurado en gestión" }, { status: 500 });

    // Identificar al vendedor desde la sesión de gestión (cookie fg_token)
    let vendedor = "", vendedorEmail = "";
    try {
      const fg = req.cookies.get("fg_token")?.value;
      const fgSecret = process.env.FG_JWT_SECRET;
      if (fg && fgSecret) {
        const { payload } = await jwtVerify(fg, new TextEncoder().encode(fgSecret));
        vendedor = String(payload.nombre || payload.name || "");
        vendedorEmail = String(payload.email || "");
      }
    } catch { /* sin vendedor identificable → sigue sin atribución */ }

    const qs = new URLSearchParams();
    if (vendedor) qs.set("vendedor", vendedor);
    if (vendedorEmail) qs.set("vendedor_email", vendedorEmail);
    const url = "https://fv.febecos.com/api/internal-session" + (qs.toString() ? "?" + qs : "");
    const r = await fetch(url, {
      headers: { Authorization: "Bearer " + secret },
      cache: "no-store",
    });
    const d = await r.json().catch(() => ({ ok: false, error: "respuesta no-JSON de fv" }));
    return NextResponse.json(d, { status: r.ok ? 200 : r.status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
  }
}
