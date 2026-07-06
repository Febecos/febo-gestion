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
      // whatsapp: comparar por los ÚLTIMOS 10 DÍGITOS (no exacto) — el mismo contacto entra con y
      // sin prefijo de país (549...) según el canal (febo-ai vs alta_rev vs whatsapp_import), y con
      // comparación exacta el match fallaba, generando duplicados (caso Javier Reich, id 5136/5145).
      if (!found && wa && wa.length >= 8) {
        found = (await sql`
          SELECT id FROM clientes
          WHERE (crm_eliminado IS NULL OR crm_eliminado=false)
            AND length(regexp_replace(COALESCE(whatsapp,''),'\D','','g')) >= 8
            AND right(regexp_replace(whatsapp,'\D','','g'), 10) = right(${wa}, 10)
          ORDER BY (cuit IS NOT NULL) DESC, id ASC
          LIMIT 1` as any[])[0];
      }
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

    // AUTO-ARCA (opt-in, b.auto_arca=true): pedido de Guille — cuando se aprueba un revendedor con
    // CUIT, validar contra ARCA y traer razón social/domicilio oficiales sin esperar al botón manual
    // "Traer de ARCA". Aditivo (COALESCE, nunca pisa lo ya cargado). condicion_fiscal se intenta
    // igual, pero la constancia A13 hoy la devuelve null (bloqueo conocido, ver DEV Admin) — no falla
    // el upsert si ARCA no responde o no trae ese dato, solo completa lo que sí trae.
    let arca: any = null;
    if (b.auto_arca === true) {
      const cuitParaArca = cuit || (await sql`SELECT cuit FROM clientes WHERE id=${id} LIMIT 1` as any[])[0]?.cuit;
      if (cuitParaArca && String(cuitParaArca).replace(/\D/g, "").length === 11) {
        try {
          const rc = await fetch(`https://febecos.com/api/admin?action=consultar_cuit&cuit=${String(cuitParaArca).replace(/\D/g, "")}`, { signal: AbortSignal.timeout(12000) });
          const dc = await rc.json();
          arca = { consultado: true, ok: !!dc?.ok && dc?.valido !== false, condicion_fiscal: dc?.condicionFiscal || null, bloqueado_a13: !dc?.condicionFiscal };
          if (arca.ok) {
            await sql`UPDATE clientes SET
              razon_social = COALESCE(NULLIF(razon_social,''), ${dc.razonSocial || dc.denominacion || null}),
              domicilio = COALESCE(NULLIF(domicilio,''), ${dc.domicilio?.direccion || null}),
              localidad = COALESCE(NULLIF(localidad,''), ${dc.domicilio?.localidad || null}),
              provincia = COALESCE(NULLIF(provincia,''), ${dc.domicilio?.provincia || null}),
              cod_postal = COALESCE(NULLIF(cod_postal,''), ${dc.domicilio?.codPostal || null}),
              condicion_fiscal = COALESCE(NULLIF(condicion_fiscal,''), ${dc.condicionFiscal || null}),
              updated_at = now()
              WHERE id = ${id}`;
          }
        } catch (e: any) { arca = { consultado: true, ok: false, error: e.message }; }
      }
    }

    // Bus (D1): cada write emite cliente.actualizado — FEBO AI/FEBO-REV lo consumen para
    // read-through (refrescar contacto en su inbox sin esperar recarga manual).
    try {
      await emitEvento(sql, { tipo: "cliente.actualizado", entidad: "cliente", entidadId: String(id),
        payload: { cliente_id: id, accion }, idempotencyKey: `gestion:cliente.actualizado:${id}:${Date.now()}`, clienteId: id });
    } catch { /* no debe romper el upsert */ }

    return NextResponse.json({ ok: true, cliente_id: id, accion, arca });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
