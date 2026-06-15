import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { movCtaCte, delMov, delMovPrefijo } from "@/lib/ctacte";
import { resolveProveedor } from "@/lib/proveedores";

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
      const provSent = await sql`SELECT proveedor, items, total_costo_usd, email_destinatario, gsa_numero, estado, created_at FROM pedidos_proveedores WHERE fv_numero=${ref} ORDER BY created_at`.catch(() => []) as any[];
      const payloadEnriq = p.payload || {};
      payloadEnriq.items = await enrichEmisor(sql, payloadEnriq.items || []);
      return NextResponse.json({ ok: true, pedido: {
        origen: "fv", numero: p.numero, estado: p.estado || "pendiente_confirmacion",
        public_token: p.public_token, payload: payloadEnriq, dolar, fecha: p.recibido, cliente_id,
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
      return NextResponse.json({ ok: true, estado: b.estado });
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

      await sql`CREATE TABLE IF NOT EXISTS fg_counters (clave TEXT PRIMARY KEY, ultimo_numero INT NOT NULL DEFAULT 0)`;
      await sql`INSERT INTO fg_counters (clave, ultimo_numero) VALUES ('FA', 0) ON CONFLICT (clave) DO NOTHING`;
      const nr = await sql`UPDATE fg_counters SET ultimo_numero = ultimo_numero + 1 WHERE clave='FA' RETURNING ultimo_numero` as any[];
      const facturaNum = "FA-" + String(nr[0].ultimo_numero).padStart(6, "0");

      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS vendedor TEXT`.catch(() => {});
      const comp = (await sql`
        INSERT INTO fg_comprobantes (tipo, estado, numero, cliente_id, cliente_nombre, fecha, subtotal, total, moneda, notas, token)
        VALUES ('factura','proforma',${facturaNum},${cliente_id},${rev.nombre || null}, now(), ${tot.neto || tot.total || 0}, ${tot.total || 0}, ${tot.moneda || "USD"}, ${"Pedido " + ref}, gen_random_uuid()::text)
        RETURNING id, token` as any[])[0];

      let orden = 0;
      for (const it of items) {
        await sql`INSERT INTO fg_items (comprobante_id, descripcion, cantidad, precio_unitario, total, orden)
          VALUES (${comp.id}, ${(it.descripcion || it.codigo || "").slice(0, 300)}, ${it.cantidad || 1}, ${it.pvp_sin_iva_usd ?? null}, ${it.subtotal ?? null}, ${orden++})`;
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
