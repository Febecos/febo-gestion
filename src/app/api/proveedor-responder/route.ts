import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// POST { to, cc?, subject, body, in_reply_to? } → responde al proveedor desde gsandler (vía selector).
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.to || !b.subject) return NextResponse.json({ ok: false, error: "to y subject requeridos" }, { status: 400 });
    const internal = process.env.INTERNAL_SERVICE_SECRET; const fvTok = process.env.FV_ADMIN_TOKEN;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (internal) headers["Authorization"] = "Bearer " + internal; else if (fvTok) headers["X-Admin-Token"] = fvTok;
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;white-space:pre-wrap">${String(b.body || "").replace(/[&<>]/g, (c: string) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] || c))}</div>`;
    const r = await fetch("https://febecos.com/api/admin?action=mail_send_internal", {
      method: "POST", headers,
      body: JSON.stringify({ account_email: "gsandler@febecos.com", to: b.to, cc: b.cc || undefined, subject: b.subject, html, in_reply_to: b.in_reply_to || undefined, attachments: Array.isArray(b.attachments) ? b.attachments : undefined, forward_from: b.forward_from || undefined }),
    });
    const d = await r.json().catch(() => ({ ok: false, error: "respuesta no-JSON del selector" }));
    return NextResponse.json(d, { status: r.ok ? 200 : r.status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
