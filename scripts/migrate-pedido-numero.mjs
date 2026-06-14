// Numeración correlativa ÚNICA de pedidos (PED-NNNN), continuando la serie de FV.
// Bombas (pedidos) no tenían número; FV (fv_pedidos) ya tienen PED-#### → se respetan.
// Correr: node --env-file=.env.local scripts/migrate-pedido-numero.mjs
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);

const parseNum = (s) => {
  const m = String(s || "").match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
};

async function main() {
  await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS numero TEXT`;

  // Máximo PED actual entre ambas tablas (solo los que ya tienen PED-)
  const fv = await sql`SELECT numero FROM fv_pedidos WHERE numero ILIKE 'PED-%'`;
  const ped = await sql`SELECT numero FROM pedidos WHERE numero ILIKE 'PED-%'`;
  let n = Math.max(0, ...fv.map((r) => parseNum(r.numero)), ...ped.map((r) => parseNum(r.numero)));
  console.log("Máximo PED actual:", n);

  // Asignar a las bombas sin número, por fecha
  const sinNum = await sql`SELECT id FROM pedidos WHERE numero IS NULL ORDER BY created_at ASC NULLS LAST`;
  for (const row of sinNum) {
    n++;
    const num = "PED-" + String(n).padStart(4, "0");
    await sql`UPDATE pedidos SET numero = ${num} WHERE id = ${row.id}`;
  }
  console.log(`Bombas numeradas: ${sinNum.length} → hasta PED-${String(n).padStart(4, "0")}`);

  // Contador compartido (un registro, clave 'PED')
  await sql`CREATE TABLE IF NOT EXISTS pedidos_counter (clave TEXT PRIMARY KEY, ultimo_numero INT NOT NULL DEFAULT 0)`;
  await sql`INSERT INTO pedidos_counter (clave, ultimo_numero) VALUES ('PED', ${n})
            ON CONFLICT (clave) DO UPDATE SET ultimo_numero = GREATEST(pedidos_counter.ultimo_numero, ${n})`;
  console.log("✓ pedidos_counter en", n);
}
main().catch((e) => { console.error("✗", e.message); process.exit(1); });
