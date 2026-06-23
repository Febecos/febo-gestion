import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Clientes finales de un revendedor: son filas en `clientes` con revendedor_padre_id = :id.
// A ellos se les factura (datos fiscales propios) referenciando internamente al revendedor.

// GET /api/clientes/:id/finales → lista los clientes finales del revendedor :id
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    if (!id) return NextResponse.json({ ok: false, error: "id requerido" }, { status: 400 });
    const sql = getDb();
    const rows = await sql`
      SELECT id, nombre, apellido, razon_social, empresa, email, whatsapp, cuit,
             provincia, localidad, cod_postal, domicilio, condicion_fiscal
      FROM clientes
      WHERE revendedor_padre_id = ${id} AND (crm_eliminado IS NULL OR crm_eliminado = false)
      ORDER BY lower(coalesce(razon_social, nombre, '')) ASC`;
    return NextResponse.json({ ok: true, finales: rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// POST /api/clientes/:id/finales  Body: { nombre, razon_social, cuit, condicion_fiscal, domicilio, localidad, provincia, cod_postal, email, whatsapp }
// Crea un cliente final vinculado al revendedor :id.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const padre = Number(params.id);
    if (!padre) return NextResponse.json({ ok: false, error: "id requerido" }, { status: 400 });
    const b = await req.json();
    const nombre = (b.nombre || b.razon_social || "").trim();
    if (!nombre && !(b.razon_social || "").trim()) {
      return NextResponse.json({ ok: false, error: "nombre o razón social requerido" }, { status: 400 });
    }
    const sql = getDb();
    // Hereda el nombre del revendedor para referencia interna
    const rev = await sql`SELECT nombre, razon_social FROM clientes WHERE id = ${padre} LIMIT 1`;
    const revNombre = rev.length ? (rev[0].razon_social || rev[0].nombre || null) : null;
    const r = await sql`
      INSERT INTO clientes (tipo, nombre, razon_social, empresa, email, whatsapp, cuit,
        domicilio, localidad, provincia, cod_postal, condicion_fiscal,
        origen, origenes, revendedor_padre_id, revendedor_nombre,
        primer_contacto_at, ultimo_contacto_at)
      VALUES ('cliente_final', ${b.nombre || null}, ${b.razon_social || null}, ${b.empresa || null},
        ${b.email || null}, ${b.whatsapp || null}, ${b.cuit || null},
        ${b.domicilio || null}, ${b.localidad || null}, ${b.provincia || null}, ${b.cod_postal || null},
        ${b.condicion_fiscal || null}, 'cliente_final', ARRAY['cliente_final'], ${padre}, ${revNombre},
        now(), now())
      RETURNING id`;
    return NextResponse.json({ ok: true, id: r[0].id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
