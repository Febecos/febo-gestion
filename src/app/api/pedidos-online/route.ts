import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// Bandeja de PEDIDOS ONLINE en Gestión. Lee la tabla `pedidos` (catálogo público del
// selector: MercadoPago / Transferencia / NAVE) directo de la Neon central. NATIVO, aditivo:
// no toca el checkout ni el admin del selector; gestión es un 2º consumidor de lectura.
//
//  GET                      → lista de pedidos online sin tomar por gestión (para la bandeja)
//  GET ?count=1             → { count, max_id } liviano para la ALARMA (polling)
//  POST { id, accion:"confirmar" } → resuelve/crea cliente_id + crea fv_pedido (PED-####)
//                                    + linkea pedidos.gestion_pedido_id  (confirmación MANUAL)
//  POST { id, accion:"ignorar" }   → marca el pedido como visto por gestión sin materializarlo

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

    // Lock anti doble-toma (acordado con DEV Admin): reclamo el pedido con WHERE gestion_tomado_at IS NULL.
    // Si dos confirman a la vez, sólo uno gana. Recién después creo cliente + pedido y completo gestion_pedido_id.
    const claim = await sql`UPDATE pedidos SET gestion_tomado_at = now() WHERE id::text = ${id} AND gestion_tomado_at IS NULL RETURNING id` as any[];
    if (!claim.length) return NextResponse.json({ ok: false, error: "Este pedido ya fue tomado en Gestión." }, { status: 409 });
    try {

    // ── 1. Resolver / crear el cliente en el CRM (dato único por email→whatsapp) ──
    const email = (ped.revendedor_email || "").trim().toLowerCase() || null;
    const wa = digits(ped.whatsapp || ped.notas_cliente);
    let clienteId: number | null = null;
    if (email) {
      const c = (await sql`SELECT id FROM clientes WHERE lower(email) = ${email} AND (crm_eliminado IS NULL OR crm_eliminado = false) LIMIT 1` as any[])[0];
      if (c) clienteId = c.id;
    }
    if (!clienteId && wa) {
      const c = (await sql`SELECT id FROM clientes WHERE whatsapp = ${wa} AND (crm_eliminado IS NULL OR crm_eliminado = false) LIMIT 1` as any[])[0];
      if (c) clienteId = c.id;
    }
    if (!clienteId) {
      const ins = (await sql`
        INSERT INTO clientes (tipo, nombre, email, whatsapp, origen, primer_contacto_at, ultimo_contacto_at)
        VALUES ('cliente_final', ${ped.revendedor_nombre || null}, ${email}, ${wa}, 'pedido_online', now(), now())
        RETURNING id` as any[]);
      clienteId = ins[0].id;
    }

    // ── 2. Crear el PEDIDO en gestión (fv_pedidos) — entra a la cadena de Ventas ──
    const precioFinal = Number(ped.precio_final) || Number(ped.precio_publico) || 0;
    const item = {
      codigo: ped.bomba_codigo || "",
      descripcion: ped.bomba_descripcion || ped.bomba_codigo || "Producto",
      cantidad: 1,
      subtotal: precioFinal,
      pvp_sin_iva_usd: null,
    };
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
      items: [item], totales,
      revendedor: {
        nombre: ped.revendedor_nombre || "", whatsapp: wa || "", email: email || "",
        empresa: "", localidad: "", direccion: "", cuit: "",
      },
      cliente: { nombre: ped.revendedor_nombre || "", email: email || "", cuit: "" },
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
      await sql`INSERT INTO fv_pedidos (numero, recibido, estado, payload)
        VALUES (${pedido_numero}, ${new Date().toISOString()}, ${pagadoOnline ? "pagado" : "pendiente_confirmacion"}, ${JSON.stringify(payload)}::jsonb)`;
    } catch (insErr) {
      await sql`UPDATE pedidos_counter SET ultimo_numero = ultimo_numero - 1 WHERE clave='PED' AND ultimo_numero = ${nro}`.catch(() => {});
      throw insErr;
    }

      // ── 3. Completar el link (el lock gestion_tomado_at ya fue reclamado arriba) ──
      await sql`UPDATE pedidos SET gestion_pedido_id = ${pedido_numero} WHERE id::text = ${id}`;

      return NextResponse.json({ ok: true, pedido_numero, cliente_id: clienteId });
    } catch (e: any) {
      // Falló después de reclamar el lock → lo libero para que se pueda reintentar.
      await sql`UPDATE pedidos SET gestion_tomado_at = NULL WHERE id::text = ${id} AND gestion_pedido_id IS NULL`.catch(() => {});
      return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
