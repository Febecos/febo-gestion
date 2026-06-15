import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureCtaCte, movCtaCte } from "@/lib/ctacte";
import { esOwner } from "@/lib/owner";

async function getDolar(sql: any): Promise<number> {
  try { const c = await sql`SELECT data FROM fv_config WHERE id=1`; return Number((c[0] as any)?.data?.dolar) || 0; } catch { return 0; }
}

// GET /api/ctacte?ambito=cliente&cliente_id=123
// GET /api/ctacte?ambito=proveedor&proveedor=Multiradio
// GET /api/ctacte?listar=clientes | proveedores   → saldos por entidad
export async function GET(req: NextRequest) {
  try {
    const sql = getDb();
    await ensureCtaCte(sql);
    const sp = req.nextUrl.searchParams;
    const listar = sp.get("listar");
    const dolar = await getDolar(sql);

    if (listar === "clientes") {
      const rows = await sql`
        SELECT c.cliente_id, COALESCE(cl.nombre, cl.razon_social, '—') AS nombre,
               SUM(c.debe)::numeric AS debe, SUM(c.haber)::numeric AS haber,
               (SUM(c.debe) - SUM(c.haber))::numeric AS saldo
        FROM fg_ctacte c LEFT JOIN clientes cl ON cl.id = c.cliente_id
        WHERE c.ambito='cliente' GROUP BY c.cliente_id, cl.nombre, cl.razon_social
        HAVING ABS(SUM(c.debe) - SUM(c.haber)) > 0.01 ORDER BY saldo DESC`;
      return NextResponse.json({ ok: true, cuentas: rows, dolar });
    }
    if (listar === "proveedores") {
      const rows = await sql`
        SELECT c.proveedor AS nombre,
               SUM(c.debe)::numeric AS debe, SUM(c.haber)::numeric AS haber,
               (SUM(c.haber) - SUM(c.debe))::numeric AS saldo
        FROM fg_ctacte c WHERE c.ambito='proveedor' AND c.proveedor IS NOT NULL
        GROUP BY c.proveedor HAVING ABS(SUM(c.haber) - SUM(c.debe)) > 0.01 ORDER BY saldo DESC`;
      return NextResponse.json({ ok: true, cuentas: rows, dolar });
    }

    const ambito = sp.get("ambito");
    if (ambito === "cliente") {
      const cid = Number(sp.get("cliente_id"));
      if (!cid) return NextResponse.json({ ok: false, error: "cliente_id requerido" }, { status: 400 });
      const movs = await sql`SELECT * FROM fg_ctacte WHERE ambito='cliente' AND cliente_id=${cid} ORDER BY fecha, created_at, id`;
      const saldo = movs.reduce((a: number, m: any) => a + Number(m.debe) - Number(m.haber), 0);
      return NextResponse.json({ ok: true, movimientos: movs, saldo: +saldo.toFixed(2), orientacion: "cliente_debe_si_positivo", dolar });
    }
    if (ambito === "proveedor") {
      const prov = sp.get("proveedor") || "";
      if (!prov) return NextResponse.json({ ok: false, error: "proveedor requerido" }, { status: 400 });
      const movs = await sql`SELECT * FROM fg_ctacte WHERE ambito='proveedor' AND proveedor=${prov} ORDER BY fecha, created_at, id`;
      const saldo = movs.reduce((a: number, m: any) => a + Number(m.haber) - Number(m.debe), 0);
      return NextResponse.json({ ok: true, movimientos: movs, saldo: +saldo.toFixed(2), orientacion: "le_debemos_si_positivo", dolar });
    }
    return NextResponse.json({ ok: false, error: "parámetros inválidos" }, { status: 400 });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}

// POST → movimiento MANUAL { ambito, cliente_id?|proveedor?, fecha?, concepto, debe?, haber?, nota? }
export async function POST(req: NextRequest) {
  try {
    const sql = getDb();
    const b = await req.json();
    if (b.ambito !== "cliente" && b.ambito !== "proveedor") return NextResponse.json({ ok: false, error: "ámbito inválido" }, { status: 400 });
    if (!b.concepto) return NextResponse.json({ ok: false, error: "concepto requerido" }, { status: 400 });
    const uniq = `man:${b.ambito}:${b.cliente_id || b.proveedor}:${b.fecha || ""}:${b.concepto}:${b.debe || 0}:${b.haber || 0}:${Math.round(Math.random() * 1e9)}`;
    await movCtaCte(sql, {
      ambito: b.ambito, cliente_id: b.cliente_id ?? null, proveedor: b.proveedor ?? null,
      fecha: b.fecha || null, concepto: b.concepto, comprobante: b.comprobante || null,
      debe: Number(b.debe) || 0, haber: Number(b.haber) || 0, detalle: { manual: true, nota: b.nota || "" }, uniq,
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}

// DELETE ?id=     → borra un movimiento (manual)
// DELETE ?reset=1 → PONE EN CERO toda la cta cte (solo owner; útil tras las pruebas)
export async function DELETE(req: NextRequest) {
  try {
    const sql = getDb();
    const sp = new URL(req.url).searchParams;
    if (sp.get("reset") === "1") {
      if (!(await esOwner(req))) return NextResponse.json({ ok: false, error: "Solo el administrador (owner) puede poner en cero la cuenta corriente." }, { status: 403 });
      await ensureCtaCte(sql);
      await sql`TRUNCATE fg_ctacte`;
      return NextResponse.json({ ok: true, reset: true });
    }
    const id = Number(sp.get("id"));
    if (!id) return NextResponse.json({ ok: false, error: "id requerido" }, { status: 400 });
    await sql`DELETE FROM fg_ctacte WHERE id=${id}`;
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}
