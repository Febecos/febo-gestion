import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Pool } from "@neondatabase/serverless";

// Campos editables permitidos (whitelist, igual que el admin)
const ALLOWED = new Set([
  "tipo", "nombre", "apellido", "razon_social", "empresa", "email", "whatsapp", "cuit",
  "domicilio", "localidad", "provincia", "cod_postal", "condicion_fiscal", "notas",
  "email_opt_out", "tags", "origenes",
]);

// GET /api/clientes/:id  → un cliente completo (para abrir su ficha desde otros módulos)
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    if (!id) return NextResponse.json({ ok: false, error: "id requerido" }, { status: 400 });
    const sql = getDb();
    const r = await sql`
      SELECT id, tipo, nombre, apellido, razon_social, empresa, email, whatsapp, cuit,
             provincia, localidad, cod_postal, domicilio, condicion_fiscal, notas, email_opt_out,
             tags, origenes
      FROM clientes WHERE id = ${id} LIMIT 1`;
    if (!r.length) return NextResponse.json({ ok: false, error: "no encontrado" }, { status: 404 });
    return NextResponse.json({ ok: true, cliente: r[0] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// PATCH /api/clientes/:id  Body: { field, value }  (un campo por llamada)
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    const { field, value } = await req.json();
    if (!id || !field) return NextResponse.json({ ok: false, error: "id y field requeridos" }, { status: 400 });
    if (!ALLOWED.has(field)) return NextResponse.json({ ok: false, error: `campo '${field}' no permitido` }, { status: 403 });
    // columna validada por la whitelist ALLOWED → seguro interpolarla. Pool tiene
    // .query() con parámetros (la función http de neon no).
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await pool.query(`UPDATE clientes SET "${field}" = $1, updated_at = now() WHERE id = $2`, [value, id]);
    } finally { await pool.end(); }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// DELETE /api/clientes/:id?motivo=...  → soft-delete (crm_eliminado)
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    if (!id) return NextResponse.json({ ok: false, error: "id requerido" }, { status: 400 });
    const motivo = req.nextUrl.searchParams.get("motivo") || null;
    const sql = getDb();
    await sql`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS crm_eliminado BOOLEAN DEFAULT false`;
    await sql`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS crm_eliminado_at TIMESTAMPTZ`;
    await sql`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS crm_eliminado_motivo TEXT`;
    const r = await sql`
      UPDATE clientes SET crm_eliminado = true, crm_eliminado_at = now(), crm_eliminado_motivo = ${motivo}, updated_at = now()
      WHERE id = ${id} RETURNING id`;
    if (!r.length) return NextResponse.json({ ok: false, error: "no encontrado" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
