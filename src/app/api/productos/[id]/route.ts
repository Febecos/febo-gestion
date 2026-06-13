import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Pool } from "@neondatabase/serverless";

const ALLOWED = new Set(["codigo", "descripcion", "categoria", "marca", "proveedor", "precio", "iva_pct", "stock", "activo"]);

// PATCH /api/productos/:id  Body: { field, value } — SOLO productos propios (origen='manual')
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    const { field, value } = await req.json();
    if (!id || !field) return NextResponse.json({ ok: false, error: "id y field requeridos" }, { status: 400 });
    if (!ALLOWED.has(field)) return NextResponse.json({ ok: false, error: `campo '${field}' no permitido` }, { status: 403 });
    const sql = getDb();
    const prod = await sql`SELECT origen FROM fg_productos WHERE id = ${id}`;
    if (!prod.length) return NextResponse.json({ ok: false, error: "no encontrado" }, { status: 404 });
    if (prod[0].origen !== "manual")
      return NextResponse.json({ ok: false, error: "Los productos de los listados (bombas/FV) no se pueden modificar" }, { status: 403 });
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try { await pool.query(`UPDATE fg_productos SET "${field}" = $1, updated_at = now() WHERE id = $2`, [value, id]); }
    finally { await pool.end(); }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// DELETE /api/productos/:id  → solo manuales (desactiva)
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    const sql = getDb();
    const prod = await sql`SELECT origen FROM fg_productos WHERE id = ${id}`;
    if (!prod.length) return NextResponse.json({ ok: false, error: "no encontrado" }, { status: 404 });
    if (prod[0].origen !== "manual")
      return NextResponse.json({ ok: false, error: "Solo se pueden eliminar productos propios" }, { status: 403 });
    await sql`UPDATE fg_productos SET activo = false, updated_at = now() WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
