import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// POST /api/public/track  { tipo, dato, movil }  -> registra un evento ANONIMO del visor de precios
// (medir demanda - pedido de Guille 07/07). Publico (bajo /api/public/, sin auth). NO guarda ninguna
// PII: solo tipo de evento + un dato corto (busqueda/rubro/codigo) + si es celu. Fire-and-forget.
const TIPOS = new Set(["visita", "busqueda", "rubro", "detalle"]);

export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const tipo = String(b?.tipo || "");
    if (!TIPOS.has(tipo)) return new NextResponse(null, { status: 204 }); // ignora lo desconocido
    const dato = String(b?.dato || "").trim().slice(0, 120) || null; // corto; conserva espacios/guiones (codigos)
    const movil = !!b?.movil;

    const sql = getDb();
    await sql`CREATE TABLE IF NOT EXISTS visor_eventos (
      id BIGSERIAL PRIMARY KEY, tipo TEXT NOT NULL, dato TEXT, movil BOOLEAN,
      creado TIMESTAMPTZ DEFAULT now())`.catch(() => {});
    await sql`INSERT INTO visor_eventos (tipo, dato, movil) VALUES (${tipo}, ${dato}, ${movil})`.catch(() => {});
    return new NextResponse(null, { status: 204 });
  } catch {
    return new NextResponse(null, { status: 204 }); // nunca romper por el tracking
  }
}
