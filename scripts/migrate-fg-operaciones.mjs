// Capa de WORKFLOW INTERNO de gestión: fg_operaciones referencia los pedidos
// (bombas + fv) existentes y lleva el estado del proceso (7 pasos) SIN tocar las
// tablas que usa lo externo (revendedores/fv-febecos). Misma DB, sin conflictos.
// Correr: node --env-file=.env.local scripts/migrate-fg-operaciones.mjs
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);

// Estados del circuito (orden):
// 1 presupuesto · 2 pedido_proveedor · 3 reservado_proveedor · 4 confirmado_cliente
// 5 pagado_cliente · 6 pagado_proveedor · 7 facturado   (+ anulado)
async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS fg_operaciones (
      id            SERIAL PRIMARY KEY,
      origen        TEXT NOT NULL,            -- 'bomba' | 'fv'
      pedido_ref    TEXT NOT NULL,            -- id (bombas) o numero (fv)
      numero        TEXT,                     -- PED-NNNN
      cliente_id    INT,
      cliente_nombre TEXT,
      total         NUMERIC,
      moneda        TEXT DEFAULT 'ARS',
      estado        TEXT NOT NULL DEFAULT 'pedido_proveedor',
      proveedor_reservado_at  TIMESTAMPTZ,
      confirmado_cliente_at   TIMESTAMPTZ,
      pagado_cliente_at       TIMESTAMPTZ,
      pagado_proveedor_at     TIMESTAMPTZ,
      facturado_at            TIMESTAMPTZ,
      factura_numero TEXT,
      notas         TEXT,
      created_at    TIMESTAMPTZ DEFAULT now(),
      updated_at    TIMESTAMPTZ DEFAULT now(),
      UNIQUE (origen, pedido_ref)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_fg_oper_cliente ON fg_operaciones(cliente_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_fg_oper_estado ON fg_operaciones(estado)`;

  // Backfill: una operación por cada pedido existente (bombas + fv) que no esté ya.
  const b = await sql`
    INSERT INTO fg_operaciones (origen, pedido_ref, numero, cliente_id, cliente_nombre, total, moneda, estado, created_at)
    SELECT 'bomba', p.id::text, p.numero, NULL, p.revendedor_nombre, p.precio_final, 'ARS', 'pedido_proveedor', p.created_at
    FROM pedidos p
    WHERE NOT EXISTS (SELECT 1 FROM fg_operaciones o WHERE o.origen='bomba' AND o.pedido_ref=p.id::text)
    RETURNING id`;
  console.log("Operaciones creadas (bombas):", b.length);

  const f = await sql`
    INSERT INTO fg_operaciones (origen, pedido_ref, numero, cliente_id, cliente_nombre, total, moneda, estado, created_at)
    SELECT 'fv', fp.numero, fp.numero, NULL,
           COALESCE(fp.payload->'revendedor'->>'nombre', fp.payload->'cliente'->>'nombre'),
           (fp.payload->'totales'->>'total')::numeric, COALESCE(fp.payload->'totales'->>'moneda','USD'),
           'pedido_proveedor', fp.recibido
    FROM fv_pedidos fp
    WHERE NOT EXISTS (SELECT 1 FROM fg_operaciones o WHERE o.origen='fv' AND o.pedido_ref=fp.numero)
    RETURNING id`;
  console.log("Operaciones creadas (fv):", f.length);

  const t = await sql`SELECT count(*)::int n FROM fg_operaciones`;
  console.log("✓ Total operaciones:", t[0].n);
}
main().catch((e) => { console.error("✗", e.message); process.exit(1); });
