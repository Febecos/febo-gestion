import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";

// POST /api/auth/verify  Body: { email, code }
// Valida el código OTP contra el admin del selector (reusa admin_users). Si es
// correcto, FEBO-GESTION firma SU PROPIA sesión con FG_JWT_SECRET (no depende del
// secret del selector) y la guarda en cookie httpOnly.
export async function POST(req: NextRequest) {
  try {
    const { email, code } = await req.json();
    if (!email || !code) return NextResponse.json({ ok: false, error: "Email y código requeridos" }, { status: 400 });
    const secret = process.env.FG_JWT_SECRET;
    if (!secret) return NextResponse.json({ ok: false, error: "Falta FG_JWT_SECRET en el servidor" }, { status: 500 });

    const r = await fetch("https://febecos.com/api/admin?action=verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json();
    if (!d.ok) return NextResponse.json(d, { status: r.status || 401 });

    // OTP válido → emitir sesión propia. Guardamos el nombre del usuario interno
    // (de admin_users, ej "Guillermo Sandler") para atribuir cada cotización al
    // vendedor → base del cálculo de comisiones.
    const nombre = d?.user?.nombre || d?.user?.name || email;
    const token = await new SignJWT({ email, nombre })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(new TextEncoder().encode(secret));

    const res = NextResponse.json({ ok: true });
    res.cookies.set("fg_token", token, {
      httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
  }
}
