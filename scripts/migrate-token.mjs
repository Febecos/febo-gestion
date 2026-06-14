// Migración: token público único en fg_comprobantes (para vista /p/[token]).
// Correr: node --env-file=.env.local scripts/migrate-token.mjs
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log("→ Agregando columna token…");
  await sql`ALTER TABLE fg_comprobantes ADD COLUMN IF NOT EXISTS token TEXT`;
  // Backfill: tokens únicos para los existentes (gen_random_uuid disponible en Neon).
  const r = await sql`UPDATE fg_comprobantes SET token = gen_random_uuid()::text WHERE token IS NULL RETURNING id`;
  console.log(`  backfill: ${r.length} comprobantes`);
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_fg_comprobantes_token ON fg_comprobantes(token)`;
  const t = await sql`SELECT COUNT(*)::int n, COUNT(token)::int con FROM fg_comprobantes`;
  console.log(`✓ Listo. ${t[0].con}/${t[0].n} con token`);
}
main().catch((e) => { console.error("✗", e.message); process.exit(1); });
