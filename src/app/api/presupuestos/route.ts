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
        (
          SELECT c.id FROM clientes c
          WHERE (coalesce(p.cliente_cuit,'') <> '' AND c.cuit = p.cliente_cuit)
             OR (coalesce(p.cliente_email,'') <> '' AND lower(c.email) = lower(p.cliente_email))
             OR (coalesce(p.cliente_telefono,'') <> '' AND length(regexp_replace(coalesce(c.whatsapp,''),'\D','','g')) >= 8
                 AND right(regexp_replace(c.whatsapp,'\D','','g'),10) = right(regexp_replace(p.cliente_telefono,'\D','','g'),10))
          ORDER BY (c.cuit IS NOT NULL AND c.cuit = p.cliente_cuit) DESC, c.id ASC
          LIMIT 1
        ) AS cliente_id
      FROM presupuestos p
      WHERE (${tipo} = '' OR COALESCE(p.tipo,'bomba') = ${tipo})
        AND (${estado} = '' OR p.estado = ${estado})
        AND (${q} = '' OR lower(
              coalesce(p.numero,'')||' '||coalesce(p.cliente_nombre,'')||' '||coalesce(p.cliente_apellido,'')||' '||
              coalesce(p.cliente_cuit,'')||' '||coalesce(p.cliente_email,'')||' '||coalesce(p.bomba_codigo,'')||' '||
              coalesce(p.revendedor_nombre,'')
            ) LIKE ${like})
      ORDER BY p.created_at DESC
      LIMIT ${limit}`;

    return NextResponse.json({ ok: true, presupuestos: rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
