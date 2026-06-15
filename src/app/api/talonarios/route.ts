import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Talonarios = numeración configurable por tipo de comprobante (como Táctica).
// El próximo número se puede editar a mano. Tipos de factura tomados de Táctica:
// Factura A / B (manual → proforma) y A/B electrónica (AFIP, a futuro).
async function ensure(sql: any) {
  await sql`CREATE TABLE IF NOT EXISTS fg_talonarios (
    id SERIAL PRIMARY KEY,
    clave TEXT UNIQUE NOT NULL,
    nombre TEXT NOT NULL,
    prefijo TEXT,
    serie TEXT DEFAULT '0001',
    proximo_numero INT NOT NULL DEFAULT 1,
    electronica BOOLEAN DEFAULT false,
    activo BOOLEAN DEFAULT true,
    cai TEXT, vencimiento DATE,
    orden INT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`;
  const n = await sql`SELECT count(*)::int c FROM fg_talonarios`;
  if (n[0].c > 0) return;
  // Próximos números desde los contadores existentes
  let nextPresup = 1, nextPed = 1, nextFA = 1;
  try { const r = await sql`SELECT ultimo_numero FROM presupuestos_counter ORDER BY anio DESC LIMIT 1`; if (r[0]) nextPresup = (r[0].ultimo_numero || 0) + 1; } catch {}
  try { const r = await sql`SELECT ultimo_numero FROM pedidos_counter WHERE clave='PED' LIMIT 1`; if (r[0]) nextPed = (r[0].ultimo_numero || 0) + 1; } catch {}
  try { const r = await sql`SELECT ultimo_numero FROM fg_counters WHERE clave='FA' LIMIT 1`; if (r[0]) nextFA = (r[0].ultimo_numero || 0) + 1; } catch {}
  const seed = [
    ["presupuesto", "Presupuesto", "PREV", false, nextPresup, 1],
    ["pedido", "Pedido", "PED", false, nextPed, 2],
    ["remito", "Remito", "REM", false, 1, 3],
    ["factura_a", "Factura A (manual → proforma)", "FA", false, nextFA, 4],
    ["factura_b", "Factura B (manual → proforma)", "FB", false, 1, 5],
    ["factura_a_e", "Factura A Electrónica (AFIP)", "FAE", true, 1, 6],
    ["factura_b_e", "Factura B Electrónica (AFIP)", "FBE", true, 1, 7],
  ];
  for (const [clave, nombre, prefijo, elec, prox, orden] of seed) {
    await sql`INSERT INTO fg_talonarios (clave, nombre, prefijo, electronica, proximo_numero, orden, activo)
      VALUES (${clave}, ${nombre}, ${prefijo}, ${elec}, ${prox}, ${orden}, ${!elec})
      ON CONFLICT (clave) DO NOTHING`;
  }
}

export async function GET() {
  try {
    const sql = getDb();
    await ensure(sql);
    const rows = await sql`SELECT id, clave, nombre, prefijo, serie, proximo_numero, electronica, activo, cai, vencimiento FROM fg_talonarios ORDER BY orden, id`;
    return NextResponse.json({ ok: true, talonarios: rows });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}

// PATCH /api/talonarios  Body: { id, campo, valor }  (serie, proximo_numero, activo, cai, vencimiento)
export async function PATCH(req: NextRequest) {
  try {
    const sql = getDb();
    const { id, campo, valor } = await req.json();
    const ALLOWED = ["serie", "proximo_numero", "activo", "cai", "vencimiento"];
    if (!id || !ALLOWED.includes(campo)) return NextResponse.json({ ok: false, error: "campo inválido" }, { status: 400 });
    if (campo === "proximo_numero") await sql`UPDATE fg_talonarios SET proximo_numero=${Math.max(1, Number(valor) || 1)}, updated_at=now() WHERE id=${id}`;
    else if (campo === "activo") await sql`UPDATE fg_talonarios SET activo=${!!valor}, updated_at=now() WHERE id=${id}`;
    else if (campo === "serie") await sql`UPDATE fg_talonarios SET serie=${String(valor || "").trim()}, updated_at=now() WHERE id=${id}`;
    else if (campo === "cai") await sql`UPDATE fg_talonarios SET cai=${String(valor || "").trim() || null}, updated_at=now() WHERE id=${id}`;
    else if (campo === "vencimiento") await sql`UPDATE fg_talonarios SET vencimiento=${valor || null}, updated_at=now() WHERE id=${id}`;
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}
