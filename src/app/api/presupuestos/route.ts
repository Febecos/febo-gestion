import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// GET /api/presupuestos?q=&tipo=&estado=&limit=
// Lee la tabla REAL `presupuestos` (la misma de revendedores/coti): bombas + FV.
// Relaciona con `clientes` por CUIT o email (no hay FK) para poder abrir la ficha.
export async function GET(req: NextRequest) {
  try {
    const sql = getDb();
    const sp = req.nextUrl.searchParams;
    const q = (sp.get("q") || "").trim().toLowerCase();
    const tipo = (sp.get("tipo") || "").trim();   // '', 'fv', 'bomba'
    const estado = (sp.get("estado") || "").trim();
    const vendedor = (sp.get("vendedor") || "").trim();
    const limit = Math.min(500, Number(sp.get("limit")) || 200);
    const like = `%${q}%`;

    // Detalle de ítems de un presupuesto (para el checklist de "Confirmar al cliente").
    const detalle = (sp.get("detalle") || "").trim();
    if (detalle) {
      const dr = (await sql`SELECT numero, cliente_nombre, cliente_apellido, cliente_razon_social, cliente_email, revendedor_email,
        bomba_codigo, bomba_descripcion, fv_items, precio_ofrecido, moneda, tc, public_token, estado, tipo
        FROM presupuestos WHERE numero=${detalle} LIMIT 1` as any[])[0];
      if (!dr) return NextResponse.json({ ok: false, error: "no encontrado" }, { status: 404 });
      const its = Array.isArray(dr.fv_items) && dr.fv_items.length
        ? dr.fv_items.filter((it: any) => !it.es_embalaje).map((it: any) => ({ codigo: it.codigo || "", descripcion: it.descripcion || "", cantidad: it.cantidad || 1 }))
        : (dr.bomba_codigo || dr.bomba_descripcion ? [{ codigo: dr.bomba_codigo || "", descripcion: dr.bomba_descripcion || "", cantidad: 1 }] : []);
      return NextResponse.json({ ok: true, presupuesto: { numero: dr.numero, cliente_nombre: [dr.cliente_nombre, dr.cliente_apellido].filter(Boolean).join(" ") || dr.cliente_razon_social || "", email: dr.cliente_email || dr.revendedor_email || "", precio_ofrecido: dr.precio_ofrecido, moneda: dr.moneda, tc: dr.tc, public_token: dr.public_token, estado: dr.estado, tipo: dr.tipo }, items: its } );
    }

    // Asegurar columnas de vendedor (pueden no existir si aún no se guardó ningún FV)
    await sql`ALTER TABLE presupuestos ADD COLUMN IF NOT EXISTS email_enviado_at TIMESTAMPTZ`.catch(() => {});
    await sql`ALTER TABLE presupuestos ADD COLUMN IF NOT EXISTS vendedor TEXT`.catch(() => {});
    await sql`ALTER TABLE presupuestos ADD COLUMN IF NOT EXISTS vendedor_email TEXT`.catch(() => {});
    await sql`ALTER TABLE presupuestos ADD COLUMN IF NOT EXISTS moneda TEXT`.catch(() => {});
    await sql`ALTER TABLE presupuestos ADD COLUMN IF NOT EXISTS tc NUMERIC`.catch(() => {});

    const rows = await sql`
      SELECT
        p.id, p.numero, COALESCE(p.tipo,'bomba') AS tipo, p.estado,
        p.cliente_nombre, p.cliente_apellido, p.cliente_cuit, p.cliente_email,
        p.cliente_razon_social, p.cliente_telefono,
        p.bomba_codigo, p.bomba_descripcion, p.fv_items,
        p.precio_ofrecido, p.precio_publico, p.descuento_pct, p.tipo_precio, p.moneda, p.tc,
        p.revendedor_nombre, p.revendedor_email, p.revendedor_token, p.public_token, p.created_at,
        p.vendedor, p.vendedor_email, p.email_enviado_at,
        c.id AS cliente_id,
        -- Email CANÓNICO del cliente: el del CRM (fuente única) tiene prioridad sobre la copia plana del presupuesto.
        COALESCE(NULLIF(c.email,''), NULLIF(p.cliente_email,'')) AS cliente_email_crm,
        -- Nombre CANÓNICO: del CRM (enlazado o resuelto por cuit/email/tel); si no, la copia
        COALESCE(NULLIF(c.nombre,''), NULLIF(c.razon_social,''), NULLIF(p.cliente_razon_social,''),
                 NULLIF(trim(concat_ws(' ', p.cliente_nombre, p.cliente_apellido)),'')) AS cliente_display,
        ped.pedido_numero, ped.factura_numero
      FROM presupuestos p
      LEFT JOIN LATERAL (
        SELECT fp.numero AS pedido_numero, op.factura_numero
        FROM fv_pedidos fp
        LEFT JOIN fg_operaciones op ON op.origen = 'fv' AND op.pedido_ref = fp.numero
        WHERE fp.payload->>'presupuesto_numero' = p.numero
          AND COALESCE(fp.estado,'') NOT IN ('anulado','cancelado')
        LIMIT 1
      ) ped ON true
      LEFT JOIN LATERAL (
        SELECT cc.id, cc.nombre, cc.razon_social, cc.email FROM clientes cc
        WHERE (cc.crm_eliminado IS NULL OR cc.crm_eliminado = false) AND (
              cc.id = p.cliente_id
           OR (coalesce(p.cliente_cuit,'') <> '' AND cc.cuit = p.cliente_cuit)
           OR (coalesce(p.cliente_email,'') <> '' AND lower(cc.email) = lower(p.cliente_email))
           OR (coalesce(p.cliente_telefono,'') <> '' AND length(regexp_replace(coalesce(cc.whatsapp,''),'\D','','g')) >= 8
               AND right(regexp_replace(cc.whatsapp,'\D','','g'),10) = right(regexp_replace(p.cliente_telefono,'\D','','g'),10))
           OR (coalesce(p.cliente_razon_social,'') <> '' AND lower(cc.razon_social) = lower(p.cliente_razon_social))
           OR (coalesce(p.cliente_nombre,'') <> '' AND lower(cc.nombre) = lower(p.cliente_nombre)))
        ORDER BY (cc.id = p.cliente_id) DESC, (cc.cuit = p.cliente_cuit) DESC NULLS LAST, cc.id ASC
        LIMIT 1
      ) c ON true
      WHERE (${tipo} = '' OR COALESCE(p.tipo,'bomba') = ${tipo})
        AND (${estado} = '' OR p.estado = ${estado})
        AND (${vendedor} = '' OR p.revendedor_nombre = ${vendedor})
        AND (${q} = '' OR lower(
              coalesce(p.numero,'')||' '||coalesce(p.cliente_nombre,'')||' '||coalesce(p.cliente_apellido,'')||' '||
              coalesce(p.cliente_cuit,'')||' '||coalesce(p.cliente_email,'')||' '||coalesce(p.bomba_codigo,'')||' '||
              coalesce(p.revendedor_nombre,'')
            ) LIKE ${like})
      ORDER BY p.created_at DESC
      LIMIT ${limit}`;

    // ── Presupuestos ROI (simulador) — viven en leads_roi (single source, NO se duplican
    // en presupuestos). LEFT JOIN clientes para no perder los de cliente_id null. ──
    let roiRows: any[] = [];
    if (tipo === "" || tipo === "roi") {
      await sql`ALTER TABLE leads_roi ADD COLUMN IF NOT EXISTS cliente_id INT`.catch(() => {});
      roiRows = await sql`
        SELECT
          ('roi-' || lr.id) AS id,
          COALESCE(lr.tracking_code, 'FBC-' || EXTRACT(YEAR FROM lr.created_at)::text || '-' || LPAD(lr.id::text, 4, '0')) AS numero,
          'roi' AS tipo, COALESCE(lr.estado, 'pendiente') AS estado,
          lr.nombre AS cliente_nombre, NULL AS cliente_apellido, NULL AS cliente_cuit,
          lr.email AS cliente_email, NULL AS cliente_razon_social, lr.telefono AS cliente_telefono,
          lr.pump_codigo AS bomba_codigo, lr.pump_nombre AS bomba_descripcion,
          -- ROI: el monto es la inversión calculada (results.totalInvestment, en $), porque
          -- precio_ofrecido/precio_publico suelen venir null en leads_roi.
          COALESCE(lr.precio_ofrecido, CASE WHEN lr.results->>'totalInvestment' ~ '^[0-9.]+$'
                   THEN ROUND((lr.results->>'totalInvestment')::numeric) END) AS precio_ofrecido,
          lr.precio_publico, lr.descuento_pct,
          NULL AS tipo_precio, NULL AS moneda, NULL AS tc,
          NULL AS revendedor_nombre, NULL AS revendedor_email, NULL AS revendedor_token, NULL AS public_token,
          lr.created_at, NULL AS vendedor, NULL AS vendedor_email,
          c.id AS cliente_id,
          COALESCE(NULLIF(c.email,''), NULLIF(lr.email,'')) AS cliente_email_crm,
          COALESCE(NULLIF(c.nombre,''), NULLIF(c.razon_social,''), NULLIF(lr.nombre,'')) AS cliente_display,
          NULL AS pedido_numero, NULL AS factura_numero
        FROM leads_roi lr
        LEFT JOIN LATERAL (
          SELECT cc.id, cc.nombre, cc.razon_social, cc.email FROM clientes cc
          WHERE (cc.crm_eliminado IS NULL OR cc.crm_eliminado = false) AND (
                cc.id = lr.cliente_id
             OR (lr.cliente_id IS NULL AND coalesce(lr.email,'') <> '' AND lower(cc.email) = lower(lr.email)))
          ORDER BY (cc.id = lr.cliente_id) DESC, cc.id ASC
          LIMIT 1
        ) c ON true
        WHERE COALESCE(lr.estado,'') <> 'prueba'   -- ocultar leads de testing (no se borran, conservan la secuencia FBC)
          AND (${estado} = '' OR COALESCE(lr.estado,'pendiente') = ${estado})
          AND (${vendedor} = '')  -- ROI no tiene vendedor: si se filtra por vendedor, se excluye
          AND (${q} = '' OR lower(coalesce(lr.tracking_code,'')||' '||coalesce(lr.nombre,'')||' '||coalesce(lr.email,'')||' '||coalesce(lr.pump_codigo,'')) LIKE ${like})
        ORDER BY lr.created_at DESC LIMIT ${limit}`.catch(() => []);
    }

    // Unificar presupuestos + ROI y ordenar por fecha
    const todos = [...rows, ...roiRows].sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, limit);

    // ── Marca "pedido a proveedor": cuántos hay y si cubren todos los ítems del presupuesto ──
    try {
      const nums = todos.map((r: any) => r.numero).filter(Boolean);
      if (nums.length) {
        const pp = await sql`SELECT fv_numero, items, estado FROM pedidos_proveedores WHERE fv_numero = ANY(${nums}) AND COALESCE(estado,'') <> 'anulado'` as any[];
        const byNum: Record<string, { n: number; enviados: number; codes: Set<string> }> = {};
        for (const x of pp) {
          const k = x.fv_numero; if (!k) continue;
          (byNum[k] ||= { n: 0, enviados: 0, codes: new Set() });
          byNum[k].n++;
          if (x.estado && x.estado !== "pendiente") byNum[k].enviados++;
          for (const it of (x.items || [])) if (it.codigo) byNum[k].codes.add(it.codigo);
        }
        for (const r of todos) {
          const info = byNum[r.numero];
          if (!info) { r.prov = null; continue; }
          const need = (r.fv_items || []).filter((it: any) => !it.es_embalaje && it.codigo).map((it: any) => it.codigo);
          const completo = need.length ? need.every((c: string) => info.codes.has(c)) : null;
          r.prov = { n: info.n, enviados: info.enviados, completo };
        }
      }
    } catch { /* si falla, no rompe la lista */ }
    for (const r of todos) delete (r as any).fv_items;  // no enviar el detalle pesado al front

    // Listas para los filtros (distintos, sin filtrar)
    const estados = await sql`SELECT DISTINCT estado FROM presupuestos WHERE coalesce(estado,'') <> '' ORDER BY estado`;
    const vendedores = await sql`SELECT revendedor_nombre, count(*)::int n FROM presupuestos WHERE coalesce(revendedor_nombre,'') <> '' GROUP BY revendedor_nombre ORDER BY n DESC`;

    return NextResponse.json({
      ok: true, presupuestos: todos,
      estados: estados.map((e: any) => e.estado),
      vendedores: vendedores.map((v: any) => v.revendedor_nombre),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
