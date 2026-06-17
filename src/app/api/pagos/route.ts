import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Datos en vivo: no cachear (Next cachea GET sin request → datos viejos).
export const dynamic = "force-dynamic";

// GET /api/pagos  → pagos registrados (`fg_pagos`), con datos del comprobante.
export async function GET(_req: NextRequest) {
  try {
    const sql = getDb();
    let rows: any[] = [];
    try {
      rows = await sql`
        SELECT p.id, p.monto, p.fecha, p.medio, p.notas, p.created_at,
               c.numero AS comprobante_numero, c.tipo AS comprobante_tipo,
               COALESCE(NULLIF(cli.nombre,''), NULLIF(cli.razon_social,''), c.cliente_nombre) AS cliente_nombre
        FROM fg_pagos p
        LEFT JOIN fg_comprobantes c ON c.id = p.comprobante_id
        LEFT JOIN clientes cli ON cli.id = COALESCE(p.cliente_id, c.cliente_id) AND (cli.crm_eliminado IS NULL OR cli.crm_eliminado = false)
        ORDER BY p.created_at DESC LIMIT 300` as any[];
    } catch { rows = []; }
    return NextResponse.json({ ok: true, pagos: rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
