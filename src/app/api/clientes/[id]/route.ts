import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Pool } from "@neondatabase/serverless";

// Campos editables permitidos (whitelist, igual que el admin)
const ALLOWED = new Set([
  "tipo", "nombre", "apellido", "razon_social", "empresa", "email", "whatsapp", "cuit",
  "domicilio", "localidad", "provincia", "cod_postal", "condicion_fiscal", "notas",
  "email_opt_out", "descuento_pct", "tags", "origenes",
]);

// GET /api/clientes/:id  → un cliente completo (para abrir su ficha desde otros módulos)
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    if (!id) return NextResponse.json({ ok: false, error: "id requerido" }, { status: 400 });
    const sql = getDb();
    const r = await sql`
      SELECT id, tipo, nombre, apellido, razon_social, empresa, email, whatsapp, cuit,
             provincia, localidad, cod_postal, domicilio, condicion_fiscal, notas, email_opt_out, descuento_pct,
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
      // PROPAGAR identidad a los presupuestos enlazados (CRM = fuente única → coti/PDF se actualizan).
      const MAP: Record<string, string> = { nombre: "cliente_nombre", razon_social: "cliente_razon_social", cuit: "cliente_cuit", email: "cliente_email", whatsapp: "cliente_telefono" };
      if (MAP[field]) {
        await pool.query(`UPDATE presupuestos SET ${MAP[field]} = $1 WHERE cliente_id = $2`, [value, id]);
        if (field === "nombre") await pool.query(`UPDATE presupuestos SET cliente_apellido = NULL WHERE cliente_id = $1`, [id]);
      }
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

    // No se puede eliminar un cliente con operaciones enlazadas (presupuestos/comprobantes/compras).
    const cl = await sql`SELECT cuit, email, whatsapp FROM clientes WHERE id = ${id} LIMIT 1`;
    const cuit = (cl[0]?.cuit || "").trim();
    const email = (cl[0]?.email || "").trim().toLowerCase();
    const tel10 = (cl[0]?.whatsapp || "").replace(/\D/g, "").slice(-10);
    const presu = await sql`
      SELECT count(*)::int n FROM presupuestos
      WHERE (${cuit} <> '' AND cliente_cuit = ${cuit})
         OR (${email} <> '' AND lower(cliente_email) = ${email})
         OR (${tel10} <> '' AND length(${tel10}) >= 8 AND right(regexp_replace(coalesce(cliente_telefono,''),'\D','','g'),10) = ${tel10})`;
    let comprob = [{ n: 0 }] as any, compras = [{ n: 0 }] as any;
    try { comprob = await sql`SELECT count(*)::int n FROM fg_comprobantes WHERE cliente_id = ${id}`; } catch {}
    try { compras = await sql`SELECT count(*)::int n FROM compras_clientes WHERE cliente_id = ${id}`; } catch {}
    const nP = presu[0].n, nC = comprob[0].n, nX = compras[0].n;
    if (nP + nC + nX > 0) {
      // ¿Hay un GEMELO activo (mismo email/CUIT/WhatsApp)? Si sí, es un duplicado: se puede
      // borrar porque las operaciones (que matchean por email/tel) quedan con el gemelo.
      const gemelo = await sql`
        SELECT count(*)::int n FROM clientes
        WHERE id <> ${id} AND (crm_eliminado IS NULL OR crm_eliminado = false)
          AND ( (${cuit} <> '' AND cuit = ${cuit})
             OR (${email} <> '' AND lower(email) = ${email})
             OR (${tel10} <> '' AND length(${tel10}) >= 8 AND right(regexp_replace(coalesce(whatsapp,''),'\D','','g'),10) = ${tel10}) )`;
      const esDuplicado = gemelo[0].n > 0;
      // Las compras y comprobantes se enlazan por cliente_id (no se heredan): si los tiene, no borrar.
      if (!esDuplicado || nC > 0 || nX > 0) {
        const partes = [nP && `${nP} presupuesto(s)`, nC && `${nC} comprobante(s)`, nX && `${nX} compra(s)`].filter(Boolean).join(", ");
        return NextResponse.json({ ok: false, error: `No se puede eliminar: el cliente tiene ${partes} enlazado(s).` + (nC + nX > 0 ? "" : " (No hay otro contacto con el mismo email/CUIT para heredar los presupuestos.)") }, { status: 409 });
      }
    }

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
