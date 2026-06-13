import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

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
      SELECT id, codigo, descripcion, categoria, origen, marca, proveedor, precio, costo_usd, iva_pct, stock, activo
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
