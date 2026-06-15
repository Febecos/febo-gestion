import { NextRequest, NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
import { getDb } from "@/lib/db";
import { esOwner } from "@/lib/owner";
import { tipoPorCodigo } from "@/lib/talonarios-tipos";

// Talonarios = numeración por comprobante (igual a Táctica). Varios talonarios por tipo.
async function ensure(sql: any) {
  await sql`CREATE TABLE IF NOT EXISTS fg_talonarios (
    id SERIAL PRIMARY KEY,
    tipo_codigo TEXT NOT NULL,
    tipo_nombre TEXT,
    electronica BOOLEAN DEFAULT false,
    serie TEXT DEFAULT '',
    sucursal TEXT DEFAULT '0001',
    direccion_sucursal TEXT,
    modelo_impresora TEXT,
    nro_desde BIGINT DEFAULT 1,
    nro_hasta BIGINT,
    proximo_numero BIGINT NOT NULL DEFAULT 1,
    cantidad_max_items INT DEFAULT 0,
    vencimiento DATE,
    cai TEXT,
    nro_autorizacion TEXT,
    fecha_autorizacion DATE,
    es_bono_fiscal BOOLEAN DEFAULT false,
    informar_traslado BOOLEAN DEFAULT false,
    excluir_facturacion BOOLEAN DEFAULT false,
    bloqueado BOOLEAN DEFAULT false,
    defecto BOOLEAN DEFAULT false,
    activo BOOLEAN DEFAULT true,
    orden INT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`;
  const n = await sql`SELECT count(*)::int c FROM fg_talonarios`;
  if (n[0].c > 0) return;
  // Seed inicial: operativos + Factura A/B, tomando el último número de los contadores actuales
  let nextPresup = 1, nextPed = 1, nextFA = 1;
  try { const r = await sql`SELECT ultimo_numero FROM presupuestos_counter ORDER BY anio DESC LIMIT 1`; if (r[0]) nextPresup = (r[0].ultimo_numero || 0) + 1; } catch {}
  try { const r = await sql`SELECT ultimo_numero FROM pedidos_counter WHERE clave='PED' LIMIT 1`; if (r[0]) nextPed = (r[0].ultimo_numero || 0) + 1; } catch {}
  try { const r = await sql`SELECT ultimo_numero FROM fg_counters WHERE clave='FA' LIMIT 1`; if (r[0]) nextFA = (r[0].ultimo_numero || 0) + 1; } catch {}
  const seed: [string, number, boolean][] = [
    ["PRESUP", nextPresup, true], ["PED", nextPed, true], ["REM", 1, true], ["FAA", nextFA, true], ["FAB", 1, true],
  ];
  let orden = 0;
  for (const [cod, prox, def] of seed) {
    const t = tipoPorCodigo(cod)!;
    await sql`INSERT INTO fg_talonarios (tipo_codigo, tipo_nombre, electronica, sucursal, nro_desde, nro_hasta, proximo_numero, defecto, activo, orden)
      VALUES (${cod}, ${t.nombre}, ${t.electronica}, '0001', 1, 99999999, ${prox}, ${def}, true, ${orden++})`;
  }
}

export async function GET(req: NextRequest) {
  try {
    if (!(await esOwner(req))) return NextResponse.json({ ok: false, error: "Solo el administrador (owner) puede ver Talonarios." }, { status: 403 });
    const sql = getDb();
    await ensure(sql);
    const rows = await sql`SELECT * FROM fg_talonarios ORDER BY orden, id`;
    return NextResponse.json({ ok: true, talonarios: rows });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}

// POST → crear talonario { tipo_codigo }
export async function POST(req: NextRequest) {
  try {
    if (!(await esOwner(req))) return NextResponse.json({ ok: false, error: "no autorizado" }, { status: 403 });
    const { tipo_codigo } = await req.json();
    const t = tipoPorCodigo(tipo_codigo);
    if (!t) return NextResponse.json({ ok: false, error: "tipo inválido" }, { status: 400 });
    const sql = getDb(); await ensure(sql);
    // Domicilio LEGAL (ARCA) por defecto desde fg_empresa. La sucursal/pto. de venta es manual.
    let domicilioLegal: string | null = null;
    try {
      const e = await sql`SELECT domicilio, localidad, provincia FROM fg_empresa WHERE id=1`;
      if (e[0]) domicilioLegal = [e[0].domicilio, e[0].localidad, e[0].provincia].filter(Boolean).join(", ") || null;
    } catch {}
    const r = await sql`INSERT INTO fg_talonarios (tipo_codigo, tipo_nombre, electronica, sucursal, direccion_sucursal, nro_desde, nro_hasta, proximo_numero, activo)
      VALUES (${t.codigo}, ${t.nombre}, ${t.electronica}, '0001', ${domicilioLegal}, 1, 99999999, 1, true) RETURNING id`;
    return NextResponse.json({ ok: true, id: r[0].id });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}

const CAMPOS: Record<string, "num" | "bool" | "text" | "date"> = {
  serie: "text", sucursal: "text", direccion_sucursal: "text", modelo_impresora: "text", cai: "text", nro_autorizacion: "text",
  nro_desde: "num", nro_hasta: "num", proximo_numero: "num", cantidad_max_items: "num",
  vencimiento: "date", fecha_autorizacion: "date",
  es_bono_fiscal: "bool", informar_traslado: "bool", excluir_facturacion: "bool", bloqueado: "bool", defecto: "bool", activo: "bool",
};

// PATCH → { id, campo, valor }  (columna de whitelist → seguro inline con Pool)
export async function PATCH(req: NextRequest) {
  try {
    if (!(await esOwner(req))) return NextResponse.json({ ok: false, error: "no autorizado" }, { status: 403 });
    const { id, campo, valor } = await req.json();
    const tipo = CAMPOS[campo];
    if (!id || !tipo) return NextResponse.json({ ok: false, error: "campo inválido" }, { status: 400 });
    let v: any = valor;
    if (tipo === "num") v = (valor === "" || valor == null) ? null : Number(valor);
    else if (tipo === "bool") v = !!valor;
    else if (tipo === "date") v = valor || null;
    else v = String(valor ?? "").trim() || null;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try { await pool.query(`UPDATE fg_talonarios SET ${campo}=$1, updated_at=now() WHERE id=$2`, [v, id]); }
    finally { await pool.end(); }
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}

// DELETE ?id=
export async function DELETE(req: NextRequest) {
  try {
    if (!(await esOwner(req))) return NextResponse.json({ ok: false, error: "no autorizado" }, { status: 403 });
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!id) return NextResponse.json({ ok: false, error: "id requerido" }, { status: 400 });
    const sql = getDb();
    await sql`DELETE FROM fg_talonarios WHERE id=${id}`;
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}
