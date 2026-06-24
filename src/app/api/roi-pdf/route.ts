import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

// GET /api/roi-pdf?lead_id=NNN
// Genera el PDF del análisis ROI (FBC) que vive en el simulador (roi.febecos.com).
// El simulador lo entrega por un token de un solo uso (tabla pdf_download_tokens, en la
// MISMA Neon central que gestión comparte). Acá minteamos el token y redirigimos.
// Requiere sesión (middleware): solo usuarios logueados de gestión.
export async function GET(req: NextRequest) {
  try {
    const leadId = Number(req.nextUrl.searchParams.get("lead_id"));
    if (!leadId) return NextResponse.json({ ok: false, error: "lead_id requerido" }, { status: 400 });
    const sql = getDb();
    await sql`CREATE TABLE IF NOT EXISTS pdf_download_tokens (
      token TEXT PRIMARY KEY,
      lead_id INTEGER NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '15 minutes',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`.catch(() => {});
    // Validar que el lead exista (evita mintear tokens para ids inválidos).
    const lr = await sql`SELECT id FROM leads_roi WHERE id = ${leadId} LIMIT 1` as any[];
    if (!lr.length) return NextResponse.json({ ok: false, error: "FBC no encontrado" }, { status: 404 });
    const token = randomBytes(24).toString("hex");
    await sql`INSERT INTO pdf_download_tokens (token, lead_id) VALUES (${token}, ${leadId})`;
    return NextResponse.redirect(`https://roi.febecos.com/api/admin-pdf-download?token=${token}`);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
