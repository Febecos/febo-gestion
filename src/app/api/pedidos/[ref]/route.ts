import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// GET /api/pedidos/[ref]  → detalle completo de un pedido (FV: fv_pedidos por numero; bomba: pedidos por id)
export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  try {
    const sql = getDb();
    const ref = decodeURIComponent(params.ref);
    let dolar = 0;
    try { const c = await sql`SELECT data FROM fv_config WHERE id=1`; dolar = Number((c[0] as any)?.data?.dolar) || 0; } catch {}

    const fv = await sql`SELECT numero, estado, public_token, payload, recibido FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[];
    if (fv.length) {
      const p = fv[0];
      // nombre canónico del cliente desde el presupuesto/CRM
      let cliente_id: number | null = null;
      const presupNum = p.payload?.presupuesto_numero;
      if (presupNum) {
        const pr = await sql`SELECT cliente_id FROM presupuestos WHERE numero=${presupNum} LIMIT 1` as any[];
        cliente_id = pr[0]?.cliente_id ?? null;
      }
      return NextResponse.json({ ok: true, pedido: {
        origen: "fv", numero: p.numero, estado: p.estado || "pendiente_confirmacion",
        public_token: p.public_token, payload: p.payload || {}, dolar, fecha: p.recibido, cliente_id,
      }});
    }

    // Bomba: tabla pedidos (PK uuid)
    const b = await sql`SELECT id, numero, estado, revendedor_nombre, bomba_codigo, bomba_descripcion, precio_final, tipo_comprador, created_at FROM pedidos WHERE id::text=${ref} OR numero=${ref} LIMIT 1` as any[];
    if (b.length) {
      const p = b[0];
      return NextResponse.json({ ok: true, pedido: {
        origen: "bomba", numero: p.numero || p.id, estado: p.estado || "—", dolar, fecha: p.created_at,
        payload: { revendedor: { nombre: p.revendedor_nombre }, items: [{ codigo: p.bomba_codigo, descripcion: p.bomba_descripcion, cantidad: 1, subtotal: p.precio_final }], totales: { total: p.precio_final, moneda: "ARS" } },
      }});
    }
    return NextResponse.json({ ok: false, error: "pedido no encontrado" }, { status: 404 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

const ESTADOS_FV = ["pendiente_confirmacion", "aprobado", "pagado", "enviado", "cancelado"];

// POST /api/pedidos/[ref]  Body: { accion: 'estado'|'nota'|'envio', estado?, nota?, envio? }
export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  try {
    const sql = getDb();
    const ref = decodeURIComponent(params.ref);
    const b = await req.json();
    const esFv = (await sql`SELECT 1 FROM fv_pedidos WHERE numero=${ref} LIMIT 1` as any[]).length > 0;

    if (b.accion === "estado") {
      if (!ESTADOS_FV.includes(b.estado)) return NextResponse.json({ ok: false, error: "estado inválido" }, { status: 400 });
      if (esFv) await sql`UPDATE fv_pedidos SET estado=${b.estado} WHERE numero=${ref}`;
      else await sql`UPDATE pedidos SET estado=${b.estado} WHERE id::text=${ref} OR numero=${ref}`;
      return NextResponse.json({ ok: true, estado: b.estado });
    }
    if (b.accion === "nota") {
      if (esFv) await sql`UPDATE fv_pedidos SET payload = jsonb_set(coalesce(payload,'{}'::jsonb), '{notas_internas}', to_jsonb(${b.nota || ""}::text)) WHERE numero=${ref}`;
      return NextResponse.json({ ok: true });
    }
    if (b.accion === "envio") {
      if (esFv) await sql`UPDATE fv_pedidos SET payload = jsonb_set(coalesce(payload,'{}'::jsonb), '{envio}', ${JSON.stringify(b.envio || {})}::jsonb) WHERE numero=${ref}`;
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "acción inválida" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
