import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { desglosarIva } from "@/lib/factura-calc";
import { numeroDesdeTalonario, letraFacturaPara, leyendasFactura, condicionIvaReceptor } from "@/lib/talonarios";
import { tipoPorCodigo } from "@/lib/talonarios-tipos";
import { tipoCbteAfip, docTipoReceptor, condicionIvaReceptorId } from "@/lib/afip-codigos";
import { movCtaCte } from "@/lib/ctacte";
import { emitEvento } from "@/lib/eventos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── FACTURA EVENTUAL / SUELTA (sin pedido) ──────────────────────────────────
// Se arma 100% con ítems manuales (kit puntual, etc.). Reusa el mismo motor de IVA
// (`desglosarIva`) y el mismo emisor AFIP que el facturar de pedido, pero SIN kit /
// comisión / presupuesto / stock. accion: 'revisar' (dry-run) | 'emitir' | 'autorizar'.
//   item = { descripcion, cantidad, subtotal (NETO sin IVA de la línea), iva_pct }
//   El toggle Neto/Final (deriva neto = final/(1+iva/100)) lo resuelve la UI → acá siempre llega `subtotal` NETO.

const TALS_FACTURA = ["FAA", "FAB", "FAC", "FAM", "FAI", "FBI", "FAE", "FEA", "FEB", "FEC", "FEE"];
const ID2PCT: Record<number, number> = { 3: 0, 4: 10.5, 5: 21, 6: 27, 8: 5, 9: 2.5 };
const hoy = () => new Date().toISOString().slice(0, 10);

async function callSelector(action: string, body?: any): Promise<any> {
  const internal = process.env.INTERNAL_SERVICE_SECRET; const fvTok = process.env.FV_ADMIN_TOKEN;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (internal) headers["Authorization"] = "Bearer " + internal; else if (fvTok) headers["X-Admin-Token"] = fvTok;
  const r = await fetch("https://febecos.com/api/admin?action=" + action, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => ({ ok: false, error: "respuesta no-JSON del admin" }));
}

// Resuelve receptor + talonario + moneda + desglose (compartido por revisar y emitir).
async function preparar(sql: any, b: any): Promise<any> {
  const items = (Array.isArray(b.items) ? b.items : [])
    .map((it: any) => ({ descripcion: String(it.descripcion || "").slice(0, 300), cantidad: Number(it.cantidad) || 1, subtotal: Number(it.subtotal) || 0, iva_pct: Number(it.iva_pct ?? 21) }))
    .filter((it: any) => it.descripcion && it.subtotal > 0);
  if (!items.length) return { error: "Cargá al menos un ítem con descripción y precio.", status: 400 };

  const cid = Number(b.receptor_cliente_id) || 0;
  if (!cid) return { error: "Elegí el cliente receptor de la factura.", status: 400 };
  const cl = (await sql`SELECT id, nombre, razon_social, condicion_fiscal, cuit FROM clientes WHERE id=${cid} LIMIT 1` as any[])[0];
  if (!cl) return { error: "Cliente receptor no encontrado.", status: 404 };
  const condicion = cl.condicion_fiscal || null;
  const letraReq = letraFacturaPara(condicion);
  if (!letraReq) return { error: "El cliente no tiene condición fiscal cargada: no se puede facturar. Cargala en la ficha del cliente.", status: 409 };

  const tals = await sql`SELECT id, tipo_codigo, defecto, sucursal FROM fg_talonarios WHERE activo=true AND bloqueado=false AND tipo_codigo = ANY(${TALS_FACTURA}) ORDER BY defecto DESC, orden, id`.catch(() => []) as any[];
  const letraDe = (tc: string) => tipoPorCodigo(tc)?.letra || "";
  let talId = Number(b.talonario_id) || 0;
  if (talId) {
    const t = tals.find((x) => x.id === talId);
    if (t && letraDe(t.tipo_codigo) !== letraReq) return { error: `Para este cliente (${condicion}) corresponde Factura ${letraReq}, pero el talonario elegido es ${letraDe(t.tipo_codigo)}.`, status: 409 };
  } else {
    const cand = tals.find((x) => letraDe(x.tipo_codigo) === letraReq);
    if (!cand) return { error: `No hay talonario de Factura ${letraReq} cargado (lo requiere la condición del cliente). Cargalo en Configuración → Talonarios.`, status: 409 };
    talId = cand.id;
  }
  const tipoTal = tipoPorCodigo((tals.find((x) => x.id === talId) || {}).tipo_codigo || "");
  const esElectronica = !!tipoTal?.electronica;
  const letraFac = tipoTal?.letra || letraReq;
  const esFacturaC = tipoTal?.letra === "C";
  const pref = tipoTal?.grupo === "nc" ? "NC" : tipoTal?.grupo === "nd" ? "ND" : "FA";

  const facturaMoneda = (b.moneda === "ARS" || b.moneda === "$") ? "ARS" : "USD";
  let tc = 1;
  if (facturaMoneda === "ARS") {
    tc = Number(b.tc) || 0;
    if (!tc) { try { const cfg = await sql`SELECT data FROM fv_config WHERE id=1` as any[]; tc = Number(cfg[0]?.data?.dolar) || 0; } catch {} }
    if (!tc) return { error: "Para facturar en pesos falta el tipo de cambio (TC).", status: 409 };
  }
  // La eventual: los ítems ya vienen en la MONEDA de la factura → conv solo redondea (no convierte).
  const conv = facturaMoneda === "ARS" ? (n: any) => Math.round(Number(n) || 0) : (n: any) => +(Number(n) || 0).toFixed(2);
  const netoConv = +items.reduce((a: number, it: any) => a + conv(it.subtotal), 0).toFixed(2);
  const desglose = desglosarIva({ items, conv, netoConv, esFacturaC });
  const ivaDetalleStore = desglose.ivaArr.map((x) => ({ pct: ID2PCT[x.id] ?? 0, base: x.base, monto: x.importe }));

  return {
    cl, condicion, letraReq, talId, tipoTal, esElectronica, letraFac, esFacturaC, pref,
    facturaMoneda, tc, conv, desglose, ivaDetalleStore, items,
    receptorNombre: cl.razon_social || cl.nombre || null, cliente_id: cid, clienteCuit: cl.cuit || "",
  };
}

async function insertItems(sql: any, compId: number, items: any[], conv: (n: any) => number) {
  let orden = 0;
  for (const it of items) {
    const total = conv(it.subtotal); const cant = Number(it.cantidad) || 1;
    await sql`INSERT INTO fg_items (comprobante_id, descripcion, cantidad, precio_unitario, total, orden)
      VALUES (${compId}, ${String(it.descripcion || "").slice(0, 300)}, ${cant}, ${+(total / (cant || 1)).toFixed(2)}, ${total}, ${orden++})`;
  }
}

export async function POST(req: NextRequest) {
  try {
    const sql = getDb();
    const b = await req.json();
    const accion = b.accion || "revisar";

    // ── AUTORIZAR (CAE) sobre un borrador eventual, por comprobante_id ──
    if (accion === "autorizar") {
      const compId = Number(b.comprobante_id) || 0;
      if (!compId) return NextResponse.json({ ok: false, error: "Falta comprobante_id." }, { status: 400 });
      const cb = (await sql`SELECT id, letra, estado, cliente_id, moneda, tc, total, afip_payload, afip_meta FROM fg_comprobantes WHERE id=${compId} LIMIT 1` as any[])[0];
      if (!cb) return NextResponse.json({ ok: false, error: "Comprobante no encontrado." }, { status: 404 });
      if (cb.estado !== "borrador") return NextResponse.json({ ok: false, error: "El borrador ya no está disponible (¿ya autorizado?)." }, { status: 409 });
      const payload = cb.afip_payload || {}; const meta = cb.afip_meta || {};
      let monCotiz = Number(payload.monCotiz) || 1;
      if (payload.monId === "DOL") { try { const cz = await callSelector("wsfe-cotizacion&mon=DOL"); monCotiz = Number(cz?.cotiz) || monCotiz; } catch {} }
      const d = new Date(); const p2 = (n: number) => String(n).padStart(2, "0");
      const yyyymmdd = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
      const fechaISO = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
      let res: any;
      try { res = await callSelector("wsfe-emitir", { ...payload, monCotiz, fecha: yyyymmdd, fechaISO }); }
      catch (e: any) { return NextResponse.json({ ok: false, arca_caida: true, error: "No se pudo conectar con ARCA: " + e.message }, { status: 502 }); }
      if (!res?.ok) {
        const af = res?.afip || null; const caida = !af || af.tipo === "fault";
        return NextResponse.json({ ok: false, arca_caida: caida, arca_rechazo: !caida, afip: af, errores: af?.errores || [], observaciones: af?.observaciones || [], error: res?.error || "ARCA no autorizó el comprobante" }, { status: 502 });
      }
      const ptoVta = Number(meta.ptoVta) || Number(payload.ptoVta) || 1;
      const facturaNum = `${meta.pref || "FA"} ${meta.letraFac || cb.letra || ""} ${String(ptoVta).padStart(5, "0")}-${String(res.cbteNro).padStart(8, "0")}`.replace(/\s+/g, " ").trim();
      await sql`UPDATE fg_comprobantes SET estado='emitida', numero=${facturaNum}, afip_cae=${res.cae || null}, afip_cae_vto=${res.caeVto || null}, afip_qr=${res.qr || null} WHERE id=${cb.id}`;
      const totalUsd = cb.moneda === "ARS" ? +((Number(cb.total) || 0) / (Number(cb.tc) || 1)).toFixed(2) : +(Number(cb.total) || 0).toFixed(2);
      if (cb.cliente_id && totalUsd > 0) {
        await movCtaCte(sql, { ambito: "cliente", cliente_id: cb.cliente_id, fecha: hoy(), concepto: "Factura " + facturaNum, comprobante: facturaNum, debe: totalUsd, detalle: { moneda: cb.moneda, tc: cb.moneda === "ARS" ? Number(cb.tc) : null, eventual: true }, uniq: `fac:${facturaNum}` });
      }
      await emitEvento(sql, { tipo: "factura.emitida", entidad: "factura", entidadId: facturaNum,
        payload: { eventual: true, total_usd: totalUsd, moneda: cb.moneda, electronica: true, cae: res.cae || null },
        idempotencyKey: `gestion:factura.emitida:${facturaNum}`, clienteId: cb.cliente_id });
      return NextResponse.json({ ok: true, factura_numero: facturaNum, factura_token: undefined, cae: res.cae, cae_vto: res.caeVto });
    }

    // ── REVISAR / EMITIR: preparar el desglose ──
    const P = await preparar(sql, b);
    if (P.error) return NextResponse.json({ ok: false, error: P.error }, { status: P.status });

    if (accion === "revisar") {
      return NextResponse.json({
        ok: true, dry_run: true, letra: P.letraFac, electronica: P.esElectronica, moneda: P.facturaMoneda, tc: P.facturaMoneda === "ARS" ? P.tc : null,
        montos: { neto: P.desglose.neto, iva: P.ivaDetalleStore, imp_iva: P.desglose.impIVA, total: P.desglose.total },
      });
    }

    if (accion === "emitir") {
      const leyendas = leyendasFactura(P.condicion);
      const condRecept = condicionIvaReceptor(P.condicion);
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS afip_payload jsonb`.catch(() => {});
      await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS afip_meta jsonb`.catch(() => {});

      if (P.esElectronica) {
        const talFull = (await sql`SELECT sucursal FROM fg_talonarios WHERE id=${P.talId} LIMIT 1` as any[])[0];
        const ptoVta = Number(String(talFull?.sucursal || "1").replace(/\D/g, "")) || 1;
        const cbteTipo = tipoCbteAfip(P.tipoTal!.grupo, P.tipoTal!.letra || "");
        if (!cbteTipo) return NextResponse.json({ ok: false, error: "Tipo de comprobante AFIP no mapeado." }, { status: 400 });
        const condId = condicionIvaReceptorId(P.condicion);
        if (!condId) return NextResponse.json({ ok: false, error: "Condición IVA del receptor no mapeada para AFIP." }, { status: 409 });
        const doc = docTipoReceptor(P.clienteCuit);
        if (P.tipoTal!.letra === "A" && doc.tipo !== 80) return NextResponse.json({ ok: false, error: "Factura A requiere CUIT válido del receptor." }, { status: 409 });
        const { neto, ivaArr, impIVA, total } = P.desglose;
        let monId = "PES", monCotiz = 1, canMis: string | null = null;
        if (P.facturaMoneda === "USD") { monId = "DOL"; canMis = "S"; try { const cz = await callSelector("wsfe-cotizacion&mon=DOL"); monCotiz = Number(cz?.cotiz) || P.tc || 1; } catch { monCotiz = P.tc || 1; } }
        const afipPayload = { ptoVta, cbteTipo, concepto: 1, docTipo: doc.tipo, docNro: doc.nro, neto, iva: ivaArr, impIVA, impTotal: total, monId, monCotiz, canMisMonExt: canMis, condicionIvaReceptorId: condId, esFacturaC: P.esFacturaC };
        const afipMeta = { eventual: true, pref: P.pref, letraFac: P.letraFac, ptoVta, cliente_id: P.cliente_id, facturaMoneda: P.facturaMoneda, tc: P.facturaMoneda === "ARS" ? P.tc : null };
        const comp = (await sql`
          INSERT INTO fg_comprobantes (tipo, estado, numero, letra, talonario_id, cliente_id, cliente_nombre, fecha, subtotal, total, moneda, tc, notas, token, leyendas, condicion_iva_receptor, iva_detalle, afip_payload, afip_meta)
          VALUES ('factura','borrador',NULL,${P.letraFac},${P.talId || null},${P.cliente_id},${P.receptorNombre}, now(), ${neto}, ${total}, ${P.facturaMoneda}, ${P.facturaMoneda === "ARS" ? P.tc : null}, ${"Factura eventual"}, gen_random_uuid()::text, ${JSON.stringify(leyendas)}::jsonb, ${condRecept || null}, ${P.ivaDetalleStore.length ? JSON.stringify(P.ivaDetalleStore) : null}::jsonb, ${JSON.stringify(afipPayload)}::jsonb, ${JSON.stringify(afipMeta)}::jsonb)
          RETURNING id, token` as any[])[0];
        await insertItems(sql, comp.id, P.items, P.conv);
        return NextResponse.json({ ok: true, borrador: true, comprobante_id: comp.id, factura_token: comp.token, letra: P.letraFac, punto_venta: ptoVta, moneda: P.facturaMoneda, montos: { neto, iva: P.ivaDetalleStore, imp_iva: impIVA, total } });
      }

      // MANUAL (proforma, sin ARCA): se finaliza directo + cta cte.
      const n = await numeroDesdeTalonario(sql, P.talId);
      if (!n) return NextResponse.json({ ok: false, error: "talonario inválido" }, { status: 400 });
      const facturaNum = n.numero; const letraM = n.letra || P.letraFac;
      const totalCur = P.desglose.total;
      const comp = (await sql`
        INSERT INTO fg_comprobantes (tipo, estado, numero, letra, talonario_id, cliente_id, cliente_nombre, fecha, subtotal, total, moneda, tc, notas, token, leyendas, condicion_iva_receptor, iva_detalle)
        VALUES ('factura','proforma',${facturaNum},${letraM},${P.talId || null},${P.cliente_id},${P.receptorNombre}, now(), ${P.desglose.neto}, ${totalCur}, ${P.facturaMoneda}, ${P.facturaMoneda === "ARS" ? P.tc : null}, ${"Factura eventual"}, gen_random_uuid()::text, ${JSON.stringify(leyendasFactura(P.condicion))}::jsonb, ${condicionIvaReceptor(P.condicion) || null}, ${P.ivaDetalleStore.length ? JSON.stringify(P.ivaDetalleStore) : null}::jsonb)
        RETURNING id, token` as any[])[0];
      await insertItems(sql, comp.id, P.items, P.conv);
      const totalUsd = P.facturaMoneda === "ARS" ? +(totalCur / (P.tc || 1)).toFixed(2) : totalCur;
      if (P.cliente_id && totalUsd > 0) {
        await movCtaCte(sql, { ambito: "cliente", cliente_id: P.cliente_id, fecha: hoy(), concepto: "Factura " + facturaNum, comprobante: facturaNum, debe: totalUsd, detalle: { moneda: P.facturaMoneda, tc: P.facturaMoneda === "ARS" ? P.tc : null, eventual: true }, uniq: `fac:${facturaNum}` });
      }
      await emitEvento(sql, { tipo: "factura.emitida", entidad: "factura", entidadId: facturaNum,
        payload: { eventual: true, total_usd: totalUsd, moneda: P.facturaMoneda, electronica: false, proforma: true },
        idempotencyKey: `gestion:factura.emitida:${facturaNum}`, clienteId: P.cliente_id });
      return NextResponse.json({ ok: true, factura_numero: facturaNum, factura_token: comp.token });
    }

    return NextResponse.json({ ok: false, error: "acción inválida" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
