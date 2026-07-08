import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// GET /api/visor-stats?dias=30  → estadísticas del visor de precios (INTERNO, con auth de gestión).
// Agrega los eventos anónimos de visor_eventos (medir demanda). Sin PII.
export async function GET(req: NextRequest) {
  try {
    const dias = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("dias")) || 30));
    const sql = getDb();
    await sql`CREATE TABLE IF NOT EXISTS visor_eventos (
      id BIGSERIAL PRIMARY KEY, tipo TEXT NOT NULL, dato TEXT, movil BOOLEAN,
      creado TIMESTAMPTZ DEFAULT now())`.catch(() => {});

    const desde = `${dias} days`;
    const [visitas] = await sql`SELECT count(*)::int n,
        count(*) FILTER (WHERE movil)::int movil,
        count(DISTINCT date_trunc('day', creado))::int dias_con_visitas
      FROM visor_eventos WHERE tipo='visita' AND creado > now() - ${desde}::interval` as any[];
    const topBusquedas = await sql`SELECT lower(dato) dato, count(*)::int n FROM visor_eventos
      WHERE tipo='busqueda' AND dato IS NOT NULL AND creado > now() - ${desde}::interval
      GROUP BY lower(dato) ORDER BY n DESC LIMIT 25` as any[];
    const topRubros = await sql`SELECT dato, count(*)::int n FROM visor_eventos
      WHERE tipo='rubro' AND dato IS NOT NULL AND creado > now() - ${desde}::interval
      GROUP BY dato ORDER BY n DESC LIMIT 25` as any[];
    const topProductos = await sql`SELECT dato, count(*)::int n FROM visor_eventos
      WHERE tipo='detalle' AND dato IS NOT NULL AND creado > now() - ${desde}::interval
      GROUP BY dato ORDER BY n DESC LIMIT 25` as any[];
    const porDia = await sql`SELECT to_char(date_trunc('day', creado), 'YYYY-MM-DD') dia, count(*)::int n
      FROM visor_eventos WHERE tipo='visita' AND creado > now() - ${desde}::interval
      GROUP BY 1 ORDER BY 1` as any[];
    // Origen de la visita (host del referer): de dónde llega la gente.
    const topOrigenes = await sql`SELECT COALESCE(dato,'directo') dato, count(*)::int n FROM visor_eventos
      WHERE tipo='visita' AND creado > now() - ${desde}::interval
      GROUP BY COALESCE(dato,'directo') ORDER BY n DESC LIMIT 15` as any[];
    // Por revendedor (si el link vino con ?rev=<visor_ref>) → resuelve el nombre por visor_ref.
    // ⚠️ NO se usa revendedor_token acá: ese es la credencial de sesión del portal y NO debe viajar en
    // URLs públicas (validación Seguridad 07/07 #6). El ?rev del visor usa visor_ref (id no sensible).
    const porRevendedor = await sql`SELECT e.rev, c.nombre, count(*)::int n
      FROM visor_eventos e LEFT JOIN clientes c ON c.visor_ref = e.rev
      WHERE e.rev IS NOT NULL AND e.creado > now() - ${desde}::interval
      GROUP BY e.rev, c.nombre ORDER BY n DESC LIMIT 25` as any[];

    return NextResponse.json({
      ok: true, dias,
      visitas: visitas?.n || 0, movil: visitas?.movil || 0, dias_con_visitas: visitas?.dias_con_visitas || 0,
      top_busquedas: topBusquedas, top_rubros: topRubros, top_productos: topProductos,
      top_origenes: topOrigenes, por_revendedor: porRevendedor, visitas_por_dia: porDia,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
