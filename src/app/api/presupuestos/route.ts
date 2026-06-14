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

    const rows = await sql`
      SELECT
        p.id, p.numero, COALESCE(p.tipo,'bomba') AS tipo, p.estado,
        p.cliente_nombre, p.cliente_apellido, p.cliente_cuit, p.cliente_email,
        p.cliente_razon_social, p.cliente_telefono,
        p.bomba_codigo, p.bomba_descripcion,
        p.precio_ofrecido, p.precio_publico, p.descuento_pct, p.tipo_precio,
        p.revendedor_nombre, p.revendedor_email, p.revendedor_token, p.public_token, p.created_at,
        p.cliente_id,
        -- Nombre CANÓNICO: del CRM si está enlazado (fuente única); si no, la copia del presupuesto
        COALESCE(NULLIF(c.razon_social,''), NULLIF(c.nombre,''), NULLIF(p.cliente_razon_social,''),
                 NULLIF(trim(concat_ws(' ', p.cliente_nombre, p.cliente_apellido)),'')) AS cliente_display
      FROM presupuestos p
      LEFT JOIN clientes c ON c.id = p.cliente_id
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

    // Listas para los filtros (distintos, sin filtrar)
    const estados = await sql`SELECT DISTINCT estado FROM presupuestos WHERE coalesce(estado,'') <> '' ORDER BY estado`;
    const vendedores = await sql`SELECT revendedor_nombre, count(*)::int n FROM presupuestos WHERE coalesce(revendedor_nombre,'') <> '' GROUP BY revendedor_nombre ORDER BY n DESC`;

    return NextResponse.json({
      ok: true, presupuestos: rows,
      estados: estados.map((e: any) => e.estado),
      vendedores: vendedores.map((v: any) => v.revendedor_nombre),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
