import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Pool } from "@neondatabase/serverless";
import { tipoCbteAfip, docTipoReceptor, condicionIvaReceptorId, alicIvaId } from "@/lib/afip-codigos";

// Llama al selector (febecos.com/api/admin) con auth interno de servicio.
async function callSelector(action: string, body?: any): Promise<any> {
  const internal = process.env.INTERNAL_SERVICE_SECRET; const fvTok = process.env.FV_ADMIN_TOKEN;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (internal) headers["Authorization"] = "Bearer " + internal; else if (fvTok) headers["X-Admin-Token"] = fvTok;
  const r = await fetch("https://febecos.com/api/admin?action=" + action, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => ({ ok: false, error: "respuesta no-JSON del admin" }));
}

// Datos en vivo: no cachear (Next cachea GET sin request → datos viejos).
export const dynamic = "force-dynamic";

// GET /api/ventas/:id  → comprobante + items + pagos
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    const sql = getDb();
    const comp = await sql`SELECT * FROM fg_comprobantes WHERE id = ${id}`;
    if (!comp.length) return NextResponse.json({ ok: false, error: "no encontrado" }, { status: 404 });
    const items = await sql`SELECT * FROM fg_items WHERE comprobante_id = ${id} ORDER BY orden`;
    const pagos = await sql`SELECT * FROM fg_pagos WHERE comprobante_id = ${id} ORDER BY fecha DESC`;
    // Detalle de la operación (para el panel de la factura): presupuesto, cómo se pagó y si se despachó.
    let detalle: any = null;
    const c = comp[0];
    if (c.tipo === "factura") {
      const ped = (await sql`SELECT numero, estado, payload, pagos_recibidos FROM fv_pedidos WHERE factura_numero=${c.numero} LIMIT 1` as any[])[0];
      if (ped) {
        const pl = ped.payload || {};
        let presupuesto: any = null;
        if (pl.presupuesto_numero) { const pr = (await sql`SELECT numero, public_token FROM presupuestos WHERE numero=${pl.presupuesto_numero} LIMIT 1` as any[])[0]; if (pr) presupuesto = { numero: pr.numero, token: pr.public_token }; }
        const pr2 = (Array.isArray(ped.pagos_recibidos) && ped.pagos_recibidos.length ? ped.pagos_recibidos : (pl.pagos_recibidos || [])) as any[];
        const medios = [...new Set(pr2.map((p) => p.medio).filter(Boolean))];
        const despachado = !!pl.despacho_confirmado || ped.estado === "enviado";
        detalle = {
          pedido_numero: ped.numero, pedido_estado: ped.estado,
          presupuesto,
          factura_proforma: c.estado === "proforma" && !c.afip_cae,
          pago: { pagado: ["pagado", "enviado"].includes(ped.estado) || pr2.length > 0, cantidad: pr2.length, medios },
          despacho: { despachado, remitos: (pl.remitos || []).map((r: any) => r.numero), remito_externo: !!pl.remito_externo, transporte: pl.envio?.empresa || pl.remito_externo?.validacion?.es_remito_transporte ? (pl.envio?.empresa || "transporte") : null },
        };
      }
    }
    return NextResponse.json({ ok: true, comprobante: c, items, pagos, detalle });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// Reglas de la cadena: de qué tipo se puede derivar a cuál.
const DERIVA: Record<string, { tipo: string; estado: string; pref: string; desde: string[]; estado_origen: string }> = {
  confirmar: { tipo: "pedido", estado: "confirmado", pref: "PED", desde: ["presupuesto"], estado_origen: "confirmado" },
  facturar: { tipo: "factura", estado: "proforma", pref: "F", desde: ["pedido"], estado_origen: "facturado" },
  remitir: { tipo: "remito", estado: "emitido", pref: "R", desde: ["pedido", "factura"], estado_origen: "remitido" },
};

// POST /api/ventas/:id  → acciones de la cadena.
// Body: { accion: 'confirmar'|'facturar'|'remitir'|'pagar'|'estado', ... }
//  - confirmar/facturar/remitir: derivan un nuevo comprobante (copian ítems, ref_id + operacion_id heredados)
//  - pagar: registra un pago (fg_pagos) ligado al comprobante y al cliente
//  - estado: cambia el estado del comprobante
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const id = Number(params.id);
    const b = await req.json();
    const client = await pool.connect();
    try {
      if (b.accion === "estado") {
        await client.query(`UPDATE fg_comprobantes SET estado=$1, updated_at=now() WHERE id=$2`, [b.estado, id]);
        return NextResponse.json({ ok: true });
      }

      if (b.accion === "pagar") {
        const monto = Number(b.monto) || 0;
        if (monto <= 0) return NextResponse.json({ ok: false, error: "Monto inválido" }, { status: 400 });
        const c = (await client.query(`SELECT cliente_id FROM fg_comprobantes WHERE id=$1`, [id])).rows[0];
        if (!c) throw new Error("comprobante no encontrado");
        const pago = (await client.query(
          `INSERT INTO fg_pagos (comprobante_id, cliente_id, fecha, monto, medio, notas, created_by)
           VALUES ($1,$2,COALESCE($3,now()),$4,$5,$6,$7) RETURNING id`,
          [id, c.cliente_id || null, b.fecha || null, monto, b.medio || null, b.notas || null, b.created_by || null]
        )).rows[0];
        return NextResponse.json({ ok: true, pago_id: pago.id });
      }

      // ── Nota de Crédito / Débito (sobre una factura con CAE) ──────────────────
      if (b.accion === "nota_credito" || b.accion === "nota_debito") {
        const grupo = b.accion === "nota_credito" ? "nc" : "nd";
        const nombreDoc = grupo === "nc" ? "Nota de Crédito" : "Nota de Débito";
        const sqlx = getDb();
        const f = (await sqlx`SELECT * FROM fg_comprobantes WHERE id=${id}` as any[])[0];
        if (!f) return NextResponse.json({ ok: false, error: "factura no encontrada" }, { status: 404 });
        if (f.tipo !== "factura") return NextResponse.json({ ok: false, error: `Solo se puede emitir ${nombreDoc} sobre una factura.` }, { status: 409 });
        if (!f.afip_cae) return NextResponse.json({ ok: false, error: `Solo se puede emitir ${nombreDoc} electrónica sobre una factura CON CAE (las proforma no son fiscales).` }, { status: 409 });
        const letra = String(f.letra || "").toUpperCase();
        const cbteTipo = tipoCbteAfip(grupo, letra);
        if (!cbteTipo) return NextResponse.json({ ok: false, error: `No hay tipo AFIP para ${nombreDoc} ${letra || "(sin letra)"}.` }, { status: 409 });
        const origCbteTipo = tipoCbteAfip("factura", letra);

        // Punto de venta + número de la factura original (para el comprobante asociado).
        let ptoVta = 0;
        if (f.talonario_id) { const t = (await sqlx`SELECT sucursal, activo, bloqueado FROM fg_talonarios WHERE id=${f.talonario_id}` as any[])[0]; if (t) ptoVta = Number(String(t.sucursal || "").replace(/\D/g, "")) || 0; }
        const m = String(f.numero || "").match(/(\d+)\s*-\s*(\d+)\s*$/);
        if (!ptoVta && m) ptoVta = Number(m[1]) || 0;
        const origNro = m ? Number(m[2]) : 0;
        if (!ptoVta) return NextResponse.json({ ok: false, error: "No se pudo determinar el punto de venta de la factura original (revisá su talonario)." }, { status: 409 });
        if (!origNro) return NextResponse.json({ ok: false, error: "No se pudo determinar el número de la factura original." }, { status: 409 });

        // Receptor
        let cuitCli = f.cliente_cuit || ""; let condFiscal = f.condicion_iva_receptor || "";
        if (f.cliente_id) { const cl = (await sqlx`SELECT cuit, condicion_fiscal FROM clientes WHERE id=${f.cliente_id}` as any[])[0]; if (cl) { cuitCli = cuitCli || cl.cuit || ""; condFiscal = condFiscal || cl.condicion_fiscal || ""; } }
        const condId = condicionIvaReceptorId(condFiscal);
        if (!condId) return NextResponse.json({ ok: false, error: "No se pudo mapear la condición de IVA del receptor (revisá la ficha del cliente)." }, { status: 409 });
        const doc = docTipoReceptor(cuitCli);
        if (letra === "A" && doc.tipo !== 80) return NextResponse.json({ ok: false, error: `${nombreDoc} A requiere CUIT válido del receptor.` }, { status: 409 });

        // Montos: se reflejan EXACTOS de la factura (NC/ND total). IVA discrimina solo A/M.
        const total = Number(f.total) || 0;
        if (total <= 0) return NextResponse.json({ ok: false, error: "La factura no tiene importe válido." }, { status: 409 });
        const idet = f.iva_detalle;
        let ivaRaw: { pct: number; monto: number }[] = [];
        if (Array.isArray(idet)) ivaRaw = idet.map((x: any) => ({ pct: Number(x.pct ?? x.alicuota), monto: Number(x.monto ?? x.importe) }));
        else if (idet && typeof idet === "object") ivaRaw = Object.entries(idet).map(([pct, monto]) => ({ pct: Number(pct), monto: Number(monto) }));
        ivaRaw = ivaRaw.filter((x) => x.monto > 0.009 && (letra === "A" || letra === "M"));
        const ivaTotal = +ivaRaw.reduce((a, x) => a + x.monto, 0).toFixed(2);
        const neto = +(total - ivaTotal).toFixed(2);
        // Bases por alícuota consistentes con el neto (Σ base == neto, exigido por AFIP).
        let acc = 0;
        const ivaArr = ivaRaw.map((x) => { const base = +(x.monto / (x.pct / 100)).toFixed(2); acc += base; return { id: alicIvaId(x.pct), base, importe: +x.monto.toFixed(2) }; });
        if (ivaArr.length) { const diff = +(neto - acc).toFixed(2); if (Math.abs(diff) >= 0.01) { let bi = 0; ivaArr.forEach((a, i) => { if (a.base > ivaArr[bi].base) bi = i; }); ivaArr[bi].base = +(ivaArr[bi].base + diff).toFixed(2); } }

        // Moneda
        let monId = "PES", monCotiz = 1, canMis: string | null = null;
        if (f.moneda === "USD") { monId = "DOL"; canMis = "S"; try { const cz = await callSelector("wsfe-cotizacion&mon=DOL"); monCotiz = Number(cz?.cotiz) || Number(f.tc) || 1; } catch { monCotiz = Number(f.tc) || 1; } }

        // Emisor (para el CUIT del comprobante asociado) + fecha de la factura original
        let emisorCuit = "";
        try { const e = (await sqlx`SELECT cuit FROM fg_empresa WHERE id=1` as any[])[0]; emisorCuit = String(e?.cuit || "").replace(/\D/g, ""); } catch {}
        const d = new Date(); const p2 = (n: number) => String(n).padStart(2, "0");
        const yyyymmdd = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
        const fechaISO = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
        const fo = f.fecha ? new Date(f.fecha) : d;
        const origFecha = `${fo.getFullYear()}${p2(fo.getMonth() + 1)}${p2(fo.getDate())}`;

        const res = await callSelector("wsfe-emitir", {
          ptoVta, cbteTipo, concepto: 1, docTipo: doc.tipo, docNro: doc.nro, fecha: yyyymmdd, fechaISO,
          neto, iva: ivaArr, impIVA: ivaTotal, impTotal: total, monId, monCotiz, canMisMonExt: canMis,
          condicionIvaReceptorId: condId, esFacturaC: letra === "C",
          cbtesAsoc: [{ tipo: origCbteTipo, ptoVta, nro: origNro, cuit: emisorCuit, fecha: origFecha }],
        });
        if (!res?.ok) return NextResponse.json({ ok: false, error: `AFIP rechazó la ${nombreDoc}: ${res?.error || "error"}` }, { status: 502 });

        const numero = `${grupo === "nc" ? "NC" : "ND"} ${letra} ${String(ptoVta).padStart(5, "0")}-${String(res.cbteNro).padStart(8, "0")}`;
        const tipoComp = grupo === "nc" ? "nota_credito" : "nota_debito";
        const opId = f.operacion_id || f.id;
        const leyendas = f.leyendas || [];
        const ins = (await sqlx`
          INSERT INTO fg_comprobantes (tipo, estado, numero, letra, talonario_id, cliente_id, cliente_nombre, cliente_cuit, ref_id, operacion_id, fecha, subtotal, total, moneda, tc, notas, token, leyendas, condicion_iva_receptor, iva_detalle, afip_cae, afip_cae_vto, afip_qr)
          VALUES (${tipoComp}, 'emitida', ${numero}, ${letra}, ${f.talonario_id || null}, ${f.cliente_id || null}, ${f.cliente_nombre || null}, ${cuitCli || null}, ${f.id}, ${opId}, now(), ${neto}, ${total}, ${f.moneda || "ARS"}, ${f.tc || null}, ${(b.motivo ? "Motivo: " + b.motivo + " · " : "") + "Asociada a " + (f.numero || "factura " + f.id)}, gen_random_uuid()::text, ${JSON.stringify(leyendas)}::jsonb, ${condFiscal || null}, ${idet ? JSON.stringify(idet) : null}::jsonb, ${res.cae || null}, ${res.caeVto || null}, ${res.qr || null})
          RETURNING id, token` as any[]);
        const nuevo = ins[0];
        // Copia los ítems de la factura
        await sqlx`INSERT INTO fg_items (comprobante_id, producto_codigo, descripcion, cantidad, precio_unitario, descuento_pct, total, orden)
          SELECT ${nuevo.id}, producto_codigo, descripcion, cantidad, precio_unitario, descuento_pct, total, orden FROM fg_items WHERE comprobante_id=${f.id}`;
        return NextResponse.json({ ok: true, nuevo_id: nuevo.id, numero, token: nuevo.token, cae: res.cae, tipo: tipoComp });
      }

      const regla = DERIVA[b.accion];
      if (!regla) return NextResponse.json({ ok: false, error: "acción inválida" }, { status: 400 });

      await client.query("BEGIN");
      const src = (await client.query(`SELECT * FROM fg_comprobantes WHERE id=$1`, [id])).rows[0];
      if (!src) throw new Error("comprobante no encontrado");
      if (!regla.desde.includes(src.tipo)) throw new Error(`no se puede ${b.accion} un ${src.tipo}`);
      const opId = src.operacion_id || src.id;

      const num = (await client.query(`SELECT COUNT(*)::int n FROM fg_comprobantes WHERE tipo=$1`, [regla.tipo])).rows[0].n + 1;
      const numero = `${regla.pref}-${String(num).padStart(6, "0")}`;
      const nuevo = (await client.query(
        `INSERT INTO fg_comprobantes (tipo, estado, numero, cliente_id, cliente_nombre, cliente_cuit, ref_id, operacion_id, fecha, subtotal, total, notas, condiciones_pago, forma_pago, plazo_entrega, lugar_entrega, created_by)
         SELECT $1,$2,$3, cliente_id, cliente_nombre, cliente_cuit, id, $4, now(), subtotal, total, notas, condiciones_pago, forma_pago, plazo_entrega, lugar_entrega, created_by
         FROM fg_comprobantes WHERE id=$5 RETURNING id`,
        [regla.tipo, regla.estado, numero, opId, id]
      )).rows[0];
      await client.query(
        `INSERT INTO fg_items (comprobante_id, producto_codigo, descripcion, cantidad, precio_unitario, descuento_pct, total, orden)
         SELECT $1, producto_codigo, descripcion, cantidad, precio_unitario, descuento_pct, total, orden FROM fg_items WHERE comprobante_id=$2`,
        [nuevo.id, id]
      );
      await client.query(`UPDATE fg_comprobantes SET token = gen_random_uuid()::text WHERE id=$1 AND token IS NULL`, [nuevo.id]);
      await client.query(`UPDATE fg_comprobantes SET estado=$1, updated_at=now() WHERE id=$2`, [regla.estado_origen, id]);
      await client.query("COMMIT");
      return NextResponse.json({ ok: true, nuevo_id: nuevo.id, numero, tipo: regla.tipo });
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
    finally { client.release(); }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  } finally { await pool.end(); }
}
