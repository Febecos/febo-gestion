// EJECUTOR Fase A (GO de Guille 12/07): backup + import Táctica → clientes.
// - upgrades: contacto/prospecto facturado → cliente_final + tag compro (guard RANK: nunca toca cliente_final/revendedor)
// - revendedores: solo tag compro (NO se pisa el tipo)
// - nuevos: INSERT cliente_final origen tactica (re-verifica dedup por cuit/email/tel en el momento)
import { readFileSync, writeFileSync } from 'node:fs';

const env = readFileSync('D:/secrets/febo-gestion/.env.local', 'utf8');
const url = env.match(/DATABASE_URL=(.*)/)[1].trim().replace(/^["']+|["']+$/g, '');
const { neon } = await import('file:///D:/Dropbox/FEBECOS - FULL CLAUDE/fv-febecos/node_modules/@neondatabase/serverless/index.mjs');
const sql = neon(url);

const dry = JSON.parse(readFileSync('C:/Users/Guille/AppData/Local/Temp/claude/D--Dropbox-FEBECOS---FULL-CLAUDE/e0607c3a-1d61-4664-aec4-3ddff761a026/scratchpad/dryrun_fase_a.json', 'utf8'));
const acc = JSON.parse(readFileSync('C:/Users/Guille/AppData/Local/Temp/claude/D--Dropbox-FEBECOS---FULL-CLAUDE/e0607c3a-1d61-4664-aec4-3ddff761a026/scratchpad/acciones-fase-a.json', 'utf8'));

// ---- 1. BACKUP completo ----
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const full = await sql`SELECT * FROM clientes`;
const bkPath = `D:/secrets/febo-gestion/backup-clientes-fase-a-tactica-${ts}.json`;
writeFileSync(bkPath, JSON.stringify(full));
console.log('BACKUP:', bkPath, '(', full.length, 'filas )');

const norm = (v) => (v || '').replace(/\D/g, '');
const res = { upgrades: 0, upgrades_skip: 0, rev_tag: 0, rev_skip: 0, nuevos: 0, nuevos_skip_dedup: 0, errores: [] };

// ---- 2. UPGRADES: 113 → cliente_final + tag compro (guard RANK en el WHERE) ----
for (const id of acc.upgrades) {
  try {
    const r = await sql`UPDATE clientes SET tipo = 'cliente_final',
        tags = CASE WHEN 'compro' = ANY(coalesce(tags, '{}')) THEN tags ELSE coalesce(tags, '{}') || '{compro}' END,
        origenes = CASE WHEN 'tactica' = ANY(coalesce(origenes, '{}')) THEN origenes ELSE coalesce(origenes, '{}') || '{tactica}' END,
        updated_at = now()
      WHERE id = ${id} AND tipo NOT IN ('cliente_final', 'revendedor')
      RETURNING id`;
    r.length ? res.upgrades++ : res.upgrades_skip++;
  } catch (e) { res.errores.push('upgrade ' + id + ': ' + e.message); }
}

// ---- 3. REVENDEDORES: 28 → solo tag compro ----
for (const rv of dry.revendedores) {
  try {
    const r = await sql`UPDATE clientes SET
        tags = CASE WHEN 'compro' = ANY(coalesce(tags, '{}')) THEN tags ELSE coalesce(tags, '{}') || '{compro}' END,
        origenes = CASE WHEN 'tactica' = ANY(coalesce(origenes, '{}')) THEN origenes ELSE coalesce(origenes, '{}') || '{tactica}' END,
        updated_at = now()
      WHERE id = ${rv.crm_id} AND tipo = 'revendedor' RETURNING id`;
    r.length ? res.rev_tag++ : res.rev_skip++;
  } catch (e) { res.errores.push('rev ' + rv.crm_id + ': ' + e.message); }
}

// ---- 4. NUEVOS: 188 → INSERT cliente_final (re-dedup en el momento) ----
for (const n of acc.nuevos) {
  try {
    const tel10 = norm(n.whatsapp).slice(-10);
    const dup = await sql`SELECT id FROM clientes WHERE
        (${n.cuit}::text IS NOT NULL AND regexp_replace(coalesce(cuit,''),'\\D','','g') = ${n.cuit || ''})
        OR (${n.email}::text IS NOT NULL AND lower(email) = lower(${n.email || ''}))
        OR (${tel10 || null}::text IS NOT NULL AND length(${tel10 || ''}) = 10
            AND regexp_replace(coalesce(whatsapp,''),'\\D','','g') LIKE '%' || ${tel10 || 'X'})
      LIMIT 1`;
    if (dup.length) { res.nuevos_skip_dedup++; continue; }
    const notas = `Importado de Táctica (facturado): ${n.facturas} factura/s desde jul-2022, última ${n.ultima_factura}.` +
      (n.emails_extra?.length ? ` Emails adicionales: ${n.emails_extra.join(', ')}.` : '');
    await sql`INSERT INTO clientes (tipo, nombre, razon_social, cuit, email, whatsapp, provincia, localidad, domicilio,
        origen, origenes, tags, notas, created_at, updated_at)
      VALUES ('cliente_final', ${n.nombre}, ${n.nombre}, ${n.cuit}, ${n.email}, ${n.whatsapp},
        ${n.provincia}, ${n.localidad}, ${n.domicilio},
        'tactica', '{tactica}', '{compro}', ${notas}, now(), now())`;
    res.nuevos++;
  } catch (e) { res.errores.push('nuevo ' + n.nombre + ': ' + e.message); }
}

// ---- 5. Verificación final ----
const tipos = await sql`SELECT tipo, COUNT(*) n FROM clientes GROUP BY tipo ORDER BY n DESC`;
const [revPisados] = await sql`SELECT COUNT(*) n FROM clientes WHERE tipo <> 'revendedor' AND revendedor_token IS NOT NULL`;
console.log('\nRESULTADO:', JSON.stringify(res, null, 1));
console.log('TIPOS AHORA:', tipos.map((t) => t.tipo + '=' + t.n).join(' · '));
console.log('sanity revendedores con token fuera de tipo revendedor:', revPisados.n);
