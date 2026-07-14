import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureCtaCte, movCtaCte, delMov, delMovPrefijo } from "@/lib/ctacte";

// Auto-confirma el stock del PEDIDO DE CLIENTE (fv_pedidos.proveedor_confirmado) cuando TODOS sus
// pedidos a proveedor están confirmados (proforma/orden/factura). Solo SETEA true (nunca pisa un
// override manual del owner). Un pedido de cliente puede tener varios pedidos a proveedor (1 por emisor).
async function syncProveedorConfirmado(sql: any, fvNumero: string | null) {
  if (!fvNumero) return;
  const refs = String(fvNumero).split(/[,;]/).map((s) => s.trim().replace(/^FV-/i, "")).filter((r) => /^PED-/i.test(r));
  if (!refs.length) return;
  const CONF = ["confirmado", "pagado", "recibido_ok", "recibido_diferencias", "stock_propio"];
  const todas = (await sql`SELECT fv_numero, estado FROM pedidos_proveedores WHERE fv_numero IS NOT NULL AND COALESCE(estado,'') <> 'anulado'` as any[]);
  for (const ref of refs) {
    const mine = todas.filter((r) => String(r.fv_numero).split(/[,;]/).map((s: string) => s.trim().replace(/^FV-/i, "")).includes(ref));
    if (!mine.length) continue;
    if (mine.every((r) => CONF.includes(r.estado))) {
      await sql`UPDATE fv_pedidos SET proveedor_confirmado=true, proveedor_confirmado_at=now() WHERE numero=${ref} AND COALESCE(proveedor_confirmado,false)=false`.catch(() => {});
    }
  }
}

// Migra la confirmación VIEJA (proforma_archivo único) al nuevo array `proformas` (1 entrada) la
// primera vez que se abre el pedido. Convierte la cta cte: ppconf:<id> → ppprof:<id>:0. Idempotente.
async function migrarProformas(sql: any, p: any): Promise<any> {
  if (!p) return p;
  const proformas = Array.isArray(p.proformas) ? p.proformas : [];
  if (proformas.length > 0) return p;
  if (!p.proforma_archivo && !p.monto_solicitado) return p;
  const itemsConf = Array.isArray(p.items_confirmados) ? p.items_confirmados.filter((x: any) => x.confirmado !== false).map((x: any) => String(x.codigo)) : (p.items || []).map((it: any) => String(it.codigo));
  const pf0 = { numero: p.gsa_numero ? "GSA " + p.gsa_numero : "", archivo: p.proforma_archivo || null, moneda: p.moneda_prov || "USD", monto: p.monto_solicitado || null, monto_usd: p.monto_solicitado_usd || null, tc: p.tc_prov || null, items: itemsConf, fecha: p.created_at || new Date().toISOString() };
  try {
    await sql`UPDATE pedidos_proveedores SET proformas=${JSON.stringify([pf0])}::jsonb WHERE id=${p.id}`;
    if ((Number(pf0.monto_usd) || 0) > 0) {
      await delMov(sql, `ppconf:${p.id}`).catch(() => {});
      await movCtaCte(sql, { ambito: "proveedor", proveedor: p.proveedor, concepto: `Proforma ${pf0.numero || ""} ${p.gsa_numero ? "GSA " + p.gsa_numero : "#" + p.id}`, comprobante: p.fv_numero || null, debe: 0, haber: +Number(pf0.monto_usd).toFixed(2), detalle: { pedido_id: p.id, proforma: pf0.numero }, uniq: `ppprof:${p.id}:0` }).catch(() => {});
    }
  } catch { /* no bloquea */ }
  return { ...p, proformas: [pf0] };
}

// Pedidos a proveedor (tabla pedidos_proveedores, compartida con el admin del selector).
// GET ?id= → detalle · GET → lista (filtros proveedor/estado/q)
// PATCH { id, accion: 'estado'|'recibir'|'pago' }
async function ensure(sql: any) {
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS numero_remito TEXT`.catch(() => {});
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS items_recibidos JSONB`.catch(() => {});
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS total_recibido_usd NUMERIC`.catch(() => {});
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS notas_recepcion TEXT`.catch(() => {});
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS pagado_archivo JSONB`.catch(() => {});
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS pagado_fecha TIMESTAMPTZ`.catch(() => {});
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS origen TEXT DEFAULT 'fv'`.catch(() => {});
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS mensaje TEXT`.catch(() => {});
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS creado_por TEXT`.catch(() => {});
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS cc_emails TEXT`.catch(() => {});
  // Confirmación del proveedor (proforma + moneda + monto solicitado + TC + tildes)
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS proforma_archivo JSONB`.catch(() => {});
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS moneda_prov TEXT`.catch(() => {});
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS tc_prov NUMERIC`.catch(() => {});
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS monto_solicitado NUMERIC`.catch(() => {});
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS monto_solicitado_usd NUMERIC`.catch(() => {});
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS items_confirmados JSONB`.catch(() => {});
  // Confirmación POR PROFORMA: varias proformas por pedido, cada una con N°, PDF, monto e ítems.
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS proformas JSONB DEFAULT '[]'::jsonb`.catch(() => {});
  // Pagos (puede haber varios) + factura del proveedor
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS pagos JSONB`.catch(() => {});
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS factura_archivo JSONB`.catch(() => {});
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS numero_factura TEXT`.catch(() => {});
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS factura_total NUMERIC`.catch(() => {});
  await sql`ALTER TABLE pedidos_proveedores ADD COLUMN IF NOT EXISTS factura_fecha DATE`.catch(() => {});
}

// Resuelve los contactos del proveedor (CRM) por nombre de empresa.
// Devuelve { to, cc } → comercial al "Para" (campo original); admin + logística + email general al CC.
const normPP = (s: any) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
// Normalización CANÓNICA de nombre de proveedor para AGRUPAR (unificar pedidos): saca sufijos
// societarios finales (S.A./S.R.L./SAS/SA/SRL) + acentos/espacios/puntuación → "Multisolar" y
// "MULTISOLAR S. A." caen en la misma clave. (Fix 07/07: el unificar agrupaba por string exacto.)
const normProvCanon = (s: any) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/\s*(s\.?\s*a\.?\s*s\.?|s\.?\s*r\.?\s*l\.?|s\.?\s*a\.?|sas|srl|sa)\s*$/, "")
  .replace(/[^a-z0-9]/g, "");
const esEmail = (s: any) => typeof s === "string" && /\S+@\S+\.\S+/.test(s.trim());
async function resolverContactos(sql: any, proveedorNombre: string, fallbackTo?: string) {
  let prov: any = null;
  try {
    const rows = (await sql`SELECT razon_social, nombre_fantasia, alias, email,
      cont_comercial_email, cont_admin_email, cont_logistica_email FROM fg_proveedores WHERE activo IS NOT false` as any[]);
    const pe = normPP(proveedorNombre);
    if (pe) prov = rows.find((p) => {
      const toks = [p.razon_social, p.nombre_fantasia, ...String(p.alias || "").split(/[,;|]/)].map(normPP).filter((t: string) => t.length >= 4);
      return toks.some((t: string) => t.includes(pe) || pe.includes(t));
    }) || null;
  } catch { /* tabla puede no existir aún */ }
  const comercial = prov && esEmail(prov.cont_comercial_email) ? prov.cont_comercial_email.trim() : "";
  const to = comercial || (esEmail(fallbackTo) ? String(fallbackTo).trim() : "") || (prov && esEmail(prov.email) ? prov.email.trim() : "");
  const ccCand = [prov?.cont_admin_email, prov?.cont_logistica_email, prov?.email]
    .filter(esEmail).map((e: string) => e.trim());
  const cc = Array.from(new Set(ccCand)).filter((e) => e.toLowerCase() !== String(to).toLowerCase());
  return { to, cc };
}

// POST → crea el pedido a proveedor en estado PENDIENTE (NO envía, no genera Excel).
// El envío al proveedor (Excel/GSA/email) se dispara después con PATCH accion:'enviar'.
export async function POST(req: NextRequest) {
  try {
    const sql = getDb(); await ensure(sql);
    const b = await req.json();
    const items = (b.items || []).filter((it: any) => it.codigo && Number(it.cantidad) > 0);
    if (!b.proveedor || !items.length) return NextResponse.json({ ok: false, error: "proveedor e ítems requeridos" }, { status: 400 });
    const total = items.reduce((a: number, it: any) => a + (Number(it.costo_usd) || 0) * (Number(it.cantidad) || 1), 0);
    const ccStr = (Array.isArray(b.cc) ? b.cc : []).map((x: any) => String(x || "").trim()).filter((x: string) => /\S+@\S+\.\S+/.test(x)).join(", ") || null;
    const r = await sql`INSERT INTO pedidos_proveedores (proveedor, fv_numero, items, total_costo_usd, email_destinatario, mensaje, cc_emails, estado, origen, creado_por)
      VALUES (${b.proveedor}, ${b.fv_numero || null}, ${JSON.stringify(items)}::jsonb, ${+total.toFixed(2)}, ${b.email_destinatario || null}, ${b.mensaje || null}, ${ccStr}, 'pendiente', ${b.origen || "compra"}, ${b.creado_por || null}) RETURNING id`;
    return NextResponse.json({ ok: true, id: r[0].id, estado: "pendiente" });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}

export async function GET(req: NextRequest) {
  try {
    const sql = getDb(); await ensure(sql);
    const sp = req.nextUrl.searchParams;
    const id = Number(sp.get("id"));
    if (id) {
      const r = await sql`SELECT * FROM pedidos_proveedores WHERE id=${id} LIMIT 1` as any[];
      if (!r.length) return NextResponse.json({ ok: false, error: "no encontrado" }, { status: 404 });
      const pedido = await migrarProformas(sql, r[0]);
      // Contactos resueltos del CRM (Para comercial + CC admin/logística) para mostrarlos antes de enviar.
      const contactos = await resolverContactos(sql, pedido.proveedor, pedido.email_destinatario).catch(() => ({ to: "", cc: [] }));
      return NextResponse.json({ ok: true, pedido, contactos });
    }
    const prov = (sp.get("proveedor") || "").trim();
    const estado = (sp.get("estado") || "").trim();
    const q = (sp.get("q") || "").trim().toLowerCase();
    const like = `%${q}%`;
    const rows = await sql`
      SELECT id, proveedor, fv_numero, items, total_costo_usd, email_destinatario, gsa_numero, estado,
             COALESCE(origen,'fv') AS origen, numero_remito, total_recibido_usd, pagado_fecha, created_at
      FROM pedidos_proveedores
      WHERE (${estado} = '' OR estado = ${estado})
        AND (${q} = '' OR lower(coalesce(proveedor,'')||' '||coalesce(fv_numero,'')||' '||coalesce(gsa_numero::text,'')) LIKE ${like})
      ORDER BY id DESC LIMIT 400`;
    // Filtro de proveedor por nombre NORMALIZADO (agrupa variantes: "Multisolar" == "MULTISOLAR S. A.").
    const rowsF = prov ? (rows as any[]).filter((r) => normProvCanon(r.proveedor) === normProvCanon(prov)) : (rows as any[]);
    // ── ¿El proveedor respondió el pedido? (cruce con la bandeja de entrada de correo) ──
    try {
      const inbox = (await sql`SELECT lower(from_addr) AS from_addr, subject, date, seen FROM mail_messages WHERE folder='INBOX' AND date > now() - interval '180 days'` as any[]);
      for (const r of rows as any[]) {
        const re = r.gsa_numero ? new RegExp("gsa\\s*0*" + r.gsa_numero + "(\\D|$)", "i") : null;
        const em = String(r.email_destinatario || "").toLowerCase();
        const matches = inbox.filter((m) => (re && re.test(m.subject || "")) || (em && m.from_addr === em && r.created_at && new Date(m.date) >= new Date(r.created_at)));
        r.respondio = matches.length > 0;
        r.resp_no_leido = matches.some((m) => m.seen === false);  // hay respuesta SIN LEER
      }
    } catch { /* sin correo, no marca */ }
    // ── Referencia de cliente: si el pedido viene de un pedido/presupuesto de cliente, resolvemos
    //    su nombre. Si es compra directa (sin ref de cliente) → "para stock". ──
    try {
      const norm = (s: string) => String(s || "").replace(/^FV-/i, "");
      const refs = Array.from(new Set((rows as any[]).map((r) => r.fv_numero).filter(Boolean) as string[]));
      const esPed = (f: string) => /^(FV-)?PED-/i.test(f);
      const esPrev = (f: string) => /^PREV-/i.test(f);
      const pedRefs = refs.filter(esPed).map(norm);
      const pedMap: Record<string, { pn: string | null; rev: string | null }> = {};
      if (pedRefs.length) {
        const pr = (await sql`SELECT numero, payload->>'presupuesto_numero' AS pn, COALESCE(NULLIF(payload->'revendedor'->>'empresa',''), payload->'revendedor'->>'nombre') AS rev FROM fv_pedidos WHERE numero = ANY(${pedRefs})` as any[]);
        pr.forEach((x) => { pedMap[x.numero] = { pn: x.pn || null, rev: x.rev || null }; });
      }
      const prevRefs = Array.from(new Set([...refs.filter(esPrev), ...(Object.values(pedMap).map((v) => v.pn).filter(Boolean) as string[])]));
      const prevMap: Record<string, string> = {};
      if (prevRefs.length) {
        const pv = (await sql`SELECT numero, COALESCE(NULLIF(cliente_razon_social,''), NULLIF(TRIM(COALESCE(cliente_nombre,'')||' '||COALESCE(cliente_apellido,'')),'')) AS cli FROM presupuestos WHERE numero = ANY(${prevRefs})` as any[]);
        pv.forEach((x) => { if (x.cli) prevMap[x.numero] = String(x.cli).trim(); });
      }
      for (const r of rows as any[]) {
        const f = r.fv_numero as string | null;
        let cli = "";
        if (f && esPrev(f)) cli = prevMap[f] || "";
        else if (f && esPed(f)) { const m = pedMap[norm(f)]; cli = (m?.pn && prevMap[m.pn]) || m?.rev || ""; }
        r.cliente_ref = cli || null;
        // Compra directa (para stock): sin ref, o refs internas de compra/stock/test.
        r.para_stock = !f || /^(STOCK|TEST|COMPRA)/i.test(f);
      }
    } catch { /* si falla la resolución, la lista igual se muestra */ }
    return NextResponse.json({ ok: true, pedidos: rowsF });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}

const ESTADOS = ["pendiente", "confirmado", "pagado", "recibido_ok", "recibido_diferencias", "enviado", "stock_propio", "anulado"];

export async function PATCH(req: NextRequest) {
  try {
    const sql = getDb(); await ensure(sql);
    const b = await req.json();
    const { id, accion } = b;
    if (!id) return NextResponse.json({ ok: false, error: "id requerido" }, { status: 400 });

    if (accion === "estado") {
      if (!ESTADOS.includes(b.estado)) return NextResponse.json({ ok: false, error: "estado inválido" }, { status: 400 });
      await sql`UPDATE pedidos_proveedores SET estado=${b.estado} WHERE id=${id}`;
      return NextResponse.json({ ok: true });
    }
    // Enviar al proveedor: genera Excel/GSA + email (lo hace el selector) sobre la fila pendiente.
    // Reusa el envío existente del selector y elimina la fila placeholder para no duplicar.
    if (accion === "enviar") {
      const row = (await sql`SELECT * FROM pedidos_proveedores WHERE id=${id} LIMIT 1` as any[])[0];
      if (!row) return NextResponse.json({ ok: false, error: "pedido no encontrado" }, { status: 404 });
      if (row.estado !== "pendiente") return NextResponse.json({ ok: false, error: "el pedido ya fue " + row.estado }, { status: 409 });
      // Modo prueba: avanzar a "enviado" SIN mandar email (no genera Excel/GSA).
      if (b.no_email) {
        await sql`UPDATE pedidos_proveedores SET estado='enviado' WHERE id=${id}`;
        return NextResponse.json({ ok: true, sin_email: true });
      }
      // Comercial → Para. CC: SOLO lo que el usuario eligió (b.cc); nunca por defecto.
      const { to: contactoTo } = await resolverContactos(sql, row.proveedor, row.email_destinatario);
      const destinatario = contactoTo || row.email_destinatario;
      if (!destinatario) return NextResponse.json({ ok: false, error: "falta el email del proveedor (cargá el contacto comercial en el CRM)" }, { status: 400 });
      const contactoCc = (Array.isArray(b.cc) ? b.cc : []).map((x: any) => String(x || "").trim()).filter((x: string) => /\S+@\S+\.\S+/.test(x));
      const internal = process.env.INTERNAL_SERVICE_SECRET; const fvTok = process.env.FV_ADMIN_TOKEN;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (internal) headers["Authorization"] = "Bearer " + internal; else if (fvTok) headers["X-Admin-Token"] = fvTok;
      let envio: any;
      try {
        const er = await fetch("https://febecos.com/api/admin?action=pedido-proveedor", {
          method: "POST", headers,
          body: JSON.stringify({ fv_numero: row.fv_numero || null, proveedor: row.proveedor, email_destinatario: destinatario, cc: contactoCc, mensaje: (b.mensaje != null ? b.mensaje : (row.mensaje || "")), items: row.items }),
        });
        envio = await er.json().catch(() => ({ ok: false, error: "respuesta no-JSON" }));
      } catch (e: any) { return NextResponse.json({ ok: false, error: "fallo el envío: " + e.message }, { status: 502 }); }
      if (!envio?.ok) return NextResponse.json({ ok: false, error: envio?.error || "el proveedor no recibió el pedido" }, { status: 502 });
      // El selector creó la fila ENVIADA (con GSA/Excel); borramos el placeholder pendiente.
      await sql`DELETE FROM pedidos_proveedores WHERE id=${id}`.catch(() => {});
      return NextResponse.json({ ok: true, envio, nuevo_id: envio.id || null, gsa_numero: envio.gsa_numero || null });
    }
    // Enviar UNIFICADO: junta varios pendientes del MISMO proveedor en un solo pedido/email.
    // Cada ítem queda etiquetado con su presupuesto de origen para no perder trazabilidad.
    if (accion === "enviar_unificado") {
      const ids = (Array.isArray(b.ids) ? b.ids : []).map((x: any) => Number(x)).filter(Boolean);
      if (ids.length < 2) return NextResponse.json({ ok: false, error: "se necesitan al menos 2 pedidos para unificar" }, { status: 400 });
      const rows = (await sql`SELECT * FROM pedidos_proveedores WHERE id = ANY(${ids}) AND estado='pendiente'` as any[]);
      if (rows.length < 2) return NextResponse.json({ ok: false, error: "no hay suficientes pendientes para unificar" }, { status: 409 });
      const proveedor = rows[0].proveedor;
      if (rows.some((r) => r.proveedor !== proveedor)) return NextResponse.json({ ok: false, error: "los pedidos son de proveedores distintos" }, { status: 400 });
      // Combinar ítems, etiquetando cada uno con su presupuesto/origen.
      const itemsComb: any[] = [];
      const refs: string[] = [];
      for (const r of rows) {
        const ref = r.fv_numero || ("#" + r.id);
        if (!refs.includes(ref)) refs.push(ref);
        for (const it of (r.items || [])) {
          itemsComb.push({ ...it, descripcion: `${it.descripcion || it.codigo || ""} [${ref}]` });
        }
      }
      const { to: contactoTo } = await resolverContactos(sql, proveedor, rows.find((r) => r.email_destinatario)?.email_destinatario);
      const destinatario = contactoTo || rows.find((r) => r.email_destinatario)?.email_destinatario;
      if (!destinatario) return NextResponse.json({ ok: false, error: "falta el email del proveedor (cargá el contacto comercial en el CRM)" }, { status: 400 });
      const contactoCc = (Array.isArray(b.cc) ? b.cc : []).map((x: any) => String(x || "").trim()).filter((x: string) => /\S+@\S+\.\S+/.test(x));
      const mensaje = (b.mensaje != null && String(b.mensaje).trim()) ? String(b.mensaje) : rows.map((r) => r.mensaje).filter(Boolean).join("\n");
      const internal = process.env.INTERNAL_SERVICE_SECRET; const fvTok = process.env.FV_ADMIN_TOKEN;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (internal) headers["Authorization"] = "Bearer " + internal; else if (fvTok) headers["X-Admin-Token"] = fvTok;
      let envio: any;
      try {
        const er = await fetch("https://febecos.com/api/admin?action=pedido-proveedor", {
          method: "POST", headers,
          body: JSON.stringify({ fv_numero: refs.join(", "), proveedor, email_destinatario: destinatario, cc: contactoCc, mensaje, items: itemsComb }),
        });
        envio = await er.json().catch(() => ({ ok: false, error: "respuesta no-JSON" }));
      } catch (e: any) { return NextResponse.json({ ok: false, error: "fallo el envío: " + e.message }, { status: 502 }); }
      if (!envio?.ok) return NextResponse.json({ ok: false, error: envio?.error || "el proveedor no recibió el pedido" }, { status: 502 });
      // Los pendientes originales se reemplazan por el unificado (que ya quedó ENVIADO con GSA/Excel).
      await sql`DELETE FROM pedidos_proveedores WHERE id = ANY(${ids})`.catch(() => {});
      return NextResponse.json({ ok: true, envio, unificados: rows.length, gsa_numero: envio.gsa_numero || null });
    }
    if (accion === "recibir") {
      const its = Array.isArray(b.items_recibidos) ? b.items_recibidos : [];
      const totalRec = its.reduce((s: number, it: any) => s + (Number(it.costo_usd || 0) * Number(it.cantidad || 0)), 0);
      const estado = b.con_diferencias ? "recibido_diferencias" : "recibido_ok";
      await sql`UPDATE pedidos_proveedores SET estado=${estado}, items_recibidos=${JSON.stringify(its)}::jsonb,
        total_recibido_usd=${+totalRec.toFixed(2)}, numero_remito=${b.numero_remito || null}, notas_recepcion=${b.notas || null} WHERE id=${id}`;
      return NextResponse.json({ ok: true, estado });
    }
    // Capa 1 — EDITAR ÍTEMS del pedido a proveedor en la etapa de confirmación (cuando llega la
    // proforma y el proveedor no tiene exactamente lo pedido): sustituir un ítem por otro SKU / línea
    // manual, cambiar la cantidad, o eliminar el que no va. Recalcula total_costo_usd y re-mapea las
    // confirmaciones a los ítems que quedan. NO toca la venta al cliente (esto es costo/proveedor).
    // Bloqueado una vez que hubo plata/recepción (pagado/recibido) o si está anulado.
    if (accion === "editar_items") {
      const row = (await sql`SELECT estado, items_confirmados FROM pedidos_proveedores WHERE id=${id} LIMIT 1` as any[])[0];
      if (!row) return NextResponse.json({ ok: false, error: "no encontrado" }, { status: 404 });
      // Editable SOLO mientras el pedido no esté confirmado por el proveedor ni despachado/pagado
      // (Guille 14/07): estados editables = pendiente / enviado. Una vez confirmado ya hay asiento en
      // la cta cte del proveedor + proformas → no se toca por acá.
      const editable = ["pendiente", "enviado"].includes(row.estado);
      if (!editable) return NextResponse.json({ ok: false, error: `No se puede editar ítems con el pedido en estado "${row.estado}" — solo es editable antes de confirmarlo el proveedor (pendiente/enviado).` }, { status: 409 });
      const its = Array.isArray(b.items) ? b.items : [];
      const clean = its.map((it: any) => {
        const o: any = {
          codigo: String(it.codigo || "").trim(),
          descripcion: String(it.descripcion || "").trim(),
          cantidad: Math.max(0, Number(it.cantidad) || 0),
          costo_usd: Math.max(0, Number(it.costo_usd) || 0),
        };
        if (it.emisor != null && it.emisor !== "") o.emisor = it.emisor;
        if (it.proveedor != null && it.proveedor !== "") o.proveedor = it.proveedor;
        if (it.manual) o.manual = true;
        return o;
      }).filter((it: any) => it.codigo || it.descripcion); // descarta filas vacías
      if (!clean.length) return NextResponse.json({ ok: false, error: "El pedido debe quedar con al menos un ítem." }, { status: 400 });
      const total = +clean.reduce((s: number, it: any) => s + it.costo_usd * it.cantidad, 0).toFixed(2);
      // Conserva las tildes de confirmación para los códigos que sobreviven; los nuevos entran sin confirmar.
      const prevConf = new Map((row.items_confirmados || []).map((c: any) => [String(c.codigo), !!c.confirmado]));
      const items_confirmados = clean.map((it: any) => ({ codigo: it.codigo, confirmado: prevConf.get(it.codigo) ?? false }));
      await sql`UPDATE pedidos_proveedores SET items=${JSON.stringify(clean)}::jsonb, items_confirmados=${JSON.stringify(items_confirmados)}::jsonb, total_costo_usd=${total} WHERE id=${id}`;
      return NextResponse.json({ ok: true, total, n: clean.length });
    }

    // Confirmación del proveedor: proforma + moneda + monto solicitado + TC + ítems confirmados (tildes).
    // Postea a la cta cte del proveedor lo que LE DEBEMOS (haber, en USD).
    if (accion === "confirmar_proveedor") {
      await ensureCtaCte(sql);
      const moneda = b.moneda === "ARS" ? "ARS" : "USD";
      const tc = Number(b.tc) || 0;
      const monto = Number(b.monto_solicitado) || 0;
      const montoUsd = moneda === "USD" ? monto : (tc > 0 ? monto / tc : 0);
      const row = (await sql`SELECT proveedor, gsa_numero, fv_numero FROM pedidos_proveedores WHERE id=${id} LIMIT 1` as any[])[0];
      if (!row) return NextResponse.json({ ok: false, error: "no encontrado" }, { status: 404 });
      await sql`UPDATE pedidos_proveedores SET estado='confirmado',
        proforma_archivo=${b.proforma ? JSON.stringify(b.proforma) : null}::jsonb,
        moneda_prov=${moneda}, tc_prov=${tc || null}, monto_solicitado=${monto || null}, monto_solicitado_usd=${+montoUsd.toFixed(2) || null},
        items_confirmados=${b.items_confirmados ? JSON.stringify(b.items_confirmados) : null}::jsonb WHERE id=${id}`;
      if (montoUsd > 0) await movCtaCte(sql, { ambito: "proveedor", proveedor: row.proveedor, concepto: `Pedido confirmado ${row.gsa_numero ? "GSA " + row.gsa_numero : "#" + id}`, comprobante: row.fv_numero || null, debe: 0, haber: +montoUsd.toFixed(2), detalle: { pedido_id: id }, uniq: `ppconf:${id}` }).catch(() => {});
      return NextResponse.json({ ok: true });
    }

    // Agregar una PROFORMA (confirmación parcial): N° + PDF + monto + ítems. Varias por pedido.
    // "Cubrir con stock propio": el pedido NO se le compra a nadie (ej. "Sin proveedor") → se cubre
    // con inventario propio. Cierra la operación como válida (proforma INTERNA sobre TODOS los ítems),
    // SIN número/monto, SIN cuenta corriente y SIN descontar stock (el descuento va por la venta/entrega,
    // confirmado con Guille → evita doble descuento). Marca el pedido de cliente como proveedor-confirmado.
    if (accion === "cubrir_stock_propio") {
      const row = (await sql`SELECT fv_numero, items FROM pedidos_proveedores WHERE id=${id} LIMIT 1` as any[])[0];
      if (!row) return NextResponse.json({ ok: false, error: "no encontrado" }, { status: 404 });
      const allItems = (row.items || []).map((it: any) => String(it.codigo));
      const pfInterna = { numero: "INTERNA", interna: true, archivo: null, moneda: "USD", monto: null, monto_usd: null, tc: null, items: allItems, fecha: new Date().toISOString(), nota: "Cubierto con stock propio" };
      const items_confirmados = allItems.map((c: string) => ({ codigo: c, confirmado: true }));
      // Libera cualquier deuda de proforma previa (ej. proforma dummy) y cierra como stock propio.
      await ensureCtaCte(sql); await delMovPrefijo(sql, `ppprof:${id}:`).catch(() => {});
      await sql`UPDATE pedidos_proveedores SET estado='stock_propio', proformas=${JSON.stringify([pfInterna])}::jsonb, items_confirmados=${JSON.stringify(items_confirmados)}::jsonb WHERE id=${id}`;
      await syncProveedorConfirmado(sql, row.fv_numero);
      return NextResponse.json({ ok: true, estado: "stock_propio" });
    }

    if (accion === "agregar_proforma") {
      await ensureCtaCte(sql);
      const row = (await sql`SELECT proveedor, gsa_numero, fv_numero, items, COALESCE(proformas,'[]'::jsonb) AS proformas FROM pedidos_proveedores WHERE id=${id} LIMIT 1` as any[])[0];
      if (!row) return NextResponse.json({ ok: false, error: "no encontrado" }, { status: 404 });
      const moneda = b.moneda === "ARS" ? "ARS" : "USD";
      const tc = Number(b.tc) || 0;
      const monto = Number(b.monto) || 0;
      const montoUsd = moneda === "USD" ? monto : (tc > 0 ? monto / tc : 0);
      const itemsSel = Array.isArray(b.items) ? b.items.map((x: any) => String(x)) : [];
      if (!itemsSel.length) return NextResponse.json({ ok: false, error: "marcá al menos un ítem para esta proforma" }, { status: 400 });
      const proformas = Array.isArray(row.proformas) ? row.proformas : [];
      proformas.push({ numero: String(b.numero || "").trim(), archivo: b.proforma || null, moneda, monto: monto || null, monto_usd: +montoUsd.toFixed(2) || null, tc: tc || null, items: itemsSel, fecha: new Date().toISOString() });
      const confSet = new Set(proformas.flatMap((p: any) => p.items || []));
      const allItems = (row.items || []).map((it: any) => String(it.codigo));
      const items_confirmados = allItems.map((c: string) => ({ codigo: c, confirmado: confSet.has(c) }));
      const todoCubierto = allItems.length > 0 && allItems.every((c: string) => confSet.has(c));
      await sql`UPDATE pedidos_proveedores SET proformas=${JSON.stringify(proformas)}::jsonb, items_confirmados=${JSON.stringify(items_confirmados)}::jsonb, estado=${todoCubierto ? "confirmado" : "enviado"} WHERE id=${id}`;
      if (montoUsd > 0) await movCtaCte(sql, { ambito: "proveedor", proveedor: row.proveedor, concepto: `Proforma ${proformas[proformas.length - 1].numero || ""} ${row.gsa_numero ? "GSA " + row.gsa_numero : "#" + id}`, comprobante: row.fv_numero || null, debe: 0, haber: +montoUsd.toFixed(2), detalle: { pedido_id: id, proforma: proformas[proformas.length - 1].numero }, uniq: `ppprof:${id}:${proformas.length - 1}` }).catch(() => {});
      await syncProveedorConfirmado(sql, row.fv_numero);
      return NextResponse.json({ ok: true, todo_cubierto: todoCubierto, total_proformas: proformas.length });
    }

    // Eliminar/corregir una proforma por índice. Recalcula ítems confirmados, estado y cta cte.
    if (accion === "eliminar_proforma") {
      await ensureCtaCte(sql);
      const idx = Number(b.index);
      const row = (await sql`SELECT proveedor, gsa_numero, fv_numero, items, COALESCE(proformas,'[]'::jsonb) AS proformas FROM pedidos_proveedores WHERE id=${id} LIMIT 1` as any[])[0];
      if (!row) return NextResponse.json({ ok: false, error: "no encontrado" }, { status: 404 });
      const proformas = Array.isArray(row.proformas) ? row.proformas : [];
      if (!Number.isInteger(idx) || idx < 0 || idx >= proformas.length) return NextResponse.json({ ok: false, error: "índice inválido" }, { status: 400 });
      proformas.splice(idx, 1);
      const confSet = new Set(proformas.flatMap((p: any) => p.items || []));
      const allItems = (row.items || []).map((it: any) => String(it.codigo));
      const items_confirmados = allItems.map((c: string) => ({ codigo: c, confirmado: confSet.has(c) }));
      const todoCubierto = allItems.length > 0 && allItems.every((c: string) => confSet.has(c));
      await sql`UPDATE pedidos_proveedores SET proformas=${JSON.stringify(proformas)}::jsonb, items_confirmados=${JSON.stringify(items_confirmados)}::jsonb, estado=${proformas.length && todoCubierto ? "confirmado" : "enviado"} WHERE id=${id}`;
      // Reescribir la cta cte: borrar todos los movimientos de proforma de este pedido y re-postear los que quedan.
      await delMovPrefijo(sql, `ppprof:${id}:`).catch(() => {});
      for (let i = 0; i < proformas.length; i++) {
        const p = proformas[i];
        if ((Number(p.monto_usd) || 0) > 0) await movCtaCte(sql, { ambito: "proveedor", proveedor: row.proveedor, concepto: `Proforma ${p.numero || ""} ${row.gsa_numero ? "GSA " + row.gsa_numero : "#" + id}`, comprobante: row.fv_numero || null, debe: 0, haber: +Number(p.monto_usd).toFixed(2), detalle: { pedido_id: id, proforma: p.numero }, uniq: `ppprof:${id}:${i}` }).catch(() => {});
      }
      return NextResponse.json({ ok: true });
    }
    // Registrar un pago al proveedor (puede haber varios; USD o $ al TC del momento; cheque/transf).
    // Postea DEBE (en USD) a la cta cte → reduce lo que le debemos.
    if (accion === "pago") {
      await ensureCtaCte(sql);
      const row = (await sql`SELECT * FROM pedidos_proveedores WHERE id=${id} LIMIT 1` as any[])[0];
      if (!row) return NextResponse.json({ ok: false, error: "no encontrado" }, { status: 404 });
      const pg = b.pago || {};
      const monto = Number(pg.monto) || 0;
      if (monto <= 0) return NextResponse.json({ ok: false, error: "monto del pago requerido" }, { status: 400 });
      const moneda = pg.moneda === "ARS" ? "ARS" : "USD";
      const tc = Number(pg.tc) || 0;
      const montoUsd = moneda === "USD" ? monto : (tc > 0 ? monto / tc : 0);
      // Comprobante de pago adjunto (cheque/transferencia leído por visión) — queda con el pago.
      const arch = b.pago?.archivo && b.pago.archivo.b64 ? { nombre: String(b.pago.archivo.nombre || "comprobante"), tipo: String(b.pago.archivo.tipo || ""), b64: String(b.pago.archivo.b64) } : null;
      const pago = { monto, moneda, tc: tc || null, medio: pg.medio || "transferencia", fecha: pg.fecha || new Date().toISOString().slice(0, 10), nota: pg.nota || "", monto_usd: +montoUsd.toFixed(2), archivo: arch };
      const pagos = Array.isArray(row.pagos) ? row.pagos : [];
      pagos.push(pago);
      const totalPagUsd = pagos.reduce((a: number, p: any) => a + (Number(p.monto_usd) || 0), 0);
      const owedUsd = Number(row.monto_solicitado_usd) || Number(row.total_costo_usd) || 0;
      const saldado = owedUsd > 0 && totalPagUsd >= owedUsd - 0.01;
      const factura = b.factura ? JSON.stringify(b.factura) : (row.factura_archivo ? JSON.stringify(row.factura_archivo) : null);
      await sql`UPDATE pedidos_proveedores SET pagos=${JSON.stringify(pagos)}::jsonb,
        estado=${saldado ? "pagado" : row.estado}, pagado_fecha=${saldado ? new Date().toISOString() : (row.pagado_fecha || null)},
        factura_archivo=${factura}::jsonb WHERE id=${id}`;
      if (montoUsd > 0) await movCtaCte(sql, { ambito: "proveedor", proveedor: row.proveedor, concepto: `Pago ${pago.medio} ${row.gsa_numero ? "GSA " + row.gsa_numero : "#" + id}`, comprobante: row.fv_numero || null, debe: +montoUsd.toFixed(2), haber: 0, detalle: { pedido_id: id, moneda, tc, monto }, uniq: `pppago:${id}:${pagos.length}` }).catch(() => {});
      return NextResponse.json({ ok: true, total_pagado_usd: +totalPagUsd.toFixed(2), saldado });
    }
    // Anular el pedido a proveedor. Si YA fue enviado al proveedor, le avisamos la anulación
    // (vía selector action=anular-pedido-proveedor) para que no lo tome como pedido válido.
    if (accion === "anular") {
      const row = (await sql`SELECT * FROM pedidos_proveedores WHERE id=${id} LIMIT 1` as any[])[0];
      if (!row) return NextResponse.json({ ok: false, error: "no encontrado" }, { status: 404 });
      let aviso: any = undefined;
      const yaSalio = ["enviado", "confirmado", "pagado", "recibido_ok", "recibido_diferencias"].includes(row.estado);
      const { to: contactoTo } = await resolverContactos(sql, row.proveedor, row.email_destinatario);
      const contactoCc = (Array.isArray(b.cc) ? b.cc : []).map((x: any) => String(x || "").trim()).filter((x: string) => /\S+@\S+\.\S+/.test(x));
      const emailAviso = (b.email && String(b.email).includes("@")) ? b.email : (contactoTo || row.email_destinatario);
      if (yaSalio && emailAviso && !b.no_email) {
        // Aviso de anulación vía fv-febecos (mismo puente FV_BRIDGE). Email con sello ANULADO.
        const secret = process.env.FV_BRIDGE_SECRET || process.env.INTERNAL_SERVICE_SECRET;
        try {
          const r = await fetch("https://fv.febecos.com/api/aviso-anulacion", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (secret || "") },
            body: JSON.stringify({ email: emailAviso, cc: contactoCc, proveedor: row.proveedor, gsa_numero: row.gsa_numero, fv_numero: row.fv_numero, items: row.items }),
          });
          aviso = await r.json().catch(() => ({ ok: false, error: "respuesta no-JSON" }));
        } catch (e: any) { aviso = { ok: false, error: e.message }; }
      }
      // Libera las proformas asociadas y borra su deuda en cuenta corriente (no le compramos a nadie).
      await ensureCtaCte(sql);
      await delMovPrefijo(sql, `ppprof:${id}:`).catch(() => {});
      await sql`UPDATE pedidos_proveedores SET estado='anulado', proformas='[]'::jsonb, items_confirmados='[]'::jsonb WHERE id=${id}`;
      return NextResponse.json({ ok: true, aviso, avisado: yaSalio && !!emailAviso && !b.no_email });
    }
    // Cargar la factura del proveedor (PDF/imagen): la LEE con IA (leer_factura del selector)
    // y registra N° de factura, total y fecha.
    if (accion === "factura") {
      let datos: any = {};
      if (b.archivo?.b64) {
        const internal = process.env.INTERNAL_SERVICE_SECRET; const fvTok = process.env.FV_ADMIN_TOKEN;
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (internal) headers["Authorization"] = "Bearer " + internal; else if (fvTok) headers["X-Admin-Token"] = fvTok;
        try {
          const er = await fetch("https://febecos.com/api/admin?action=leer_factura", {
            method: "POST", headers,
            body: JSON.stringify({ archivo: { nombre: b.archivo.nombre, tipo: b.archivo.tipo, data: b.archivo.b64 } }),
          });
          const d = await er.json().catch(() => ({}));
          if (d?.ok && d.datos) datos = d.datos;
        } catch { /* si falla la lectura, igual guardamos el archivo */ }
      }
      await sql`UPDATE pedidos_proveedores SET
        factura_archivo=${b.archivo ? JSON.stringify(b.archivo) : null}::jsonb,
        numero_factura=${datos.nro_factura || b.numero_factura || null},
        factura_total=${datos.total != null ? Number(datos.total) : null},
        factura_fecha=${datos.fecha || null} WHERE id=${id}`;
      return NextResponse.json({ ok: true, datos });
    }
    return NextResponse.json({ ok: false, error: "acción inválida" }, { status: 400 });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}
