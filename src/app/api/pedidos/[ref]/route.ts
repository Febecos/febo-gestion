import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { movCtaCte, delMov, delMovPrefijo } from "@/lib/ctacte";
import { resolveProveedor } from "@/lib/proveedores";
import { numeroDesdeTalonario, letraFacturaPara, leyendasFactura, condicionIvaReceptor } from "@/lib/talonarios";
import { tipoPorCodigo } from "@/lib/talonarios-tipos";
import { tipoCbteAfip, docTipoReceptor, condicionIvaReceptorId } from "@/lib/afip-codigos";
import { desglosarFactura, normalizarTotales, splitPanelResto } from "@/lib/factura-calc";
import { validarStock, descontarStock, restituirStock } from "@/lib/stock";
import { getUser } from "@/lib/owner";
import { emitEvento } from "@/lib/eventos";
import { marcarCompro } from "@/lib/crm-compro";

// Datos en vivo: no cachear (Next cachea GET sin request → datos viejos).
export const dynamic = "force-dynamic";

// Llama al selector (febecos.com/api/admin) con auth interno. action="x" o "x&p=v".
async function callSelector(action: string, body?: any): Promise<any> {
  const internal = process.env.INTERNAL_SERVICE_SECRET; const fvTok = process.env.FV_ADMIN_TOKEN;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (internal) headers["Authorization"] = "Bearer " + internal; else if (fvTok) headers["X-Admin-Token"] = fvTok;
  const r = await fetch("https://febecos.com/api/admin?action=" + action, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => ({ ok: false, error: "respuesta no-JSON del admin" }));
}

// Resuelve los datos del transporte (CUIT/domicilio/teléfono) desde el MAESTRO de transportistas
// (logistics.carriers en el selector), por nombre. Devuelve null si no lo encuentra.
async function resolverTransporte(empresa: string): Promise<{ cuit: string; domicilio: string; telefono: string } | null> {
  const nom = String(empresa || "").trim();
  if (!nom) return null;
  try {
    const internal = process.env.INTERNAL_SERVICE_SECRET; const fvTok = process.env.FV_ADMIN_TOKEN;
    const headers: Record<string, string> = {};
    if (internal) headers["Authorization"] = "Bearer " + internal; else if (fvTok) headers["X-Admin-Token"] = fvTok;
    const r = await fetch("https://febecos.com/api/transportistas?soloActivos=true", { headers, signal: AbortSignal.timeout(8000) });
    const d = await r.json().catch(() => null);
    const rows: any[] = Array.isArray(d?.rows) ? d.rows : [];
    const norm = (s: string) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
    const t = rows.find((x) => norm(x.nombre) === norm(nom)) || rows.find((x) => norm(nom).includes(norm(x.nombre)) || norm(x.nombre).includes(norm(nom)));
    if (!t) return null;
    const cont: any[] = Array.isArray(t.contactos) ? t.contactos : [];
    const tel = cont.find((c) => /phone|tel|mobile|cel|whats/i.test(c.type || ""))?.value || "";
    const dir = cont.find((c) => /address|domicil|direcc/i.test(c.type || ""))?.value || "";
    return { cuit: String(t.tax_id || ""), domicilio: String(dir || ""), telefono: String(tel || "") };
  } catch { return null; }
}

// Total a mostrarle al cliente en los emails (datos para abonar / pago recibido).
// En pedidos FV los montos de `totales` están en USD base con `moneda` = la moneda de
// la cotización (ej "ARS") + `tc`. Hay que convertir (neto+iva)*tc para que el email
// muestre el MISMO total que vio el cliente en el presupuesto (ej $67.199), no el USD.
// En pedidos de bomba `totales.total` ya viene en la moneda destino (sin `tc`) → tal cual.
function totalParaCliente(tot: any): { total: number | null; moneda: string } {
  const moneda = tot?.moneda || "USD";
  const tc = Number(tot?.tc) || 0;
  const neto = Number(tot?.neto) || 0, iva = Number(tot?.iva) || 0;
  const baseTotal = Number(tot?.total) || +(neto + iva).toFixed(2);
  if (moneda !== "USD" && tc > 0 && (neto > 0 || iva > 0)) {
    return { total: Math.round((neto + iva) * tc), moneda };
  }
  return { total: tot?.total != null ? baseTotal : null, moneda };
}

// Nombre de pila para saludar en los emails al cliente. ARCA devuelve "Apellido, Nombres"
// (ej. "Calabres, Yanina Bobbio") → el saludo NO debe decir "Calabres,". Si hay coma,
// tomamos lo que va DESPUÉS (los nombres) y nos quedamos con el primero.
function nombreSaludo(rev: any): string {
  const raw = String(rev?.nombre || rev?.empresa || "").trim();
  if (!raw) return "";
  const base = raw.includes(",") ? raw.split(",").slice(1).join(",").trim() : raw;
  const primero = (base.split(/\s+/)[0] || "").trim();
  if (!primero) return "";
  return primero.charAt(0).toUpperCase() + primero.slice(1).toLowerCase();
}

// Kit de bomba: NETO de paneles (10,5%) calculado igual que el portal de bombas, leyendo del
// PRESUPUESTO (descuento) + catálogo (precio del panel × cant). factor = 1 − descuento%/100.
// Devuelve el neto de paneles, o null si no es un kit con panel en catálogo.
// Neto (sin IVA) de los PANELES del kit, para el split de IVA 10,5% (panel) / 21% (resto).
// Multi-equipo (Portal): SUMA los paneles de TODAS las bombas del presupuesto, tomando los
// códigos de los ítems `es_bomba` (cada equipo su bomba). Si no hay ítems es_bomba (presupuestos
// viejos de 1 bomba) cae al `presupuestos.bomba_codigo` único → resultado IDÉNTICO al anterior.
async function netoPanelKit(sql: any, presupNum: string | null, totalConIva: number, items?: any[]): Promise<number | null> {
  if (!presupNum || !(totalConIva > 0)) return null;
  try {
    const pr = (await sql`SELECT descuento_pct, bomba_codigo, tipo FROM presupuestos WHERE numero=${presupNum} LIMIT 1` as any[])[0];
    if (!pr || pr.tipo !== "bomba") return null;
    // Códigos de bomba: de los ítems es_bomba (multi-equipo) o el bomba_codigo único (legacy).
    const deItems = Array.isArray(items)
      ? items.filter((it) => it && it.es_bomba).map((it) => String(it.bomba_codigo || it.codigo || "").trim()).filter(Boolean)
      : [];
    const codigos = deItems.length ? deItems : (pr.bomba_codigo ? [String(pr.bomba_codigo)] : []);
    if (!codigos.length) return null;
    let panelPublico = 0;
    for (const cod of codigos) {
      const pump = (await sql`SELECT id, cant_paneles FROM pumps WHERE regexp_replace(lower(codigo),'[[:space:]]','','g')=regexp_replace(lower(${cod}),'[[:space:]]','','g') LIMIT 1` as any[])[0];
      if (!pump) continue;
      const panRow = (await sql`SELECT cc.precio_ars, pc.cantidad FROM pump_components pc JOIN components cc ON cc.id=pc.component_id WHERE pc.pump_id=${pump.id} AND lower(cc.familia)='panel' LIMIT 1` as any[])[0];
      const cantPan = Number(pump.cant_paneles) || Number(panRow?.cantidad) || 0;
      panelPublico += (Number(panRow?.precio_ars) || 0) * cantPan;
    }
    const factor = 1 - (Number(pr.descuento_pct) || 0) / 100;
    const panelEnPrecio = panelPublico * factor;
    if (!(panelEnPrecio > 0 && panelEnPrecio < totalConIva)) return null;
    return +(panelEnPrecio / 1.105).toFixed(2);
  } catch { return null; }
}

// Comisión del revendedor (USD). RI → base TOTAL (c/IVA); otra condición → base NETO.
async function calcComision(sql: any, revendedor_id: number | null, receptorFinalId: number, totalUsd: number, netoUsd: number): Promise<{ pct: number; monto: number }> {
  if (!revendedor_id) return { pct: 0, monto: 0 };
  await sql`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS comision_propia_pct NUMERIC`.catch(() => {});
  await sql`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS comision_revende_pct NUMERIC`.catch(() => {});
  const rc = await sql`SELECT comision_propia_pct, comision_revende_pct, revendedor_token, condicion_fiscal FROM clientes WHERE id=${revendedor_id} LIMIT 1` as any[];
  let pct = 0;
  if (receptorFinalId) { pct = Number(rc[0]?.comision_revende_pct) || 0; }
  else {
    pct = Number(rc[0]?.comision_propia_pct) || 0;
    const tk = rc[0]?.revendedor_token;
    if (tk) { const adm = await sql`SELECT descuento_pct FROM solicitudes_revendedor WHERE token_acceso=${tk} LIMIT 1` as any[]; if (adm.length && adm[0].descuento_pct != null) pct = Number(adm[0].descuento_pct) || 0; }
  }
  const condRev = String(rc[0]?.condicion_fiscal || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const esRI = condRev.includes('responsable') && condRev.includes('inscripto');
  const base = esRI ? totalUsd : netoUsd;
  return { pct, monto: +(base * pct / 100).toFixed(2) };
}

async function clienteIdDe(sql: any, payload: any): Promise<number | null> {
  const pn = payload?.presupuesto_numero;
  if (!pn) return null;
  const pr = await sql`SELECT cliente_id FROM presupuestos WHERE numero=${pn} LIMIT 1` as any[];
  return pr[0]?.cliente_id ?? null;
}

// Comprobantes del transporte (sin remito propio): lista normalizada. Migra el single legacy
// (`remito_externo_archivo`) al array `remito_externo_archivos` para soportar VARIOS.
function normalizarRemitosExt(row: any): any[] {
  const arr = Array.isArray(row?.remito_externo_archivos) ? row.remito_externo_archivos : [];
  if (arr.length) return arr;
  const lg = row?.remito_externo_archivo;
  if (lg?.b64) return [{ id: "legacy", nombre: lg.nombre, tipo: lg.tipo, b64: lg.b64, at: lg.at, validacion: lg.validacion ?? null, enviada_at: lg.enviada_at ?? null, email: lg.email ?? null }];
  return [];
}
// Meta liviana (sin el b64) que va al payload para que el front liste los comprobantes.
function metasRemitosExt(arr: any[]): any[] {
  return (arr || []).map((x) => ({ id: x.id, nombre: x.nombre, at: x.at, validacion: x.validacion ?? null, enviada_at: x.enviada_at ?? null, email: x.email ?? null }));
}

// C1 (OBJETIVO-99): emite `pedido.estado_cambiado` para que Envíos (email) y FEBO AI (WhatsApp)
// avisen al cliente. Resuelve cliente_id + teléfono + email (de la ficha del cliente o del payload).
// Idempotente por (pedido, estado) → cada transición avisa una sola vez. No manda el mail/WA acá.
async function emitEstadoPedido(sql: any, ref: string, estadoNuevo: string): Promise<void> {
  try {
    const row = (await sql`SELECT payload FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
    const pl = row?.payload || {};
    const cid = await clienteIdDe(sql, pl);
    const c = pl.revendedor || pl.cliente || {};
    let email: string | null = c.email || pl.cliente?.email || null;
    let telefono: string | null = c.whatsapp || c.telefono || null;
    if (cid) {
      const cl = (await sql`SELECT email, whatsapp FROM clientes WHERE id=${cid} LIMIT 1` as any[])[0];
      if (cl) { email = email || cl.email || null; telefono = telefono || cl.whatsapp || null; }
    }
    await emitEvento(sql, { tipo: "pedido.estado_cambiado", entidad: "pedido", entidadId: ref,
      payload: { pedido_ref: ref, estado_nuevo: estadoNuevo, cliente_id: cid, telefono, email },
      idempotencyKey: `gestion:pedido.estado_cambiado:${ref}:${estadoNuevo}`, clienteId: cid });
  } catch { /* fire-and-forget */ }
}
const hoy = () => new Date().toISOString().slice(0, 10);

// Enriquece los ítems con el `emisor` (Multiradio/Multisolar/Multipoint) y el `costo_usd`
// buscándolos en fg_productos por código. El costo se usa para mostrar la columna Costo en
// pedidos sin precio por ítem (ej. kit de bombas con precio global). Aditivo: solo rellena lo
// que falta, nunca pisa lo que el ítem ya trae.
async function enrichEmisor(sql: any, items: any[]): Promise<any[]> {
  if (!Array.isArray(items) || !items.length) return items || [];
  const faltanEmi = items.filter((it) => !it.emisor && it.codigo).map((it) => String(it.codigo));
  const faltanCosto = items.filter((it) => it.costo_usd == null && it.codigo).map((it) => String(it.codigo));
  // Ruteo a proveedor: ítem sin emisor NI proveedor → resolver el proveedor real del catálogo (bug
  // PED-0045: el pedido guardaba proveedor:"" → todo caía en "Sin proveedor").
  const faltanProv = items.filter((it) => !it.emisor && !it.proveedor && it.codigo).map((it) => String(it.codigo));
  if (!faltanEmi.length && !faltanCosto.length && !faltanProv.length) return items;
  const emi: Record<string, string> = {};
  const costo: Record<string, number> = {};
  const prov: Record<string, string> = {};
  if (faltanEmi.length) {
    try { const rows = await sql`SELECT codigo, emisor FROM fg_productos WHERE emisor IS NOT NULL AND codigo = ANY(${faltanEmi})` as any[];
      for (const r of rows) if (emi[String(r.codigo)] == null) emi[String(r.codigo)] = r.emisor; } catch {}
  }
  if (faltanCosto.length) {
    // Excluir los espejos del catálogo (origen pumps/kit_bomba): queremos el costo del depósito real.
    try { const rows = await sql`SELECT codigo, costo_usd FROM fg_productos WHERE costo_usd IS NOT NULL AND codigo = ANY(${faltanCosto}) AND COALESCE(origen,'') NOT IN ('pumps','kit_bomba')` as any[];
      for (const r of rows) if (costo[String(r.codigo)] == null) costo[String(r.codigo)] = Number(r.costo_usd); } catch {}
  }
  if (faltanProv.length) {
    // Proveedor real de la fila NO-espejo (K4SP11→LV Energy, accesorios→Lista Manual). Mismo criterio
    // anti-espejo que el costo. Se toma la primera fila con proveedor cargado por código.
    try { const rows = await sql`SELECT codigo, proveedor FROM fg_productos WHERE COALESCE(proveedor,'') <> '' AND codigo = ANY(${faltanProv}) AND COALESCE(origen,'') NOT IN ('pumps','kit_bomba')` as any[];
      for (const r of rows) if (prov[String(r.codigo)] == null) prov[String(r.codigo)] = r.proveedor; } catch {}
  }
  return items.map((it) => {
    const k = String(it.codigo);
    let out = it;
    if (!it.emisor && emi[k] != null) out = { ...out, emisor: emi[k] };
    if (it.costo_usd == null && costo[k] != null) out = { ...out, costo_usd: costo[k] };
    if (!it.emisor && !it.proveedor && prov[k] != null) out = { ...out, proveedor: prov[k] };
    return out;
  });
}

async function ensureCols(sql: any) {
  await sql`ALTER TABLE fv_pedidos ADD COLUMN IF NOT EXISTS proveedor_confirmado boolean DEFAULT false`.catch(() => {});
  await sql`ALTER TABLE fv_pedidos ADD COLUMN IF NOT EXISTS proveedor_confirmado_at timestamptz`.catch(() => {});
  await sql`ALTER TABLE fv_pedidos ADD COLUMN IF NOT EXISTS proforma_archivo jsonb`.catch(() => {});
  await sql`ALTER TABLE fv_pedidos ADD COLUMN IF NOT EXISTS factura_numero text`.catch(() => {});
  await sql`ALTER TABLE fv_pedidos ADD COLUMN IF NOT EXISTS factura_token text`.catch(() => {});
  await sql`ALTER TABLE fv_pedidos ADD COLUMN IF NOT EXISTS factura_estado text`.catch(() => {});
  await sql`ALTER TABLE fv_pedidos ADD COLUMN IF NOT EXISTS factura_borrador_id int`.catch(() => {});
  await sql`ALTER TABLE fv_pedidos ADD COLUMN IF NOT EXISTS pago_proveedor jsonb`.catch(() => {});
  await sql`ALTER TABLE fv_pedidos ADD COLUMN IF NOT EXISTS stock_validado boolean DEFAULT false`.catch(() => {});
  await sql`ALTER TABLE fv_pedidos ADD COLUMN IF NOT EXISTS stock_validado_at timestamptz`.catch(() => {});
  await sql`ALTER TABLE fv_pedidos ADD COLUMN IF NOT EXISTS stock_override_by text`.catch(() => {});
}

// GET /api/pedidos/[ref]  → detalle completo de un pedido (FV: fv_pedidos por numero; bomba: pedidos por id)
export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  try {
    const sql = getDb();
    const ref = decodeURIComponent(params.ref);
    let dolar = 0;
    try { const c = await sql`SELECT data FROM fv_config WHERE id=1`; dolar = Number((c[0] as any)?.data?.dolar) || 0; } catch {}

    await ensureCols(sql);
    const fv = await sql`SELECT numero, estado, public_token, payload, recibido, comprobante_recibido, comprobante_archivo, verificacion_pago, pagos_recibidos, envio_data, metodo_pago, proveedor_confirmado, proveedor_confirmado_at, proforma_archivo, factura_numero, factura_token, factura_estado, factura_borrador_id, pago_proveedor, stock_validado, stock_validado_at, stock_override_by FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[];
    if (fv.length) {
      const p = fv[0];
      // nombre canónico del cliente desde el presupuesto/CRM
      let cliente_id: number | null = null;
      const presupNum = p.payload?.presupuesto_numero;
      if (presupNum) {
        const pr = await sql`SELECT cliente_id FROM presupuestos WHERE numero=${presupNum} LIMIT 1` as any[];
        cliente_id = pr[0]?.cliente_id ?? null;
      }
      // Pedidos ONLINE (catálogo, sin presupuesto): el cliente CRM ya se resolvió al confirmar
      // (pedidos-online/route.ts) y quedó en payload.cliente_id — usarlo como fallback directo.
      if (!cliente_id && p.payload?.cliente_id) cliente_id = Number(p.payload.cliente_id) || null;
      // Datos fiscales completos del cliente (para facturar según AFIP)
      let cliente: any = null;
      if (cliente_id) {
        const cl = await sql`SELECT id, tipo, nombre, razon_social, empresa, email, whatsapp, cuit, domicilio, localidad, provincia, cod_postal, condicion_fiscal, envio FROM clientes WHERE id=${cliente_id} LIMIT 1` as any[];
        cliente = cl[0] || null;
      }
      const provSent = await sql`SELECT proveedor, items, total_costo_usd, email_destinatario, gsa_numero, estado, created_at FROM pedidos_proveedores WHERE fv_numero=${ref} ORDER BY created_at`.catch(() => []) as any[];
      // TC/moneda/total REALES de la factura (borrador o emitida): los $ del pedido se muestran
      // al TC PACTADO de la factura, no al dólar del día (evita diferir de lo facturado).
      let factura: any = null; let factura_proforma = false;
      if (p.factura_borrador_id || p.factura_numero) {
        const fc = await sql`SELECT numero, moneda, tc, total, afip_cae, estado FROM fg_comprobantes WHERE id=${p.factura_borrador_id || -1} OR numero=${p.factura_numero || ''} LIMIT 1`.catch(() => []) as any[];
        if (fc[0]) { factura = { numero: fc[0].numero, moneda: fc[0].moneda, tc: fc[0].tc != null ? Number(fc[0].tc) : null, total: fc[0].total != null ? Number(fc[0].total) : null, afip_cae: fc[0].afip_cae || null }; factura_proforma = !!p.factura_numero && !fc[0].afip_cae && fc[0].estado === "proforma"; }
      }
      // Notas de Crédito de la factura (si las hay) + si cancelan TODO el comprobante (pedido anulado).
      let notas_credito: any[] = []; let anulado_por_nc = false;
      if (p.factura_numero) {
        const facRow = (await sql`SELECT id, total FROM fg_comprobantes WHERE numero=${p.factura_numero} AND tipo='factura' LIMIT 1`.catch(() => []) as any[])[0];
        if (facRow) {
          const ncs = await sql`SELECT numero, token, total FROM fg_comprobantes WHERE tipo='nota_credito' AND operacion_id=${facRow.id} ORDER BY id`.catch(() => []) as any[];
          notas_credito = ncs.map((n: any) => ({ numero: n.numero, token: n.token, total: n.total != null ? Number(n.total) : null }));
          const sumNc = ncs.reduce((a: number, n: any) => a + (Number(n.total) || 0), 0);
          const totFac = Number(facRow.total) || 0;
          anulado_por_nc = ncs.length > 0 && totFac > 0 && sumNc >= totFac - 0.5; // NC cubre toda la factura
        }
      }
      // ¿Es el ÚLTIMO número emitido? (para habilitar "Revertir" solo en ese caso).
      let es_ultimo = false;
      try { const n = parseInt(String(ref).match(/(\d+)\s*$/)?.[1] || "0", 10); const cnt = await sql`SELECT ultimo_numero FROM pedidos_counter WHERE clave='PED' LIMIT 1` as any[]; es_ultimo = !!cnt[0] && n > 0 && Number(cnt[0].ultimo_numero) === n; } catch {}
      const payloadEnriq = p.payload || {};
      payloadEnriq.items = await enrichEmisor(sql, payloadEnriq.items || []);
      // Desglose de IVA para mostrar en el detalle del pedido (cuando el presupuesto guardó solo el
      // total, ej. bombas): paneles 10,5% + resto 21%, o todo 21% si no hay split.
      let desglose_iva: any = null;
      const totG = payloadEnriq.totales || {};
      if (Number(totG.total) > 0 && !(Number(totG.neto) > 0)) {
        const pn = await netoPanelKit(sql, payloadEnriq.presupuesto_numero || null, Number(totG.total), payloadEnriq.items);
        if (pn && pn > 0) {
          const sp = splitPanelResto(Number(totG.total), pn);
          desglose_iva = { neto: sp.neto, iva: +sp.iva_detalle.reduce((a, d) => a + d.monto, 0).toFixed(2), iva_detalle: sp.iva_detalle, total: Number(totG.total) };
        } else {
          const norm = normalizarTotales(totG);
          if (Number(norm.tot.neto) > 0) desglose_iva = { neto: norm.tot.neto, iva: +(norm.tot.iva_detalle || []).reduce((a: number, d: any) => a + (Number(d.monto) || 0), 0).toFixed(2), iva_detalle: norm.tot.iva_detalle, total: Number(totG.total) };
        }
      }
      return NextResponse.json({ ok: true, pedido: {
        origen: "fv", numero: p.numero, estado: p.estado || "pendiente_confirmacion",
        public_token: p.public_token, payload: payloadEnriq, dolar, fecha: p.recibido, cliente_id, cliente,
        cliente_envio: cliente?.envio || null,
        pedidos_proveedor: provSent,
        comprobante_recibido: p.comprobante_recibido, comprobante_archivo: p.comprobante_archivo,
        verificacion_pago: p.verificacion_pago, pagos_recibidos: p.pagos_recibidos || [], envio_data: p.envio_data, metodo_pago: p.metodo_pago,
        proveedor_confirmado: !!p.proveedor_confirmado, proveedor_confirmado_at: p.proveedor_confirmado_at, proforma_archivo: p.proforma_archivo,
        factura_numero: p.factura_numero, factura_token: p.factura_token, factura_estado: p.factura_estado || null, factura_borrador_id: p.factura_borrador_id || null, factura, factura_proforma, pago_proveedor: p.pago_proveedor || null,
        stock_validado: !!p.stock_validado, stock_validado_at: p.stock_validado_at, stock_override_by: p.stock_override_by || null,
        recibo_numero: payloadEnriq.recibo_numero || null, recibo_token: payloadEnriq.recibo_token || null, recibo_saldo: payloadEnriq.recibo_saldo ?? null,
        despacho_confirmado: !!payloadEnriq.despacho_confirmado, remito_preparado: !!payloadEnriq.remito_numero,
        remito_externo: payloadEnriq.remito_externo || null,
        remitos_externos: Array.isArray(payloadEnriq.remitos_externos) ? payloadEnriq.remitos_externos
          : (payloadEnriq.remito_externo ? [{ id: "legacy", ...payloadEnriq.remito_externo }] : []),
        desglose_iva,
        notas_credito, anulado_por_nc,
        es_ultimo,
      }});
    }

    // Bomba: tabla pedidos (PK uuid)
    const b = await sql`SELECT id, numero, estado, revendedor_nombre, bomba_codigo, bomba_descripcion, precio_final, tipo_comprador, created_at FROM pedidos WHERE id::text=${ref} OR numero=${ref} LIMIT 1` as any[];
    if (b.length) {
      const p = b[0];
      return NextResponse.json({ ok: true, pedido: {
        origen: "bomba", numero: p.numero || p.id, estado: p.estado || "—", dolar, fecha: p.created_at,
        payload: { revendedor: { nombre: p.revendedor_nombre }, items: [{ codigo: p.bomba_codigo, descripcion: p.bomba_descripcion, cantidad: 1, subtotal: p.precio_final }], totales: { total: p.precio_final, moneda: "ARS" } },
      }});
    }
    return NextResponse.json({ ok: false, error: "pedido no encontrado" }, { status: 404 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

const ESTADOS_FV = ["pendiente_confirmacion", "aprobado", "pagado", "enviado", "cancelado"];

// POST /api/pedidos/[ref]  Body: { accion: 'estado'|'nota'|'envio', estado?, nota?, envio? }
export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  try {
    const sql = getDb();
    const ref = decodeURIComponent(params.ref);
    const b = await req.json();
    await ensureCols(sql);
    const fvRow = await sql`SELECT estado FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[];
    const esFv = fvRow.length > 0;
    // Pedido cancelado → bloquea toda operatoria (hay que generar uno nuevo)
    if (esFv && fvRow[0].estado === "cancelado") {
      return NextResponse.json({ ok: false, error: "El pedido está CANCELADO: no se puede editar. Generá un nuevo pedido." }, { status: 409 });
    }

    // Validación de STOCK propio (depósito). El pedido NO puede facturar sin esto, salvo override de Guillermo (owner).
    if (b.accion === "validar_stock") {
      if (!esFv) return NextResponse.json({ ok: false, error: "solo FV/kit por ahora" }, { status: 400 });
      const row = (await sql`SELECT payload, stock_validado FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
      if (!row) return NextResponse.json({ ok: false, error: "pedido no encontrado" }, { status: 404 });
      if (row.stock_validado) return NextResponse.json({ ok: true, ya: true });
      const items = row.payload?.items || [];
      const { ok, faltantes } = await validarStock(sql, items);
      const u = await getUser(req);
      if (!ok && !(b.override && u?.es_owner)) {
        // El depósito registrado da menos de lo pedido y no hay override válido → NO continúa.
        // (0 en el sistema no siempre es 0 real — puede haber stock físico no cargado.)
        return NextResponse.json({ ok: false, error: "Stock a confirmar manualmente para este pedido.", faltantes, puede_override: !!u?.es_owner }, { status: 409 });
      }
      // OK (o override de owner): descuenta el stock disponible y marca validado.
      await descontarStock(sql, items, ref, u?.email || null);
      await sql`UPDATE fv_pedidos SET stock_validado=true, stock_validado_at=now(), stock_override_by=${!ok ? (u?.email || "owner") : null} WHERE numero=${ref}`;
      return NextResponse.json({ ok: true, override: !ok });
    }

    if (b.accion === "confirmar_proveedor") {
      if (esFv) {
        await sql`UPDATE fv_pedidos SET proveedor_confirmado=true, proveedor_confirmado_at=now(), proforma_archivo=${JSON.stringify(b.archivos || [])}::jsonb WHERE numero=${ref}`;
        // Cta cte proveedor: nace lo que le debemos (costo USD) al confirmar stock, por proveedor.
        const row = (await sql`SELECT payload FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
        const items = await enrichEmisor(sql, row?.payload?.items || []);
        const porProv: Record<string, number> = {};
        for (const it of items) { const k = it.emisor || it.proveedor || "Sin proveedor"; porProv[k] = (porProv[k] || 0) + (Number(it.costo_usd) || 0) * (Number(it.cantidad) || 1); }
        for (const [prov, costo] of Object.entries(porProv)) {
          if (costo <= 0) continue;
          const pr = await resolveProveedor(sql, prov);
          await movCtaCte(sql, { ambito: "proveedor", proveedor: prov, proveedor_id: pr?.id ?? null, fecha: hoy(), concepto: "Pedido confirmado " + ref, pedido_ref: ref, haber: +costo.toFixed(2), uniq: `provconf:${ref}:${prov}` });
        }
        await emitEvento(sql, { tipo: "proveedor.confirmado", entidad: "pedido", entidadId: ref,
          payload: { proveedores: Object.keys(porProv) }, idempotencyKey: `gestion:proveedor.confirmado:${ref}`,
          clienteId: await clienteIdDe(sql, row?.payload) });
      }
      return NextResponse.json({ ok: true });
    }
    if (b.accion === "desconfirmar_proveedor") {
      if (esFv) {
        await sql`UPDATE fv_pedidos SET proveedor_confirmado=false, proveedor_confirmado_at=null WHERE numero=${ref}`;
        await delMovPrefijo(sql, `provconf:${ref}:`);
      }
      return NextResponse.json({ ok: true });
    }

    // Revertir el pedido (se confirmó por error): borra el fv_pedido y devuelve el presupuesto a 'emitido'.
    // Solo si NO está facturado/despachado/pagado.
    if (b.accion === "revertir") {
      if (!esFv) return NextResponse.json({ ok: false, error: "solo FV por ahora" }, { status: 400 });
      const row = (await sql`SELECT payload, factura_numero, estado, pagos_recibidos, proveedor_confirmado FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
      if (!row) return NextResponse.json({ ok: false, error: "pedido no encontrado" }, { status: 404 });
      const plr = row.payload || {};
      if (row.factura_numero) return NextResponse.json({ ok: false, error: "El pedido ya está facturado: no se puede revertir (anulá la factura primero)." }, { status: 409 });
      if (plr.remito_numero) return NextResponse.json({ ok: false, error: "El pedido ya tiene remito/despacho: no se puede revertir." }, { status: 409 });
      if (["pagado", "enviado"].includes(row.estado) || (row.pagos_recibidos || plr.pagos_recibidos || []).length > 0)
        return NextResponse.json({ ok: false, error: "El pedido tiene pago/envío registrado: no se puede revertir." }, { status: 409 });
      if (row.proveedor_confirmado) return NextResponse.json({ ok: false, error: "El pedido ya tiene el stock confirmado con el proveedor: no se puede revertir." }, { status: 409 });
      // Además: solo el ÚLTIMO número emitido (no dejar huecos en el medio).
      {
        const nn = parseInt(String(ref).match(/(\d+)\s*$/)?.[1] || "0", 10);
        const cc = (await sql`SELECT ultimo_numero FROM pedidos_counter WHERE clave='PED' LIMIT 1` as any[])[0];
        if (!cc || nn <= 0 || Number(cc.ultimo_numero) !== nn) return NextResponse.json({ ok: false, error: "Solo se puede revertir el último pedido emitido." }, { status: 409 });
      }
      const presup = plr.presupuesto_numero || null;
      // Devolver el stock propio que se había descontado al confirmar (si se había validado/descontado).
      if (row.stock_validado) await restituirStock(sql, plr.items || [], ref, (await getUser(req))?.email || null).catch(() => {});
      // Si está en el medio → ANULAR (se mantiene el número, sin hueco fantasma).
      const n = parseInt(String(ref).match(/(\d+)\s*$/)?.[1] || "0", 10);
      let modo = "anulado";
      const cnt = (await sql`SELECT ultimo_numero FROM pedidos_counter WHERE clave='PED' LIMIT 1` as any[])[0];
      const esUltimo = cnt && n > 0 && Number(cnt.ultimo_numero) === n;
      if (esUltimo) {
        await sql`DELETE FROM fv_pedidos WHERE numero=${ref}`;
        await sql`UPDATE pedidos_counter SET ultimo_numero = ${n - 1} WHERE clave='PED' AND ultimo_numero = ${n}`;
        modo = "borrado_reusable";
      } else {
        // stock_validado=false SIEMPRE acá (ya se restituyó arriba si estaba en true) — si no se resetea,
        // una transición posterior sobre este pedido "anulado" podría restituir el stock DE NUEVO (doble crédito).
        await sql`UPDATE fv_pedidos SET estado='anulado', cancelado_at=now(), stock_validado=false WHERE numero=${ref}`;
      }
      if (presup) await sql`UPDATE presupuestos SET estado='emitido' WHERE numero=${presup} AND COALESCE(estado,'') IN ('confirmado','pedido','convertido')`;
      // Si vino de un PEDIDO ONLINE (tienda), liberar el link para que VUELVA a la bandeja "Pedidos online".
      const origenOnline = plr.origen_pedido_id || (plr.tipo_origen === "online" ? plr.origen_pedido_id : null);
      if (origenOnline) {
        await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS gestion_pedido_id TEXT`.catch(() => {});
        await sql`UPDATE pedidos SET gestion_pedido_id = NULL, gestion_tomado_at = NULL WHERE id::text = ${String(origenOnline)}`.catch(() => {});
      }
      return NextResponse.json({ ok: true, revertido: ref, modo, presupuesto: presup, online_liberado: !!origenOnline });
    }
    if (b.accion === "estado") {
      if (!ESTADOS_FV.includes(b.estado)) return NextResponse.json({ ok: false, error: "estado inválido" }, { status: 400 });
      // Compuerta: no se puede aprobar sin confirmación de stock del proveedor
      if (b.estado === "aprobado" && esFv) {
        const c = await sql`SELECT proveedor_confirmado FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[];
        if (!c[0]?.proveedor_confirmado) return NextResponse.json({ ok: false, error: "Antes de aprobar tenés que confirmar el stock con el proveedor." }, { status: 409 });
      }
      if (esFv) {
        if (b.estado === "aprobado") await sql`UPDATE fv_pedidos SET estado='aprobado', aprobado_at=now() WHERE numero=${ref}`;
        else if (b.estado === "pagado") await sql`UPDATE fv_pedidos SET estado='pagado', pagado_at=now() WHERE numero=${ref}`;
        else if (b.estado === "enviado") await sql`UPDATE fv_pedidos SET estado='enviado', enviado_at=now() WHERE numero=${ref}`;
        else if (b.estado === "cancelado") {
          // Al cancelar/rechazar, devolver el stock propio descontado al confirmar.
          const cr = (await sql`SELECT payload, stock_validado FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
          if (cr?.stock_validado) { await restituirStock(sql, cr.payload?.items || [], ref, (await getUser(req))?.email || null).catch(() => {}); await sql`UPDATE fv_pedidos SET stock_validado=false WHERE numero=${ref}`.catch(() => {}); }
          await sql`UPDATE fv_pedidos SET estado='cancelado', cancelado_at=now() WHERE numero=${ref}`;
        }
        else await sql`UPDATE fv_pedidos SET estado=${b.estado} WHERE numero=${ref}`;
      } else await sql`UPDATE pedidos SET estado=${b.estado} WHERE id::text=${ref} OR numero=${ref}`;

      await emitEstadoPedido(sql, ref, b.estado);

      // Al APROBAR un pedido FV → avisar al cliente para el pago (email vía selector/Resend).
      let aviso_cliente: any = undefined;
      if (b.estado === "aprobado" && esFv && b.avisar !== false) {
        try {
          const row = (await sql`SELECT payload FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
          const pl = row?.payload || {}; const rev = pl.revendedor || pl.cliente || {};
          const email = String(b.email || rev.email || "").trim(); // permite override del email desde el modal de aprobación
          if (!email) { aviso_cliente = { ok: false, error: "El cliente no tiene email cargado" }; }
          else {
            let link = "";
            if (pl.presupuesto_numero) {
              const pr = await sql`SELECT public_token FROM presupuestos WHERE numero=${pl.presupuesto_numero} LIMIT 1` as any[];
              if (pr[0]?.public_token) link = `https://fv.febecos.com/ver-presupuesto?token=${pr[0].public_token}`;
            }
            const internal = process.env.INTERNAL_SERVICE_SECRET; const fvTok = process.env.FV_ADMIN_TOKEN;
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (internal) headers["Authorization"] = "Bearer " + internal; else if (fvTok) headers["X-Admin-Token"] = fvTok;
            const tpc = totalParaCliente(pl.totales);
            const r = await fetch("https://febecos.com/api/admin?action=notificar-pago-cliente", {
              method: "POST", headers,
              body: JSON.stringify({ email, nombre: nombreSaludo(rev), pedido_numero: ref, total: tpc.total, moneda: tpc.moneda, link }),
            });
            aviso_cliente = await r.json().catch(() => ({ ok: false, error: "respuesta no-JSON" }));
          }
        } catch (e: any) { aviso_cliente = { ok: false, error: e.message }; }
      }
      return NextResponse.json({ ok: true, estado: b.estado, aviso_cliente });
    }
    if (b.accion === "avisar_pago") {
      // Avisa al cliente que su PAGO está OK (email desde administración) y marca el pedido como pagado.
      // b.email es editable (para pruebas: ver el contenido sin mandarlo al cliente real).
      const row = (await sql`SELECT payload FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
      const pl = row?.payload || {}; const rev = pl.revendedor || pl.cliente || {};
      const email = String(b.email || rev.email || "").trim();
      let aviso_cliente: any = { ok: false, error: "El cliente no tiene email" };
      if (email) {
        let link = "";
        if (pl.presupuesto_numero) { const pr = await sql`SELECT public_token FROM presupuestos WHERE numero=${pl.presupuesto_numero} LIMIT 1` as any[]; if (pr[0]?.public_token) link = `https://fv.febecos.com/ver-presupuesto?token=${pr[0].public_token}`; }
        const tpc = totalParaCliente(pl.totales);
        try { aviso_cliente = await callSelector("confirmar-pago-cliente", { email, nombre: nombreSaludo(rev), pedido_numero: ref, total: tpc.total, moneda: tpc.moneda, link }); }
        catch (e: any) { aviso_cliente = { ok: false, error: e.message }; }
      }
      if (esFv) { await sql`UPDATE fv_pedidos SET estado='pagado' WHERE numero=${ref}`.catch(() => {}); await emitEstadoPedido(sql, ref, "pagado"); }
      return NextResponse.json({ ok: true, estado: "pagado", aviso_cliente });
    }
    if (b.accion === "comprobante") {
      // b.archivos = [{nombre, tipo, b64}]
      if (esFv) await sql`UPDATE fv_pedidos SET comprobante_archivo=${JSON.stringify(b.archivos || [])}::jsonb, comprobante_recibido=true WHERE numero=${ref}`;
      return NextResponse.json({ ok: true });
    }
    if (b.accion === "verificar") {
      // b.pago = { monto, moneda, tc, redondeo, monto_usd, diff_usd, ok, fecha }
      if (esFv) {
        const row = (await sql`SELECT payload, pagos_recibidos FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
        // Dedupe: NO sumar el mismo pago dos veces (re-leer un comprobante y volver a Guardar) →
        // evita saldo negativo. Mismo monto + fecha (día) + medio + N° de operación = mismo pago.
        const existentes: any[] = Array.isArray(row?.pagos_recibidos) ? row.pagos_recibidos : [];
        const mismaClave = (a: any, x: any) => Math.abs((Number(a.monto) || 0) - (Number(x.monto) || 0)) < 0.01
          && String(a.fecha || "").slice(0, 10) === String(x.fecha || "").slice(0, 10)
          && String(a.medio || "") === String(x.medio || "")
          && String(a.ref_numero || "") === String(x.ref_numero || "");
        if (existentes.some((e) => mismaClave(e, b.pago))) return NextResponse.json({ ok: true, duplicado: true });
        await sql`UPDATE fv_pedidos
          SET pagos_recibidos = coalesce(pagos_recibidos,'[]'::jsonb) || ${JSON.stringify([b.pago])}::jsonb,
              verificacion_pago = ${JSON.stringify(b.pago)}::jsonb
          WHERE numero=${ref}`;
        // Cta cte cliente: el pago cancela (haber). uniq por fecha exacta del pago.
        const cid = await clienteIdDe(sql, row?.payload);
        if (cid && Number(b.pago?.monto_usd) > 0) {
          await movCtaCte(sql, { ambito: "cliente", cliente_id: cid, fecha: (b.pago.fecha || "").slice(0, 10) || hoy(),
            concepto: "Pago recibido", pedido_ref: ref, haber: +Number(b.pago.monto_usd).toFixed(2),
            detalle: b.pago, uniq: `pcli:${ref}:${b.pago.fecha}` });
        }
        await emitEvento(sql, { tipo: "pago.recibido", entidad: "pedido", entidadId: ref,
          payload: { monto: b.pago?.monto, moneda: b.pago?.moneda, medio: b.pago?.medio, monto_usd: b.pago?.monto_usd, fecha: b.pago?.fecha, ref_numero: b.pago?.ref_numero },
          idempotencyKey: `gestion:pago.recibido:${ref}:${String(b.pago?.fecha || "").slice(0,10)}:${b.pago?.monto}:${b.pago?.medio || ""}:${b.pago?.ref_numero || ""}`,
          clienteId: cid });
        await marcarCompro(sql, cid);
      }
      return NextResponse.json({ ok: true });
    }
    if (b.accion === "eliminar_pago") {
      // Borra un pago recibido (por índice) y revierte su movimiento en cuenta corriente.
      if (esFv) {
        const row = (await sql`SELECT payload, pagos_recibidos FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
        const pagos: any[] = Array.isArray(row?.pagos_recibidos) ? row.pagos_recibidos : [];
        const idx = Number(b.index);
        if (!(idx >= 0 && idx < pagos.length)) return NextResponse.json({ ok: false, error: "pago no encontrado" }, { status: 404 });
        const p = pagos[idx];
        const resto = pagos.filter((_, i) => i !== idx);
        await sql`UPDATE fv_pedidos SET pagos_recibidos=${JSON.stringify(resto)}::jsonb, verificacion_pago=${resto.length ? JSON.stringify(resto[resto.length - 1]) : null}::jsonb, comprobante_recibido=${resto.length > 0} WHERE numero=${ref}`;
        // Revierte el movimiento de cuenta corriente del pago eliminado.
        if (p?.fecha) await delMov(sql, `pcli:${ref}:${p.fecha}`).catch(() => {});
        if (resto.length === 0) {
          // Sin pagos: barre cualquier mov de pago huérfano de este pedido (uniq con fecha distinta)
          // para que no quede saldo "duplicado" al volver a cargar.
          await delMovPrefijo(sql, `pcli:${ref}:`).catch(() => {});
          // Reactiva el botón "Avisar pago OK al cliente": si quedó marcado 'pagado'
          // (y todavía no se despachó), vuelve a 'aprobado' para reiniciar el proceso de pago.
          await sql`UPDATE fv_pedidos SET estado='aprobado', pagado_at=NULL WHERE numero=${ref} AND estado='pagado'`.catch(() => {});
        }
      }
      return NextResponse.json({ ok: true });
    }
    // Editar el MEDIO (y datos de retención) de un pago ya cargado, sin borrarlo ni tocar el monto.
    if (b.accion === "editar_pago") {
      if (esFv) {
        const row = (await sql`SELECT pagos_recibidos FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
        const pagos: any[] = Array.isArray(row?.pagos_recibidos) ? row.pagos_recibidos : [];
        const idx = Number(b.index);
        if (!(idx >= 0 && idx < pagos.length)) return NextResponse.json({ ok: false, error: "pago no encontrado" }, { status: 404 });
        const esRet = (b.medio ?? pagos[idx].medio) === "Retención";
        pagos[idx] = { ...pagos[idx],
          medio: String(b.medio ?? pagos[idx].medio ?? "Transferencia"),
          banco: b.banco !== undefined ? (b.banco || null) : (pagos[idx].banco ?? null),
          ref_numero: b.ref_numero !== undefined ? (b.ref_numero || null) : (pagos[idx].ref_numero ?? null),
          fecha: b.fecha ? b.fecha : pagos[idx].fecha,
          retencion: esRet ? { pct: b.ret_pct ? Number(b.ret_pct) : (pagos[idx].retencion?.pct ?? null), certificado: b.ret_cert ?? pagos[idx].retencion?.certificado ?? null } : null };
        await sql`UPDATE fv_pedidos SET pagos_recibidos=${JSON.stringify(pagos)}::jsonb WHERE numero=${ref}`;
      }
      return NextResponse.json({ ok: true });
    }
    // Recibo X (no fiscal): detalle de cada pago recibido + saldo. Snapshot inmutable en datos_recibo.
    if (b.accion === "recibo") {
      if (!esFv) return NextResponse.json({ ok: false, error: "solo FV por ahora" }, { status: 400 });
      const row = (await sql`SELECT payload, factura_numero, pagos_recibidos FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
      if (!row) return NextResponse.json({ ok: false, error: "pedido no encontrado" }, { status: 404 });
      const plr = row.payload || {};
      const pagos: any[] = Array.isArray(row.pagos_recibidos) && row.pagos_recibidos.length ? row.pagos_recibidos : (Array.isArray(plr.pagos_recibidos) ? plr.pagos_recibidos : []);
      if (!pagos.length) return NextResponse.json({ ok: false, error: "No hay pagos registrados para emitir el recibo." }, { status: 409 });
      const cidEnvio = await clienteIdDe(sql, plr);
      const fac = row.factura_numero ? (await sql`SELECT id, cliente_id, cliente_nombre, total, moneda FROM fg_comprobantes WHERE numero=${row.factura_numero} AND tipo='factura' LIMIT 1` as any[])[0] : null;
      const cid = fac?.cliente_id ?? cidEnvio;
      const cnombre = fac?.cliente_nombre || plr.revendedor?.nombre || plr.cliente?.nombre || null;
      const tt = plr.totales || {};
      // ESPEJO EXACTO del tab Pago. La "moneda" del pedido es la moneda de COBRO; neto/total están en
      // base USD y, si se cobra en pesos, se multiplican por el TC pactado. Si ya hay factura, manda
      // la factura. Así el recibo da idéntico a "Total a cobrar / Pagado / Saldo" del tab Pago.
      const pedMoneda = String(fac?.moneda || tt.moneda || "USD").toUpperCase();
      const tcPed = Number(fac?.tc) || Number(tt.tc) || 0;
      const enPesos = pedMoneda === "ARS";
      const monedaRec = pedMoneda;
      const totalLabel = fac?.total != null ? "Total facturado" : "Total del pedido";
      const referencia = row.factura_numero || ref;
      const ivaUsd = Array.isArray(tt.iva_detalle) ? tt.iva_detalle.reduce((a: number, d: any) => a + (Number(d.monto ?? d.importe) || 0), 0) : 0;
      const netoUsd = Number(tt.neto);
      const totalUsdReal = (Array.isArray(tt.iva_detalle) && tt.iva_detalle.length && !isNaN(netoUsd)) ? +(netoUsd + ivaUsd).toFixed(2) : (Number(tt.total) || 0);
      // Presupuestos que guardan SOLO el total (bombas): el total ya está en su moneda (pesos), no se aplica TC.
      const sinNeto = !(Number(tt.neto) > 0) && Number(tt.total) > 0;
      const totalCobrar = fac?.total != null
        ? (enPesos ? Math.round(Number(fac.total)) : +Number(fac.total).toFixed(2))
        : sinNeto ? (enPesos ? Math.round(Number(tt.total)) : +Number(tt.total).toFixed(2))
        : (enPesos ? Math.round(totalUsdReal * tcPed) : +totalUsdReal.toFixed(2));
      // Convierte un pago a la moneda de cobro, igual que pagoEnMonedaFactura del tab Pago.
      const aRec = (p: any) => { const m = Number(p.monto) || 0; if (enPesos) return p.moneda === "usd" ? Math.round(m * tcPed) : +m.toFixed(2); return p.moneda === "ars" ? (tcPed ? +(m / tcPed).toFixed(2) : 0) : +m.toFixed(2); };
      const det = pagos.map((p: any) => ({
        fecha: String(p.fecha || "").slice(0, 10),
        medio: p.medio || "Transferencia",
        banco: p.banco || null,
        ref_numero: p.ref_numero || null,
        retencion: p.retencion || null,
        monto: aRec(p),
        moneda: monedaRec,
      }));
      const totalPagado = +det.reduce((a, x) => a + x.monto, 0).toFixed(2);
      const saldo = +(totalCobrar - totalPagado).toFixed(2);
      const monedaFac = monedaRec;
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS datos_recibo JSONB`.catch(() => {});
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS letra TEXT`.catch(() => {});
      const datosRecibo = { factura_nro: row.factura_numero || null, referencia, total_label: totalLabel, total_cobrar: totalCobrar, total_pagado: totalPagado, saldo, moneda: monedaFac, pagos: det, emitido_at: new Date().toISOString() };
      const n = ((await sql`SELECT count(*)::int c FROM fg_comprobantes WHERE tipo='recibo'` as any[])[0]?.c || 0) + 1;
      const numero = `REC X ${String(n).padStart(8, "0")}`;
      const comp = (await sql`
        INSERT INTO fg_comprobantes (tipo, letra, estado, numero, cliente_id, cliente_nombre, operacion_id, fecha, subtotal, total, moneda, notas, token, datos_recibo)
        VALUES ('recibo','X','emitido',${numero},${cid},${cnombre},${fac?.id ?? null}, now(), ${totalPagado}, ${totalPagado}, ${monedaFac}, ${"Recibo del pedido " + ref + (row.factura_numero ? " · " + row.factura_numero : "")}, gen_random_uuid()::text, ${JSON.stringify(datosRecibo)}::jsonb)
        RETURNING id, token` as any[])[0];
      let orden = 0;
      for (const d of det) {
        const desc = [d.medio, d.banco, d.ref_numero ? `N° ${d.ref_numero}` : "", d.fecha, d.retencion ? `retención ${d.retencion.pct ? d.retencion.pct + "% " : ""}${d.retencion.certificado || ""}` : ""].filter(Boolean).join(" · ");
        await sql`INSERT INTO fg_items (comprobante_id, descripcion, cantidad, precio_unitario, total, orden)
          VALUES (${comp.id}, ${desc.slice(0, 300)}, 1, ${d.monto}, ${d.monto}, ${orden++})`;
      }
      const mergeRec = JSON.stringify({ recibo_numero: numero, recibo_token: comp.token, recibo_saldo: saldo });
      await sql`UPDATE fv_pedidos SET payload = coalesce(payload,'{}'::jsonb) || ${mergeRec}::jsonb WHERE numero=${ref} RETURNING numero`;
      return NextResponse.json({ ok: true, recibo_numero: numero, recibo_token: comp.token, saldo });
    }
    if (b.accion === "pago_proveedor") {
      // b.pago = { proveedor, medio('usd'|'pesos'|'cheque_propio'|'cheque_endosado'), tc_usd, monto, monto_usd,
      //            monto_proveedor_usd, diff_vs_pedido, diff_vs_proveedor, ok, fecha, nota }  (TC manual)
      // b.quitar = nombre de proveedor → elimina su pago.  pago_proveedor se guarda como ARRAY (un pago por proveedor).
      if (!esFv) return NextResponse.json({ ok: false, error: "solo FV por ahora" }, { status: 400 });
      const cur = (await sql`SELECT pago_proveedor FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0]?.pago_proveedor;
      let arr: any[] = Array.isArray(cur) ? cur : (cur ? [cur] : []);
      if (b.quitar) {
        arr = arr.filter((p) => p.proveedor !== b.quitar);
        await delMov(sql, `pprov:${ref}:${b.quitar}`);
      } else if (b.pago) {
        const prov = b.pago.proveedor || "Sin proveedor";
        arr = arr.filter((p) => p.proveedor !== prov);
        arr.push(b.pago);
        const pr = await resolveProveedor(sql, prov);
        await movCtaCte(sql, { ambito: "proveedor", proveedor: prov, proveedor_id: pr?.id ?? null, fecha: b.pago.fecha || hoy(),
          concepto: "Pago a proveedor (" + (b.pago.medio || "") + ")", pedido_ref: ref,
          debe: +Number(b.pago.monto_usd || 0).toFixed(2), detalle: b.pago, uniq: `pprov:${ref}:${prov}` });
      }
      await sql`UPDATE fv_pedidos SET pago_proveedor=${arr.length ? JSON.stringify(arr) : null}::jsonb WHERE numero=${ref}`;
      return NextResponse.json({ ok: true });
    }
    if (b.accion === "email_cliente") {
      const email = String(b.email || "").trim();
      if (esFv) await sql`UPDATE fv_pedidos SET payload = jsonb_set(jsonb_set(coalesce(payload,'{}'::jsonb), '{revendedor}', coalesce(payload->'revendedor','{}'::jsonb)), '{revendedor,email}', to_jsonb(${email}::text)) WHERE numero=${ref}`;
      // Por norma: el email también queda en la ficha del CRM (de ahí lo lee el envío de factura).
      if (email) {
        const fvRow2 = await sql`SELECT payload FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[];
        const cid = await clienteIdDe(sql, fvRow2[0]?.payload);
        if (cid) await sql`UPDATE clientes SET email=${email} WHERE id=${cid}`;
      }
      return NextResponse.json({ ok: true });
    }
    if (b.accion === "nota") {
      if (esFv) await sql`UPDATE fv_pedidos SET payload = jsonb_set(coalesce(payload,'{}'::jsonb), '{notas_internas}', to_jsonb(${b.nota || ""}::text)) WHERE numero=${ref}`;
      return NextResponse.json({ ok: true });
    }
    if (b.accion === "envio") {
      if (esFv) await sql`UPDATE fv_pedidos SET payload = jsonb_set(coalesce(payload,'{}'::jsonb), '{envio}', ${JSON.stringify(b.envio || {})}::jsonb) WHERE numero=${ref}`;
      return NextResponse.json({ ok: true });
    }
    // Valor declarado para el transporte: es PROPIO del pedido (no del cliente), lo indica el cliente.
    if (b.accion === "valor_declarado") {
      const vd = String(b.valor_declarado ?? "").trim();
      if (esFv) await sql`UPDATE fv_pedidos SET payload = jsonb_set(coalesce(payload,'{}'::jsonb), '{valor_declarado}', to_jsonb(${vd}::text)) WHERE numero=${ref}`;
      return NextResponse.json({ ok: true });
    }
    // Enviar al cliente el link para que cargue sus datos de envío.
    if (b.accion === "pedir_envio") {
      const email = String(b.email || "").trim();
      if (!email) return NextResponse.json({ ok: false, error: "El pedido no tiene email del cliente." }, { status: 409 });
      let nombre = ""; let numero = ref;
      if (esFv) { const row = await sql`SELECT payload FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[]; nombre = row[0]?.payload?.revendedor?.nombre || row[0]?.payload?.cliente?.nombre || ""; }
      const r = await callSelector("enviar-link-envio", { email, nombre, numero, link: b.link });
      if (!r?.ok) return NextResponse.json({ ok: false, error: r?.error || "No se pudo enviar el email" }, { status: 502 });
      return NextResponse.json({ ok: true, email });
    }
    // Despacho: generar REMITO. Habilitado solo tras FACTURADO + PAGADO.
    if (b.accion === "remitir") {
      if (!esFv) return NextResponse.json({ ok: false, error: "solo FV por ahora" }, { status: 400 });
      const row = (await sql`SELECT payload, factura_numero, estado, pagos_recibidos FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
      if (!row) return NextResponse.json({ ok: false, error: "pedido no encontrado" }, { status: 404 });
      const plr = row.payload || {};
      if (!row.factura_numero) return NextResponse.json({ ok: false, error: "Primero facturá el pedido." }, { status: 409 });
      const pagado = ["pagado", "enviado"].includes(row.estado) || (row.pagos_recibidos || []).length > 0 || (plr.pagos_recibidos || []).length > 0;
      if (!pagado) return NextResponse.json({ ok: false, error: "Falta registrar el pago del cliente antes de despachar." }, { status: 409 });
      // CRM = fuente única de los datos de envío: el remito toma el envío de la ficha del cliente.
      // (fallback al envío que pudiera tener el pedido por compatibilidad con pedidos viejos).
      const cidEnvio = await clienteIdDe(sql, plr);
      const clEnvio = cidEnvio ? ((await sql`SELECT envio FROM clientes WHERE id=${cidEnvio} LIMIT 1` as any[])[0]?.envio || null) : null;
      // Si hay cliente en CRM, manda SIEMPRE su envío (en vivo); el payload viejo es solo fallback sin cliente.
      const env = cidEnvio ? (clEnvio || {}) : (plr.envio || {});
      const envCompleto = !!(env.nombre && env.direccion && env.localidad && env.provincia);
      if (!envCompleto) return NextResponse.json({ ok: false, error: "Faltan los datos de envío del cliente. Cargalos en la ficha del cliente (CRM › Datos Envíos) o pedile que los complete desde el link." }, { status: 409 });
      if (!String(env.empresa || "").trim()) return NextResponse.json({ ok: false, error: "Falta el TRANSPORTE en los datos de envío del cliente. Cargalo antes de generar el remito." }, { status: 409 });
      // REMITOS PARCIALES: se puede despachar de a tandas. Lo ya despachado vive en payload.remitos.
      // El FLETE INTERNO no es mercadería: no se despacha ni cuenta para completar el remito.
      const esFlete = (it: any) => /flete/i.test(String(it?.codigo || "") + " " + String(it?.descripcion || ""));
      const itemsPed = (plr.items || []);
      const yaDesp: Record<number, number> = {};
      for (const rr of (plr.remitos || [])) for (const it of (rr.items || [])) yaDesp[it.idx] = (yaDesp[it.idx] || 0) + (Number(it.cantidad) || 0);
      const pend = itemsPed.map((it: any, idx: number) => ({ idx, codigo: it.codigo || "", descripcion: it.descripcion || it.codigo || "", pendiente: esFlete(it) ? 0 : Math.max(0, (Number(it.cantidad) || 0) - (yaDesp[idx] || 0)) }));
      // Selección a despachar: lo que marque el front, o TODO lo pendiente (compatibilidad).
      let aDespachar: { idx: number; codigo: string; descripcion: string; cantidad: number }[];
      if (Array.isArray(b.items) && b.items.length) {
        aDespachar = b.items.map((s: any) => { const p = pend.find((x: any) => x.idx === Number(s.idx)); const c = Math.min(Number(s.cantidad) || 0, p?.pendiente || 0); return p && c > 0 ? { idx: p.idx, codigo: p.codigo, descripcion: p.descripcion, cantidad: c } : null; }).filter(Boolean) as any[];
      } else {
        aDespachar = pend.filter((p: any) => p.pendiente > 0).map((p: any) => ({ idx: p.idx, codigo: p.codigo, descripcion: p.descripcion, cantidad: p.pendiente }));
      }
      if (!aDespachar.length) return NextResponse.json({ ok: false, error: "No hay ítems pendientes de despacho (¿ya se despachó todo?)." }, { status: 409 });
      // ¿Queda todo despachado con esta tanda? (para marcar el pedido como 'enviado')
      const despAcc: Record<number, number> = { ...yaDesp };
      for (const it of aDespachar) despAcc[it.idx] = (despAcc[it.idx] || 0) + it.cantidad;
      const completo = itemsPed.every((it: any, idx: number) => esFlete(it) || (despAcc[idx] || 0) >= (Number(it.cantidad) || 0));
      // VALOR DECLARADO del remito: el que indique el front (b.valor_declarado) o, por defecto,
      // proporcional al valor de los ítems de ESTA tanda respecto del total del pedido. Así con 2
      // remitos cada uno declara su parte.
      const valItem = (it: any) => Number(it?.subtotal) || 0;
      const totalVal = itemsPed.reduce((a: number, it: any) => a + valItem(it), 0);
      const remVal = aDespachar.reduce((a: number, x: any) => { const it = itemsPed[x.idx]; const full = Number(it?.cantidad) || 1; return a + valItem(it) * (x.cantidad / full); }, 0);
      const totQty = itemsPed.reduce((a: number, it: any) => a + (esFlete(it) ? 0 : (Number(it?.cantidad) || 0)), 0);
      const remQty = aDespachar.reduce((a: number, x: any) => a + x.cantidad, 0);
      const share = totalVal > 0 ? (remVal / totalVal) : (totQty > 0 ? (remQty / totQty) : 1);
      // Valor declarado = SOLO lo que declara el cliente (nunca el total del pedido, Guille 14/07).
      // Base si el front no manda uno explícito: lo que cargó el cliente en /envio, si no el override
      // manual guardado en gestión. NUNCA el total.
      const baseDeclarado = Number(plr.envio?.valor_declarado) || Number(plr.valor_declarado) || 0;
      const valorDeclaradoRemito = (b.valor_declarado != null && String(b.valor_declarado) !== "") ? Math.round(Number(b.valor_declarado)) : Math.round(baseDeclarado * share);
      // El remito va al MISMO receptor que la factura (puede ser un cliente final del revendedor).
      const fac = (await sql`SELECT cliente_id, cliente_nombre FROM fg_comprobantes WHERE numero=${row.factura_numero} AND tipo='factura' LIMIT 1` as any[])[0];
      const cid = fac?.cliente_id ?? cidEnvio;
      const cnombre = fac?.cliente_nombre || plr.revendedor?.nombre || null;
      const tMaster = await resolverTransporte(env.empresa); // datos del transporte directo del maestro
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS lugar_entrega TEXT`.catch(() => {});
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS tipo_transporte TEXT`.catch(() => {});
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS talonario_id INT`.catch(() => {});
      // Snapshot inmutable del remito (cliente + transporte + factura + imagen de fondo de la matriz).
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS datos_remito JSONB`.catch(() => {});
      await sql`ALTER TABLE fg_talonarios ADD COLUMN IF NOT EXISTS imagen_fondo TEXT`.catch(() => {});
      // Numeración por TALONARIO REM (config, estilo Táctica). Permite elegir uno (b.talonario_id);
      // si no, el REM por defecto. Si no hay ningún talonario REM, cae a R-NNNNNN.
      let numero: string; let remTalId: number | null = null;
      const remTal = Number(b.talonario_id) > 0
        ? (await sql`SELECT id, imagen_fondo FROM fg_talonarios WHERE id=${Number(b.talonario_id)} AND tipo_codigo='REM' AND activo=true AND bloqueado=false LIMIT 1` as any[])[0]
        : (await sql`SELECT id, imagen_fondo FROM fg_talonarios WHERE tipo_codigo='REM' AND activo=true AND bloqueado=false ORDER BY defecto DESC, orden, id LIMIT 1` as any[])[0];
      if (remTal) {
        try { const nn = await numeroDesdeTalonario(sql, remTal.id); numero = `R ${nn!.numero}`; remTalId = remTal.id; }
        catch (e: any) { return NextResponse.json({ ok: false, error: "Talonario REM: " + e.message }, { status: 409 }); }
      } else {
        const n = ((await sql`SELECT count(*)::int c FROM fg_comprobantes WHERE tipo='remito'` as any[])[0]?.c || 0) + 1;
        numero = `R-${String(n).padStart(6, "0")}`;
      }
      const lugar = [env.direccion, env.localidad, env.provincia, env.cp && `(${env.cp})`].filter(Boolean).join(", ") || plr.datos_venta?.lugar_entrega || null;
      const transp = env.empresa || plr.datos_venta?.tipo_transporte || null;
      // SNAPSHOT inmutable: datos fiscales del receptor (congelados al emitir, NO se leen en vivo),
      // datos del transporte (incl. su domicilio), N° de factura e imagen de fondo de la matriz/talonario.
      const recep = cid ? (await sql`SELECT nombre, razon_social, cuit, condicion_fiscal, domicilio, localidad, provincia, cod_postal FROM clientes WHERE id=${cid} LIMIT 1` as any[])[0] : null;
      // Nota/texto libre del remito (bloque destacado, hasta 4 líneas) que Guille escribe al generar.
      const notaRemito = String(b.nota_remito ?? "").replace(/\r/g, "").split("\n").slice(0, 4).map((l: string) => l.slice(0, 60)).join("\n").trim();
      const datosRemito = {
        cliente: {
          nombre: recep?.nombre || recep?.razon_social || cnombre || env.nombre || "",
          domicilio: [recep?.domicilio, recep?.localidad, (recep?.provincia && String(recep.provincia).toLowerCase() !== String(recep?.localidad || "").toLowerCase()) ? recep.provincia : null, recep?.cod_postal && `(${recep.cod_postal})`].filter(Boolean).join(" "),
          cuit: recep?.cuit || env.dni || "",
          condicion_fiscal: recep?.condicion_fiscal || "",
        },
        transporte: { empresa: env.empresa || "", domicilio: env.domicilio_transporte || tMaster?.domicilio || "", telefono: env.telefono_transporte || tMaster?.telefono || "", cuit: env.cuit_transporte || tMaster?.cuit || "" },
        entrega: lugar,
        factura_nro: row.factura_numero || null,
        imagen_fondo: (remTal && remTal.imagen_fondo) ? remTal.imagen_fondo : "remito-fondo.png",
        emitido_at: new Date().toISOString(),
        parcial: !completo,
        valor_declarado: valorDeclaradoRemito || null,
        nota: notaRemito || null,
        items: aDespachar.map((x) => ({ codigo: x.codigo, descripcion: x.descripcion, cantidad: x.cantidad })),
      };
      const comp = (await sql`
        INSERT INTO fg_comprobantes (tipo, estado, numero, talonario_id, cliente_id, cliente_nombre, fecha, subtotal, total, moneda, notas, token, lugar_entrega, tipo_transporte, datos_remito)
        VALUES ('remito','emitido',${numero},${remTalId},${cid},${cnombre}, now(), 0, 0, 'ARS', ${"Despacho del pedido " + ref + (row.factura_numero ? " · " + row.factura_numero : "")}, gen_random_uuid()::text, ${lugar}, ${transp}, ${JSON.stringify(datosRemito)}::jsonb)
        RETURNING id, token` as any[])[0];
      let orden = 0;
      for (const it of aDespachar) {
        await sql`INSERT INTO fg_items (comprobante_id, descripcion, cantidad, precio_unitario, total, orden)
          VALUES (${comp.id}, ${(it.descripcion || it.codigo || "").slice(0, 300)}, ${it.cantidad || 1}, 0, 0, ${orden++})`;
      }
      // Acumular este remito en payload.remitos. Solo se marca 'enviado' cuando se despachó TODO.
      const nuevoRemito = { numero, token: comp.token, fecha: new Date().toISOString(), parcial: !completo, items: aDespachar.map((x) => ({ idx: x.idx, codigo: x.codigo, descripcion: x.descripcion, cantidad: x.cantidad })) };
      const remitosAll = [...(plr.remitos || []), nuevoRemito];
      // Estado: al generar el remito el pedido queda "remito preparado" (NO despachado). El despacho se
      // confirma recién cuando se sube el remito sellado por el transporte (acción confirmacion_despacho).
      const merge = JSON.stringify({ remitos: remitosAll, remito_numero: numero, remito_token: comp.token, despacho_completo: completo, despacho_confirmado: false, remito_preparado: true });
      await sql`UPDATE fv_pedidos SET payload = coalesce(payload,'{}'::jsonb) || ${merge}::jsonb WHERE numero=${ref} RETURNING numero`;
      return NextResponse.json({ ok: true, remito_numero: numero, remito_token: comp.token, completo, despachados: aDespachar });
    }
    // Eliminar un remito — SOLO si es el último emitido (no hay otro remito con número/id posterior).
    if (b.accion === "eliminar_remito") {
      if (!esFv) return NextResponse.json({ ok: false, error: "solo FV por ahora" }, { status: 400 });
      const numero = String(b.numero || "").trim();
      if (!numero) return NextResponse.json({ ok: false, error: "Falta el N° de remito." }, { status: 400 });
      const row = (await sql`SELECT payload, estado FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
      if (!row) return NextResponse.json({ ok: false, error: "pedido no encontrado" }, { status: 404 });
      const plr = row.payload || {};
      const rem = (await sql`SELECT id, talonario_id, numero FROM fg_comprobantes WHERE numero=${numero} AND tipo='remito' LIMIT 1` as any[])[0];
      if (!rem) return NextResponse.json({ ok: false, error: "Remito no encontrado." }, { status: 404 });
      // No se puede borrar si existe un remito posterior (mayor id = emitido después).
      const ultId = (await sql`SELECT max(id)::int m FROM fg_comprobantes WHERE tipo='remito'` as any[])[0]?.m || 0;
      if (Number(rem.id) !== Number(ultId)) return NextResponse.json({ ok: false, error: "No se puede eliminar: existe un remito posterior. Eliminá primero el último emitido." }, { status: 409 });
      // Roll back del número en el talonario (si el remito usó talonario y era el último número emitido).
      if (rem.talonario_id) {
        const emit = parseInt(String(numero).replace(/\D/g, "").slice(-8) || "0", 10);
        if (emit > 0) await sql`UPDATE fg_talonarios SET proximo_numero = proximo_numero - 1 WHERE id=${rem.talonario_id} AND proximo_numero = ${emit + 1}`;
      }
      await sql`DELETE FROM fg_items WHERE comprobante_id=${rem.id}`;
      await sql`DELETE FROM fg_comprobantes WHERE id=${rem.id}`;
      const remitosAll = (plr.remitos || []).filter((r: any) => r.numero !== numero);
      const last = remitosAll[remitosAll.length - 1] || null;
      const merge = JSON.stringify({ remitos: remitosAll, remito_numero: last?.numero || null, remito_token: last?.token || null, despacho_completo: false, despacho_confirmado: false, remito_preparado: remitosAll.length > 0 });
      // Si ya no queda ningún remito, el pedido vuelve de 'enviado' a 'pagado'.
      const nuevoEstado = remitosAll.length === 0 && row.estado === "enviado" ? "pagado" : row.estado;
      await sql`UPDATE fv_pedidos SET estado=${nuevoEstado}, payload = coalesce(payload,'{}'::jsonb) || ${merge}::jsonb WHERE numero=${ref} RETURNING numero`;
      return NextResponse.json({ ok: true, eliminado: numero });
    }
    // Regenerar un remito EXISTENTE con el mismo número/token pero datos actualizados (envío/transporte en vivo).
    if (b.accion === "regenerar_remito") {
      if (!esFv) return NextResponse.json({ ok: false, error: "solo FV por ahora" }, { status: 400 });
      const numero = String(b.numero || "").trim();
      if (!numero) return NextResponse.json({ ok: false, error: "Falta el N° de remito." }, { status: 400 });
      const row = (await sql`SELECT payload, factura_numero FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
      if (!row) return NextResponse.json({ ok: false, error: "pedido no encontrado" }, { status: 404 });
      const plr = row.payload || {};
      const rem = (await sql`SELECT id, talonario_id, cliente_id, datos_remito FROM fg_comprobantes WHERE numero=${numero} AND tipo='remito' LIMIT 1` as any[])[0];
      if (!rem) return NextResponse.json({ ok: false, error: "Remito no encontrado." }, { status: 404 });
      const cidEnvio = await clienteIdDe(sql, plr);
      const clEnvio = cidEnvio ? ((await sql`SELECT envio FROM clientes WHERE id=${cidEnvio} LIMIT 1` as any[])[0]?.envio || null) : null;
      const env = cidEnvio ? (clEnvio || {}) : (plr.envio || {});
      if (!(env.nombre && env.direccion && env.localidad && env.provincia)) return NextResponse.json({ ok: false, error: "Faltan los datos de envío del cliente." }, { status: 409 });
      if (!String(env.empresa || "").trim()) return NextResponse.json({ ok: false, error: "Falta el TRANSPORTE en los datos de envío del cliente. Cargalo antes de regenerar el remito." }, { status: 409 });
      const cid = rem.cliente_id;
      const recep = cid ? (await sql`SELECT nombre, razon_social, cuit, condicion_fiscal, domicilio, localidad, provincia, cod_postal FROM clientes WHERE id=${cid} LIMIT 1` as any[])[0] : null;
      const lugar = [env.direccion, env.localidad, env.provincia, env.cp && `(${env.cp})`].filter(Boolean).join(", ") || plr.datos_venta?.lugar_entrega || null;
      const transp = env.empresa || plr.datos_venta?.tipo_transporte || null;
      const tMaster = await resolverTransporte(env.empresa); // datos del transporte directo del maestro
      const prev = rem.datos_remito || {};
      const datosRemito = {
        ...prev,
        cliente: {
          nombre: recep?.nombre || recep?.razon_social || prev?.cliente?.nombre || env.nombre || "",
          domicilio: [recep?.domicilio, recep?.localidad, (recep?.provincia && String(recep.provincia).toLowerCase() !== String(recep?.localidad || "").toLowerCase()) ? recep.provincia : null, recep?.cod_postal && `(${recep.cod_postal})`].filter(Boolean).join(" "),
          cuit: recep?.cuit || env.dni || "",
          condicion_fiscal: recep?.condicion_fiscal || "",
        },
        transporte: { empresa: env.empresa || "", domicilio: env.domicilio_transporte || tMaster?.domicilio || "", telefono: env.telefono_transporte || tMaster?.telefono || "", cuit: env.cuit_transporte || tMaster?.cuit || "" },
        entrega: lugar,
        valor_declarado: prev?.valor_declarado ?? plr.valor_declarado ?? null, // conserva el valor PROPIO del remito (regenerar NO lo pisa con el del pedido)
        regenerado_at: new Date().toISOString(),
      };
      await sql`UPDATE fg_comprobantes SET lugar_entrega=${lugar}, tipo_transporte=${transp}, datos_remito=${JSON.stringify(datosRemito)}::jsonb WHERE id=${rem.id}`;
      return NextResponse.json({ ok: true, remito_numero: numero });
    }
    // Confirmación de despacho: subir el remito sellado por el transporte (PDF/imagen) y guardarlo en el remito.
    if (b.accion === "confirmacion_despacho") {
      if (!esFv) return NextResponse.json({ ok: false, error: "solo FV por ahora" }, { status: 400 });
      const numero = String(b.numero || "").trim();
      const arch = b.archivo || null;
      if (!numero || !arch?.b64) return NextResponse.json({ ok: false, error: "Falta el N° de remito o el archivo." }, { status: 400 });
      const rem = (await sql`SELECT id FROM fg_comprobantes WHERE numero=${numero} AND tipo='remito' LIMIT 1` as any[])[0];
      if (!rem) return NextResponse.json({ ok: false, error: "Remito no encontrado." }, { status: 404 });
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS confirmacion_archivo JSONB`.catch(() => {});
      const validacion = b.validacion && typeof b.validacion === "object" ? b.validacion : null;
      const conf = { nombre: String(arch.nombre || "confirmacion").slice(0, 120), tipo: String(arch.tipo || "application/octet-stream").slice(0, 60), b64: String(arch.b64), at: new Date().toISOString(), validacion };
      await sql`UPDATE fg_comprobantes SET confirmacion_archivo=${JSON.stringify(conf)}::jsonb WHERE id=${rem.id}`;
      // Espejo (sin b64) en payload.remitos para que el front sepa que hay confirmación.
      const row = (await sql`SELECT payload, estado FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
      const plr = row?.payload || {};
      const remitos = (plr.remitos || []).map((r: any) => r.numero === numero ? { ...r, confirmacion: { ...(r.confirmacion || {}), nombre: conf.nombre, at: conf.at, validacion } } : r);
      // Despacho COMPLETO = todos los ítems (sin flete) tienen remito Y todos los remitos están confirmados (sellados).
      const esFlete = (it: any) => /flete/i.test(String(it?.codigo || "") + " " + String(it?.descripcion || ""));
      const yaDesp: Record<number, number> = {};
      for (const rr of remitos) for (const it of (rr.items || [])) yaDesp[it.idx] = (yaDesp[it.idx] || 0) + (Number(it.cantidad) || 0);
      const itemsCompletos = (plr.items || []).every((it: any, idx: number) => esFlete(it) || (yaDesp[idx] || 0) >= (Number(it.cantidad) || 0));
      const todosConfirmados = remitos.length > 0 && remitos.every((r: any) => r.confirmacion);
      const confirmado = itemsCompletos && todosConfirmados;
      const merge = JSON.stringify({ remitos, despacho_completo: itemsCompletos, despacho_confirmado: confirmado, remito_preparado: true });
      const nuevoEstado = confirmado ? "enviado" : row?.estado;
      await sql`UPDATE fv_pedidos SET estado=${nuevoEstado}, payload = coalesce(payload,'{}'::jsonb) || ${merge}::jsonb WHERE numero=${ref} RETURNING numero`;
      if (confirmado) await emitEstadoPedido(sql, ref, "despachado");
      return NextResponse.json({ ok: true, remito_numero: numero, despacho_confirmado: confirmado });
    }
    // Quitar la confirmación de despacho de un remito → vuelve a "remito preparado".
    if (b.accion === "eliminar_confirmacion") {
      if (!esFv) return NextResponse.json({ ok: false, error: "solo FV por ahora" }, { status: 400 });
      const numero = String(b.numero || "").trim();
      if (!numero) return NextResponse.json({ ok: false, error: "Falta el N° de remito." }, { status: 400 });
      const rem = (await sql`SELECT id FROM fg_comprobantes WHERE numero=${numero} AND tipo='remito' LIMIT 1` as any[])[0];
      if (!rem) return NextResponse.json({ ok: false, error: "Remito no encontrado." }, { status: 404 });
      await sql`UPDATE fg_comprobantes SET confirmacion_archivo=NULL WHERE id=${rem.id}`;
      const row = (await sql`SELECT payload, estado FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
      const plr = row?.payload || {};
      const remitos = (plr.remitos || []).map((r: any) => r.numero === numero ? (() => { const { confirmacion, ...rest } = r; return rest; })() : r);
      const esFlete = (it: any) => /flete/i.test(String(it?.codigo || "") + " " + String(it?.descripcion || ""));
      const yaDesp: Record<number, number> = {};
      for (const rr of remitos) for (const it of (rr.items || [])) yaDesp[it.idx] = (yaDesp[it.idx] || 0) + (Number(it.cantidad) || 0);
      const itemsCompletos = (plr.items || []).every((it: any, idx: number) => esFlete(it) || (yaDesp[idx] || 0) >= (Number(it.cantidad) || 0));
      const confirmado = itemsCompletos && remitos.length > 0 && remitos.every((r: any) => r.confirmacion);
      const merge = JSON.stringify({ remitos, despacho_completo: itemsCompletos, despacho_confirmado: confirmado, remito_preparado: remitos.length > 0 });
      // Si dejó de estar confirmado y el pedido estaba 'enviado', vuelve a 'pagado'.
      const nuevoEstado = !confirmado && row?.estado === "enviado" ? "pagado" : row?.estado;
      await sql`UPDATE fv_pedidos SET estado=${nuevoEstado}, payload = coalesce(payload,'{}'::jsonb) || ${merge}::jsonb WHERE numero=${ref} RETURNING numero`;
      return NextResponse.json({ ok: true, remito_numero: numero, despacho_confirmado: confirmado });
    }
    // Enviar la confirmación de despacho por email al cliente (con el remito sellado adjunto).
    if (b.accion === "enviar_confirmacion") {
      if (!esFv) return NextResponse.json({ ok: false, error: "solo FV por ahora" }, { status: 400 });
      const numero = String(b.numero || "").trim();
      const email = String(b.email || "").trim();
      if (!numero) return NextResponse.json({ ok: false, error: "Falta el N° de remito." }, { status: 400 });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ ok: false, error: "Email inválido." }, { status: 400 });
      const rem = (await sql`SELECT id, confirmacion_archivo, cliente_nombre FROM fg_comprobantes WHERE numero=${numero} AND tipo='remito' LIMIT 1` as any[])[0];
      if (!rem) return NextResponse.json({ ok: false, error: "Remito no encontrado." }, { status: 404 });
      const conf = rem.confirmacion_archivo;
      if (!conf?.b64) return NextResponse.json({ ok: false, error: "Primero cargá la confirmación de despacho (remito sellado)." }, { status: 409 });
      const b64 = String(conf.b64).split(",").pop() || "";
      const nombreArch = /\.(pdf|jpe?g|png|webp|gif)$/i.test(conf.nombre || "") ? conf.nombre : (conf.nombre || "remito") + (/pdf/i.test(conf.tipo || "") ? ".pdf" : ".jpg");
      const html = `<div style="font-family:'Trebuchet MS',Segoe UI,Verdana,sans-serif;font-size:15px;color:#374151;line-height:1.7">
        <p>Hola${rem.cliente_nombre ? " " + rem.cliente_nombre : ""},</p>
        <p>Te adjuntamos la <b>confirmación de despacho</b> de tu pedido <b>${ref}</b> (remito <b>${numero}</b>), con la conformidad del transporte.</p>
        <p>Cualquier consulta, respondé este correo.</p>
        <p style="margin-top:18px;color:#0b3d6b"><b>FEBECOS — Energía Solar</b></p>
      </div>`;
      const r = await callSelector("mail_send_internal", { to: email, subject: `Confirmación de despacho — pedido ${ref} (remito ${numero})`, html, attachments: [{ filename: nombreArch, content: b64 }] });
      if (!r?.ok) return NextResponse.json({ ok: false, error: r?.error || "No se pudo enviar el email" }, { status: 502 });
      const row = (await sql`SELECT payload FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
      const remitos = ((row?.payload || {}).remitos || []).map((rr: any) => rr.numero === numero ? { ...rr, confirmacion: { ...(rr.confirmacion || {}), enviada_at: new Date().toISOString(), email } } : rr);
      await sql`UPDATE fv_pedidos SET payload = coalesce(payload,'{}'::jsonb) || ${JSON.stringify({ remitos })}::jsonb WHERE numero=${ref} RETURNING numero`;
      return NextResponse.json({ ok: true, email });
    }
    // REMITO DEL TRANSPORTE (Via Cargo, etc.): se carga el remito del transporte SIN generar el nuestro.
    // Confirma el despacho directamente (no hay remito propio).
    if (b.accion === "remito_externo") {
      if (!esFv) return NextResponse.json({ ok: false, error: "solo FV por ahora" }, { status: 400 });
      const arch = b.archivo || null;
      if (!arch?.b64) return NextResponse.json({ ok: false, error: "Falta el archivo del remito del transporte." }, { status: 400 });
      const validacion = b.validacion && typeof b.validacion === "object" ? b.validacion : null;
      await sql`ALTER TABLE fv_pedidos ADD COLUMN IF NOT EXISTS remito_externo_archivo JSONB`.catch(() => {});
      await sql`ALTER TABLE fv_pedidos ADD COLUMN IF NOT EXISTS remito_externo_archivos JSONB`.catch(() => {});
      const row = (await sql`SELECT remito_externo_archivo, remito_externo_archivos FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
      const arr = normalizarRemitosExt(row);   // migra el single legacy al array
      const id = "r" + Date.now();
      const nuevo = { id, nombre: String(arch.nombre || "remito-transporte").slice(0, 120), tipo: String(arch.tipo || "application/octet-stream").slice(0, 60), b64: String(arch.b64), at: new Date().toISOString(), validacion, enviada_at: null, email: null };
      const full = [...arr, nuevo];
      await sql`UPDATE fv_pedidos SET estado='enviado', remito_externo_archivo=NULL, remito_externo_archivos=${JSON.stringify(full)}::jsonb,
        payload = (coalesce(payload,'{}'::jsonb) - 'remito_externo') || ${JSON.stringify({ remitos_externos: metasRemitosExt(full), despacho_completo: true, despacho_confirmado: true, remito_preparado: true })}::jsonb
        WHERE numero=${ref} RETURNING numero`;
      return NextResponse.json({ ok: true, id });
    }
    // Enviar el remito del transporte por email al cliente.
    if (b.accion === "enviar_remito_externo") {
      if (!esFv) return NextResponse.json({ ok: false, error: "solo FV por ahora" }, { status: 400 });
      const email = String(b.email || "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ ok: false, error: "Email inválido." }, { status: 400 });
      const row = (await sql`SELECT payload, remito_externo_archivo, remito_externo_archivos, factura_numero FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
      const arr = normalizarRemitosExt(row);
      const id = String(b.id || "").trim();
      const conf = (id ? arr.find((x: any) => x.id === id) : arr[0]) || arr[0];
      if (!conf?.b64) return NextResponse.json({ ok: false, error: "No hay remito del transporte cargado." }, { status: 409 });
      const cnombre = (row?.payload?.revendedor?.nombre || row?.payload?.cliente?.nombre || "");
      const b64 = String(conf.b64).split(",").pop() || "";
      const nombreArch = /\.(pdf|jpe?g|png|webp|gif)$/i.test(conf.nombre || "") ? conf.nombre : (conf.nombre || "remito") + (/pdf/i.test(conf.tipo || "") ? ".pdf" : ".jpg");
      const html = `<div style="font-family:'Trebuchet MS',Segoe UI,Verdana,sans-serif;font-size:15px;color:#374151;line-height:1.7">
        <p>Hola${cnombre ? " " + cnombre : ""},</p>
        <p>Te adjuntamos el <b>remito del transporte</b> de tu pedido <b>${ref}</b>, como confirmación del despacho.</p>
        <p>Cualquier consulta, respondé este correo.</p>
        <p style="margin-top:18px;color:#0b3d6b"><b>FEBECOS — Energía Solar</b></p></div>`;
      const r = await callSelector("mail_send_internal", { to: email, subject: `Confirmación de despacho — pedido ${ref}`, html, attachments: [{ filename: nombreArch, content: b64 }] });
      if (!r?.ok) return NextResponse.json({ ok: false, error: r?.error || "No se pudo enviar el email" }, { status: 502 });
      const full = arr.map((x: any) => x.id === conf.id ? { ...x, enviada_at: new Date().toISOString(), email } : x);
      await sql`UPDATE fv_pedidos SET remito_externo_archivos=${JSON.stringify(full)}::jsonb,
        payload = (coalesce(payload,'{}'::jsonb) - 'remito_externo') || ${JSON.stringify({ remitos_externos: metasRemitosExt(full) })}::jsonb WHERE numero=${ref} RETURNING numero`;
      return NextResponse.json({ ok: true, email });
    }
    // Quitar el remito del transporte → el pedido vuelve a "pagado" (sin despacho).
    if (b.accion === "eliminar_remito_externo") {
      if (!esFv) return NextResponse.json({ ok: false, error: "solo FV por ahora" }, { status: 400 });
      const row = (await sql`SELECT estado, payload, remito_externo_archivo, remito_externo_archivos FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
      const id = String(b.id || "").trim();
      const arr = normalizarRemitosExt(row);
      const full = id ? arr.filter((x: any) => x.id !== id) : arr.slice(0, -1);   // quita por id (o el último)
      const quedanExternos = full.length > 0;
      const hayRemitos = ((row?.payload || {}).remitos || []).length > 0;
      const nuevoEstado = (row?.estado === "enviado" && !hayRemitos && !quedanExternos) ? "pagado" : row?.estado;
      await sql`UPDATE fv_pedidos SET estado=${nuevoEstado}, remito_externo_archivo=NULL, remito_externo_archivos=${JSON.stringify(full)}::jsonb,
        payload = (coalesce(payload,'{}'::jsonb) - 'remito_externo') || ${JSON.stringify({ remitos_externos: metasRemitosExt(full), despacho_completo: hayRemitos || quedanExternos, despacho_confirmado: quedanExternos })}::jsonb
        WHERE numero=${ref} RETURNING numero`;
      return NextResponse.json({ ok: true });
    }
    // Datos de venta (Condiciones de Venta / Forma de Pago / Lugar de Entrega / Tipo de Transporte) → factura.
    if (b.accion === "datos_venta") {
      const dv = b.datos_venta || {};
      const clean = { validez: String(dv.validez || "").trim(), condiciones_venta: String(dv.condiciones_venta || "").trim(), forma_pago: String(dv.forma_pago || "").trim(), plazo_entrega: String(dv.plazo_entrega || "").trim(), lugar_entrega: String(dv.lugar_entrega || "").trim(), tipo_transporte: String(dv.tipo_transporte || "").trim() };
      if (esFv) await sql`UPDATE fv_pedidos SET payload = jsonb_set(coalesce(payload,'{}'::jsonb), '{datos_venta}', ${JSON.stringify(clean)}::jsonb) WHERE numero=${ref}`;
      return NextResponse.json({ ok: true });
    }
    // Revertir una factura PROFORMA (manual, SIN CAE) → deja el pedido listo para re-facturar electrónica.
    if (b.accion === "revertir_factura") {
      if (!esFv) return NextResponse.json({ ok: false, error: "solo FV por ahora" }, { status: 400 });
      const row = (await sql`SELECT factura_numero, factura_borrador_id FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
      if (!row?.factura_numero) return NextResponse.json({ ok: false, error: "El pedido no tiene factura para revertir." }, { status: 409 });
      const fc = (await sql`SELECT id, afip_cae, estado FROM fg_comprobantes WHERE numero=${row.factura_numero} AND tipo='factura' LIMIT 1` as any[])[0];
      if (!fc) return NextResponse.json({ ok: false, error: "Factura no encontrada." }, { status: 404 });
      if (fc.afip_cae) return NextResponse.json({ ok: false, error: "La factura ya tiene CAE (es fiscal). No se puede revertir: emití una Nota de Crédito." }, { status: 409 });
      // Sin CAE ni cta cte (la proforma no mueve cuenta corriente). Borrar comprobante + ítems y limpiar el pedido.
      await sql`DELETE FROM fg_items WHERE comprobante_id=${fc.id}`;
      await sql`DELETE FROM fg_comprobantes WHERE id=${fc.id}`;
      await sql`UPDATE fv_pedidos SET factura_numero=NULL, factura_token=NULL, factura_estado=NULL, factura_borrador_id=NULL WHERE numero=${ref} RETURNING numero`;
      return NextResponse.json({ ok: true });
    }
    // Mail al proveedor: reusa el endpoint del admin (genera Excel "Pedido GSA" + email). 1 llamada por proveedor.
    if (b.accion === "proveedor") {
      const internal = process.env.INTERNAL_SERVICE_SECRET;
      const fvTok = process.env.FV_ADMIN_TOKEN;
      if (!internal && !fvTok) return NextResponse.json({ ok: false, error: "Falta INTERNAL_SERVICE_SECRET en el servidor de gestión" }, { status: 500 });
      if (!b.proveedor || !b.email_destinatario || !b.items?.length) return NextResponse.json({ ok: false, error: "proveedor, email e ítems requeridos" }, { status: 400 });
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (internal) headers["Authorization"] = "Bearer " + internal;
      else headers["X-Admin-Token"] = fvTok!;
      const r = await fetch("https://febecos.com/api/admin?action=pedido-proveedor", {
        method: "POST", headers,
        body: JSON.stringify({ fv_numero: ref, proveedor: b.proveedor, email_destinatario: b.email_destinatario, mensaje: b.mensaje || "", items: b.items }),
      });
      const d = await r.json().catch(() => ({ ok: false, error: "respuesta no-JSON del admin" }));
      return NextResponse.json(d, { status: r.ok ? 200 : (r.status || 502) });
    }
    // ── REVISIÓN PREVIA (dry-run): calcula TODO lo que se va a facturar (letra, condición IVA del
    //    receptor, neto, IVA por alícuota, total, talonario/PV) SIN emitir CAE ni escribir nada.
    //    Reusa el mismo desglose que la emisión real → los números coinciden exactamente. ──
    if (b.accion === "facturar_preview") {
      if (!esFv) return NextResponse.json({ ok: false, error: "solo FV por ahora" }, { status: 400 });
      const row = (await sql`SELECT payload, proveedor_confirmado, factura_numero, stock_validado FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
      if (!row) return NextResponse.json({ ok: false, error: "pedido no encontrado" }, { status: 404 });
      const pl = row.payload || {}; const items = pl.items || []; const tot = pl.totales || {};
      const rev = pl.revendedor || pl.cliente || {};
      const bloqueos: string[] = [];
      const avisos: string[] = [];
      if (row.factura_numero) avisos.push(`Este pedido ya fue facturado (${row.factura_numero}).`);
      if (!row.stock_validado) bloqueos.push("El stock del pedido no está validado.");
      if (!row.proveedor_confirmado) bloqueos.push("Falta confirmar el stock con el proveedor.");

      // Receptor (revendedor por defecto, o cliente final suyo)
      let revendedor_id: number | null = null;
      if (pl.presupuesto_numero) { const pr = await sql`SELECT cliente_id FROM presupuestos WHERE numero=${pl.presupuesto_numero} LIMIT 1` as any[]; revendedor_id = pr[0]?.cliente_id ?? null; }
      // Pedidos ONLINE (sin presupuesto): el cliente ya se resolvió al confirmar y quedó en payload.cliente_id.
      if (!revendedor_id && pl.cliente_id) revendedor_id = Number(pl.cliente_id) || null;
      let receptorFinalId = Number(b.receptor_cliente_id) || 0;
      // Auto-detección (pedido de Guille, caso Aibal/Daniel Rusch): si se cotizó DIRECTO a un cliente
      // final que en el CRM ya pertenece a un revendedor (revendedor_padre_id), la comisión tiene que
      // ir al revendedor real — no perderse porque no se pasó por su sesión de cotización. Solo si no
      // se eligió un receptor a mano (b.receptor_cliente_id manda si vino explícito).
      if (!receptorFinalId && revendedor_id) {
        const rp = (await sql`SELECT revendedor_padre_id FROM clientes WHERE id=${revendedor_id} LIMIT 1` as any[])[0];
        if (rp?.revendedor_padre_id) { receptorFinalId = revendedor_id; revendedor_id = rp.revendedor_padre_id; }
      }
      let cliente_id: number | null = revendedor_id;
      let receptorNombre: string | null = rev.nombre || null;
      if (receptorFinalId) {
        const cf = await sql`SELECT id, nombre, razon_social, revendedor_padre_id FROM clientes WHERE id=${receptorFinalId} LIMIT 1` as any[];
        if (!cf.length) return NextResponse.json({ ok: false, error: "Cliente final no encontrado." }, { status: 404 });
        cliente_id = receptorFinalId;
        receptorNombre = cf[0].razon_social || cf[0].nombre || receptorNombre;
      }
      let condicion: string | null = null; let clienteCuit: string = receptorFinalId ? "" : (rev.cuit || "");
      if (cliente_id) { const cl = await sql`SELECT condicion_fiscal, cuit, razon_social, nombre FROM clientes WHERE id=${cliente_id} LIMIT 1` as any[]; condicion = cl[0]?.condicion_fiscal || null; clienteCuit = cl[0]?.cuit || clienteCuit; receptorNombre = cl[0]?.razon_social || cl[0]?.nombre || receptorNombre; }

      // ── Auto-carga de condición fiscal desde ARCA (best-effort) si falta ──
      const arca: any = { consultado: false, condicion_fiscal: null, persistida: false, nota: null };
      if (!condicion && clienteCuit && String(clienteCuit).replace(/\D/g, "").length === 11) {
        try {
          const rc = await fetch(`https://febecos.com/api/admin?action=consultar_cuit&cuit=${String(clienteCuit).replace(/\D/g, "")}`, { signal: AbortSignal.timeout(12000) });
          const dc = await rc.json(); arca.consultado = true;
          if (dc?.condicionFiscal) {
            condicion = String(dc.condicionFiscal); arca.condicion_fiscal = condicion;
            if (cliente_id) { await sql`UPDATE clientes SET condicion_fiscal=${condicion} WHERE id=${cliente_id} AND COALESCE(condicion_fiscal,'')=''`.catch(() => {}); arca.persistida = true; }
          } else {
            arca.nota = "ARCA no devolvió la condición IVA (el padrón público no la expone). Cargala a mano en la ficha del cliente.";
          }
        } catch (e: any) { arca.nota = "No se pudo consultar ARCA: " + e.message; }
      }

      const letra = letraFacturaPara(condicion);
      if (!letra) bloqueos.push(condicion ? `La condición fiscal "${condicion}" no mapea a una letra de factura.` : "El receptor no tiene condición fiscal cargada.");
      const condId = condicionIvaReceptorId(condicion);

      // Talonario que correspondería
      const facturaTals = await sql`SELECT id, tipo_codigo, sucursal, defecto FROM fg_talonarios WHERE activo=true AND bloqueado=false AND tipo_codigo IN ('FAA','FAB','FAC','FAM','FAI','FBI','FAE','FEA','FEB','FEC','FEE') ORDER BY defecto DESC, orden, id`.catch(() => []) as any[];
      const letraDe = (tc: string) => tipoPorCodigo(tc)?.letra || "";
      let tal: any = null;
      if (Number(b.talonario_id)) tal = facturaTals.find((x) => x.id === Number(b.talonario_id)) || null;
      if (!tal && letra) tal = facturaTals.find((x) => letraDe(x.tipo_codigo) === letra) || null;
      if (letra && !tal) bloqueos.push(`No hay talonario de Factura ${letra} cargado (Configuración → Talonarios).`);
      const tipoTal = tal ? tipoPorCodigo(tal.tipo_codigo) : null;
      const ptoVta = tal ? (Number(String(tal.sucursal || "1").replace(/\D/g, "")) || 1) : null;

      // Moneda + desglose (mismo helper que la emisión real)
      const facturaMoneda = (b.moneda === "ARS" || b.moneda === "$") ? "ARS" : "USD";
      let tc = 1;
      if (facturaMoneda === "ARS") { tc = Number(b.tc) || 0; if (!tc) { try { const cfg = await sql`SELECT data FROM fv_config WHERE id=1` as any[]; tc = Number(cfg[0]?.data?.dolar) || 0; } catch {} } if (!tc) bloqueos.push("Para facturar en pesos falta el tipo de cambio (TC)."); }
      const conv = (n: any) => facturaMoneda === "ARS" ? Math.round((Number(n) || 0) * (tc || 0)) : +(Number(n) || 0).toFixed(2);
      const esFacturaC = tipoTal?.letra === "C";
      // Presupuestos que guardan SOLO el total (bombas) → derivar neto/IVA del total. Si el total ya
      // está en pesos (arsNativo) la factura ARS NO le re-aplica el TC (conv identidad).
      // ARS nativo: el total ya está en pesos (tc null, moneda ARS) → la factura ARS NO re-aplica el TC.
      const arsNatP = (tot?.tc == null) && (tot?.moneda === "ARS" || tot?.moneda === "$") && Number(tot?.total) > 0;
      // Kit de bomba: neto de paneles (10,5%). Manual (b.split_panel_neto) o leído del presupuesto+catálogo.
      let panelNetoP = Number(b.split_panel_neto) || 0;
      if (!panelNetoP && Number(tot?.total) > 0) panelNetoP = (await netoPanelKit(sql, pl.presupuesto_numero || null, Number(tot.total), pl.items)) || 0;
      let totP: any, convP: (n: any) => number;
      if (panelNetoP > 0 && Number(tot?.total) > 0) {
        const sp = splitPanelResto(Number(tot.total), panelNetoP);
        totP = { ...tot, neto: sp.neto, iva_detalle: sp.iva_detalle };
        convP = (n: any) => Math.round(Number(n) || 0); // split ya en pesos (total del pedido)
      } else {
        const normP = normalizarTotales(tot);
        totP = normP.tot;
        convP = ((arsNatP || normP.arsNativo) && facturaMoneda === "ARS") ? ((n: any) => Math.round(Number(n) || 0)) : conv;
      }
      const des = desglosarFactura({ items, tot: totP, conv: convP, esFacturaC });
      const doc = docTipoReceptor(clienteCuit);
      if (letra === "A" && doc.tipo !== 80) bloqueos.push("Factura A requiere CUIT válido del receptor.");

      // Renglones que saldrán en la factura (para mostrar en la revisión).
      const esPanelIt = (it: any) => { const s = (String(it.codigo || "") + " " + String(it.descripcion || "")).toLowerCase(); if (/soporte|estructura|caja|cable|soga|jabalina|controlador|bomba/.test(s)) return false; return /^pan[-\s]|panel\s*solar|fotovolt|m[oó]dulo\s*solar/.test(s); };
      const detIt = (arr: any[]) => arr.map((it) => `${(it.descripcion || it.codigo || "").trim()} x${it.cantidad || 1}`).join("; ");
      let items_factura: any[];
      if (panelNetoP > 0) {
        const baseP = +(Number(des.ivaArr.find((x) => x.id === 4)?.base) || 0).toFixed(2);
        const baseR = +(Number(des.ivaArr.find((x) => x.id === 5)?.base) || 0).toFixed(2);
        const panels = items.filter(esPanelIt); const resto = items.filter((it: any) => !esPanelIt(it));
        const cantPan = panels.reduce((a: number, it: any) => a + (Number(it.cantidad) || 1), 0) || 1;
        items_factura = [
          { cantidad: cantPan, descripcion: "Paneles solares" + (panels.length ? " — " + detIt(panels) : ""), total: baseP, alic: "10,5%" },
          { cantidad: 1, descripcion: "Bomba, controlador y accesorios — " + detIt(resto), total: baseR, alic: "21%" },
        ];
      } else {
        items_factura = items.map((it: any) => ({ cantidad: it.cantidad || 1, descripcion: it.descripcion || it.codigo || "", total: convP(it.subtotal) }));
      }

      return NextResponse.json({
        ok: true, preview: true, ref,
        receptor: { id: cliente_id, nombre: receptorNombre, cuit: clienteCuit || null, condicion_fiscal: condicion, doc_tipo: doc.tipo, doc_nro: doc.nro, es_cliente_final: !!receptorFinalId },
        arca,
        letra, condicion_iva_receptor_id: condId, condicion_iva_receptor_txt: condicionIvaReceptor(condicion),
        talonario: tal ? { id: tal.id, tipo_codigo: tal.tipo_codigo, letra: tipoTal?.letra || letra, electronica: !!tipoTal?.electronica, punto_venta: ptoVta } : null,
        moneda: facturaMoneda, tc: facturaMoneda === "ARS" ? tc : null,
        montos: { neto: des.neto, iva: des.ivaArr.map((x) => ({ id: x.id, base: x.base, importe: x.importe })), imp_iva: des.impIVA, total: des.total, es_factura_c: esFacturaC },
        items_factura,
        leyendas: leyendasFactura(condicion),
        bloqueos, avisos, puede_facturar: bloqueos.length === 0,
      });
    }

    if (b.accion === "facturar") {
      if (!esFv) return NextResponse.json({ ok: false, error: "solo FV por ahora" }, { status: 400 });
      const row = (await sql`SELECT payload, proveedor_confirmado, factura_numero, factura_token, stock_validado FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
      if (!row) return NextResponse.json({ ok: false, error: "pedido no encontrado" }, { status: 404 });
      if (!row.stock_validado) return NextResponse.json({ ok: false, error: "No se puede facturar: el stock del pedido no está validado. Validá el stock (o pedí override a Guillermo)." }, { status: 409 });
      if (!row.proveedor_confirmado) return NextResponse.json({ ok: false, error: "Confirmá el stock con el proveedor antes de facturar." }, { status: 409 });
      if (row.factura_numero) return NextResponse.json({ ok: true, factura_numero: row.factura_numero, factura_token: row.factura_token, ya: true });

      const pl = row.payload || {}; const items = pl.items || []; const tot = pl.totales || {};
      const rev = pl.revendedor || pl.cliente || {};
      // El presupuesto se cotiza al REVENDEDOR; ese es el revendedor de la operación.
      let revendedor_id: number | null = null;
      if (pl.presupuesto_numero) { const pr = await sql`SELECT cliente_id FROM presupuestos WHERE numero=${pl.presupuesto_numero} LIMIT 1` as any[]; revendedor_id = pr[0]?.cliente_id ?? null; }
      // Pedidos ONLINE (sin presupuesto): el cliente ya se resolvió al confirmar y quedó en payload.cliente_id.
      if (!revendedor_id && pl.cliente_id) revendedor_id = Number(pl.cliente_id) || null;

      // Receptor de la factura: por defecto el revendedor; o un cliente final suyo (b.receptor_cliente_id).
      let receptorFinalId = Number(b.receptor_cliente_id) || 0;
      // Auto-detección (mismo fix que en /facturar): cotizado directo a un cliente final que ya
      // pertenece a un revendedor → la comisión va al revendedor real.
      if (!receptorFinalId && revendedor_id) {
        const rp = (await sql`SELECT revendedor_padre_id FROM clientes WHERE id=${revendedor_id} LIMIT 1` as any[])[0];
        if (rp?.revendedor_padre_id) { receptorFinalId = revendedor_id; revendedor_id = rp.revendedor_padre_id; }
      }
      let cliente_id: number | null = revendedor_id;
      let receptorNombre: string | null = rev.nombre || null;
      if (receptorFinalId) {
        const cf = await sql`SELECT id, nombre, razon_social, revendedor_padre_id FROM clientes WHERE id=${receptorFinalId} LIMIT 1` as any[];
        if (!cf.length) return NextResponse.json({ ok: false, error: "Cliente final no encontrado." }, { status: 404 });
        if (revendedor_id && cf[0].revendedor_padre_id && cf[0].revendedor_padre_id !== revendedor_id) {
          return NextResponse.json({ ok: false, error: "El cliente final no pertenece al revendedor de esta operación." }, { status: 409 });
        }
        cliente_id = receptorFinalId;
        receptorNombre = cf[0].razon_social || cf[0].nombre || receptorNombre;
      }

      // ── Validación AFIP: la letra de factura depende de la condición fiscal del RECEPTOR ──
      let condicion: string | null = null; let clienteCuit: string = receptorFinalId ? "" : (rev.cuit || "");
      if (cliente_id) { const cl = await sql`SELECT condicion_fiscal, cuit FROM clientes WHERE id=${cliente_id} LIMIT 1` as any[]; condicion = cl[0]?.condicion_fiscal || null; clienteCuit = cl[0]?.cuit || clienteCuit; }
      const letraReq = letraFacturaPara(condicion);
      if (!letraReq) return NextResponse.json({ ok: false, error: "El cliente no tiene condición fiscal cargada: no se puede emitir factura. Cargala en la ficha del cliente." }, { status: 409 });

      // Numeración: si se eligió talonario → serie/número Táctica (FA B 0001-00000123).
      // Si no, toma el talonario por defecto DE LA LETRA QUE CORRESPONDE. Fallback: FA-NNNN.
      let talId = Number(b.talonario_id) || 0;
      const facturaTals = await sql`SELECT id, tipo_codigo, defecto FROM fg_talonarios WHERE activo=true AND bloqueado=false AND tipo_codigo IN ('FAA','FAB','FAC','FAM','FAI','FBI','FAE','FEA','FEB','FEC','FEE') ORDER BY defecto DESC, orden, id`.catch(() => []) as any[];
      const letraDe = (tc: string) => tipoPorCodigo(tc)?.letra || "";
      if (talId) {
        // Verificar que el talonario elegido sea de la letra correcta
        const t = facturaTals.find((x) => x.id === talId);
        if (t && letraDe(t.tipo_codigo) !== letraReq) {
          return NextResponse.json({ ok: false, error: `Para este cliente (${condicion}) corresponde Factura ${letraReq}, pero el talonario elegido es ${letraDe(t.tipo_codigo)}.` }, { status: 409 });
        }
      } else {
        const cand = facturaTals.find((x) => letraDe(x.tipo_codigo) === letraReq);
        if (!cand) return NextResponse.json({ ok: false, error: `No hay talonario de Factura ${letraReq} cargado (lo requiere la condición del cliente). Cargalo en Configuración → Talonarios.` }, { status: 409 });
        talId = cand.id;
      }
      // ── Moneda de la factura: USD o ARS (pesos). TC editable al cerrar. ──
      const facturaMoneda = (b.moneda === "ARS" || b.moneda === "$") ? "ARS" : "USD";
      let tc = 1;
      if (facturaMoneda === "ARS") {
        tc = Number(b.tc) || 0;
        if (!tc) { try { const cfg = await sql`SELECT data FROM fv_config WHERE id=1` as any[]; tc = Number(cfg[0]?.data?.dolar) || 0; } catch {} }
        if (!tc) return NextResponse.json({ ok: false, error: "Para facturar en pesos falta el tipo de cambio (TC)." }, { status: 409 });
      }
      const conv = (n: any) => facturaMoneda === "ARS" ? Math.round((Number(n) || 0) * tc) : +(Number(n) || 0).toFixed(2);
      const ivaDetalle = Array.isArray(tot.iva_detalle)
        ? tot.iva_detalle.map((d: any) => ({ ...d, monto: conv(d.monto ?? d.importe) }))
        : (tot.iva_detalle && typeof tot.iva_detalle === "object"
            ? Object.fromEntries(Object.entries(tot.iva_detalle).map(([k, v]) => [k, conv(v)]))
            : null);

      // ── ELECTRÓNICA = 2 pasos: (1) "Facturar en gestión" deja un BORRADOR (sin ARCA, sin cta cte)
      //    y (2) "Autorizar y enviar a ARCA" pide el CAE. MANUAL = se finaliza directo (no hay ARCA). ──
      const tipoTal = tipoPorCodigo((facturaTals.find((x) => x.id === talId) || {}).tipo_codigo || "");
      const esElectronica = !!tipoTal?.electronica;
      const letraFac: string | null = tipoTal?.letra || letraReq || null;
      const pref = tipoTal?.grupo === "nc" ? "NC" : tipoTal?.grupo === "nd" ? "ND" : "FA";
      // ── TOTAL CANÓNICO: neto + IVA (NUNCA el tot.total redondeado del cotizador). Mismo desglose
      //    que el dry-run "revisar" → presupuesto == revisar == factura == cta cte, al peso. ──
      const esFacturaC = tipoTal?.letra === "C";
      // Presupuestos con SOLO total (bombas): derivar neto/IVA del total acordado (lo preserva).
      const arsNatF = (tot?.tc == null) && (tot?.moneda === "ARS" || tot?.moneda === "$") && Number(tot?.total) > 0;
      // Kit de bomba: neto paneles (10,5%) manual o leído del presupuesto+catálogo (igual que el preview).
      let panelNetoF = Number(b.split_panel_neto) || 0;
      if (!panelNetoF && Number(tot?.total) > 0) panelNetoF = (await netoPanelKit(sql, pl.presupuesto_numero || null, Number(tot.total), pl.items)) || 0;
      let totF: any, convF: (n: any) => number;
      if (panelNetoF > 0 && Number(tot?.total) > 0) {
        const sp = splitPanelResto(Number(tot.total), panelNetoF);
        totF = { ...tot, neto: sp.neto, iva_detalle: sp.iva_detalle };
        convF = (n: any) => Math.round(Number(n) || 0);
      } else {
        const normF = normalizarTotales(tot);
        totF = normF.tot;
        convF = ((arsNatF || normF.arsNativo) && facturaMoneda === "ARS") ? ((n: any) => Math.round(Number(n) || 0)) : conv;
      }
      const netoUsd = Number(totF.neto ?? totF.total ?? 0);
      const sumIvaUsd = Array.isArray(totF.iva_detalle) ? totF.iva_detalle.reduce((a: number, d: any) => a + (Number(d.monto ?? d.importe) || 0), 0) : 0;
      const totalUsd = esFacturaC ? +netoUsd.toFixed(2) : +(netoUsd + sumIvaUsd).toFixed(2);
      // ARS-NATIVO (presupuesto que guarda SOLO el total en pesos, ej. bombas): totalUsd/netoUsd quedan
      // en PESOS. La cuenta corriente es SIEMPRE en USD → el `debe` debe ir en USD (pesos/TC), NO el
      // monto en pesos (bug: la cta cte mostraba $ = pesos×dólar, inflado ×TC). Para facturas en USD o
      // ARS con presupuesto USD, totalUsd YA es USD → no se convierte.
      const arsNativoF = !!((arsNatF || (normalizarTotales(tot).arsNativo)) && facturaMoneda === "ARS");
      const totalUsdCta = (arsNativoF && tc > 0) ? +(totalUsd / tc).toFixed(2) : totalUsd;
      const netoUsdCta = (arsNativoF && tc > 0) ? +(netoUsd / tc).toFixed(2) : netoUsd;
      const desglose = desglosarFactura({ items, tot: totF, conv: convF, esFacturaC });
      // IVA a GUARDAR = el del desglose (consistente con neto/total de la factura), NO el del
      // presupuesto. Si no, el PDF mostraría un IVA que no cierra con el total (subtotal+IVA≠total).
      const ID2PCT: Record<number, number> = { 3: 0, 4: 10.5, 5: 21, 6: 27, 8: 5, 9: 2.5 };
      const ivaDetalleStore = desglose.ivaArr.map((x) => ({ pct: ID2PCT[x.id] ?? 0, base: x.base, monto: x.importe }));
      const leyendas = leyendasFactura(condicion);
      const condRecept = condicionIvaReceptor(condicion);
      const dvp = pl.datos_venta || {}; const cond = pl.condiciones || {};
      const dvF = {
        condiciones_venta: dvp.condiciones_venta || cond.pago || null,
        forma_pago: dvp.forma_pago || cond.forma || null,
        lugar_entrega: dvp.lugar_entrega || cond.lugar || null,
        tipo_transporte: dvp.tipo_transporte || null,
      };
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS vendedor TEXT`.catch(() => {});
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS talonario_id INT`.catch(() => {});
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS letra TEXT`.catch(() => {});
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS leyendas jsonb`.catch(() => {});
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS condicion_iva_receptor TEXT`.catch(() => {});
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS iva_detalle jsonb`.catch(() => {});
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS tc NUMERIC`.catch(() => {});
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS afip_cae TEXT`.catch(() => {});
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS afip_cae_vto TEXT`.catch(() => {});
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS afip_qr TEXT`.catch(() => {});
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS condiciones_venta TEXT`.catch(() => {});
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS forma_pago TEXT`.catch(() => {});
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS lugar_entrega TEXT`.catch(() => {});
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS tipo_transporte TEXT`.catch(() => {});
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS revendedor_id INTEGER`.catch(() => {});
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS comision_pct NUMERIC`.catch(() => {});
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS comision_monto NUMERIC`.catch(() => {});
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS afip_payload jsonb`.catch(() => {});
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS afip_meta jsonb`.catch(() => {});
      await sql`ALTER TABLE fv_pedidos ADD COLUMN IF NOT EXISTS factura_estado text`.catch(() => {});
      await sql`ALTER TABLE fv_pedidos ADD COLUMN IF NOT EXISTS factura_borrador_id int`.catch(() => {});

      // KIT DE BOMBA con split de paneles: 2 renglones (Paneles 10,5% / Resto 21%) con el detalle de
      // los componentes y cantidades en la descripción, valuados con el neto de cada alícuota.
      // Panel solar real (10,5%): NO confundir con "Soporte para 3 paneles", caja, etc.
      const esPanelItem = (it: any) => { const s = (String(it.codigo || "") + " " + String(it.descripcion || "")).toLowerCase(); if (/soporte|estructura|caja|cable|soga|jabalina|controlador|bomba/.test(s)) return false; return /^pan[-\s]|panel\s*solar|fotovolt|m[oó]dulo\s*solar/.test(s); };
      const detalleItems = (arr: any[]) => arr.map((it) => `${(it.descripcion || it.codigo || "").trim()} x${it.cantidad || 1}`).join("; ");
      const insertItems = async (compId: number) => {
        if (panelNetoF > 0) {
          const baseP = +(Number(desglose.ivaArr.find((x) => x.id === 4)?.base) || 0).toFixed(2); // 10,5%
          const baseR = +(Number(desglose.ivaArr.find((x) => x.id === 5)?.base) || 0).toFixed(2); // 21%
          const panels = items.filter(esPanelItem); const resto = items.filter((it: any) => !esPanelItem(it));
          const cantPan = panels.reduce((a: number, it: any) => a + (Number(it.cantidad) || 1), 0) || 1;
          const descP = "Paneles solares" + (panels.length ? " — " + detalleItems(panels) : "");
          const descR = "Bomba, controlador y accesorios — " + detalleItems(resto);
          await sql`INSERT INTO fg_items (comprobante_id, descripcion, cantidad, precio_unitario, total, orden)
            VALUES (${compId}, ${descP.slice(0, 600)}, ${cantPan}, ${+(baseP / cantPan).toFixed(2)}, ${baseP}, 0)`;
          await sql`INSERT INTO fg_items (comprobante_id, descripcion, cantidad, precio_unitario, total, orden)
            VALUES (${compId}, ${descR.slice(0, 800)}, 1, ${baseR}, ${baseR}, 1)`;
          return;
        }
        let orden = 0;
        for (const it of items) {
          await sql`INSERT INTO fg_items (comprobante_id, descripcion, cantidad, precio_unitario, total, orden)
            VALUES (${compId}, ${(it.descripcion || it.codigo || "").slice(0, 300)}, ${it.cantidad || 1}, ${conv(it.pvp_sin_iva_usd)}, ${conv(it.subtotal)}, ${orden++})`;
        }
      };

      if (esElectronica) {
        // ── PASO 1: armar el payload AFIP y guardar el BORRADOR (NO se emite, NO mueve cta cte). ──
        const talFull = (await sql`SELECT sucursal FROM fg_talonarios WHERE id=${talId} LIMIT 1` as any[])[0];
        const ptoVta = Number(String(talFull?.sucursal || "1").replace(/\D/g, "")) || 1;
        const cbteTipo = tipoCbteAfip(tipoTal!.grupo, tipoTal!.letra || "");
        if (!cbteTipo) return NextResponse.json({ ok: false, error: "Tipo de comprobante AFIP no mapeado." }, { status: 400 });
        const condId = condicionIvaReceptorId(condicion);
        if (!condId) return NextResponse.json({ ok: false, error: "Condición IVA del receptor no mapeada para AFIP." }, { status: 409 });
        const doc = docTipoReceptor(clienteCuit);
        if (tipoTal!.letra === "A" && doc.tipo !== 80) return NextResponse.json({ ok: false, error: "Factura A requiere CUIT válido del receptor." }, { status: 409 });
        const { neto, ivaArr, impIVA, total } = desglose;
        let monId = "PES", monCotiz = 1, canMis: string | null = null;
        if (facturaMoneda === "USD") { monId = "DOL"; canMis = "S"; try { const cz = await callSelector("wsfe-cotizacion&mon=DOL"); monCotiz = Number(cz?.cotiz) || tc || 1; } catch { monCotiz = tc || 1; } }
        const afipPayload = { ptoVta, cbteTipo, concepto: 1, docTipo: doc.tipo, docNro: doc.nro, neto, iva: ivaArr, impIVA, impTotal: total, monId, monCotiz, canMisMonExt: canMis, condicionIvaReceptorId: condId, esFacturaC };
        const afipMeta = { ref, pref, letraFac, ptoVta, cliente_id, revendedor_id, receptorFinalId, totalUsd, netoUsd, totalUsdCta, netoUsdCta, arsNativo: arsNativoF, facturaMoneda, tc: facturaMoneda === "ARS" ? tc : null };
        const comp = (await sql`
          INSERT INTO fg_comprobantes (tipo, estado, numero, letra, talonario_id, cliente_id, cliente_nombre, revendedor_id, fecha, subtotal, total, moneda, tc, notas, token, leyendas, condicion_iva_receptor, iva_detalle, condiciones_venta, forma_pago, lugar_entrega, tipo_transporte, afip_payload, afip_meta)
          VALUES ('factura','borrador',NULL,${letraFac},${talId || null},${cliente_id},${receptorNombre}, ${revendedor_id}, now(), ${desglose.neto}, ${desglose.total}, ${facturaMoneda}, ${facturaMoneda === "ARS" ? tc : null}, ${"Pedido " + ref}, gen_random_uuid()::text, ${JSON.stringify(leyendas)}::jsonb, ${condRecept || null}, ${ivaDetalleStore.length ? JSON.stringify(ivaDetalleStore) : null}::jsonb, ${dvF.condiciones_venta || null}, ${dvF.forma_pago || null}, ${dvF.lugar_entrega || null}, ${dvF.tipo_transporte || null}, ${JSON.stringify(afipPayload)}::jsonb, ${JSON.stringify(afipMeta)}::jsonb)
          RETURNING id, token` as any[])[0];
        await insertItems(comp.id);
        await sql`UPDATE fv_pedidos SET factura_estado='borrador', factura_borrador_id=${comp.id}, factura_token=${comp.token} WHERE numero=${ref}`;
        return NextResponse.json({ ok: true, borrador: true, comprobante_id: comp.id, factura_token: comp.token, letra: letraFac, punto_venta: ptoVta, moneda: facturaMoneda, montos: { neto, iva: ivaArr.map((x) => ({ id: x.id, base: x.base, importe: x.importe })), imp_iva: impIVA, total } });
      }

      // ── MANUAL (sin ARCA): se finaliza directo (proforma). Mueve cta cte + comisión. ──
      const n = await numeroDesdeTalonario(sql, talId);
      if (!n) return NextResponse.json({ ok: false, error: "talonario inválido" }, { status: 400 });
      const facturaNum = n.numero; const letraM = n.letra || letraFac;
      const { pct: comisionPct, monto: comisionMonto } = await calcComision(sql, revendedor_id, receptorFinalId, totalUsdCta, netoUsdCta);
      const comp = (await sql`
        INSERT INTO fg_comprobantes (tipo, estado, numero, letra, talonario_id, cliente_id, cliente_nombre, revendedor_id, comision_pct, comision_monto, fecha, subtotal, total, moneda, tc, notas, token, leyendas, condicion_iva_receptor, iva_detalle, condiciones_venta, forma_pago, lugar_entrega, tipo_transporte)
        VALUES ('factura','proforma',${facturaNum},${letraM},${talId || null},${cliente_id},${receptorNombre}, ${revendedor_id}, ${comisionPct || null}, ${comisionMonto || null}, now(), ${desglose.neto}, ${desglose.total}, ${facturaMoneda}, ${facturaMoneda === "ARS" ? tc : null}, ${"Pedido " + ref}, gen_random_uuid()::text, ${JSON.stringify(leyendas)}::jsonb, ${condRecept || null}, ${ivaDetalle ? JSON.stringify(ivaDetalle) : null}::jsonb, ${dvF.condiciones_venta || null}, ${dvF.forma_pago || null}, ${dvF.lugar_entrega || null}, ${dvF.tipo_transporte || null})
        RETURNING id, token` as any[])[0];
      await insertItems(comp.id);
      await sql`UPDATE fv_pedidos SET factura_numero=${facturaNum}, factura_token=${comp.token}, factura_estado='emitida' WHERE numero=${ref}`;
      if (cliente_id && totalUsdCta > 0) {
        // La cta cte es USD-base: se debita el total en USD (para ARS-nativo = pesos/TC), no en pesos.
        await movCtaCte(sql, { ambito: "cliente", cliente_id, fecha: hoy(), concepto: "Factura " + facturaNum, comprobante: facturaNum, pedido_ref: ref, debe: totalUsdCta, detalle: { moneda: facturaMoneda, tc: facturaMoneda === "ARS" ? tc : null }, uniq: `fac:${facturaNum}` });
      }
      if (revendedor_id && comisionMonto > 0) {
        await movCtaCte(sql, { ambito: "cliente", cliente_id: revendedor_id, fecha: hoy(), concepto: `Comisión ${comisionPct}% s/ ${facturaNum}${receptorFinalId ? " (venta a cliente)" : ""}`, comprobante: facturaNum, pedido_ref: ref, haber: comisionMonto, detalle: { tipo: "comision_revendedor", pct: comisionPct, factura: facturaNum }, uniq: `com:${facturaNum}` });
      }
      await emitEvento(sql, { tipo: "factura.emitida", entidad: "factura", entidadId: facturaNum,
        payload: { pedido_ref: ref, total_usd: totalUsd, moneda: facturaMoneda, electronica: false, proforma: true, comision_monto: comisionMonto, comision_pct: comisionPct, revendedor_id, receptor_cliente_id: receptorFinalId || null },
        idempotencyKey: `gestion:factura.emitida:${facturaNum}`, clienteId: cliente_id });
      await marcarCompro(sql, cliente_id);
      await emitEstadoPedido(sql, ref, "facturado");
      return NextResponse.json({ ok: true, factura_numero: facturaNum, factura_token: comp.token, comision_monto: comisionMonto, comision_pct: comisionPct });
    }

    // ── PASO 2: AUTORIZAR Y ENVIAR A ARCA (emite el CAE sobre el borrador del paso 1). ──
    if (b.accion === "autorizar_arca") {
      if (!esFv) return NextResponse.json({ ok: false, error: "solo FV por ahora" }, { status: 400 });
      const fvr = (await sql`SELECT factura_numero, factura_borrador_id FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
      if (!fvr) return NextResponse.json({ ok: false, error: "pedido no encontrado" }, { status: 404 });
      if (fvr.factura_numero) return NextResponse.json({ ok: true, factura_numero: fvr.factura_numero, ya: true });
      if (!fvr.factura_borrador_id) return NextResponse.json({ ok: false, error: "No hay un borrador de factura para autorizar. Facturá primero en gestión." }, { status: 409 });
      const cb = (await sql`SELECT id, token, total, moneda, afip_payload, afip_meta, estado FROM fg_comprobantes WHERE id=${fvr.factura_borrador_id} LIMIT 1` as any[])[0];
      if (!cb || cb.estado !== "borrador") return NextResponse.json({ ok: false, error: "El borrador ya no está disponible (¿ya autorizado?)." }, { status: 409 });
      const payload = cb.afip_payload || {}; const meta = cb.afip_meta || {};
      // Cotización del día + fecha (se resuelven al momento real de emitir).
      let monCotiz = Number(payload.monCotiz) || 1;
      if (payload.monId === "DOL") { try { const cz = await callSelector("wsfe-cotizacion&mon=DOL"); monCotiz = Number(cz?.cotiz) || monCotiz; } catch { /* usa la guardada */ } }
      const d = new Date(); const p2 = (n: number) => String(n).padStart(2, "0");
      const yyyymmdd = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
      const fechaISO = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
      let res: any;
      try {
        res = await callSelector("wsfe-emitir", { ...payload, monCotiz, fecha: yyyymmdd, fechaISO });
      } catch (e: any) {
        return NextResponse.json({ ok: false, arca_caida: true, error: "No se pudo conectar con ARCA: " + e.message }, { status: 502 });
      }
      if (!res?.ok) {
        // El borrador queda intacto. Distinguimos:
        //  · CAÍDA (fault / sin afip / red): ARCA no respondió → reintentar más tarde sirve.
        //  · RECHAZO (afip.tipo error|rechazo, con Errores/Observaciones y CÓDIGO): hay un dato a corregir.
        const af = res?.afip || null;
        const caida = !af || af.tipo === "fault";
        return NextResponse.json({
          ok: false,
          arca_caida: caida,
          arca_rechazo: !caida,
          afip: af,                                   // { tipo, errores:[{code,msg}], observaciones:[{code,msg}], resultado }
          errores: af?.errores || [],
          observaciones: af?.observaciones || [],
          error: res?.error || "ARCA no autorizó el comprobante",
        }, { status: 502 });
      }
      const ptoVta = Number(meta.ptoVta) || Number(payload.ptoVta) || 1;
      const facturaNum = `${meta.pref || "FA"} ${meta.letraFac || cb.letra || ""} ${String(ptoVta).padStart(5, "0")}-${String(res.cbteNro).padStart(8, "0")}`.replace(/\s+/g, " ").trim();
      await sql`UPDATE fg_comprobantes SET estado='emitida', numero=${facturaNum}, afip_cae=${res.cae || null}, afip_cae_vto=${res.caeVto || null}, afip_qr=${res.qr || null} WHERE id=${cb.id}`;
      await sql`UPDATE fv_pedidos SET factura_numero=${facturaNum}, factura_estado='emitida' WHERE numero=${ref}`;
      // Recién ahora (CAE válido) se genera la deuda en cta cte y la comisión del revendedor.
      const totalUsd = Number(meta.totalUsd) || 0;
      // Debe/comisión en USD (cta cte es USD-base). Para ARS-nativo (bombas) totalUsd está en PESOS →
      // se usa totalUsdCta/netoUsdCta (= pesos/TC) que guardó afipMeta. Fallback (facturas viejas sin
      // esos campos): si es ARS-nativo con tc, convertir; si no, el totalUsd tal cual.
      const _tcMeta = Number(meta.tc) || 0;
      const totalUsdCta = meta.totalUsdCta != null ? Number(meta.totalUsdCta)
        : (meta.arsNativo && _tcMeta > 0 ? +(totalUsd / _tcMeta).toFixed(2) : totalUsd);
      const netoUsdCta = meta.netoUsdCta != null ? Number(meta.netoUsdCta) : (Number(meta.netoUsd) || totalUsdCta);
      const cliente_id = meta.cliente_id || null; const revendedor_id = meta.revendedor_id || null; const receptorFinalId = Number(meta.receptorFinalId) || 0;
      if (cliente_id && totalUsdCta > 0) {
        await movCtaCte(sql, { ambito: "cliente", cliente_id, fecha: hoy(), concepto: "Factura " + facturaNum, comprobante: facturaNum, pedido_ref: ref, debe: +totalUsdCta.toFixed(2), detalle: { moneda: meta.facturaMoneda || "USD", tc: meta.tc || null }, uniq: `fac:${facturaNum}` });
      }
      const { pct: comisionPct, monto: comisionMonto } = await calcComision(sql, revendedor_id, receptorFinalId, totalUsdCta, netoUsdCta);
      if (revendedor_id && comisionMonto > 0) {
        await sql`UPDATE fg_comprobantes SET comision_pct=${comisionPct}, comision_monto=${comisionMonto} WHERE id=${cb.id}`.catch(() => {});
        await movCtaCte(sql, { ambito: "cliente", cliente_id: revendedor_id, fecha: hoy(), concepto: `Comisión ${comisionPct}% s/ ${facturaNum}${receptorFinalId ? " (venta a cliente)" : ""}`, comprobante: facturaNum, pedido_ref: ref, haber: comisionMonto, detalle: { tipo: "comision_revendedor", pct: comisionPct, factura: facturaNum }, uniq: `com:${facturaNum}` });
      }
      await emitEvento(sql, { tipo: "factura.emitida", entidad: "factura", entidadId: facturaNum,
        payload: { pedido_ref: ref, total_usd: totalUsd, moneda: meta.facturaMoneda || "USD", electronica: true, cae: res.cae || null, comision_monto: comisionMonto, comision_pct: comisionPct, revendedor_id, receptor_cliente_id: receptorFinalId || null },
        idempotencyKey: `gestion:factura.emitida:${facturaNum}`, clienteId: cliente_id });
      await marcarCompro(sql, cliente_id);
      await emitEstadoPedido(sql, ref, "facturado");
      return NextResponse.json({ ok: true, factura_numero: facturaNum, factura_token: cb.token, cae: res.cae, cae_vto: res.caeVto, comision_monto: comisionMonto, comision_pct: comisionPct });
    }
    return NextResponse.json({ ok: false, error: "acción inválida" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
