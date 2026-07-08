import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// POST /api/public/track  { tipo, dato, movil, rev }  -> registra un evento ANONIMO del visor de
// precios (medir demanda - pedido de Guille 07/07). Publico (bajo /api/public/, sin auth). NO guarda
// PII: tipo + dato corto (busqueda/rubro/codigo/referer) + celu + rev (token del revendedor si el
// link venia con ?rev=TOKEN -> atribucion; hoy el visor esta ABIERTO, pero asi ya sabemos quien mira
// cuando comparte con su token, y queda la base para gatear por token en la fase 2). Fire-and-forget.
const TIPOS = new Set(["visita", "busqueda", "rubro", "detalle"]);

export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const tipo = String(b?.tipo || "");
    if (!TIPOS.has(tipo)) return new NextResponse(null, { status: 204 });
    const dato = String(b?.dato || "").trim().slice(0, 120) || null;
    const rev = String(b?.rev || "").trim().slice(0, 80) || null;
    const movil = !!b?.movil;

    const sql = getDb();
    await sql`CREATE TABLE IF NOT EXISTS visor_eventos (
      id BIGSERIAL PRIMARY KEY, tipo TEXT NOT NULL, dato TEXT, movil BOOLEAN, rev TEXT,
      creado TIMESTAMPTZ DEFAULT now())`.catch(() => {});
    await sql`ALTER TABLE visor_eventos ADD COLUMN IF NOT EXISTS rev TEXT`.catch(() => {});
    await sql`INSERT INTO visor_eventos (tipo, dato, movil, rev) VALUES (${tipo}, ${dato}, ${movil}, ${rev})`.catch(() => {});
    return new NextResponse(null, { status: 204 });
  } catch {
    return new NextResponse(null, { status: 204 });
  }
}
