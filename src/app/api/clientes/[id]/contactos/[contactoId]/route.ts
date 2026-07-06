import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// PATCH /api/clientes/:id/contactos/:contactoId  Body: { field, value }  (un campo por llamada)
const ALLOWED = new Set(["nombre", "apellido", "email", "telefono", "cargo"]);
export async function PATCH(req: NextRequest, { params }: { params: { id: string; contactoId: string } }) {
  try {
    const clienteId = Number(params.id);
    const contactoId = Number(params.contactoId);
    if (!clienteId || !contactoId) return NextResponse.json({ ok: false, error: "id requerido" }, { status: 400 });
    const { field, value } = await req.json();
    if (!ALLOWED.has(field)) return NextResponse.json({ ok: false, error: `campo '${field}' no permitido` }, { status: 403 });
    const sql = getDb();
    const col = field as "nombre" | "apellido" | "email" | "telefono" | "cargo";
    const map: Record<string, any> = {
      nombre: sql`UPDATE cliente_contactos SET nombre=${value} WHERE id=${contactoId} AND cliente_id=${clienteId}`,
      apellido: sql`UPDATE cliente_contactos SET apellido=${value} WHERE id=${contactoId} AND cliente_id=${clienteId}`,
      email: sql`UPDATE cliente_contactos SET email=${value} WHERE id=${contactoId} AND cliente_id=${clienteId}`,
      telefono: sql`UPDATE cliente_contactos SET telefono=${value} WHERE id=${contactoId} AND cliente_id=${clienteId}`,
      cargo: sql`UPDATE cliente_contactos SET cargo=${value} WHERE id=${contactoId} AND cliente_id=${clienteId}`,
    };
    await map[col];
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// DELETE /api/clientes/:id/contactos/:contactoId
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; contactoId: string } }) {
  try {
    const clienteId = Number(params.id);
    const contactoId = Number(params.contactoId);
    if (!clienteId || !contactoId) return NextResponse.json({ ok: false, error: "id requerido" }, { status: 400 });
    const sql = getDb();
    await sql`DELETE FROM cliente_contactos WHERE id=${contactoId} AND cliente_id=${clienteId}`;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
