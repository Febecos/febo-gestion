import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // datos en vivo — nunca servir una versión cacheada (bug ruta stale 14/07)
export const revalidate = 0;

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
  await sql`ALTER TABLE fv_proyectos ADD COLUMN IF NOT EXISTS meta JSONB`.catch(() => {});
  // opciones: las 3 variantes generadas (on-grid/off-grid/híbrido) con su PREV + meta, para el
  // comparativo y para ver informe/presentación por opción con ?opcion=. recomendacion = menor repago.
  await sql`ALTER TABLE fv_proyectos ADD COLUMN IF NOT EXISTS opciones JSONB`.catch(() => {});
  await sql`ALTER TABLE fv_proyectos ADD COLUMN IF NOT EXISTS recomendacion JSONB`.catch(() => {});
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
    const meta = b.meta ? JSON.stringify(b.meta) : null;
    const factura_ref = b.factura_ref ? JSON.stringify(b.factura_ref) : null;
    const presupuesto_numero = b.presupuesto_numero ? String(b.presupuesto_numero) : null;
    const opciones = b.opciones ? JSON.stringify(b.opciones) : null;
    const recomendacion = b.recomendacion ? JSON.stringify(b.recomendacion) : null;
    const estado = b.estado ? String(b.estado) : "borrador";
    // Referencia editable (nombre de la carpeta destino en COTIZADOS). Se sanea a caracteres válidos de
    // Windows acá también (defensa; el script de sync vuelve a sanear).
    const referencia = b.referencia != null ? String(b.referencia).replace(/[/\\:*?"<>|]/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 80) : null;

    // Al REGENERAR las 3 opciones (llega opciones nuevas), marcar los PREV viejos del proyecto como
    // 'reemplazado' (traza en notas_internas → el PREV nuevo del mismo modo). NO tocar los que ya
    // avanzaron en la cadena de venta (convertido/confirmado/pedido/emitido) — plata en curso.
    if (b.id && b.opciones) {
      try {
        const prevRow = await sql`SELECT opciones FROM fv_proyectos WHERE id = ${Number(b.id)} LIMIT 1`;
        const viejas: any[] = Array.isArray(prevRow[0]?.opciones) ? prevRow[0].opciones : [];
        const nuevasPorModo = new Map((b.opciones as any[]).map((o) => [o.modo, o.presupuesto_numero]));
        const nuevosNums = new Set((b.opciones as any[]).map((o) => o.presupuesto_numero).filter(Boolean));
        for (const o of viejas) {
          const viejo = o.presupuesto_numero;
          if (!viejo || nuevosNums.has(viejo)) continue; // sigue vigente en el set nuevo
          const reemplazoPor = nuevasPorModo.get(o.modo) || null;
          await sql`UPDATE presupuestos SET estado = 'reemplazado',
              notas_internas = COALESCE(notas_internas || ' · ', '') || ${'Reemplazado por ' + (reemplazoPor || 'nueva versión') + ' (regeneración de opciones ' + new Date().toISOString().slice(0, 10) + ')'}
            WHERE numero = ${viejo} AND estado NOT IN ('convertido', 'confirmado', 'pedido', 'emitido')`;
        }
      } catch (e) { /* traza best-effort: no frenar la persistencia de las opciones nuevas */ }
    }

    if (b.id) {
      // UPDATE: solo pisa los campos provistos (coalesce), para no borrar lo que no vino.
      const r = await sql`
        UPDATE fv_proyectos SET
          cliente_id = COALESCE(${cliente_id}, cliente_id),
          vendedor = COALESCE(${vendedor}, vendedor),
          inputs = COALESCE(${inputs}::jsonb, inputs),
          bom = COALESCE(${bom}::jsonb, bom),
          sistema = COALESCE(${sistema}::jsonb, sistema),
          meta = COALESCE(${meta}::jsonb, meta),
          factura_ref = COALESCE(${factura_ref}::jsonb, factura_ref),
          presupuesto_numero = COALESCE(${presupuesto_numero}, presupuesto_numero),
          opciones = COALESCE(${opciones}::jsonb, opciones),
          recomendacion = COALESCE(${recomendacion}::jsonb, recomendacion),
          referencia = COALESCE(${referencia}, referencia),
          estado = COALESCE(${estado}, estado),
          updated_at = now()
        WHERE id = ${Number(b.id)} RETURNING id`;
      if (!r.length) return NextResponse.json({ ok: false, error: "no encontrado" }, { status: 404 });
      return NextResponse.json({ ok: true, id: r[0].id });
    }
    const r = await sql`
      INSERT INTO fv_proyectos (cliente_id, vendedor, inputs, bom, sistema, meta, factura_ref, presupuesto_numero, referencia, estado)
      VALUES (${cliente_id}, ${vendedor}, ${inputs}::jsonb, ${bom}::jsonb, ${sistema}::jsonb, ${meta}::jsonb, ${factura_ref}::jsonb, ${presupuesto_numero}, ${referencia}, ${estado})
      RETURNING id`;
    return NextResponse.json({ ok: true, id: r[0].id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
