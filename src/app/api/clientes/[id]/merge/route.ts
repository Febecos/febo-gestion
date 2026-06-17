import { NextRequest, NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";

export const dynamic = "force-dynamic";

// POST /api/clientes/[id]/merge  { target_id }
// Fusiona el cliente [id] (DUPLICADO) en target_id (el que se conserva):
// reasigna todas sus operaciones al target y soft-elimina el duplicado.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const dupId = Number(params.id);
    const { target_id } = await req.json();
    const keep = Number(target_id);
    if (!dupId || !keep) return NextResponse.json({ ok: false, error: "id y target_id requeridos" }, { status: 400 });
    if (dupId === keep) return NextResponse.json({ ok: false, error: "No se puede fusionar un cliente consigo mismo" }, { status: 400 });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const k = (await client.query(`SELECT id, nombre, razon_social, cuit, email, whatsapp FROM clientes WHERE id=$1`, [keep])).rows[0];
      const d = (await client.query(`SELECT id FROM clientes WHERE id=$1`, [dupId])).rows[0];
      if (!k || !d) { await client.query("ROLLBACK"); return NextResponse.json({ ok: false, error: "cliente no encontrado" }, { status: 404 }); }

      const movidos: Record<string, number> = {};
      // Presupuestos: reasignar + propagar identidad del que se conserva (coti/PDF).
      const p = await client.query(
        `UPDATE presupuestos SET cliente_id=$1, cliente_nombre=COALESCE($2,cliente_nombre), cliente_razon_social=COALESCE($3,cliente_razon_social), cliente_cuit=COALESCE($4,cliente_cuit), cliente_email=COALESCE($5,cliente_email), cliente_telefono=COALESCE($6,cliente_telefono) WHERE cliente_id=$7`,
        [keep, k.nombre, k.razon_social, k.cuit, k.email, k.whatsapp, dupId]
      );
      movidos.presupuestos = p.rowCount || 0;
      // Resto de tablas que referencian cliente_id (las que existan).
      for (const [tabla, key] of [["fg_comprobantes", "comprobantes"], ["fg_pagos", "pagos"], ["compras_clientes", "compras"], ["fg_operaciones", "operaciones"]] as const) {
        try { const r = await client.query(`UPDATE ${tabla} SET cliente_id=$1 WHERE cliente_id=$2`, [keep, dupId]); movidos[key] = r.rowCount || 0; } catch { /* tabla puede no existir */ }
      }
      // Soft-delete del duplicado.
      await client.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS crm_eliminado BOOLEAN DEFAULT false`).catch(() => {});
      await client.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS crm_eliminado_at TIMESTAMPTZ`).catch(() => {});
      await client.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS crm_eliminado_motivo TEXT`).catch(() => {});
      await client.query(`UPDATE clientes SET crm_eliminado=true, crm_eliminado_at=now(), crm_eliminado_motivo=$1, updated_at=now() WHERE id=$2`, [`Fusionado en cliente #${keep}`, dupId]);
      await client.query("COMMIT");
      return NextResponse.json({ ok: true, movidos, target_id: keep });
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
    finally { client.release(); }
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
  finally { await pool.end(); }
}
