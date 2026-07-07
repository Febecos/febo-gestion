import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { computarLista } from "@/lib/lista-precios-core";

// GET /api/public/lista-precios?categorias=A,B  → VISOR PÚBLICO (sin auth; ruta whitelisteada en el
// middleware bajo /api/public/). Pedido de Guille 07/07: link para compartir a usuarios/revendedores
// que vean los productos y el PRECIO SUGERIDO A PÚBLICO online (medir demanda antes de activar el sistema).
//
// ⚠️⚠️ Al ser público, acá SOLO sale:
//   - precio_publico (sugerido a público), en USD, NETO (+ IVA por producto).
//   - NUNCA: precio de reventa (es interno, undercutea al público), costo, proveedor, ni markup.
// No acepta filtro por proveedor (los proveedores son nuestros, no se exponen). Filtro por rubro sí.
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const categorias = (sp.get("categorias") || "").split(",").map((s) => s.trim()).filter(Boolean);

    const r = await computarLista({ categorias, moneda: "USD" }); // USD siempre en el visor
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });

    // Solo precio sugerido a público (se descarta reventa/niveles ANTES de responder — nunca salen del server).
    const productos = r.productos.map((p) => ({
      codigo: p.codigo, descripcion: p.descripcion, categoria: p.categoria,
      iva_pct: p.iva_pct, precio_publico: p.precio_publico,
    }));

    // Rubros disponibles (para el selector del visor) — el visor no puede pegarle a /api/productos (con auth).
    const sql = getDb();
    const cats = await sql`
      SELECT categoria, count(*)::int n FROM fg_productos
      WHERE activo = true AND origen = 'fv' AND costo_usd IS NOT NULL AND COALESCE(sin_precio, false) = false
      GROUP BY categoria ORDER BY categoria` as any[];

    return NextResponse.json({
      ok: true, productos, total: productos.length,
      categorias: cats.map((c) => ({ categoria: c.categoria || "VARIOS", n: c.n })),
      meta: { moneda: "USD", con_iva: r.meta.con_iva },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
