import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { computarLista } from "@/lib/lista-precios-core";

// GET /api/public/lista-precios?categorias=A,B  → VISOR REVENDEDORES (sin auth; ruta whitelisteada en
// el middleware bajo /api/public/). Pedido de Guille (07/07 → reencuadre): NO es "precios sugeridos a
// público" — es la LISTA DE PRECIOS EXCLUSIVA PARA REVENDEDORES (facturada al CUIT del revendedor), que
// se comparte por link (abierta por ahora, se gatea por token de revendedor en fase 2).
//
// ⚠️⚠️ Al ser público, acá sale el PRECIO DE REVENTA (lo que paga el revendedor) + los umbrales de
// volumen (dónde mejora el precio). NUNCA: costo, proveedor, ni markup %. No expone proveedor (filtra
// por rubro sí). El descuento por volumen es RELATIVO (no despeja el costo).
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const categorias = (sp.get("categorias") || "").split(",").map((s) => s.trim()).filter(Boolean);

    const r = await computarLista({ categorias, moneda: "USD" }); // USD siempre en el visor
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });

    // Precio de REVENTA (revendedor). Se descarta costo/proveedor (nunca vienen en el resultado del core).
    const productos = r.productos.map((p) => ({
      codigo: p.codigo, descripcion: p.descripcion, categoria: p.categoria,
      iva_pct: p.iva_pct, precio_reventa: p.precio_reventa,
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
      niveles_volumen: r.niveles_volumen, // umbrales donde mejora el precio (montos del admin)
      meta: { moneda: "USD", con_iva: r.meta.con_iva },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
