// Migración: agrega operacion_id a fg_comprobantes y hace backfill.
// operacion_id = id de la cabeza de la cadena (el presupuesto).
// Correr: node --env-file=.env.local scripts/migrate-operacion.mjs
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log("→ Agregando columna operacion_id…");
  await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS operacion_id INT`;
  await sql`CREATE INDEX IF NOT EXISTS idx_fg_comprobantes_operacion ON fg_comprobantes(operacion_id)`;

  // Backfill nivel 1: presupuestos (sin ref) = cabeza → operacion_id = id
  await sql`UPDATE fg_comprobantes SET operacion_id = id WHERE operacion_id IS NULL AND ref_id IS NULL`;

  // Backfill: comprobantes con ref → heredan el operacion_id de su referenciado.
  // Se repite hasta que no queden nulos (cadenas de varios niveles).
  for (let i = 0; i < 5; i++) {
    const r = await sql`
      UPDATE fg_comprobantes c
      SET operacion_id = p.operacion_id
      FROM fg_comprobantes p
      WHERE c.operacion_id IS NULL AND c.ref_id = p.id AND p.operacion_id IS NOT NULL
      RETURNING c.id`;
    console.log(`  pasada ${i + 1}: ${r.length} filas`);
    if (!r.length) break;
  }

  // Cualquier resto (ref roto): operacion_id = id propio
  const resto = await sql`UPDATE fg_comprobantes SET operacion_id = id WHERE operacion_id IS NULL RETURNING id`;
  if (resto.length) console.log(`  resto sin cadena: ${resto.length} → operacion_id = id`);

  const tot = await sql`SELECT COUNT(*)::int n, COUNT(operacion_id)::int con FROM fg_comprobantes`;
  console.log(`✓ Listo. ${tot[0].con}/${tot[0].n} comprobantes con operacion_id`);
}

main().catch((e) => { console.error("✗ Error:", e.message); process.exit(1); });
