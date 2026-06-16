import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Datos en vivo: no cachear (Next cachea GET sin request → datos viejos).
export const dynamic = "force-dynamic";

// GET /api/presupuestos/[id]  → un presupuesto real (para editar en gestión)
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    if (!id) return NextResponse.json({ ok: false, error: "id requerido" }, { status: 400 });
    const sql = getDb();
    const r = await sql`
      SELECT id, numero, COALESCE(tipo,'bomba') AS tipo, estado,
             bomba_codigo, bomba_descripcion, bomba_watts, bomba_marca,
             precio_publico, precio_ofrecido, descuento_pct, tipo_precio,
             cliente_nombre, cliente_apellido, cliente_telefono, cliente_email, cliente_zona,
             cliente_razon_social, cliente_cuit, revendedor_nombre, public_token, created_at
      FROM presupuestos WHERE id = ${id} LIMIT 1`;
    if (!r.length) return NextResponse.json({ ok: false, error: "no encontrado" }, { status: 404 });
    return NextResponse.json({ ok: true, presupuesto: r[0] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// PATCH /api/presupuestos/[id]  → edición NATIVA desde gestión (solo staff autenticado).
// Coti queda 100% público/solo-lectura: TODA edición pasa por acá.
// Body: { descuento_pct?, precio_ofrecido?, precio_publico?, tipo_precio?, estado?,
//         cliente_nombre?, cliente_apellido?, cliente_telefono?, cliente_email?,
//         cliente_zona?, cliente_razon_social?, cliente_cuit? }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    if (!id) return NextResponse.json({ ok: false, error: "id requerido" }, { status: 400 });
    const b = await req.json();
    const n = (v: any) => (v === undefined || v === null || v === "" ? null : v);
    const sql = getDb();

    const r = await sql`
      UPDATE presupuestos SET
        descuento_pct        = COALESCE(${n(b.descuento_pct)}, descuento_pct),
        precio_ofrecido      = COALESCE(${n(b.precio_ofrecido)}, precio_ofrecido),
        precio_publico       = COALESCE(${n(b.precio_publico)}, precio_publico),
        tipo_precio          = COALESCE(${n(b.tipo_precio)}, tipo_precio),
        estado               = COALESCE(${n(b.estado)}, estado),
        cliente_nombre       = COALESCE(${n(b.cliente_nombre)}, cliente_nombre),
        cliente_apellido     = COALESCE(${n(b.cliente_apellido)}, cliente_apellido),
        cliente_telefono     = COALESCE(${n(b.cliente_telefono)}, cliente_telefono),
        cliente_email        = COALESCE(${n(b.cliente_email)}, cliente_email),
        cliente_zona         = COALESCE(${n(b.cliente_zona)}, cliente_zona),
        cliente_razon_social = COALESCE(${n(b.cliente_razon_social)}, cliente_razon_social),
        cliente_cuit         = COALESCE(${n(b.cliente_cuit)}, cliente_cuit)
      WHERE id = ${id}
      RETURNING id, numero`;
    if (!r.length) return NextResponse.json({ ok: false, error: "no encontrado" }, { status: 404 });
    return NextResponse.json({ ok: true, presupuesto: r[0] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
