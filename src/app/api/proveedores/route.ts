import { NextRequest, NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
import { getDb } from "@/lib/db";

// Proveedores (maestro). Datos legales se traen por CUIT (ARCA, vía /api/consultar-cuit).
async function ensure(sql: any) {
  await sql`CREATE TABLE IF NOT EXISTS fg_proveedores (
    id SERIAL PRIMARY KEY,
    cuit TEXT, razon_social TEXT, nombre_fantasia TEXT,
    email TEXT, telefono TEXT, contacto TEXT,
    domicilio TEXT, localidad TEXT, provincia TEXT, cod_postal TEXT,
    condicion_iva TEXT, rubro TEXT, notas TEXT, alias TEXT,
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`ALTER TABLE fg_proveedores ADD COLUMN IF NOT EXISTS alias TEXT`.catch(() => {});
}

export async function GET(req: NextRequest) {
  try {
    const sql = getDb(); await ensure(sql);
    const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();
    const like = `%${q}%`;
    const rows = await sql`
      SELECT * FROM fg_proveedores
      WHERE (${q} = '' OR lower(coalesce(razon_social,'')||' '||coalesce(nombre_fantasia,'')||' '||coalesce(cuit,'')||' '||coalesce(rubro,'')) LIKE ${like})
      ORDER BY activo DESC, razon_social, nombre_fantasia`;
    return NextResponse.json({ ok: true, proveedores: rows });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}

const CAMPOS = ["cuit", "razon_social", "nombre_fantasia", "email", "telefono", "contacto", "domicilio", "localidad", "provincia", "cod_postal", "condicion_iva", "rubro", "notas", "alias", "activo"];

// POST → crear { ...campos }
export async function POST(req: NextRequest) {
  try {
    const sql = getDb(); await ensure(sql);
    const b = await req.json();
    const r = await sql`INSERT INTO fg_proveedores (cuit, razon_social, nombre_fantasia, email, telefono, contacto, domicilio, localidad, provincia, cod_postal, condicion_iva, rubro, notas, activo)
      VALUES (${b.cuit || null}, ${b.razon_social || null}, ${b.nombre_fantasia || null}, ${b.email || null}, ${b.telefono || null}, ${b.contacto || null}, ${b.domicilio || null}, ${b.localidad || null}, ${b.provincia || null}, ${b.cod_postal || null}, ${b.condicion_iva || null}, ${b.rubro || null}, ${b.notas || null}, true)
      RETURNING *`;
    return NextResponse.json({ ok: true, proveedor: r[0] });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}

// PATCH → { id, campo, valor }  (columna de whitelist → seguro con Pool)
export async function PATCH(req: NextRequest) {
  try {
    const sql = getDb(); await ensure(sql);
    const { id, campo, valor } = await req.json();
    if (!id || !CAMPOS.includes(campo)) return NextResponse.json({ ok: false, error: "campo inválido" }, { status: 400 });
    const v = campo === "activo" ? !!valor : (String(valor ?? "").trim() || null);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try { await pool.query(`UPDATE fg_proveedores SET ${campo}=$1 WHERE id=$2`, [v, id]); }
    finally { await pool.end(); }
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}

// DELETE ?id=  → elimina proveedor. ?reasignar_a=ID → primero mueve su cta cte a ese proveedor (merge).
export async function DELETE(req: NextRequest) {
  try {
    const sql = getDb();
    const sp = new URL(req.url).searchParams;
    const id = Number(sp.get("id"));
    const reasignar = Number(sp.get("reasignar_a")) || 0;
    if (!id) return NextResponse.json({ ok: false, error: "id requerido" }, { status: 400 });
    if (reasignar) {
      await sql`ALTER TABLE fg_ctacte ADD COLUMN IF NOT EXISTS proveedor_id INT`.catch(() => {});
      await sql`UPDATE fg_ctacte SET proveedor_id=${reasignar} WHERE proveedor_id=${id}`.catch(() => {});
    }
    await sql`DELETE FROM fg_proveedores WHERE id=${id}`;
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}
