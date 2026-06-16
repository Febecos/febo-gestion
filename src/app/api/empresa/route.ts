import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { esOwner } from "@/lib/owner";

// Datos en vivo: no cachear (Next cachea GET sin request → datos viejos).
export const dynamic = "force-dynamic";

// Datos fiscales/legales del emisor (FEBECOS) según AFIP/ARCA. Fila única.
async function ensure(sql: any) {
  await sql`CREATE TABLE IF NOT EXISTS fg_empresa (
    id INT PRIMARY KEY DEFAULT 1,
    cuit TEXT, razon_social TEXT, nombre_fantasia TEXT,
    domicilio TEXT, localidad TEXT, provincia TEXT, cod_postal TEXT,
    condicion_iva TEXT, iibb TEXT, inicio_actividades TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`INSERT INTO fg_empresa (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;
}

export async function GET(req: NextRequest) {
  try {
    if (!(await esOwner(req))) return NextResponse.json({ ok: false, error: "Solo el administrador puede ver los datos de la empresa." }, { status: 403 });
    const sql = getDb(); await ensure(sql);
    const r = await sql`SELECT * FROM fg_empresa WHERE id=1`;
    return NextResponse.json({ ok: true, empresa: r[0] || {} });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}

const CAMPOS = ["cuit", "razon_social", "nombre_fantasia", "domicilio", "localidad", "provincia", "cod_postal", "condicion_iva", "iibb", "inicio_actividades"];

// PATCH { campo, valor }  ó  { bulk: {campo:valor,...} } para guardar varios (traer de ARCA)
export async function PATCH(req: NextRequest) {
  try {
    if (!(await esOwner(req))) return NextResponse.json({ ok: false, error: "no autorizado" }, { status: 403 });
    const body = await req.json();
    const sql = getDb(); await ensure(sql);
    const entries: [string, any][] = body.bulk ? Object.entries(body.bulk) : [[body.campo, body.valor]];
    for (const [campo, valor] of entries) {
      if (!CAMPOS.includes(campo)) continue;
      const v = String(valor ?? "").trim() || null;
      // columna de whitelist → seguro
      const { Pool } = await import("@neondatabase/serverless");
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      try { await pool.query(`UPDATE fg_empresa SET ${campo}=$1, updated_at=now() WHERE id=1`, [v]); }
      finally { await pool.end(); }
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}
