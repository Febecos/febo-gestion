import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// GET /api/pagos  → pagos registrados (`fg_pagos`), con datos del comprobante.
export async function GET(_req: NextRequest) {
  try {
    const sql = getDb();
    let rows: any[] = [];
    try {
      rows = await sql`
        SELECT p.id, p.monto, p.fecha, p.medio, p.notas, p.created_at,
               c.numero AS comprobante_numero, c.tipo AS comprobante_tipo, c.cliente_nombre
        FROM fg_pagos p
        LEFT JOIN fg_comprobantes c ON c.id = p.comprobante_id
        ORDER BY p.created_at DESC LIMIT 300` as any[];
    } catch { rows = []; }
    return NextResponse.json({ ok: true, pagos: rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
