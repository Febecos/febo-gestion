import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// Datos en vivo: no cachear (Next cachea GET sin request → datos viejos).
export const dynamic = "force-dynamic";

// GET /api/me → datos del usuario logueado (de la cookie fg_token). Sirve para
// mostrar/ocultar opciones por rol (ej. Configuración solo para el owner).
export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("fg_token")?.value;
    const secret = process.env.FG_JWT_SECRET;
    if (!token || !secret) return NextResponse.json({ ok: false }, { status: 401 });
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    return NextResponse.json({
      ok: true,
      email: payload.email || "",
      nombre: payload.nombre || payload.name || "",
      es_owner: !!payload.es_owner,
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
}
