import { NextRequest, NextResponse } from "next/server";

// POST /api/auth/login  Body: { email }
// Proxy al admin del selector: envía el código OTP por email (reusa admin_users).
export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email) return NextResponse.json({ ok: false, error: "Email requerido" }, { status: 400 });
    const r = await fetch("https://febecos.com/api/admin?action=login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json();
    return NextResponse.json(d, { status: r.status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
  }
}
