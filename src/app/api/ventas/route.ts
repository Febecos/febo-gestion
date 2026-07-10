import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Pool } from "@neondatabase/serverless";

// GET /api/ventas?tipo=&estado=&q=  → lista de comprobantes
export async function GET(req: NextRequest) {
  try {
    const sql = getDb();
    const sp = req.nextUrl.searchParams;
    const tipo = (sp.get("tipo") || "").trim();
    const estado = (sp.get("estado") || "").trim();
    const q = (sp.get("q") || "").trim().toLowerCase();
    const like = `%${q}%`;
    // Nombre del cliente SIEMPRE desde el CRM (por norma): por cliente_id; si no, la copia guardada.
    const rows = await sql`
      SELECT fc.id, fc.tipo, fc.estado, fc.numero, fc.cliente_id,
             COALESCE(NULLIF(c.nombre,''), NULLIF(c.razon_social,''), fc.cliente_nombre) AS cliente_nombre,
             COALESCE(NULLIF(c.cuit,''), fc.cliente_cuit) AS cliente_cuit,
             fc.ref_id, fc.fecha, fc.total, fc.moneda, fc.token, fc.afip_cae, fc.letra, fc.created_at,
             COALESCE((SELECT json_agg(json_build_object('tipo', n.tipo, 'numero', n.numero, 'token', n.token) ORDER BY n.id)
               FROM fg_comprobantes n WHERE n.operacion_id = fc.id AND n.tipo IN ('nota_credito','nota_debito')), '[]'::json) AS notas
      FROM fg_comprobantes fc
      LEFT JOIN clientes c ON c.id = fc.cliente_id AND (c.crm_eliminado IS NULL OR c.crm_eliminado = false)
      WHERE (${tipo} = '' OR fc.tipo = ANY(string_to_array(${tipo}, ',')))
        AND (${estado} = '' OR fc.estado = ${estado})
        AND (${q} = '' OR lower(coalesce(c.nombre,'')||' '||coalesce(c.razon_social,'')||' '||coalesce(fc.cliente_nombre,'')||' '||coalesce(fc.numero,'')||' '||coalesce(fc.cliente_cuit,'')) LIKE ${like})
      ORDER BY fc.created_at DESC LIMIT 200`;
    return NextResponse.json({ ok: true, comprobantes: rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// POST /api/ventas  → crea un comprobante (default presupuesto) con sus ítems.
// Body: { tipo?, cliente_id, cliente_nombre, cliente_cuit?, fecha?, notas?, condiciones_pago?, items:[{descripcion,cantidad,precio_unitario,descuento_pct}] }
export async function POST(req: NextRequest) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const b = await req.json();
    const items = Array.isArray(b.items) ? b.items : [];
    if (!b.cliente_id && !b.cliente_nombre) return NextResponse.json({ ok: false, error: "Falta el cliente" }, { status: 400 });
    if (!items.length) return NextResponse.json({ ok: false, error: "Agregá al menos un ítem" }, { status: 400 });

    const calcItem = (it: any) => {
      const cant = Number(it.cantidad) || 0, pu = Number(it.precio_unitario) || 0, d = Number(it.descuento_pct) || 0;
      return Math.round(cant * pu * (1 - d / 100) * 100) / 100;
    };
    const subtotal = items.reduce((a: number, it: any) => a + calcItem(it), 0);
    const tipo = b.tipo || "presupuesto";

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // numeración simple por tipo: P-000001 / etc
      const pref = { presupuesto: "P", pedido: "PED", factura: "F", remito: "R" }[tipo as string] || "C";
      const num = (await client.query(`SELECT COUNT(*)::int n FROM fg_comprobantes WHERE tipo=$1`, [tipo])).rows[0].n + 1;
      const numero = `${pref}-${String(num).padStart(6, "0")}`;

      const comp = (await client.query(
        `INSERT INTO fg_comprobantes (tipo, estado, numero, cliente_id, cliente_nombre, cliente_cuit, fecha, subtotal, total, notas, condiciones_pago, forma_pago, plazo_entrega, lugar_entrega, created_by)
         VALUES ($1,'emitido',$2,$3,$4,$5,COALESCE($6,now()),$7,$7,$8,$9,$10,$11,$12,$13) RETURNING id, numero`,
        [tipo, numero, b.cliente_id || null, b.cliente_nombre || null, b.cliente_cuit || null, b.fecha || null, subtotal, b.notas || null, b.condiciones_pago || null, b.forma_pago || null, b.plazo_entrega || null, b.lugar_entrega || null, b.created_by || null]
      )).rows[0];

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        await client.query(
          `INSERT INTO fg_items (comprobante_id, producto_codigo, descripcion, cantidad, precio_unitario, descuento_pct, total, orden)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [comp.id, it.producto_codigo || null, it.descripcion || "", Number(it.cantidad) || 0, Number(it.precio_unitario) || 0, Number(it.descuento_pct) || 0, calcItem(it), i]
        );
      }
      // Comprobante creado directo (presupuesto) = cabeza de su propia operación.
      await client.query(`UPDATE fg_comprobantes SET operacion_id = id, token = COALESCE(token, gen_random_uuid()::text) WHERE id = $1`, [comp.id]);
      await client.query("COMMIT");
      // PROMOCIÓN (plan tipo 'prospecto'): una FACTURA manual directa = compra real → si el cliente era
      // prospecto/contacto, pasa a cliente_final + tag 'compro' (nunca degrada revendedor/proveedor).
      // SOLO para tipo='factura' (un 'presupuesto' NO es compra — es lo que define a un prospecto).
      // Post-COMMIT + best-effort: una falla de la promoción no revierte la factura ya emitida.
      if (tipo === "factura" && b.cliente_id) {
        try {
          await client.query(`UPDATE clientes SET tags = ARRAY(SELECT DISTINCT unnest(COALESCE(tags,'{}'::text[]) || ARRAY['compro'])), updated_at = now() WHERE id = $1 AND tipo <> 'proveedor'`, [b.cliente_id]);
          await client.query(`UPDATE clientes SET tipo = 'cliente_final', updated_at = now() WHERE id = $1 AND tipo IN ('prospecto','contacto')`, [b.cliente_id]);
        } catch (promErr: any) { console.error("[ventas] promoción a cliente_final falló:", promErr.message); }
      }
      return NextResponse.json({ ok: true, id: comp.id, numero: comp.numero });
    } catch (e) { await client.query("ROLLBACK"); throw e; }
    finally { client.release(); }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  } finally { await pool.end(); }
}
