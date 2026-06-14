import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// GET /api/pedidos-proveedor  → órdenes a proveedor (`pedidos_proveedores`).
export async function GET(_req: NextRequest) {
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT id, proveedor, fv_numero, total_costo_usd, estado, created_at,
             gsa_numero, numero_remito, proveedor_confirmado
      FROM pedidos_proveedores ORDER BY created_at DESC LIMIT 300`;
    return NextResponse.json({ ok: true, pedidos: rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
