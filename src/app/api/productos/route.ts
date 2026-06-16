import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// POST /api/productos  → crea un producto PROPIO (origen='manual'). Los importados
// (pumps/fv) no se crean acá. Body: { codigo, descripcion, categoria, marca, proveedor, precio, iva_pct, stock }
export async function POST(req: NextRequest) {
  try {
    const sql = getDb();
    const b = await req.json();
    if (!b.descripcion || !String(b.descripcion).trim())
      return NextResponse.json({ ok: false, error: "La descripción es obligatoria" }, { status: 400 });
    const ins = await sql`
      INSERT INTO fg_productos (codigo, descripcion, categoria, origen, marca, proveedor, precio, iva_pct, stock, activo)
      VALUES (${b.codigo || null}, ${b.descripcion}, ${b.categoria || "OTROS"}, 'manual', ${b.marca || null}, ${b.proveedor || null}, ${Number(b.precio) || null}, ${Number(b.iva_pct) || 21}, ${Number(b.stock) || null}, true)
      RETURNING id`;
    return NextResponse.json({ ok: true, id: ins[0].id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// GET /api/productos?q=&categoria=&proveedor=&stock=&limit=  → catálogo unificado.
// Calcula precios FV con la MISMA lógica del cotizador: costo_usd × dólar (fv_config)
// × markup × IVA. El dólar sale de fv_config (no se duplica).
const MARKUP = 1.30; // markup 30% (catálogo Multiradio). TODO: configurable / multi-lista.

export async function GET(req: NextRequest) {
  try {
    const sql = getDb();
    await sql`ALTER TABLE fg_productos ADD COLUMN IF NOT EXISTS emisor TEXT`.catch(() => {});
    const sp = req.nextUrl.searchParams;
    const q = (sp.get("q") || "").trim().toLowerCase();
    const categoria = (sp.get("categoria") || "").trim();
    const proveedor = (sp.get("proveedor") || "").trim();
    const stock = (sp.get("stock") || "").trim(); // '1' = solo en stock
    const limit = Math.min(200, Number(sp.get("limit")) || 50);
    const like = `%${q}%`;

    // dólar del sistema FV (mismas reglas)
    let dolar = 1460;
    try { const cfg = await sql`SELECT data FROM fv_config WHERE id = 1`; if (cfg[0]?.data?.dolar) dolar = Number(cfg[0].data.dolar); } catch {}

    const rows = await sql`
      SELECT id, codigo, descripcion, descripcion_alt, categoria, origen, marca, fabricante, proveedor, emisor,
             precio, costo_usd, iva_pct, disponibilidad, sin_precio, stock, activo
      FROM fg_productos
      WHERE activo = true
        AND (${q} = '' OR lower(coalesce(codigo,'')||' '||coalesce(descripcion,'')||' '||coalesce(marca,'')||' '||coalesce(fabricante,'')) LIKE ${like})
        AND (${categoria} = '' OR categoria = ${categoria})
        AND (${proveedor} = '' OR proveedor = ${proveedor})
        AND (${stock} = '' OR (disponibilidad ILIKE '%stock%' AND disponibilidad NOT ILIKE '%sin stock%' AND disponibilidad NOT ILIKE '%confirm%' AND disponibilidad NOT ILIKE '%consult%' AND proveedor IS DISTINCT FROM 'LV Energy'))
      ORDER BY categoria, descripcion LIMIT ${limit}`;

    const productos = rows.map((p: any) => {
      let costo_ars = null, precio_venta = null;
      if (p.origen === "fv" && p.costo_usd && !p.sin_precio) {
        costo_ars = Math.round(Number(p.costo_usd) * dolar);
        precio_venta = Math.round(costo_ars * MARKUP * (1 + Number(p.iva_pct || 21) / 100));
      } else if (p.precio) {
        precio_venta = Number(p.precio);
      }
      const dl = (p.disponibilidad || "").toLowerCase().trim();
      const a_confirmar = p.proveedor === "LV Energy" || dl === "" || dl.includes("confirm") || dl.includes("consult");
      const en_stock = !a_confirmar && dl.includes("stock") && !dl.includes("sin stock");
      return { ...p, costo_ars, precio_venta, en_stock, a_confirmar };
    });

    const cats = await sql`SELECT categoria, COUNT(*)::int n FROM fg_productos WHERE activo = true GROUP BY categoria ORDER BY categoria`;
    const provs = await sql`SELECT proveedor, COUNT(*)::int n FROM fg_productos WHERE activo = true AND proveedor IS NOT NULL GROUP BY proveedor ORDER BY proveedor`;
    return NextResponse.json({ ok: true, productos, categorias: cats, proveedores: provs, dolar });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
