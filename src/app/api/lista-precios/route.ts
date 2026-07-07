import { NextRequest, NextResponse } from "next/server";
import { computarLista } from "@/lib/lista-precios-core";

// GET /api/lista-precios?proveedor=&categorias=A,B,C&moneda=&stock=1
// Lista de precios INTERNA (con auth de gestión): devuelve reventa + público sugerido + niveles por
// volumen. La lógica de precios vive en lib/lista-precios-core (compartida con el visor público).
// ⚠️ NUNCA incluye proveedor, costo ni markup %.
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    // multi-rubro: ?categorias=A,B  (compat: ?categoria=A)
    const categorias = [
      ...(sp.get("categorias") || "").split(",").map((s) => s.trim()).filter(Boolean),
      ...(sp.get("categoria") ? [String(sp.get("categoria")).trim()] : []),
    ];
    const r = await computarLista({
      proveedor: sp.get("proveedor") || "",
      categorias,
      soloStock: sp.get("stock") === "1",
      moneda: sp.get("moneda") === "USD" ? "USD" : "ARS",
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, productos: r.productos, total: r.productos.length, niveles_volumen: r.niveles_volumen, meta: r.meta });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
