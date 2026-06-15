import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { esOwner } from "@/lib/owner";

// Interruptor del monitor mensual de normativa ARCA (cron en el selector lee arca_watch.activo).
async function ensure(sql: any) {
  await sql`CREATE TABLE IF NOT EXISTS arca_watch (id INT PRIMARY KEY DEFAULT 1, last_summary TEXT, last_run TIMESTAMPTZ, last_items JSONB, activo BOOLEAN DEFAULT false)`;
  await sql`ALTER TABLE arca_watch ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT false`.catch(() => {});
  await sql`INSERT INTO arca_watch (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;
}

export async function GET(req: NextRequest) {
  try {
    if (!(await esOwner(req))) return NextResponse.json({ ok: false, error: "Solo el administrador (owner)." }, { status: 403 });
    const sql = getDb(); await ensure(sql);
    const r = await sql`SELECT activo, last_run, last_summary FROM arca_watch WHERE id=1` as any[];
    return NextResponse.json({ ok: true, activo: !!r[0]?.activo, last_run: r[0]?.last_run || null, last_summary: r[0]?.last_summary || null });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  try {
    if (!(await esOwner(req))) return NextResponse.json({ ok: false, error: "no autorizado" }, { status: 403 });
    const { activo } = await req.json();
    const sql = getDb(); await ensure(sql);
    await sql`UPDATE arca_watch SET activo=${!!activo} WHERE id=1`;
    return NextResponse.json({ ok: true, activo: !!activo });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}
