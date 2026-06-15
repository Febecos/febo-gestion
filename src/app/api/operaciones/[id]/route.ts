import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// POST /api/operaciones/[id]  Body: { accion, notas? }
//   reservar_proveedor | confirmar_cliente | pagar_cliente | pagar_proveedor | anular | facturar
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    const b = await req.json();
    if (!id || !b.accion) return NextResponse.json({ ok: false, error: "id y acción requeridos" }, { status: 400 });
    const sql = getDb();

    if (b.accion === "facturar") {
      // Numerador de facturas (FA-NNNN) compartido, atómico.
      await sql`CREATE TABLE IF NOT EXISTS fg_counters (clave TEXT PRIMARY KEY, ultimo_numero INT NOT NULL DEFAULT 0)`;
      await sql`INSERT INTO fg_counters (clave, ultimo_numero) VALUES ('FA', 0) ON CONFLICT (clave) DO NOTHING`;
      const nr = await sql`UPDATE fg_counters SET ultimo_numero = ultimo_numero + 1 WHERE clave='FA' RETURNING ultimo_numero`;
      const facturaNum = "FA-" + String(nr[0].ultimo_numero).padStart(6, "0");
      const r = await sql`
        UPDATE fg_operaciones
        SET estado='facturado', facturado_at=now(), factura_numero=${facturaNum}, updated_at=now()
        WHERE id=${id} RETURNING id, factura_numero`;
      if (!r.length) return NextResponse.json({ ok: false, error: "no encontrada" }, { status: 404 });
      return NextResponse.json({ ok: true, factura_numero: r[0].factura_numero });
    }

    const notas = b.notas ?? null;
    let estado = "";
    switch (b.accion) {
      case "reservar_proveedor":
        estado = "reservado_proveedor";
        await sql`UPDATE fg_operaciones SET estado=${estado}, proveedor_reservado_at=now(), notas=COALESCE(${notas},notas), updated_at=now() WHERE id=${id}`;
        break;
      case "confirmar_cliente":
        estado = "confirmado_cliente";
        await sql`UPDATE fg_operaciones SET estado=${estado}, confirmado_cliente_at=now(), notas=COALESCE(${notas},notas), updated_at=now() WHERE id=${id}`;
        break;
      case "pagar_cliente":
        estado = "pagado_cliente";
        await sql`UPDATE fg_operaciones SET estado=${estado}, pagado_cliente_at=now(), notas=COALESCE(${notas},notas), updated_at=now() WHERE id=${id}`;
        break;
      case "pagar_proveedor":
        estado = "pagado_proveedor";
        await sql`UPDATE fg_operaciones SET estado=${estado}, pagado_proveedor_at=now(), notas=COALESCE(${notas},notas), updated_at=now() WHERE id=${id}`;
        break;
      case "anular":
        estado = "anulado";
        await sql`UPDATE fg_operaciones SET estado=${estado}, notas=COALESCE(${notas},notas), updated_at=now() WHERE id=${id}`;
        break;
      default:
        return NextResponse.json({ ok: false, error: "acción inválida" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, estado });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
