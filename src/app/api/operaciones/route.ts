import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// GET /api/operaciones?estado=&q=
// Cockpit del circuito interno. Lee fg_operaciones (capa de gestión) y ADOPTA
// automáticamente cualquier pedido nuevo (bombas/fv) que no tenga operación.
export async function GET(req: NextRequest) {
  try {
    const sql = getDb();
    const sp = req.nextUrl.searchParams;
    const estado = (sp.get("estado") || "").trim();
    const q = (sp.get("q") || "").trim().toLowerCase();
    const like = `%${q}%`;

    // Vendedor (usuario interno que cotizó) → comisiones
    await sql`ALTER TABLE fg_operaciones ADD COLUMN IF NOT EXISTS vendedor TEXT`.catch(() => {});

    // Auto-adopción de pedidos nuevos (idempotente)
    await sql`
      INSERT INTO fg_operaciones (origen, pedido_ref, numero, cliente_nombre, total, moneda, estado, created_at)
      SELECT 'bomba', p.id::text, p.numero, p.revendedor_nombre, p.precio_final, 'ARS', 'pedido_proveedor', p.created_at
      FROM pedidos p
      WHERE NOT EXISTS (SELECT 1 FROM fg_operaciones o WHERE o.origen='bomba' AND o.pedido_ref=p.id::text)`;
    await sql`
      INSERT INTO fg_operaciones (origen, pedido_ref, numero, cliente_nombre, total, moneda, estado, vendedor, created_at)
      SELECT 'fv', fp.numero, fp.numero,
             COALESCE(fp.payload->'revendedor'->>'nombre', fp.payload->'cliente'->>'nombre'),
             (fp.payload->'totales'->>'total')::numeric, COALESCE(fp.payload->'totales'->>'moneda','USD'),
             'pedido_proveedor',
             (SELECT pr.vendedor FROM presupuestos pr WHERE pr.numero = fp.payload->>'presupuesto_numero' LIMIT 1),
             fp.recibido
      FROM fv_pedidos fp
      WHERE NOT EXISTS (SELECT 1 FROM fg_operaciones o WHERE o.origen='fv' AND o.pedido_ref=fp.numero)`;

    // Backfill de vendedor en operaciones FV ya adoptadas que no lo tienen
    await sql`
      UPDATE fg_operaciones o SET vendedor = pr.vendedor
      FROM fv_pedidos fp, presupuestos pr
      WHERE o.origen='fv' AND coalesce(o.vendedor,'')='' AND o.pedido_ref = fp.numero
        AND pr.numero = fp.payload->>'presupuesto_numero' AND coalesce(pr.vendedor,'') <> ''`.catch(() => {});

    const rows = await sql`
      SELECT id, origen, pedido_ref, numero, cliente_id, cliente_nombre, total, moneda, estado, vendedor,
             proveedor_reservado_at, confirmado_cliente_at, pagado_cliente_at, pagado_proveedor_at,
             facturado_at, factura_numero, notas, created_at
      FROM fg_operaciones
      WHERE (${estado} = '' OR estado = ${estado})
        AND (${q} = '' OR lower(coalesce(numero,'')||' '||coalesce(cliente_nombre,'')) LIKE ${like})
      ORDER BY created_at DESC LIMIT 300`;

    return NextResponse.json({ ok: true, operaciones: rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
