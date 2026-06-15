// Renumera TODOS los pedidos (bombas + fv) en una sola serie correlativa PED-NNNN por fecha.
// Datos de prueba → se puede reasignar libremente. Fase temporal para evitar colisión de PK.
// Correr: node --env-file=.env.local scripts/renumerar-pedidos.mjs
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);
const pad = (n) => "PED-" + String(n).padStart(4, "0");

async function main() {
  const bombas = await sql`SELECT id, created_at FROM pedidos`;
  const fvs = await sql`SELECT numero, public_token, recibido FROM fv_pedidos`;

  const all = [
    ...bombas.map((b) => ({ kind: "bomba", key: b.id, date: b.created_at })),
    ...fvs.map((f) => ({ kind: "fv", key: f.public_token, old: f.numero, date: f.recibido })),
  ].sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());

  console.log(`Total a renumerar: ${all.length} (bombas ${bombas.length} + fv ${fvs.length})`);

  // Fase 1: temporales únicos
  let t = 0;
  for (const x of all) {
    t++;
    const tmp = "TMP-" + t;
    if (x.kind === "bomba") await sql`UPDATE pedidos SET numero = ${tmp} WHERE id = ${x.key}`;
    else await sql`UPDATE fv_pedidos SET numero = ${tmp} WHERE public_token = ${x.key}`;
  }

  // Fase 2: finales + mapa old→new para fv (para actualizar pedidos_proveedores)
  let n = 0; const fvMap = {};
  t = 0;
  for (const x of all) {
    t++; n++; const num = pad(n); const tmp = "TMP-" + t;
    if (x.kind === "bomba") await sql`UPDATE pedidos SET numero = ${num} WHERE numero = ${tmp}`;
    else { await sql`UPDATE fv_pedidos SET numero = ${num} WHERE numero = ${tmp}`; if (x.old) fvMap[x.old] = num; }
  }

  // Actualizar referencias en pedidos_proveedores (fv_numero)
  let refs = 0;
  for (const [oldN, newN] of Object.entries(fvMap)) {
    const r = await sql`UPDATE pedidos_proveedores SET fv_numero = ${newN} WHERE fv_numero = ${oldN} RETURNING id`;
    refs += r.length;
  }

  await sql`INSERT INTO pedidos_counter (clave, ultimo_numero) VALUES ('PED', ${n})
            ON CONFLICT (clave) DO UPDATE SET ultimo_numero = ${n}`;

  const dup = await sql`SELECT numero, count(*)::int c FROM (SELECT numero FROM pedidos UNION ALL SELECT numero FROM fv_pedidos) z GROUP BY numero HAVING count(*)>1`;
  console.log(`✓ Renumerados ${n} pedidos. Refs proveedor actualizadas: ${refs}. Counter en ${n}.`);
  console.log("Duplicados restantes:", dup.length ? JSON.stringify(dup) : "ninguno ✓");
}
main().catch((e) => { console.error("✗", e.message); process.exit(1); });
