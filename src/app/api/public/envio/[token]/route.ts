import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Datos en vivo: no cachear.
export const dynamic = "force-dynamic";

// GET /api/public/envio/[token] → datos del pedido + envío cargado (por public_token de fv_pedidos).
// Público: el token aleatorio del pedido es la credencial. Solo expone lo necesario para el form.
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const token = (params.token || "").trim();
    if (!token) return NextResponse.json({ ok: false, error: "token requerido" }, { status: 400 });
    const sql = getDb();
    const r = await sql`SELECT numero, payload FROM fv_pedidos WHERE public_token = ${token} LIMIT 1` as any[];
    if (!r.length) return NextResponse.json({ ok: false, error: "pedido no encontrado" }, { status: 404 });
    const pl = r[0].payload || {};
    const rev = pl.revendedor || pl.cliente || {};
    const envio = pl.envio || {};
    return NextResponse.json({
      ok: true,
      numero: r[0].numero,
      cliente_nombre: rev.nombre || "",
      completado: !!envio.completado,
      envio,
    });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}

// POST /api/public/envio/[token] → el cliente guarda sus datos de envío en payload.envio.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const token = (params.token || "").trim();
    if (!token) return NextResponse.json({ ok: false, error: "token requerido" }, { status: 400 });
    const body = await req.json();
    const e = body.envio || {};
    // Campos obligatorios mínimos para poder despachar.
    const falta = ["nombre", "direccion", "localidad", "provincia"].filter((k) => !String(e[k] || "").trim());
    if (falta.length) return NextResponse.json({ ok: false, error: "Faltan datos obligatorios: " + falta.join(", ") }, { status: 400 });

    const sql = getDb();
    const r = await sql`SELECT payload FROM fv_pedidos WHERE public_token = ${token} LIMIT 1` as any[];
    if (!r.length) return NextResponse.json({ ok: false, error: "pedido no encontrado" }, { status: 404 });
    const prev = (r[0].payload || {}).envio || {};
    const limpio = (v: any) => String(v ?? "").trim();
    const envio = {
      ...prev,
      nombre: limpio(e.nombre), dni: limpio(e.dni), telefono: limpio(e.telefono), email: limpio(e.email),
      direccion: limpio(e.direccion), localidad: limpio(e.localidad), provincia: limpio(e.provincia), cp: limpio(e.cp),
      empresa: limpio(e.empresa), tipo_envio: limpio(e.tipo_envio), domicilio_transporte: limpio(e.domicilio_transporte),
      telefono_transporte: limpio(e.telefono_transporte), valor_declarado: limpio(e.valor_declarado),
      completado: true, completado_at: new Date().toISOString(), cargado_por: "cliente",
    };
    await sql`UPDATE fv_pedidos SET payload = jsonb_set(coalesce(payload,'{}'::jsonb), '{envio}', ${JSON.stringify(envio)}::jsonb) WHERE public_token = ${token}`;
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}
