import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// GET /api/public/[token]  → comprobante + ítems + datos del cliente, SOLO por token.
// Público (sin sesión): el token aleatorio es la credencial.
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const token = (params.token || "").trim();
    if (!token) return NextResponse.json({ ok: false, error: "token requerido" }, { status: 400 });
    const sql = getDb();

    const comp = await sql`SELECT * FROM fg_comprobantes WHERE token = ${token} LIMIT 1`;
    if (!comp.length) return NextResponse.json({ ok: false, error: "no encontrado" }, { status: 404 });
    const c = comp[0] as any;

    const items = await sql`SELECT descripcion, cantidad, precio_unitario, descuento_pct, total FROM fg_items WHERE comprobante_id = ${c.id} ORDER BY orden`;

    let cliente: any = null;
    if (c.cliente_id) {
      const cl = await sql`
        SELECT nombre, razon_social, cuit, condicion_fiscal, domicilio, localidad, provincia, cod_postal, email, whatsapp
        FROM clientes WHERE id = ${c.cliente_id} LIMIT 1`;
      cliente = cl[0] || null;
    }

    return NextResponse.json({ ok: true, comprobante: c, items, cliente });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
