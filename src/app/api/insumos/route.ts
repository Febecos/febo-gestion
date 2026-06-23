import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// INSUMOS de registro interno (consumibles que NO son productos de venta: embalaje, oficina,
// herramientas, etc.). Tabla propia fg_insumos, separada del catálogo fg_productos.
//  GET                  → lista (q, bajo)
//  GET ?count=1         → { count } bajo mínimo
//  POST {accion:'crear'|'editar'|'eliminar'|'ajustar', ...}

async function ensure(sql: any) {
  await sql`CREATE TABLE IF NOT EXISTS fg_insumos (
    id BIGSERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    categoria TEXT,
    unidad TEXT DEFAULT 'unidad',
    cantidad NUMERIC DEFAULT 0,
    minimo NUMERIC DEFAULT 0,
    notas TEXT,
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`.catch(() => {});
}

export async function GET(req: NextRequest) {
  try {
    const sql = getDb();
    await ensure(sql);
    const sp = req.nextUrl.searchParams;
    if (sp.get("count")) {
      const r = (await sql`SELECT COUNT(*)::int AS count FROM fg_insumos WHERE activo=true AND COALESCE(minimo,0)>0 AND COALESCE(cantidad,0)<minimo` as any[])[0];
      return NextResponse.json({ ok: true, count: r.count });
    }
    const q = (sp.get("q") || "").trim().toLowerCase();
    const like = `%${q}%`;
    const bajo = sp.get("bajo") === "1";
    const rows = await sql`SELECT id, nombre, categoria, unidad, cantidad, minimo, notas FROM fg_insumos
      WHERE activo=true
        AND (${q}='' OR lower(coalesce(nombre,'')||' '||coalesce(categoria,'')) LIKE ${like})
        AND (${bajo}=false OR (COALESCE(minimo,0)>0 AND COALESCE(cantidad,0)<minimo))
      ORDER BY (COALESCE(minimo,0)>0 AND COALESCE(cantidad,0)<minimo) DESC, nombre ASC` as any[];
    return NextResponse.json({ ok: true, insumos: rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const sql = getDb();
    await ensure(sql);
    const b = await req.json();

    if (b.accion === "crear") {
      if (!b.nombre || !String(b.nombre).trim()) return NextResponse.json({ ok: false, error: "nombre requerido" }, { status: 400 });
      const ins = await sql`INSERT INTO fg_insumos (nombre, categoria, unidad, cantidad, minimo, notas)
        VALUES (${b.nombre}, ${b.categoria || null}, ${b.unidad || "unidad"}, ${Number(b.cantidad) || 0}, ${Number(b.minimo) || 0}, ${b.notas || null}) RETURNING id` as any[];
      return NextResponse.json({ ok: true, id: ins[0].id });
    }

    const id = Number(b.id);
    if (!id) return NextResponse.json({ ok: false, error: "id requerido" }, { status: 400 });

    if (b.accion === "eliminar") {
      await sql`UPDATE fg_insumos SET activo=false, updated_at=now() WHERE id=${id}`;
      return NextResponse.json({ ok: true });
    }
    if (b.accion === "editar") {
      // Campos editables (lista). Solo actualiza los que vienen definidos.
      const set: Record<string, any> = {};
      for (const k of ["nombre", "categoria", "unidad", "notas"]) if (b[k] !== undefined) set[k] = b[k] || null;
      for (const k of ["cantidad", "minimo"]) if (b[k] !== undefined) set[k] = Number(b[k]) || 0;
      if (!Object.keys(set).length) return NextResponse.json({ ok: false, error: "nada para actualizar" }, { status: 400 });
      // Updates puntuales (sin fragmentos anidados con neon serverless).
      if (set.nombre !== undefined) await sql`UPDATE fg_insumos SET nombre=${set.nombre}, updated_at=now() WHERE id=${id}`;
      if (set.categoria !== undefined) await sql`UPDATE fg_insumos SET categoria=${set.categoria}, updated_at=now() WHERE id=${id}`;
      if (set.unidad !== undefined) await sql`UPDATE fg_insumos SET unidad=${set.unidad}, updated_at=now() WHERE id=${id}`;
      if (set.notas !== undefined) await sql`UPDATE fg_insumos SET notas=${set.notas}, updated_at=now() WHERE id=${id}`;
      if (set.cantidad !== undefined) await sql`UPDATE fg_insumos SET cantidad=${set.cantidad}, updated_at=now() WHERE id=${id}`;
      if (set.minimo !== undefined) await sql`UPDATE fg_insumos SET minimo=${set.minimo}, updated_at=now() WHERE id=${id}`;
      return NextResponse.json({ ok: true });
    }
    if (b.accion === "ajustar") {
      const delta = Number(b.delta);
      if (!Number.isFinite(delta) || delta === 0) return NextResponse.json({ ok: false, error: "delta inválido" }, { status: 400 });
      const r = await sql`UPDATE fg_insumos SET cantidad = COALESCE(cantidad,0) + ${delta}, updated_at=now() WHERE id=${id} RETURNING cantidad` as any[];
      return NextResponse.json({ ok: true, cantidad: r[0]?.cantidad });
    }
    return NextResponse.json({ ok: false, error: "acción desconocida" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
