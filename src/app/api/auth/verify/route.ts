import { NextRequest, NextResponse } from "next/server";

// POST /api/auth/verify  Body: { email, code }
// Proxy al verify del selector → recibe el JWT y lo guarda en cookie httpOnly.
export async function POST(req: NextRequest) {
  try {
    const { email, code } = await req.json();
    if (!email || !code) return NextResponse.json({ ok: false, error: "Email y código requeridos" }, { status: 400 });
    const r = await fetch("https://febecos.com/api/admin?action=verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json();
    if (!d.ok || !d.token) return NextResponse.json(d, { status: r.status || 401 });

    const res = NextResponse.json({ ok: true });
    res.cookies.set("fg_token", d.token, {
      httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
  }
}
