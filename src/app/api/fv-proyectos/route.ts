import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// Plataforma de proyectos FV (backlog #3). El proyecto vive en Neon (fuente de verdad); el motor de
// dimensionado (CÁLCULOS FV) y el enganche al cotizador se agregan después. Este endpoint guarda/lee
// el proyecto (inputs del formulario + factura + BOM/sistema cuando el motor los devuelva).
//
// GET  /api/fv-proyectos            → lista (últimos 200)
// GET  /api/fv-proyectos?id=N       → un proyecto
// POST /api/fv-proyectos  {id?, cliente_id?, vendedor?, inputs?, factura_ref?, bom?, sistema?, presupuesto_numero?, estado?}
//   → crea (sin id) o actualiza (con id). Devuelve { ok, id }.

async function migrate(sql: any) {
  await sql`CREATE TABLE IF NOT EXISTS fv_proyectos (
    id SERIAL PRIMARY KEY, cliente_id BIGINT, vendedor TEXT, inputs JSONB, bom JSONB, sistema JSONB,
    factura_ref JSONB, presupuesto_numero TEXT, estado TEXT DEFAULT 'borrador',
    created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now())`.catch(() => {});
  await sql`ALTER TABLE fv_proyectos ADD COLUMN IF NOT EXISTS referencia TEXT`.catch(() => {});
}

export async function GET(req: NextRequest) {
  try {
    const sql = getDb();
    await migrate(sql);
    const id = Number(req.nextUrl.searchParams.get("id") || 0);
    if (id) {
      const r = await sql`SELECT * FROM fv_proyectos WHERE id = ${id} LIMIT 1`;
      if (!r.length) return NextResponse.json({ ok: false, error: "no encontrado" }, { status: 404 });
      return NextResponse.json({ ok: true, proyecto: r[0] });
    }
    // COALESCE: el nombre visible sale del CRM si hay cliente vinculado, si no del propio formulario
    // (inputs.cliente) → nunca más filas "—" por proyectos sin cliente_id.
    const rows = await sql`
      SELECT p.id, p.cliente_id, p.vendedor, p.estado, p.presupuesto_numero, p.referencia, p.created_at, p.updated_at,
             p.sistema,
             COALESCE(c.nombre, p.inputs->'cliente'->>'nombre') AS cliente_nombre,
             COALESCE(c.razon_social, p.inputs->'cliente'->>'razon_social') AS cliente_razon_social
      FROM fv_proyectos p LEFT JOIN clientes c ON c.id = p.cliente_id
      ORDER BY p.updated_at DESC LIMIT 200`;
    return NextResponse.json({ ok: true, proyectos: rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// DELETE /api/fv-proyectos?id=N  → borra el proyecto (hard delete; el vendedor lo pidió explícito).
export async function DELETE(req: NextRequest) {
  try {
    const sql = getDb();
    await migrate(sql);
    const id = Number(req.nextUrl.searchParams.get("id") || 0);
    if (!id) return NextResponse.json({ ok: false, error: "id requerido" }, { status: 400 });
    const r = await sql`DELETE FROM fv_proyectos WHERE id = ${id} RETURNING id`;
    if (!r.length) return NextResponse.json({ ok: false, error: "no encontrado" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const sql = getDb();
    await migrate(sql);
    const b = await req.json();
    const cliente_id = b.cliente_id != null ? Number(b.cliente_id) : null;
    const vendedor = b.vendedor ? String(b.vendedor) : null;
    const inputs = b.inputs ? JSON.stringify(b.inputs) : null;
    const bom = b.bom ? JSON.stringify(b.bom) : null;
    const sistema = b.sistema ? JSON.stringify(b.sistema) : null;
    const factura_ref = b.factura_ref ? JSON.stringify(b.factura_ref) : null;
    const presupuesto_numero = b.presupuesto_numero ? String(b.presupuesto_numero) : null;
    const estado = b.estado ? String(b.estado) : "borrador";
    // Referencia editable (nombre de la carpeta destino en COTIZADOS). Se sanea a caracteres válidos de
    // Windows acá también (defensa; el script de sync vuelve a sanear).
    const referencia = b.referencia != null ? String(b.referencia).replace(/[/\\:*?"<>|]/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 80) : null;

    if (b.id) {
      // UPDATE: solo pisa los campos provistos (coalesce), para no borrar lo que no vino.
      const r = await sql`
        UPDATE fv_proyectos SET
          cliente_id = COALESCE(${cliente_id}, cliente_id),
          vendedor = COALESCE(${vendedor}, vendedor),
          inputs = COALESCE(${inputs}::jsonb, inputs),
          bom = COALESCE(${bom}::jsonb, bom),
          sistema = COALESCE(${sistema}::jsonb, sistema),
          factura_ref = COALESCE(${factura_ref}::jsonb, factura_ref),
          presupuesto_numero = COALESCE(${presupuesto_numero}, presupuesto_numero),
          referencia = COALESCE(${referencia}, referencia),
          estado = COALESCE(${estado}, estado),
          updated_at = now()
        WHERE id = ${Number(b.id)} RETURNING id`;
      if (!r.length) return NextResponse.json({ ok: false, error: "no encontrado" }, { status: 404 });
      return NextResponse.json({ ok: true, id: r[0].id });
    }
    const r = await sql`
      INSERT INTO fv_proyectos (cliente_id, vendedor, inputs, bom, sistema, factura_ref, presupuesto_numero, referencia, estado)
      VALUES (${cliente_id}, ${vendedor}, ${inputs}::jsonb, ${bom}::jsonb, ${sistema}::jsonb, ${factura_ref}::jsonb, ${presupuesto_numero}, ${referencia}, ${estado})
      RETURNING id`;
    return NextResponse.json({ ok: true, id: r[0].id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
