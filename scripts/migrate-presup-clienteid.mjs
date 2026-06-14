// Normalización: agrega presupuestos.cliente_id (FK lógica a clientes) + backfill.
// Match por CUIT → email → teléfono (últimos 10 dígitos). El cliente pasa a ser la
// fuente de verdad del nombre; el presupuesto solo lo referencia.
// Correr: node --env-file=.env.local scripts/migrate-presup-clienteid.mjs
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log("→ Agregando presupuestos.cliente_id…");
  await sql`ALTER TABLE presupuestos ADD COLUMN IF NOT EXISTS cliente_id INT`;
  await sql`CREATE INDEX IF NOT EXISTS idx_presupuestos_cliente_id ON presupuestos(cliente_id)`;

  // Backfill: por CUIT
  const r1 = await sql`
    UPDATE presupuestos p SET cliente_id = c.id
    FROM clientes c
    WHERE p.cliente_id IS NULL AND coalesce(p.cliente_cuit,'') <> '' AND c.cuit = p.cliente_cuit
    RETURNING p.id`;
  console.log(`  por CUIT: ${r1.length}`);

  // por email
  const r2 = await sql`
    UPDATE presupuestos p SET cliente_id = c.id
    FROM clientes c
    WHERE p.cliente_id IS NULL AND coalesce(p.cliente_email,'') <> '' AND lower(c.email) = lower(p.cliente_email)
    RETURNING p.id`;
  console.log(`  por email: ${r2.length}`);

  // por teléfono (últimos 10 dígitos) — elige el cliente de menor id si hay varios
  const r3 = await sql`
    UPDATE presupuestos p SET cliente_id = sub.cid
    FROM (
      SELECT pp.id AS pid, (
        SELECT c.id FROM clientes c
        WHERE length(regexp_replace(coalesce(c.whatsapp,''),'\D','','g')) >= 8
          AND right(regexp_replace(c.whatsapp,'\D','','g'),10) = right(regexp_replace(pp.cliente_telefono,'\D','','g'),10)
        ORDER BY c.id ASC LIMIT 1
      ) AS cid
      FROM presupuestos pp
      WHERE pp.cliente_id IS NULL AND coalesce(pp.cliente_telefono,'') <> ''
    ) sub
    WHERE p.id = sub.pid AND sub.cid IS NOT NULL
    RETURNING p.id`;
  console.log(`  por teléfono: ${r3.length}`);

  const tot = await sql`SELECT count(*)::int n, count(cliente_id)::int con FROM presupuestos`;
  console.log(`✓ ${tot[0].con}/${tot[0].n} presupuestos con cliente_id`);
}
main().catch((e) => { console.error("✗", e.message); process.exit(1); });
