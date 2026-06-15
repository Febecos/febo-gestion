// Cuenta corriente unificada (cliente + proveedor), siempre en USD.
// Convención de signos (la orienta la API por ámbito):
//   cliente:   debe = lo que el cliente nos debe (factura) · haber = sus pagos
//              saldo = Σdebe − Σhaber  (>0 = el cliente nos debe)
//   proveedor: haber = lo que le debemos (costo confirmado) · debe = nuestros pagos
//              saldo = Σhaber − Σdebe  (>0 = le debemos al proveedor)
// Cada movimiento lleva `uniq` para ser idempotente (re-ejecutar una acción no duplica).

export async function ensureCtaCte(sql: any) {
  await sql`CREATE TABLE IF NOT EXISTS fg_ctacte (
    id SERIAL PRIMARY KEY,
    ambito TEXT NOT NULL,                 -- 'cliente' | 'proveedor'
    cliente_id INT,
    proveedor TEXT,
    fecha DATE NOT NULL DEFAULT now(),
    concepto TEXT,
    comprobante TEXT,
    pedido_ref TEXT,
    debe NUMERIC NOT NULL DEFAULT 0,
    haber NUMERIC NOT NULL DEFAULT 0,
    moneda TEXT NOT NULL DEFAULT 'USD',
    detalle JSONB,
    uniq TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
}

export type Mov = {
  ambito: "cliente" | "proveedor";
  cliente_id?: number | null;
  proveedor?: string | null;
  fecha?: string | null;
  concepto: string;
  comprobante?: string | null;
  pedido_ref?: string | null;
  debe?: number;
  haber?: number;
  detalle?: any;
  uniq: string; // clave idempotente
};

// Upsert por uniq: si la acción se repite, actualiza importes en vez de duplicar.
export async function movCtaCte(sql: any, m: Mov) {
  await ensureCtaCte(sql);
  await sql`
    INSERT INTO fg_ctacte (ambito, cliente_id, proveedor, fecha, concepto, comprobante, pedido_ref, debe, haber, moneda, detalle, uniq)
    VALUES (${m.ambito}, ${m.cliente_id ?? null}, ${m.proveedor ?? null}, ${m.fecha || null}, ${m.concepto},
            ${m.comprobante ?? null}, ${m.pedido_ref ?? null}, ${m.debe || 0}, ${m.haber || 0}, 'USD',
            ${m.detalle ? JSON.stringify(m.detalle) : null}::jsonb, ${m.uniq})
    ON CONFLICT (uniq) DO UPDATE SET
      cliente_id=EXCLUDED.cliente_id, proveedor=EXCLUDED.proveedor, fecha=COALESCE(EXCLUDED.fecha, fg_ctacte.fecha),
      concepto=EXCLUDED.concepto, comprobante=EXCLUDED.comprobante, debe=EXCLUDED.debe, haber=EXCLUDED.haber,
      detalle=EXCLUDED.detalle`;
}

export async function delMov(sql: any, uniq: string) {
  await ensureCtaCte(sql);
  await sql`DELETE FROM fg_ctacte WHERE uniq=${uniq}`;
}

// Borra todos los movimientos cuyo uniq empieza con el prefijo (ej. todos los de un pedido/proveedor).
export async function delMovPrefijo(sql: any, prefijo: string) {
  await ensureCtaCte(sql);
  await sql`DELETE FROM fg_ctacte WHERE uniq LIKE ${prefijo + "%"}`;
}
