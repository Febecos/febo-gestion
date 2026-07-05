import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { emitEvento } from "@/lib/eventos";
import { validarStock, descontarStock, restituirStock } from "@/lib/stock";

export const runtime = "nodejs";

// Bandeja de PEDIDOS ONLINE en Gestión. Lee la tabla `pedidos` (catálogo público del
// selector: MercadoPago / Transferencia / NAVE) directo de la Neon central. NATIVO, aditivo:
// no toca el checkout ni el admin del selector; gestión es un 2º consumidor de lectura.
//
//  GET                      → lista de pedidos online sin tomar por gestión (para la bandeja)
//  GET ?count=1             → { count, max_id } liviano para la ALARMA (polling)
//  POST { id, accion:"confirmar" } → resuelve/crea cliente_id + crea fv_pedido (PED-####)
//                                    + linkea pedidos.gestion_pedido_id  (confirmación MANUAL)
//                                    + descuenta stock (kit expandido a componentes vía pump_components)
//  POST { id, accion:"ignorar" }   → marca el pedido como visto por gestión sin materializarlo
//  POST { id, accion:"cancelar" }  → estado propio (no "ignorar"): avisa por mail al cliente que el
//                                    pedido no se validó, y devuelve stock si ya se había descontado.
//
// CONTRATO para DEV ADMIN (checkout catálogo, opción C — captura en checkout + link post-pedido):
// si el checkout suma captura de CUIT/condición fiscal, agregar a `pedidos` (ALTER TABLE aditivo,
// mismo patrón que gestion_pedido_id/gestion_tomado_at abajo) estas columnas, TODAS opcionales:
//   cliente_cuit TEXT, cliente_condicion_fiscal TEXT, cliente_razon_social TEXT,
//   cliente_domicilio TEXT, cliente_localidad TEXT, cliente_provincia TEXT, cliente_cod_postal TEXT
// Este archivo ya las consume si están (match por CUIT tiene prioridad sobre email/whatsapp, y se
// usan para crear/completar la ficha CRM) — no hace falta avisar cuando las agreguen, ya funciona.

const digits = (s: any) => String(s || "").replace(/\D/g, "") || null;
const ESTADOS = ["pendiente_aprobacion", "aprobado", "pagado", "revisar_pago"];

// Garantiza las columnas de enlace gestión↔pedido (aditivo/idempotente; ver SPEC para DEV Admin).
async function ensureCols(sql: any) {
  await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS gestion_pedido_id TEXT`.catch(() => {});
  await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS gestion_tomado_at TIMESTAMPTZ`.catch(() => {});
}

export async function GET(req: NextRequest) {
  try {
    const sql = getDb();
    await ensureCols(sql);
    const sp = req.nextUrl.searchParams;

    if (sp.get("id")) {
      // Detalle completo para el modal "Ver" — todas las columnas del pedido online +
      // el cliente CRM si ya matchea por email/whatsapp (fuente única, sin copiar).
      const id = String(sp.get("id")).trim();
      const ped = (await sql`SELECT * FROM pedidos WHERE id::text = ${id} LIMIT 1` as any[])[0];
      if (!ped) return NextResponse.json({ ok: false, error: "pedido no encontrado" }, { status: 404 });
      const email = (ped.revendedor_email || "").trim().toLowerCase() || null;
      const wa = digits(ped.whatsapp || ped.notas_cliente);
      let cliente = null;
      if (email) cliente = (await sql`SELECT id, nombre, email, whatsapp, cuit, condicion_fiscal, domicilio, localidad, provincia FROM clientes WHERE lower(email) = ${email} AND (crm_eliminado IS NULL OR crm_eliminado = false) LIMIT 1` as any[])[0] || null;
      if (!cliente && wa) cliente = (await sql`SELECT id, nombre, email, whatsapp, cuit, condicion_fiscal, domicilio, localidad, provincia FROM clientes WHERE whatsapp = ${wa} AND (crm_eliminado IS NULL OR crm_eliminado = false) LIMIT 1` as any[])[0] || null;
      return NextResponse.json({ ok: true, pedido: ped, cliente });
    }

    if (sp.get("count")) {
      // `id` es UUID → no se puede usar como marca numérica. Watermark por created_at.
      const r = (await sql`
        SELECT COUNT(*)::int AS count, MAX(created_at) AS latest
        FROM pedidos
        WHERE tipo_comprador = 'cliente_final'
          AND COALESCE(estado,'') = ANY(${ESTADOS})
          AND gestion_pedido_id IS NULL` as any[])[0];
      return NextResponse.json({ ok: true, count: r.count, latest: r.latest });
    }

    const rows = (await sql`
      SELECT id, created_at, estado, metodo_pago, tipo_comprador,
             revendedor_nombre AS cliente_nombre, revendedor_email AS cliente_email,
             notas_cliente AS whatsapp, bomba_codigo, bomba_descripcion,
             precio_publico, precio_final, descuento_pct, precio_original, descuento_ars,
             cupon_codigo, mp_payment_id, mp_checkout_url, stock_decrementado,
             utm_source, utm_medium, utm_campaign, lead_id
      FROM pedidos
      WHERE tipo_comprador = 'cliente_final'
        AND COALESCE(estado,'') = ANY(${ESTADOS})
        AND gestion_pedido_id IS NULL
      ORDER BY created_at DESC NULLS LAST, id DESC
      LIMIT 100` as any[]);
    return NextResponse.json({ ok: true, pedidos: rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const sql = getDb();
    await ensureCols(sql);
    const b = await req.json();
    const id = String(b.id || "").trim();   // `id` es UUID
    if (!id) return NextResponse.json({ ok: false, error: "id requerido" }, { status: 400 });

    const ped = (await sql`SELECT * FROM pedidos WHERE id::text = ${id} LIMIT 1` as any[])[0];
    if (!ped) return NextResponse.json({ ok: false, error: "pedido no encontrado" }, { status: 404 });
    if (ped.gestion_pedido_id)
      return NextResponse.json({ ok: false, error: "Este pedido ya fue tomado en Gestión (" + ped.gestion_pedido_id + ")" }, { status: 409 });

    if (b.accion === "ignorar") {
      const r = await sql`UPDATE pedidos SET gestion_pedido_id = 'IGNORADO', gestion_tomado_at = now() WHERE id::text = ${id} AND gestion_tomado_at IS NULL RETURNING id` as any[];
      if (!r.length) return NextResponse.json({ ok: false, error: "Este pedido ya fue tomado en Gestión." }, { status: 409 });
      return NextResponse.json({ ok: true, ignorado: true });
    }

    // "Cancelar" (distinto de "ignorar"): estado propio/auditable + mail al cliente avisando que el
    // pedido NO se validó. En el caso normal el pedido nunca se confirmó → no hay stock que devolver
    // (nunca se descontó). Defensivo: si por una carrera ya quedó vinculado a un fv_pedido, revertimos
    // el stock de ESE pedido antes de cancelar (mismo mecanismo que "cancelado" en Ventas).
    if (b.accion === "cancelar") {
      if (ped.gestion_pedido_id) {
        const fv = (await sql`SELECT payload, stock_validado FROM fv_pedidos WHERE numero=${ped.gestion_pedido_id} LIMIT 1` as any[])[0];
        if (fv?.stock_validado) {
          await restituirStock(sql, fv.payload?.items || [], ped.gestion_pedido_id, "pedidos-online:cancelar").catch(() => {});
          await sql`UPDATE fv_pedidos SET stock_validado=false WHERE numero=${ped.gestion_pedido_id}`.catch(() => {});
        }
        await sql`UPDATE fv_pedidos SET estado='cancelado', cancelado_at=now() WHERE numero=${ped.gestion_pedido_id}`.catch(() => {});
      }
      const r = await sql`UPDATE pedidos SET gestion_pedido_id = 'CANCELADO', gestion_tomado_at = now() WHERE id::text = ${id} AND (gestion_tomado_at IS NULL OR gestion_pedido_id IS NULL) RETURNING id` as any[];
      if (!r.length && !ped.gestion_pedido_id) return NextResponse.json({ ok: false, error: "Este pedido ya fue tomado en Gestión." }, { status: 409 });
      // Aviso al cliente (best-effort, no bloquea la cancelación si el mail falla).
      const emailCancel = (ped.revendedor_email || "").trim().toLowerCase();
      if (emailCancel) {
        const html = `<div style="font-family:'Trebuchet MS',sans-serif;max-width:520px;margin:0 auto">
          <h2 style="color:#0b3d6b">Tu pedido no pudo validarse</h2>
          <p>Hola ${ped.revendedor_nombre || ""},</p>
          <p>Te escribimos para avisarte que tu pedido <b>#${String(ped.id).slice(0, 8)}</b> (${ped.bomba_descripcion || ped.bomba_codigo || "producto"}) no pudo ser validado y quedó cancelado.</p>
          <p>Si ya realizaste el pago, no te preocupes: nadie te va a cobrar por este pedido, o si el cobro ya se hizo se te reintegra. Cualquier duda, respondé este mail o escribinos por WhatsApp.</p>
          <p>Disculpá las molestias.<br/>Equipo FEBECOS</p>
        </div>`;
        await fetch("https://febecos.com/api/admin?action=mail_send_internal", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: emailCancel, subject: "Tu pedido no pudo validarse — FEBECOS", html }),
          signal: AbortSignal.timeout(10000),
        }).catch(() => {});
      }
      return NextResponse.json({ ok: true, cancelado: true });
    }

    // Lock anti doble-toma (acordado con DEV Admin): reclamo el pedido con WHERE gestion_tomado_at IS NULL.
    // Si dos confirman a la vez, sólo uno gana. Recién después creo cliente + pedido y completo gestion_pedido_id.
    const claim = await sql`UPDATE pedidos SET gestion_tomado_at = now() WHERE id::text = ${id} AND gestion_tomado_at IS NULL RETURNING id` as any[];
    if (!claim.length) return NextResponse.json({ ok: false, error: "Este pedido ya fue tomado en Gestión." }, { status: 409 });
    try {

    // ── 1. Resolver / crear el cliente en el CRM (CUIT > email > whatsapp — mismo orden que la
    //      remediación del CRM). El CUIT solo llega si el checkout ya lo captura (contrato p/ ADMIN
    //      arriba); mientras tanto es simplemente undefined y este bloque se comporta como antes. ──
    const cuitPed = digits(ped.cliente_cuit);
    const email = (ped.revendedor_email || "").trim().toLowerCase() || null;
    const wa = digits(ped.whatsapp || ped.notas_cliente);
    let clienteId: number | null = null;
    if (cuitPed) {
      const c = (await sql`SELECT id FROM clientes WHERE cuit = ${cuitPed} AND (crm_eliminado IS NULL OR crm_eliminado = false) LIMIT 1` as any[])[0];
      if (c) clienteId = c.id;
    }
    if (!clienteId && email) {
      const c = (await sql`SELECT id FROM clientes WHERE lower(email) = ${email} AND (crm_eliminado IS NULL OR crm_eliminado = false) LIMIT 1` as any[])[0];
      if (c) clienteId = c.id;
    }
    if (!clienteId && wa) {
      const c = (await sql`SELECT id FROM clientes WHERE whatsapp = ${wa} AND (crm_eliminado IS NULL OR crm_eliminado = false) LIMIT 1` as any[])[0];
      if (c) clienteId = c.id;
    }
    if (!clienteId) {
      const ins = (await sql`
        INSERT INTO clientes (tipo, nombre, email, whatsapp, cuit, condicion_fiscal, razon_social, domicilio, localidad, provincia, cod_postal, origen, primer_contacto_at, ultimo_contacto_at)
        VALUES ('cliente_final', ${ped.revendedor_nombre || null}, ${email}, ${wa}, ${cuitPed}, ${ped.cliente_condicion_fiscal || null}, ${ped.cliente_razon_social || null}, ${ped.cliente_domicilio || null}, ${ped.cliente_localidad || null}, ${ped.cliente_provincia || null}, ${ped.cliente_cod_postal || null}, 'pedido_online', now(), now())
        RETURNING id` as any[]);
      clienteId = ins[0].id;
    } else if (cuitPed) {
      // Cliente ya existía (matcheado por email/whatsapp) pero el checkout trajo datos fiscales que
      // a la ficha le faltaban — completar ADITIVO, nunca pisar un dato ya cargado a mano.
      await sql`UPDATE clientes SET
        cuit = COALESCE(NULLIF(cuit,''), ${cuitPed}),
        condicion_fiscal = COALESCE(NULLIF(condicion_fiscal,''), ${ped.cliente_condicion_fiscal || null}),
        razon_social = COALESCE(NULLIF(razon_social,''), ${ped.cliente_razon_social || null}),
        domicilio = COALESCE(NULLIF(domicilio,''), ${ped.cliente_domicilio || null}),
        localidad = COALESCE(NULLIF(localidad,''), ${ped.cliente_localidad || null}),
        provincia = COALESCE(NULLIF(provincia,''), ${ped.cliente_provincia || null})
        WHERE id = ${clienteId}`.catch(() => {});
    }

    // ── 2. Kit → componentes reales (mismo patrón que confirmar-cliente/route.ts): el bomba_codigo
    //      del catálogo online es un espejo (origen 'pumps'), descontarStock lo excluye a propósito
    //      (bug PED-0038). Sin expandir a componentes, el stock NO baja al confirmar. ──
    const precioFinal = Number(ped.precio_final) || Number(ped.precio_publico) || 0;
    const items: any[] = [{
      codigo: ped.bomba_codigo || "",
      descripcion: ped.bomba_descripcion || ped.bomba_codigo || "Producto",
      cantidad: 1,
      subtotal: precioFinal,
      pvp_sin_iva_usd: null,
    }];
    let kitPendiente = false;
    try {
      const pump = (await sql`SELECT id FROM pumps WHERE regexp_replace(lower(codigo),'[[:space:]]','','g') = regexp_replace(lower(${ped.bomba_codigo || ""}),'[[:space:]]','','g') LIMIT 1` as any[])[0];
      if (pump) {
        const comps = (await sql`SELECT cc.codigo, cc.nombre, cc.unidad, pc.cantidad, cc.precio_usd
          FROM pump_components pc JOIN components cc ON cc.id = pc.component_id
          WHERE pc.pump_id = ${pump.id} AND COALESCE(pc.habilitado_default, true) = true AND COALESCE(pc.opcional, false) = false` as any[]);
        for (const k of comps) {
          items.push({ codigo: k.codigo || "", descripcion: k.nombre || "", cantidad: Number(k.cantidad) || 1, unidad: k.unidad || null, subtotal: 0, costo_usd: Number(k.precio_usd) || 0, kit_reconstruido: true });
        }
      } else {
        kitPendiente = true; // no está en el catálogo de bombas → no se puede expandir el kit
      }
    } catch { kitPendiente = true; }

    // ── 3. Stock: descontar (RESERVA al confirmar, pedido de Guille) — best-effort, nunca bloquea
    //      la confirmación (el pedido online ya está pagado/comprometido, no se puede deshacer solo). ──
    let stockOk = true; let stockWarning: string | null = null;
    if (kitPendiente) {
      stockWarning = "El código " + (ped.bomba_codigo || "") + " no está en el catálogo de bombas (pump_components) — no se pudo descontar stock automático. Descontalo a mano.";
      stockOk = false;
    } else {
      const chk = await validarStock(sql, items).catch(() => ({ ok: true, faltantes: [] as any[] }));
      if (!chk.ok) {
        stockWarning = "Stock insuficiente para: " + chk.faltantes.map((f: any) => `${f.codigo} (pedido ${f.pedido}, hay ${f.stock})`).join(", ") + ". Se confirmó igual (el pedido ya está pagado) — revisar a mano.";
        stockOk = false;
      }
    }

    // ── 4. Crear el PEDIDO en gestión (fv_pedidos) — entra a la cadena de Ventas ──
    // El precio online es FINAL con IVA incluido (ARS). Reflejamos eso en totales.
    const neto = +(precioFinal / 1.21).toFixed(2);
    const ivaMonto = +(precioFinal - neto).toFixed(2);
    const totales = {
      neto, iva: ivaMonto, iva_detalle: [{ pct: 21, monto: ivaMonto }],
      total: +precioFinal.toFixed(2),
      descuento_pct: Number(ped.descuento_pct) || null,
      descuento_monto: Number(ped.descuento_ars) || null,
      moneda: "ARS", tc: null,
    };
    const payload = {
      tipo_origen: "online",
      origen_pedido_id: ped.id,
      metodo_pago: ped.metodo_pago || null,
      estado_pago_online: ped.estado || null,
      mp_payment_id: ped.mp_payment_id || null,
      cupon_codigo: ped.cupon_codigo || null,
      cliente_id: clienteId,
      items, totales,
      revendedor: {
        nombre: ped.revendedor_nombre || "", whatsapp: wa || "", email: email || "",
        empresa: "", localidad: ped.cliente_localidad || "", direccion: ped.cliente_domicilio || "", cuit: cuitPed || "",
      },
      cliente: { nombre: ped.revendedor_nombre || "", email: email || "", cuit: cuitPed || "" },
      condiciones: {}, notas: "Pedido ONLINE #" + ped.id + " · " + (ped.metodo_pago || ""),
      tipo_cliente: "cf",
      utm: { source: ped.utm_source || null, medium: ped.utm_medium || null, campaign: ped.utm_campaign || null },
    };

    await sql`CREATE TABLE IF NOT EXISTS pedidos_counter (clave TEXT PRIMARY KEY, ultimo_numero INT NOT NULL DEFAULT 0)`;
    await sql`INSERT INTO pedidos_counter (clave, ultimo_numero) VALUES ('PED', 0) ON CONFLICT (clave) DO NOTHING`;
    const numRow = await sql`UPDATE pedidos_counter SET ultimo_numero = ultimo_numero + 1 WHERE clave='PED' RETURNING ultimo_numero` as any[];
    const nro = numRow[0].ultimo_numero;
    const pedido_numero = "PED-" + String(nro).padStart(4, "0");
    // Si el pago online ya está confirmado (MP/NAVE), reflejamos pago en el pedido de gestión.
    const pagadoOnline = ped.estado === "pagado";
    try {
      await sql`ALTER TABLE fv_pedidos ADD COLUMN IF NOT EXISTS stock_validado BOOLEAN DEFAULT false`.catch(() => {});
      await sql`ALTER TABLE fv_pedidos ADD COLUMN IF NOT EXISTS stock_validado_at TIMESTAMPTZ`.catch(() => {});
      await sql`ALTER TABLE fv_pedidos ADD COLUMN IF NOT EXISTS stock_override_by TEXT`.catch(() => {});
      await sql`INSERT INTO fv_pedidos (numero, recibido, estado, payload)
        VALUES (${pedido_numero}, ${new Date().toISOString()}, ${pagadoOnline ? "pagado" : "pendiente_confirmacion"}, ${JSON.stringify(payload)}::jsonb)`;
    } catch (insErr) {
      await sql`UPDATE pedidos_counter SET ultimo_numero = ultimo_numero - 1 WHERE clave='PED' AND ultimo_numero = ${nro}`.catch(() => {});
      throw insErr;
    }

      // ── 5. Descontar stock (reserva al confirmar) — best-effort, ya se armó `items` arriba.
      if (!kitPendiente) {
        await descontarStock(sql, items, pedido_numero, "pedidos-online:confirmar").catch((e: any) => { stockWarning = "Error al descontar stock: " + e.message; stockOk = false; });
        await sql`UPDATE fv_pedidos SET stock_validado=true, stock_validado_at=now(), stock_override_by=${!stockOk ? "auto (stock online)" : null} WHERE numero=${pedido_numero}`.catch(() => {});
      }

      // ── 6. Completar el link (el lock gestion_tomado_at ya fue reclamado arriba) ──
      await sql`UPDATE pedidos SET gestion_pedido_id = ${pedido_numero} WHERE id::text = ${id}`;

      // Bus de eventos (C5): pedido online tomado por gestión.
      await emitEvento(sql, { tipo: "pedido.creado", entidad: "pedido", entidadId: pedido_numero,
        payload: { origen: "online", pagado: pagadoOnline, total: payload?.totales?.total ?? null, moneda: payload?.totales?.moneda ?? null, utm: payload?.utm ?? null },
        idempotencyKey: `gestion:pedido.creado:${pedido_numero}`, clienteId: typeof clienteId === "number" ? clienteId : null });

      return NextResponse.json({ ok: true, pedido_numero, cliente_id: clienteId, stock_warning: stockWarning });
    } catch (e: any) {
      // Falló después de reclamar el lock → lo libero para que se pueda reintentar.
      await sql`UPDATE pedidos SET gestion_tomado_at = NULL WHERE id::text = ${id} AND gestion_pedido_id IS NULL`.catch(() => {});
      return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
