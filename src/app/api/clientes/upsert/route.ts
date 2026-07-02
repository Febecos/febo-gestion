import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import jwt from "jsonwebtoken";
import { emitEvento } from "@/lib/eventos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── D1 (OBJETIVO-99): ENDPOINT ÚNICO DE CLIENTES ────────────────────────────
// Gestión es el DUEÑO del dato `clientes` (Neon central). Este es el contrato que
// Portal / Admin / Cursos deben usar para escribir (en vez de pisar la tabla directo).
// Cubre: identidad (cuit/email/whatsapp), datos fiscales, descuento, tags[], origenes[],
// atribución de revendedor, comisiones. Devuelve `cliente_id`. Idempotente y aditivo.
//
// AUTH: identidad de servicio (Bearer INTERNAL_SERVICE_SECRET). La identidad fina
//       la coordina DEV Seguridad (D1) — por ahora un secret de servicio.
//
// Resolución: cliente_id explícito > (forzar=crea nuevo) > match CUIT > email > whatsapp.
// UPDATE: solo pisa un campo si viene valor (COALESCE) → no borra datos existentes.
// tags[] y origenes[] se MERGEAN (unión, sin duplicar).

const digits = (s: any) => String(s || "").replace(/\D/g, "");

// Identidad de servicio (D1, contrato de DEV Seguridad — patrón P5):
//  - JWT corto (internal:true, scope:'clientes:write', exp 30m) firmado con
//    FV_BRIDGE_SECRET || INTERNAL_SERVICE_SECRET, emitido por internal-session.js?scope=clientes:write.
//  - Fallback de rollout: bearer == secret estático (se retira cuando Portal/Admin/Cursos migren al JWT).
//  Verifica contra AMBOS secrets (acepta el token sin importar con cuál se firmó).
function autorizado(req: NextRequest): boolean {
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return false;
  const secrets = [process.env.FV_BRIDGE_SECRET, process.env.INTERNAL_SERVICE_SECRET].filter(Boolean) as string[];
  for (const sec of secrets) {
    if (bearer === sec) return true; // fallback estático (rollout)
    try {
      const p: any = jwt.verify(bearer, sec);
      if (p?.internal === true && p?.scope === "clientes:write") return true;
    } catch { /* probar el siguiente secret */ }
  }
  return false;
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  try {
    const sql = getDb();
    const b = await req.json();

    const cuit = digits(b.cuit) || null;
    const email = (b.email || "").trim().toLowerCase() || null;
    const wa = digits(b.whatsapp || b.wa || b.telefono) || null;
    if (!b.cliente_id && !cuit && !email && !wa)
      return NextResponse.json({ ok: false, error: "Falta CUIT, email o whatsapp" }, { status: 400 });

    // Asegurar columnas aditivas (idempotente).
    await sql`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS origenes TEXT[]`.catch(() => {});
    await sql`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS descuento_pct NUMERIC`.catch(() => {});
    await sql`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS transporte TEXT`.catch(() => {});

    // ── Resolver el contacto ──
    const forzar = b.forzar === true || b.forzar === "true";
    let found: any = null;
    if (b.cliente_id) {
      found = (await sql`SELECT id FROM clientes WHERE id=${Number(b.cliente_id)} LIMIT 1` as any[])[0] || null;
    } else if (!forzar) {
      if (cuit) found = (await sql`SELECT id FROM clientes WHERE cuit=${cuit} AND (crm_eliminado IS NULL OR crm_eliminado=false) LIMIT 1` as any[])[0];
      if (!found && email) found = (await sql`SELECT id FROM clientes WHERE lower(email)=${email} AND (crm_eliminado IS NULL OR crm_eliminado=false) LIMIT 1` as any[])[0];
      if (!found && wa) found = (await sql`SELECT id FROM clientes WHERE whatsapp=${wa} AND (crm_eliminado IS NULL OR crm_eliminado=false) LIMIT 1` as any[])[0];
    }

    // Campos (null = no tocar en UPDATE). Arrays a mergear.
    const tags: string[] = Array.isArray(b.tags) ? b.tags.filter(Boolean) : [];
    const origenes: string[] = Array.isArray(b.origenes) ? b.origenes.filter(Boolean) : (b.origen ? [b.origen] : []);
    const desc = b.descuento_pct != null && b.descuento_pct !== "" ? Number(b.descuento_pct) : null;
    const esInternoRev = b.rev_tipo === "interno";
    const revTok = esInternoRev ? null : (b.revendedor_token || null);
    const revNom = esInternoRev ? null : (b.revendedor_nombre || null);
    // Bumps de contadores (opcional): bump='presupuesto'|'pedido' + monto.
    const bumpPres = b.bump === "presupuesto" ? 1 : 0;
    const bumpPed = b.bump === "pedido" ? 1 : 0;
    const monto = Number(b.monto) || 0;

    let id: number;
    let accion: "insert" | "update";

    if (found) {
      id = found.id;
      accion = "update";
      await sql`
        UPDATE clientes SET
          tipo             = COALESCE(${b.tipo ?? null}, tipo),
          nombre           = COALESCE(${b.nombre ?? null}, nombre),
          apellido         = COALESCE(${b.apellido ?? null}, apellido),
          razon_social     = COALESCE(${b.razon_social ?? null}, razon_social),
          empresa          = COALESCE(${b.empresa ?? null}, empresa),
          email            = COALESCE(${email}, email),
          whatsapp         = COALESCE(${wa}, whatsapp),
          cuit             = COALESCE(${cuit}, cuit),
          domicilio        = COALESCE(${b.domicilio ?? null}, domicilio),
          localidad        = COALESCE(${b.localidad ?? null}, localidad),
          provincia        = COALESCE(${b.provincia ?? null}, provincia),
          cod_postal       = COALESCE(${b.cod_postal ?? null}, cod_postal),
          condicion_fiscal = COALESCE(${b.condicion_fiscal ?? null}, condicion_fiscal),
          descuento_pct    = COALESCE(${desc}, descuento_pct),
          transporte       = COALESCE(${b.transporte ?? null}, transporte),
          revendedor_token = COALESCE(${revTok}, revendedor_token),
          revendedor_nombre= COALESCE(${revNom}, revendedor_nombre),
          notas            = COALESCE(${b.notas ?? null}, notas),
          tags             = (SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(tags,'{}') || ${tags}::text[]))),
          origenes         = (SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(origenes,'{}') || ${origenes}::text[]))),
          total_presupuestos = COALESCE(total_presupuestos,0) + ${bumpPres},
          total_pedidos      = COALESCE(total_pedidos,0) + ${bumpPed},
          monto_total        = COALESCE(monto_total,0) + ${monto},
          ultimo_contacto_at = now(),
          updated_at         = now()
        WHERE id=${id}`;
    } else {
      accion = "insert";
      const ins = await sql`
        INSERT INTO clientes (tipo, nombre, apellido, razon_social, empresa, email, whatsapp, cuit,
          domicilio, localidad, provincia, cod_postal, condicion_fiscal, descuento_pct, transporte,
          revendedor_token, revendedor_nombre, origen, notas, tags, origenes,
          total_presupuestos, total_pedidos, monto_total, primer_contacto_at, ultimo_contacto_at)
        VALUES (${b.tipo || "contacto"}, ${b.nombre || null}, ${b.apellido || null}, ${b.razon_social || null}, ${b.empresa || null},
          ${email}, ${wa}, ${cuit}, ${b.domicilio || null}, ${b.localidad || null}, ${b.provincia || null}, ${b.cod_postal || null},
          ${b.condicion_fiscal || null}, ${desc}, ${b.transporte || null}, ${revTok}, ${revNom}, ${b.origen || (origenes[0] || null)},
          ${b.notas || null}, ${tags}::text[], ${origenes}::text[], ${bumpPres}, ${bumpPed}, ${monto}, now(), now())
        RETURNING id` as any[];
      id = ins[0].id;
    }

    // Bus (D1): cada write emite cliente.actualizado — FEBO AI/FEBO-REV lo consumen para
    // read-through (refrescar contacto en su inbox sin esperar recarga manual).
    try {
      await emitEvento(sql, { tipo: "cliente.actualizado", entidad: "cliente", entidadId: String(id),
        payload: { cliente_id: id, accion }, idempotencyKey: `gestion:cliente.actualizado:${id}:${Date.now()}`, clienteId: id });
    } catch { /* no debe romper el upsert */ }

    return NextResponse.json({ ok: true, cliente_id: id, accion });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
