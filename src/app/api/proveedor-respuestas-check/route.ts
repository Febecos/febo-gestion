import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { extractText, getDocumentProxy } from "unpdf";

export const runtime = "nodejs";

// Detección + validación NATIVA de respuestas de proveedores (proformas) contra los pedidos
// a proveedor enviados. Lee mail_messages/mail_attachments del Neon central, parsea el PDF con
// unpdf, valida proveedor/ítems/monto y da un score. Sin depender del selector.

const norm = (s: any) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const alnum = (s: any) => norm(s).replace(/[^a-z0-9]/g, "");

async function pdfText(b64: string): Promise<string> {
  try {
    const buf = Buffer.from(b64, "base64");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join(" ") : String(text || "");
  } catch { return ""; }
}

// Montos del texto: tolera formato AR (1.234,56), coma decimal (368,00) y punto decimal (445.28).
function montosDe(texto: string): number[] {
  const m = texto.match(/\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2}|\d+\.\d{2}/g) || [];
  return m.map((s) => /,\d{2}$/.test(s) ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s)).filter((n) => !isNaN(n));
}

export async function GET() {
  try {
    const sql = getDb();
    const emails = await sql`
      SELECT id, from_name, from_addr, subject, date, snippet, has_attachments, body_html, body_text
      FROM mail_messages
      WHERE folder = 'INBOX' AND seen = false
        AND (from_addr ILIKE '%multiradio%' OR from_addr ILIKE '%multisolar%' OR from_addr ILIKE '%multipoint%'
             OR subject ILIKE '%gsa%' OR subject ILIKE '%proforma%' OR subject ILIKE '%pro forma%' OR subject ILIKE '%confirmaci%')
      ORDER BY date DESC LIMIT 25` as any[];
    const pend = await sql`
      SELECT id, gsa_numero, proveedor, fv_numero, items, total_costo_usd, email_destinatario
      FROM pedidos_proveedores
      WHERE gsa_numero IS NOT NULL
        AND COALESCE(estado,'') NOT IN ('confirmado','pagado','recibido_ok','recibido_diferencias','anulado')
        AND proveedor_confirmado IS NOT TRUE` as any[];

    const alerts: any[] = [];
    for (const m of emails) {
      const gsaM = String(m.subject || "").match(/gsa[\s\-#]*0*(\d+)/i);
      const gsaNum = gsaM ? Number(gsaM[1]) : null;
      const ped = gsaNum ? pend.find((p) => Number(p.gsa_numero) === gsaNum) : null;
      let validacion: any = null;
      if (ped) {
        const adj = await sql`SELECT filename, content_type, encode(content,'base64') AS b64 FROM mail_attachments WHERE message_id=${m.id}` as any[];
        let pdfTxt = "";
        for (const a of adj) { if (/pdf/i.test(a.content_type || "") || /\.pdf$/i.test(a.filename || "")) pdfTxt += " " + await pdfText(a.b64); }
        const bodyRaw = norm((m.body_text || m.body_html || "").replace(/<[^>]+>/g, " "));
        const bodyLimpio = bodyRaw.split(/on .{0,80}wrote:|el .{0,80}escribi/i)[0].replace(/^>.*$/gm, "");
        const texto = pdfTxt.trim() ? norm(pdfTxt) : bodyLimpio;
        const textoAlnum = alnum(texto);
        const esMulti = /multiradio/i.test(ped.proveedor || "");
        const items = (ped.items || []).filter((it: any) => !(esMulti && /embalaje/i.test((it.codigo || "") + " " + (it.descripcion || ""))));
        // Proveedor
        const provFirst = norm(ped.proveedor).split(/\s+/)[0] || norm(ped.proveedor);
        const provOk = norm(m.from_addr).includes("multi") || norm(m.from_addr).includes(alnum(ped.proveedor).slice(0, 6)) || texto.includes(provFirst);
        // Ítems
        const items_detalle = items.map((it: any) => {
          const cod = alnum(it.codigo);
          let encontrado = !!cod && cod.length >= 3 && textoAlnum.includes(cod);
          let metodo = encontrado ? "código" : "";
          if (!encontrado) {
            const ws = norm(it.descripcion).split(/\s+/).filter((w: string) => w.length > 4).slice(0, 3);
            if (ws.length && ws.every((w: string) => texto.includes(w))) { encontrado = true; metodo = "descripción"; }
          }
          return { codigo: it.codigo, descripcion: it.descripcion, cantidad: it.cantidad, costo_usd: it.costo_usd, encontrado, metodo };
        });
        const encontrados = items_detalle.filter((d: any) => d.encontrado).length;
        const todos = items.length > 0 && encontrados === items.length;
        const algunos = encontrados > 0;
        // Monto
        const totalEq = items.reduce((a: number, it: any) => a + (Number(it.costo_usd) || 0) * (Number(it.cantidad) || 1), 0);
        const cerca = (v: number, t: number) => t > 0 && Math.abs(v - t) / t <= 0.12;
        const mts = montosDe(texto);
        const montoOk = mts.some((v) => cerca(v, totalEq) || (esMulti && cerca(v, totalEq * 1.21)));
        let score = 0;
        if (provOk) score += 2;
        if (todos) score += 2; else if (algunos) score += 1;
        if (montoOk) score += 1;
        validacion = {
          proveedor_ok: provOk, items_detalle, encontrados, total_items: items.length,
          monto_ok: montoOk, total_equipos: +totalEq.toFixed(2), con_iva: esMulti ? +(totalEq * 1.21).toFixed(2) : null,
          es_multiradio: esMulti, leyo_pdf: !!pdfTxt.trim(), score,
          veredicto: score >= 4 ? "corresponde" : score === 3 ? "probable" : score === 2 ? "dudosa" : "no_corresponde",
        };
      }
      alerts.push({
        email_id: m.id, from_name: m.from_name, from_addr: m.from_addr, subject: m.subject, date: m.date,
        snippet: m.snippet, has_attachments: m.has_attachments, gsa_detectado: gsaNum, validacion,
        pedido_match: ped ? { id: ped.id, gsa_numero: ped.gsa_numero, proveedor: ped.proveedor, fv_numero: ped.fv_numero, total_costo_usd: ped.total_costo_usd, items: ped.items } : null,
      });
    }
    return NextResponse.json({ ok: true, alerts });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// POST { pedido_id, email_id } → confirma el pedido a proveedor (nativo). accion='ignorar' → marca leído sin confirmar.
export async function POST(req: NextRequest) {
  try {
    const sql = getDb();
    const b = await req.json();
    const email_id = Number(b.email_id) || null;
    if (b.accion === "ignorar") {
      if (email_id) await sql`UPDATE mail_messages SET seen=true WHERE id=${email_id}`;
      return NextResponse.json({ ok: true });
    }
    const pedido_id = Number(b.pedido_id);
    if (!pedido_id) return NextResponse.json({ ok: false, error: "pedido_id requerido" }, { status: 400 });
    await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS proveedor_confirmado BOOLEAN DEFAULT false`.catch(() => {});
    await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS proveedor_confirmado_at TIMESTAMPTZ`.catch(() => {});
    await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS confirmacion_email_id INTEGER`.catch(() => {});
    await sql`UPDATE pedidos_proveedores SET estado='confirmado', proveedor_confirmado=true, proveedor_confirmado_at=now(), confirmacion_email_id=${email_id} WHERE id=${pedido_id}`;
    if (email_id) await sql`UPDATE mail_messages SET seen=true WHERE id=${email_id}`;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
