import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Contactos NOMBRADOS de una empresa (cliente/revendedor o cliente final) — ej. "Juan Pérez,
// administrativo" además de "María Gómez, compras" en la misma cuenta. Distinto de `contacts`
// (mensajería WhatsApp/febo-rev) y del contacto ÚNICO de la ficha (clientes.nombre/email/whatsapp).
// Aditivo, propio de CRM — no toca facturación.

async function ensureTabla(sql: any) {
  await sql`CREATE TABLE IF NOT EXISTS cliente_contactos (
    id SERIAL PRIMARY KEY,
    cliente_id INT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    nombre TEXT, apellido TEXT, email TEXT, telefono TEXT, cargo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS cliente_contactos_cliente_id_idx ON cliente_contactos (cliente_id)`;
}

// GET /api/clientes/:id/contactos → lista los contactos nombrados de la empresa :id
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    if (!id) return NextResponse.json({ ok: false, error: "id requerido" }, { status: 400 });
    const sql = getDb();
    await ensureTabla(sql);
    const rows = await sql`SELECT id, nombre, apellido, email, telefono, cargo, created_at FROM cliente_contactos WHERE cliente_id = ${id} ORDER BY created_at ASC`;
    return NextResponse.json({ ok: true, contactos: rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// POST /api/clientes/:id/contactos  Body: { nombre, apellido, email, telefono, cargo }
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    if (!id) return NextResponse.json({ ok: false, error: "id requerido" }, { status: 400 });
    const b = await req.json();
    if (!(b.nombre || "").trim()) return NextResponse.json({ ok: false, error: "nombre requerido" }, { status: 400 });
    const sql = getDb();
    await ensureTabla(sql);
    const r = await sql`
      INSERT INTO cliente_contactos (cliente_id, nombre, apellido, email, telefono, cargo)
      VALUES (${id}, ${b.nombre || null}, ${b.apellido || null}, ${b.email || null}, ${b.telefono || null}, ${b.cargo || null})
      RETURNING id`;
    return NextResponse.json({ ok: true, id: r[0].id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
