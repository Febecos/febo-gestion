import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

const digits = (s: string) => (s || "").replace(/\D/g, "");

// POST /api/clientes  → alta/upsert (dedup CUIT→email→whatsapp). Body: campos del cliente.
export async function POST(req: NextRequest) {
  try {
    const sql = getDb();
    const b = await req.json();
    const cuit = digits(b.cuit) || null;
    const email = (b.email || "").trim().toLowerCase() || null;
    const wa = digits(b.whatsapp || b.telefono) || null;
    if (!cuit && !email && !wa)
      return NextResponse.json({ ok: false, error: "Falta CUIT, email o WhatsApp" }, { status: 400 });

    const tipo = b.tipo || "contacto";
    const tags = Array.isArray(b.tags) ? b.tags : [];
    const origenes = ["admin_erp"];

    // Aviso de duplicado: si ya existe por CUIT/email/whatsapp y NO se forzó,
    // devolvemos los datos para que el front muestre el popup "ya existe, ¿seguir?".
    if (!b.forzar) {
      let dup: any[] = [], campo = "";
      if (cuit) { dup = await sql`SELECT id, nombre, cuit, email, whatsapp FROM clientes WHERE cuit = ${cuit} AND (crm_eliminado IS NULL OR crm_eliminado = false) LIMIT 1`; campo = "CUIT"; }
      if (!dup.length && email) { dup = await sql`SELECT id, nombre, cuit, email, whatsapp FROM clientes WHERE lower(email) = ${email} AND (crm_eliminado IS NULL OR crm_eliminado = false) LIMIT 1`; campo = "email"; }
      if (!dup.length && wa) { dup = await sql`SELECT id, nombre, cuit, email, whatsapp FROM clientes WHERE whatsapp = ${wa} AND (crm_eliminado IS NULL OR crm_eliminado = false) LIMIT 1`; campo = "teléfono"; }
      if (dup.length) {
        return NextResponse.json({ ok: false, duplicado: true, campo, existente: dup[0] });
      }
    }

    const ins = await sql`
      INSERT INTO clientes (tipo, nombre, razon_social, email, whatsapp, cuit, domicilio, localidad, provincia, cod_postal, condicion_fiscal, notas, descuento_pct, origen, tags, origenes, primer_contacto_at, ultimo_contacto_at)
      VALUES (${tipo}, ${b.nombre || null}, ${b.razon_social || null}, ${email}, ${wa}, ${cuit}, ${b.domicilio || null}, ${b.localidad || null}, ${b.provincia || null}, ${b.cod_postal || null}, ${b.condicion_fiscal || null}, ${b.notas || null}, ${Number(b.descuento_pct) || 0}, 'admin_erp', ${tags}, ${origenes}, now(), now())
      RETURNING id`;
    return NextResponse.json({ ok: true, id: ins[0].id, accion: "insert" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// GET /api/clientes?q=&tipo=&page=&limit=
// Lee la tabla `clientes` de la Neon central (la misma del admin/CRM).
export async function GET(req: NextRequest) {
  try {
    const sql = getDb();
    const sp = req.nextUrl.searchParams;
    const q = (sp.get("q") || "").trim();
    const tipo = (sp.get("tipo") || "").trim();
    const page = Math.max(1, Number(sp.get("page")) || 1);
    const limit = Math.min(100, Number(sp.get("limit")) || 50);
    const offset = (page - 1) * limit;
    const like = `%${q.toLowerCase()}%`;

    // Filtro por estado (tipo) O por etiqueta (tags), igual que el admin.
    const rows = await sql`
      SELECT id, tipo, nombre, apellido, razon_social, empresa, email, whatsapp, cuit,
             provincia, localidad, cod_postal, domicilio, condicion_fiscal, notas, email_opt_out, descuento_pct,
             tags, origenes, total_presupuestos, total_pedidos, monto_total, ultimo_contacto_at
      FROM clientes
      WHERE (crm_eliminado IS NULL OR crm_eliminado = false)
        AND (${q} = '' OR lower(coalesce(nombre,'')||' '||coalesce(email,'')||' '||coalesce(whatsapp,'')||' '||coalesce(cuit,'')) LIKE ${like})
        AND (${tipo} = '' OR tipo = ${tipo} OR ${tipo} = ANY(tags))
      ORDER BY ultimo_contacto_at DESC NULLS LAST
      LIMIT ${limit} OFFSET ${offset}`;

    const totalRows = await sql`
      SELECT COUNT(*)::int AS n FROM clientes
      WHERE (crm_eliminado IS NULL OR crm_eliminado = false)
        AND (${q} = '' OR lower(coalesce(nombre,'')||' '||coalesce(email,'')||' '||coalesce(whatsapp,'')||' '||coalesce(cuit,'')) LIKE ${like})
        AND (${tipo} = '' OR tipo = ${tipo} OR ${tipo} = ANY(tags))`;

    return NextResponse.json({ ok: true, clientes: rows, total: totalRows[0].n, page, limit });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
