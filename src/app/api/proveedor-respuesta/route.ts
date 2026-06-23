import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// GET ?id=<pedido_id> → trae el email de respuesta del proveedor para ese pedido (de gsandler),
// con el cuerpo y los adjuntos (proforma). Matchea por N° GSA en el asunto o por email del proveedor.
export async function GET(req: NextRequest) {
  try {
    const sql = getDb();
    const sp = req.nextUrl.searchParams;
    // ?msg=<id> → trae un mensaje completo (cuerpo + adjuntos)
    const msgId = Number(sp.get("msg"));
    if (msgId) {
      const full = (await sql`SELECT id, from_name, from_addr, to_addrs, message_id, subject, date, body_html, body_text FROM mail_messages WHERE id=${msgId} LIMIT 1` as any[])[0];
      if (!full) return NextResponse.json({ ok: false, error: "mensaje no encontrado" }, { status: 404 });
      const adj = (await sql`SELECT id, filename, content_type, size FROM mail_attachments WHERE message_id=${msgId} ORDER BY id` as any[]);
      return NextResponse.json({ ok: true, mensaje: full, adjuntos: adj });
    }
    const id = Number(sp.get("id"));
    if (!id) return NextResponse.json({ ok: false, error: "id requerido" }, { status: 400 });
    const pr = (await sql`SELECT gsa_numero, email_destinatario, created_at, proveedor FROM pedidos_proveedores WHERE id=${id} LIMIT 1` as any[])[0];
    if (!pr) return NextResponse.json({ ok: false, error: "pedido no encontrado" }, { status: 404 });

    // Hilo: entrada (INBOX) + salida (Sent) que matchean por N° GSA o por el email del proveedor.
    const all = (await sql`SELECT id, folder, from_name, from_addr, to_addrs, subject, date, seen FROM mail_messages WHERE date > now() - interval '180 days' AND (folder='INBOX' OR folder ILIKE '%sent%')` as any[]);
    const re = pr.gsa_numero ? new RegExp("gsa\\s*0*" + pr.gsa_numero + "(\\D|$)", "i") : null;
    const em = String(pr.email_destinatario || "").toLowerCase();
    const enHilo = (s: string) => re ? re.test(s || "") : false;
    const mensajes = all.filter((m) => {
      const esSent = /sent/i.test(m.folder || "");
      if (esSent) return enHilo(m.subject) || (em && String(m.to_addrs || "").toLowerCase().includes(em));
      return enHilo(m.subject) || (em && String(m.from_addr || "").toLowerCase() === em && pr.created_at && new Date(m.date) >= new Date(pr.created_at));
    }).map((m) => ({ ...m, dir: /sent/i.test(m.folder || "") ? "out" : "in" }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());  // más nuevos arriba

    // Opciones de CC del CRM (admin/logística/general del proveedor).
    let cc_opciones: string[] = [];
    try {
      const provs = (await sql`SELECT razon_social, nombre_fantasia, alias, email, cont_admin_email, cont_logistica_email, cont_comercial_email FROM fg_proveedores WHERE activo IS NOT FALSE` as any[]);
      const norm = (s: any) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
      const pe = norm(pr.proveedor);
      const hit = pe ? provs.find((p) => [p.razon_social, p.nombre_fantasia, ...String(p.alias || "").split(/[,;|]/)].map(norm).filter((t: string) => t.length >= 4).some((t: string) => t.includes(pe) || pe.includes(t))) : null;
      if (hit) cc_opciones = Array.from(new Set([hit.cont_admin_email, hit.cont_logistica_email, hit.email].map((x: any) => String(x || "").trim()).filter((x: string) => /\S+@\S+\.\S+/.test(x) && x.toLowerCase() !== em)));
    } catch { /* sin CRM */ }

    return NextResponse.json({ ok: true, mensajes, proveedor_email: pr.email_destinatario, gsa_numero: pr.gsa_numero, cc_opciones });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// POST { msg, seen } → marcar un mensaje como leído / no leído.
export async function POST(req: NextRequest) {
  try {
    const sql = getDb();
    const b = await req.json();
    const msg = Number(b.msg);
    if (!msg) return NextResponse.json({ ok: false, error: "msg requerido" }, { status: 400 });
    await sql`UPDATE mail_messages SET seen=${b.seen === true} WHERE id=${msg}`;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
