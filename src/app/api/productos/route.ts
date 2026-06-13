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

// GET /api/productos?q=&categoria=&limit=  → catálogo unificado (bombas + FV)
export async function GET(req: NextRequest) {
  try {
    const sql = getDb();
    const sp = req.nextUrl.searchParams;
    const q = (sp.get("q") || "").trim().toLowerCase();
    const categoria = (sp.get("categoria") || "").trim();
    const limit = Math.min(100, Number(sp.get("limit")) || 50);
    const like = `%${q}%`;
    const rows = await sql`
      SELECT id, codigo, descripcion, descripcion_alt, categoria, origen, marca, proveedor, precio, costo_usd, iva_pct, stock, activo
      FROM fg_productos
      WHERE activo = true
        AND (${q} = '' OR lower(coalesce(codigo,'')||' '||coalesce(descripcion,'')||' '||coalesce(marca,'')) LIKE ${like})
        AND (${categoria} = '' OR categoria = ${categoria})
      ORDER BY categoria, descripcion LIMIT ${limit}`;
    const cats = await sql`SELECT categoria, COUNT(*)::int n FROM fg_productos WHERE activo = true GROUP BY categoria ORDER BY categoria`;
    return NextResponse.json({ ok: true, productos: rows, categorias: cats });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
