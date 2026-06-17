import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { movCtaCte, delMov, delMovPrefijo } from "@/lib/ctacte";
import { resolveProveedor } from "@/lib/proveedores";
import { numeroDesdeTalonario, letraFacturaPara, leyendasFactura, condicionIvaReceptor } from "@/lib/talonarios";
import { tipoPorCodigo } from "@/lib/talonarios-tipos";
import { tipoCbteAfip, docTipoReceptor, condicionIvaReceptorId, alicIvaId } from "@/lib/afip-codigos";

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

async function clienteIdDe(sql: any, payload: any): Promise<number | null> {
  const pn = payload?.presupuesto_numero;
  if (!pn) return null;
  const pr = await sql`SELECT cliente_id FROM presupuestos WHERE numero=${pn} LIMIT 1` as any[];
  return pr[0]?.cliente_id ?? null;
}
const hoy = () => new Date().toISOString().slice(0, 10);

// Enriquece los ítems con el `emisor` (Multiradio/Multisolar/Multipoint) buscándolo en
// fg_productos por código. Así un pedido se puede dividir por emisor (proforma/cuenta).
async function enrichEmisor(sql: any, items: any[]): Promise<any[]> {
  if (!Array.isArray(items) || !items.length) return items || [];
  const faltan = items.filter((it) => !it.emisor && it.codigo).map((it) => String(it.codigo));
  if (!faltan.length) return items;
  let map: Record<string, string> = {};
  try {
    const rows = await sql`SELECT codigo, emisor FROM fg_productos WHERE emisor IS NOT NULL AND codigo = ANY(${faltan})` as any[];
    for (const r of rows) map[String(r.codigo)] = r.emisor;
  } catch {}
  return items.map((it) => (it.emisor || !map[String(it.codigo)]) ? it : { ...it, emisor: map[String(it.codigo)] });
}

async function ensureCols(sql: any) {
  await sql`ALTER TABLE fv_pedidos ADD COLUMN IF NOT EXISTS proveedor_confirmado boolean DEFAULT false`.catch(() => {});
  await sql`ALTER TABLE fv_pedidos ADD COLUMN IF NOT EXISTS proveedor_confirmado_at timestamptz`.catch(() => {});
  await sql`ALTER TABLE fv_pedidos ADD COLUMN IF NOT EXISTS proforma_archivo jsonb`.catch(() => {});
  await sql`ALTER TABLE fv_pedidos ADD COLUMN IF NOT EXISTS factura_numero text`.catch(() => {});
  await sql`ALTER TABLE fv_pedidos ADD COLUMN IF NOT EXISTS factura_token text`.catch(() => {});
  await sql`ALTER TABLE fv_pedidos ADD COLUMN IF NOT EXISTS pago_proveedor jsonb`.catch(() => {});
}

// GET /api/pedidos/[ref]  → detalle completo de un pedido (FV: fv_pedidos por numero; bomba: pedidos por id)
export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  try {
    const sql = getDb();
    const ref = decodeURIComponent(params.ref);
    let dolar = 0;
    try { const c = await sql`SELECT data FROM fv_config WHERE id=1`; dolar = Number((c[0] as any)?.data?.dolar) || 0; } catch {}

    await ensureCols(sql);
    const fv = await sql`SELECT numero, estado, public_token, payload, recibido, comprobante_recibido, comprobante_archivo, verificacion_pago, pagos_recibidos, envio_data, metodo_pago, proveedor_confirmado, proveedor_confirmado_at, proforma_archivo, factura_numero, factura_token, pago_proveedor FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[];
    if (fv.length) {
      const p = fv[0];
      // nombre canónico del cliente desde el presupuesto/CRM
      let cliente_id: number | null = null;
      const presupNum = p.payload?.presupuesto_numero;
      if (presupNum) {
        const pr = await sql`SELECT cliente_id FROM presupuestos WHERE numero=${presupNum} LIMIT 1` as any[];
        cliente_id = pr[0]?.cliente_id ?? null;
      }
      // Datos fiscales completos del cliente (para facturar según AFIP)
      let cliente: any = null;
      if (cliente_id) {
        const cl = await sql`SELECT id, tipo, nombre, razon_social, empresa, email, whatsapp, cuit, domicilio, localidad, provincia, cod_postal, condicion_fiscal FROM clientes WHERE id=${cliente_id} LIMIT 1` as any[];
        cliente = cl[0] || null;
      }
      const provSent = await sql`SELECT proveedor, items, total_costo_usd, email_destinatario, gsa_numero, estado, created_at FROM pedidos_proveedores WHERE fv_numero=${ref} ORDER BY created_at`.catch(() => []) as any[];
      const payloadEnriq = p.payload || {};
      payloadEnriq.items = await enrichEmisor(sql, payloadEnriq.items || []);
      return NextResponse.json({ ok: true, pedido: {
        origen: "fv", numero: p.numero, estado: p.estado || "pendiente_confirmacion",
        public_token: p.public_token, payload: payloadEnriq, dolar, fecha: p.recibido, cliente_id, cliente,
        pedidos_proveedor: provSent,
        comprobante_recibido: p.comprobante_recibido, comprobante_archivo: p.comprobante_archivo,
        verificacion_pago: p.verificacion_pago, pagos_recibidos: p.pagos_recibidos || [], envio_data: p.envio_data, metodo_pago: p.metodo_pago,
        proveedor_confirmado: !!p.proveedor_confirmado, proveedor_confirmado_at: p.proveedor_confirmado_at, proforma_archivo: p.proforma_archivo,
        factura_numero: p.factura_numero, factura_token: p.factura_token, pago_proveedor: p.pago_proveedor || null,
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
        else if (b.estado === "cancelado") await sql`UPDATE fv_pedidos SET estado='cancelado', cancelado_at=now() WHERE numero=${ref}`;
        else await sql`UPDATE fv_pedidos SET estado=${b.estado} WHERE numero=${ref}`;
      } else await sql`UPDATE pedidos SET estado=${b.estado} WHERE id::text=${ref} OR numero=${ref}`;

      // Al APROBAR un pedido FV → avisar al cliente para el pago (email vía selector/Resend).
      let aviso_cliente: any = undefined;
      if (b.estado === "aprobado" && esFv && b.avisar !== false) {
        try {
          const row = (await sql`SELECT payload FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
          const pl = row?.payload || {}; const rev = pl.revendedor || pl.cliente || {};
          const email = String(rev.email || "").trim();
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
            const r = await fetch("https://febecos.com/api/admin?action=notificar-pago-cliente", {
              method: "POST", headers,
              body: JSON.stringify({ email, nombre: rev.nombre || "", pedido_numero: ref, total: pl.totales?.total, moneda: pl.totales?.moneda || "USD", link }),
            });
            aviso_cliente = await r.json().catch(() => ({ ok: false, error: "respuesta no-JSON" }));
          }
        } catch (e: any) { aviso_cliente = { ok: false, error: e.message }; }
      }
      return NextResponse.json({ ok: true, estado: b.estado, aviso_cliente });
    }
    if (b.accion === "comprobante") {
      // b.archivos = [{nombre, tipo, b64}]
      if (esFv) await sql`UPDATE fv_pedidos SET comprobante_archivo=${JSON.stringify(b.archivos || [])}::jsonb, comprobante_recibido=true WHERE numero=${ref}`;
      return NextResponse.json({ ok: true });
    }
    if (b.accion === "verificar") {
      // b.pago = { monto, moneda, tc, redondeo, monto_usd, diff_usd, ok, fecha }
      if (esFv) {
        const row = (await sql`SELECT payload FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
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
      }
      return NextResponse.json({ ok: true });
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
    // Datos de venta (Condiciones de Venta / Forma de Pago / Lugar de Entrega / Tipo de Transporte) → factura.
    if (b.accion === "datos_venta") {
      const dv = b.datos_venta || {};
      const clean = { condiciones_venta: String(dv.condiciones_venta || "").trim(), forma_pago: String(dv.forma_pago || "").trim(), lugar_entrega: String(dv.lugar_entrega || "").trim(), tipo_transporte: String(dv.tipo_transporte || "").trim() };
      if (esFv) await sql`UPDATE fv_pedidos SET payload = jsonb_set(coalesce(payload,'{}'::jsonb), '{datos_venta}', ${JSON.stringify(clean)}::jsonb) WHERE numero=${ref}`;
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
    if (b.accion === "facturar") {
      if (!esFv) return NextResponse.json({ ok: false, error: "solo FV por ahora" }, { status: 400 });
      const row = (await sql`SELECT payload, proveedor_confirmado, factura_numero, factura_token FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[])[0];
      if (!row) return NextResponse.json({ ok: false, error: "pedido no encontrado" }, { status: 404 });
      if (!row.proveedor_confirmado) return NextResponse.json({ ok: false, error: "Confirmá el stock con el proveedor antes de facturar." }, { status: 409 });
      if (row.factura_numero) return NextResponse.json({ ok: true, factura_numero: row.factura_numero, factura_token: row.factura_token, ya: true });

      const pl = row.payload || {}; const items = pl.items || []; const tot = pl.totales || {};
      const rev = pl.revendedor || pl.cliente || {};
      let cliente_id: number | null = null;
      if (pl.presupuesto_numero) { const pr = await sql`SELECT cliente_id FROM presupuestos WHERE numero=${pl.presupuesto_numero} LIMIT 1` as any[]; cliente_id = pr[0]?.cliente_id ?? null; }

      // ── Validación AFIP: la letra de factura depende de la condición fiscal del cliente ──
      let condicion: string | null = null; let clienteCuit: string = rev.cuit || "";
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

      // ── Numeración + (si el talonario es ELECTRÓNICO) emisión AFIP/ARCA CAE (WSFEv1) ──
      const tipoTal = tipoPorCodigo((facturaTals.find((x) => x.id === talId) || {}).tipo_codigo || "");
      const esElectronica = !!tipoTal?.electronica;
      let facturaNum: string; let letraFac: string | null = tipoTal?.letra || letraReq || null;
      let afip: any = null;
      if (esElectronica) {
        const talFull = (await sql`SELECT sucursal FROM fg_talonarios WHERE id=${talId} LIMIT 1` as any[])[0];
        const ptoVta = Number(String(talFull?.sucursal || "1").replace(/\D/g, "")) || 1;
        const cbteTipo = tipoCbteAfip(tipoTal!.grupo, tipoTal!.letra || "");
        if (!cbteTipo) return NextResponse.json({ ok: false, error: "Tipo de comprobante AFIP no mapeado." }, { status: 400 });
        const condId = condicionIvaReceptorId(condicion);
        if (!condId) return NextResponse.json({ ok: false, error: "Condición IVA del receptor no mapeada para AFIP." }, { status: 409 });
        const doc = docTipoReceptor(clienteCuit);
        if (tipoTal!.letra === "A" && doc.tipo !== 80) return NextResponse.json({ ok: false, error: "Factura A requiere CUIT válido del receptor." }, { status: 409 });
        const esFacturaC = tipoTal!.letra === "C";
        // Neto declarado a AFIP (ya con descuento general aplicado, si lo hubiera).
        const neto = conv(tot.neto || tot.total || 0);
        // Bases de IVA por alícuota a partir del subtotal por ítem (sin IVA).
        const byPct: Record<string, number> = {};
        for (const it of items) { const pct = String(Number(it.iva_pct ?? 21)); byPct[pct] = (byPct[pct] || 0) + conv(it.subtotal); }
        const pcts = Object.keys(byPct);
        const brutoBases = pcts.reduce((a, p) => a + byPct[p], 0);
        // Si hay descuento general (neto < Σ bases), se prorratea en cada alícuota para que
        // Σ BaseImp == ImpNeto (lo exige AFIP) y el IVA se calcule SOBRE el precio con descuento.
        const factor = brutoBases > 0 ? neto / brutoBases : 1;
        const baseByPct: Record<string, number> = {}; let accBase = 0;
        for (const p of pcts) { const b = +(byPct[p] * factor).toFixed(2); baseByPct[p] = b; accBase += b; }
        // Ajuste de redondeo: el residuo va al bucket de mayor base → Σ base == neto exacto.
        if (pcts.length) { const diff = +(neto - accBase).toFixed(2); if (Math.abs(diff) >= 0.01) { const big = pcts.reduce((a, b) => (baseByPct[b] > baseByPct[a] ? b : a)); baseByPct[big] = +(baseByPct[big] + diff).toFixed(2); } }
        const ivaArr = esFacturaC ? [] : pcts.map((pct) => ({ id: alicIvaId(+pct), base: baseByPct[pct], importe: +(baseByPct[pct] * (+pct) / 100).toFixed(2) }));
        const impIVA = +ivaArr.reduce((a, x) => a + x.importe, 0).toFixed(2);
        // ImpTotal debe ser EXACTAMENTE ImpNeto + ImpIVA (requisito AFIP); no usar tot.total redondeado aparte.
        const total = esFacturaC ? neto : +(neto + impIVA).toFixed(2);
        let monId = "PES", monCotiz = 1, canMis: string | null = null;
        if (facturaMoneda === "USD") { monId = "DOL"; canMis = "S"; try { const cz = await callSelector("wsfe-cotizacion&mon=DOL"); monCotiz = Number(cz?.cotiz) || tc || 1; } catch { monCotiz = tc || 1; } }
        const d = new Date(); const p2 = (n: number) => String(n).padStart(2, "0");
        const yyyymmdd = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
        const fechaISO = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
        const res = await callSelector("wsfe-emitir", { ptoVta, cbteTipo, concepto: 1, docTipo: doc.tipo, docNro: doc.nro, fecha: yyyymmdd, fechaISO, neto, iva: ivaArr, impIVA, impTotal: total, monId, monCotiz, canMisMonExt: canMis, condicionIvaReceptorId: condId, esFacturaC });
        if (!res?.ok) return NextResponse.json({ ok: false, error: "AFIP: " + (res?.error || "no se pudo emitir el CAE") }, { status: 502 });
        afip = res;
        const pref = tipoTal!.grupo === "nc" ? "NC" : tipoTal!.grupo === "nd" ? "ND" : "FA";
        facturaNum = `${pref} ${letraFac} ${String(ptoVta).padStart(5, "0")}-${String(res.cbteNro).padStart(8, "0")}`;
      } else {
        const n = await numeroDesdeTalonario(sql, talId);
        if (!n) return NextResponse.json({ ok: false, error: "talonario inválido" }, { status: 400 });
        facturaNum = n.numero; letraFac = n.letra || null;
      }

      const leyendas = leyendasFactura(condicion);
      const condRecept = condicionIvaReceptor(condicion);
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
      // Datos de venta: lo guardado o, si falta, lo del presupuesto FV (condiciones).
      const dvp = pl.datos_venta || {}; const cond = pl.condiciones || {};
      const dvF = {
        condiciones_venta: dvp.condiciones_venta || cond.pago || null,
        forma_pago: dvp.forma_pago || cond.forma || null,
        lugar_entrega: dvp.lugar_entrega || cond.lugar || null,
        tipo_transporte: dvp.tipo_transporte || null,
      };
      const estadoComp = afip ? "emitida" : "proforma";
      const comp = (await sql`
        INSERT INTO fg_comprobantes (tipo, estado, numero, letra, talonario_id, cliente_id, cliente_nombre, fecha, subtotal, total, moneda, tc, notas, token, leyendas, condicion_iva_receptor, iva_detalle, afip_cae, afip_cae_vto, afip_qr, condiciones_venta, forma_pago, lugar_entrega, tipo_transporte)
        VALUES ('factura',${estadoComp},${facturaNum},${letraFac},${talId || null},${cliente_id},${rev.nombre || null}, now(), ${conv(tot.neto || tot.total || 0)}, ${conv(tot.total || 0)}, ${facturaMoneda}, ${facturaMoneda === "ARS" ? tc : null}, ${"Pedido " + ref}, gen_random_uuid()::text, ${JSON.stringify(leyendas)}::jsonb, ${condRecept || null}, ${ivaDetalle ? JSON.stringify(ivaDetalle) : null}::jsonb, ${afip?.cae || null}, ${afip?.caeVto || null}, ${afip?.qr || null}, ${dvF.condiciones_venta || null}, ${dvF.forma_pago || null}, ${dvF.lugar_entrega || null}, ${dvF.tipo_transporte || null})
        RETURNING id, token` as any[])[0];

      let orden = 0;
      for (const it of items) {
        await sql`INSERT INTO fg_items (comprobante_id, descripcion, cantidad, precio_unitario, total, orden)
          VALUES (${comp.id}, ${(it.descripcion || it.codigo || "").slice(0, 300)}, ${it.cantidad || 1}, ${conv(it.pvp_sin_iva_usd)}, ${conv(it.subtotal)}, ${orden++})`;
      }
      await sql`UPDATE fv_pedidos SET factura_numero=${facturaNum}, factura_token=${comp.token} WHERE numero=${ref}`;
      // Cta cte cliente: la factura genera la deuda (debe).
      if (cliente_id && Number(tot.total) > 0) {
        await movCtaCte(sql, { ambito: "cliente", cliente_id, fecha: hoy(), concepto: "Factura " + facturaNum,
          comprobante: facturaNum, pedido_ref: ref, debe: +Number(tot.total).toFixed(2), uniq: `fac:${facturaNum}` });
      }
      return NextResponse.json({ ok: true, factura_numero: facturaNum, factura_token: comp.token });
    }
    return NextResponse.json({ ok: false, error: "acción inválida" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
