import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// POST /api/comprobante-email { token }  → envía el comprobante por email al cliente registrado.
// Sólo envía al email que figura en la ficha del cliente (no a destinatarios arbitrarios).
export async function POST(req: NextRequest) {
  try {
    const { token, email: emailOverride } = await req.json();
    if (!token) return NextResponse.json({ ok: false, error: "token requerido" }, { status: 400 });
    const sql = getDb();
    const c = (await sql`SELECT id, tipo, numero, total, moneda, cliente_id, cliente_nombre, leyendas FROM fg_comprobantes WHERE token=${token} LIMIT 1` as any[])[0];
    if (!c) return NextResponse.json({ ok: false, error: "comprobante no encontrado" }, { status: 404 });
    let email = "", nombre = c.cliente_nombre || "";
    if (c.cliente_id) {
      const cl = await sql`SELECT email, nombre, razon_social FROM clientes WHERE id=${c.cliente_id} LIMIT 1` as any[];
      email = cl[0]?.email || ""; nombre = cl[0]?.razon_social || cl[0]?.nombre || nombre;
    }
    // Email de envío: override (prueba / destinatario indicado) o el de la ficha del CRM.
    const override = String(emailOverride || "").trim();
    if (override) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(override)) return NextResponse.json({ ok: false, error: "Email inválido." }, { status: 400 });
      email = override;
      // Si el comprobante está vinculado a un cliente sin email, lo guardamos por norma en el CRM.
      if (c.cliente_id) { const cl2 = await sql`SELECT email FROM clientes WHERE id=${c.cliente_id} LIMIT 1` as any[]; if (!cl2[0]?.email) await sql`UPDATE clientes SET email=${override} WHERE id=${c.cliente_id}`; }
    }
    if (!email) return NextResponse.json({ ok: false, error: "El cliente no tiene email cargado en su ficha del CRM. Cargalo en la ficha del cliente (o indicá un email para enviar)." }, { status: 409 });

    // Dominio público del visor (oculta gestion.febecos.com). Configurable por env;
    // si no está, cae al host de la request.
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "gestion.febecos.com";
    const proto = req.headers.get("x-forwarded-proto") || "https";
    const base = (process.env.VISOR_BASE_URL || `${proto}://${host}`).replace(/\/+$/, "");
    const link = `${base}/p/${token}`;

    const internal = process.env.INTERNAL_SERVICE_SECRET; const fvTok = process.env.FV_ADMIN_TOKEN;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (internal) headers["Authorization"] = "Bearer " + internal; else if (fvTok) headers["X-Admin-Token"] = fvTok;
    const r = await fetch("https://febecos.com/api/admin?action=enviar-comprobante", {
      method: "POST", headers,
      body: JSON.stringify({ email, nombre, numero: c.numero, tipo: c.tipo, total: c.total, moneda: c.moneda, link, leyendas: c.leyendas || [] }),
    });
    const d = await r.json().catch(() => ({ ok: false, error: "respuesta no-JSON" }));
    return NextResponse.json({ ...d, email }, { status: r.ok ? 200 : (r.status || 502) });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}
