import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getDb } from "@/lib/db";

// GET /api/cotizadores  → URLs de los cotizadores (bombas/FV) con el TOKEN del usuario
// logueado, para que abran su perfil (precios). El token se resuelve server-side por
// email (de la sesión) contra solicitudes_revendedor — nunca queda en el código/bundle.
export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("fg_token")?.value;
    const secret = process.env.FG_JWT_SECRET;
    if (!token || !secret) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    const email = (payload as any).email as string;
    if (!email) return NextResponse.json({ ok: false, error: "Sesión sin email" }, { status: 401 });

    const sql = getDb();
    const rows = await sql`
      SELECT token_acceso FROM solicitudes_revendedor
      WHERE lower(email) = ${email.toLowerCase()} AND token_acceso_activo = true AND token_acceso IS NOT NULL
      LIMIT 1`;
    const tk = rows[0]?.token_acceso || null;
    if (!tk) {
      // sin token → URLs públicas (versión sin perfil)
      return NextResponse.json({ ok: true, tiene_token: false, bombas: "https://revendedores.febecos.com/portal", fv: "https://fv.febecos.com/cotizar" });
    }
    const e = encodeURIComponent(tk);
    return NextResponse.json({
      ok: true, tiene_token: true,
      bombas: `https://revendedores.febecos.com/portal?token=${e}`,
      fv: `https://fv.febecos.com/cotizar#rev=${e}`,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
