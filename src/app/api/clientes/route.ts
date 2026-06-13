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

    // buscar existente: CUIT → email → whatsapp
    let found: any[] = [];
    if (cuit) found = await sql`SELECT id FROM clientes WHERE cuit = ${cuit} LIMIT 1`;
    if (!found.length && email) found = await sql`SELECT id FROM clientes WHERE lower(email) = ${email} LIMIT 1`;
    if (!found.length && wa) found = await sql`SELECT id FROM clientes WHERE whatsapp = ${wa} LIMIT 1`;

    const tipo = b.tipo || "contacto";
    const tags = Array.isArray(b.tags) ? b.tags : [];
    const origenes = ["admin_erp"];

    if (found.length) {
      const id = found[0].id;
      await sql`
        UPDATE clientes SET
          tipo = COALESCE(${tipo}, tipo),
          nombre = COALESCE(${b.nombre || null}, nombre),
          razon_social = COALESCE(${b.razon_social || null}, razon_social),
          email = COALESCE(${email}, email), whatsapp = COALESCE(${wa}, whatsapp), cuit = COALESCE(${cuit}, cuit),
          domicilio = COALESCE(${b.domicilio || null}, domicilio), localidad = COALESCE(${b.localidad || null}, localidad),
          provincia = COALESCE(${b.provincia || null}, provincia), cod_postal = COALESCE(${b.cod_postal || null}, cod_postal),
          condicion_fiscal = COALESCE(${b.condicion_fiscal || null}, condicion_fiscal), notas = COALESCE(${b.notas || null}, notas),
          tags = (SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(tags,'{}') || ${tags}::text[]))),
          ultimo_contacto_at = now(), updated_at = now()
        WHERE id = ${id}`;
      return NextResponse.json({ ok: true, id, accion: "update" });
    }
    const ins = await sql`
      INSERT INTO clientes (tipo, nombre, razon_social, email, whatsapp, cuit, domicilio, localidad, provincia, cod_postal, condicion_fiscal, notas, origen, tags, origenes, primer_contacto_at, ultimo_contacto_at)
      VALUES (${tipo}, ${b.nombre || null}, ${b.razon_social || null}, ${email}, ${wa}, ${cuit}, ${b.domicilio || null}, ${b.localidad || null}, ${b.provincia || null}, ${b.cod_postal || null}, ${b.condicion_fiscal || null}, ${b.notas || null}, 'admin_erp', ${tags}, ${origenes}, now(), now())
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
      SELECT id, tipo, nombre, email, whatsapp, cuit, provincia, localidad,
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
