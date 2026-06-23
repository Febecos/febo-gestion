-- ============================================================================
-- BUS DE EVENTOS CENTRAL  ·  Pilar 2 del OBJETIVO-99 (capa de eventos/triggers)
-- Dueño: DEV Gestión (D3).  DB: Neon central compartida (misma que clientes/presupuestos).
-- v1 — 23/06/2026. Aditivo y reversible. Abierto a feedback de Envíos/Seguridad/coordinador.
--
-- Modelo:
--   eventos          → log append-only. Los PRODUCTORES hacen INSERT fire-and-forget.
--   eventos_consumo  → cursor + idempotencia POR consumidor. Cada consumidor marca
--                      qué procesó (PK compuesta garantiza "exactamente una vez" por consumidor).
-- ============================================================================

CREATE TABLE IF NOT EXISTS eventos (
  id              BIGSERIAL   PRIMARY KEY,
  tipo            TEXT        NOT NULL,                       -- 'pedido.creado' | 'pago.aprobado' | 'stock.cambio' | 'cotizacion.creada' | ...
  origen          TEXT        NOT NULL,                       -- productor: 'gestion' | 'febo-ai' | 'febo-rev' | 'envios' | 'selector' | 'ads'
  entidad         TEXT,                                       -- 'pedido' | 'presupuesto' | 'cliente' | 'stock' | ...
  entidad_id      TEXT,                                       -- clave de negocio: 'PED-0039' | 'PREV-2026-0223' | cuit | sku
  payload         JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- datos del evento (snapshot mínimo necesario para reaccionar)
  idempotency_key TEXT        UNIQUE,                         -- dedupe del productor (re-emisión segura). NULL = sin dedupe.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eventos_tipo_idx       ON eventos (tipo);
CREATE INDEX IF NOT EXISTS eventos_entidad_idx    ON eventos (entidad, entidad_id);
CREATE INDEX IF NOT EXISTS eventos_created_at_idx ON eventos (created_at);

CREATE TABLE IF NOT EXISTS eventos_consumo (
  consumidor   TEXT        NOT NULL,                          -- 'envios' | 'ads' | 'gestion-facturar' | 'febo-ai' | ...
  evento_id    BIGINT      NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  estado       TEXT        NOT NULL DEFAULT 'pendiente',      -- 'pendiente' | 'procesado' | 'error'
  intentos     INT         NOT NULL DEFAULT 0,
  error        TEXT,
  procesado_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (consumidor, evento_id)                         -- cada consumidor procesa cada evento UNA sola vez
);
-- Sólo los pendientes/error de cada consumidor (cola de trabajo).
CREATE INDEX IF NOT EXISTS eventos_consumo_pendientes_idx
  ON eventos_consumo (consumidor, evento_id) WHERE estado <> 'procesado';

-- ----------------------------------------------------------------------------
-- USO
--
-- PRODUCIR (fire-and-forget, idempotente):
--   INSERT INTO eventos (tipo, origen, entidad, entidad_id, payload, idempotency_key)
--   VALUES ('pago.aprobado', 'febo-ai', 'pedido', 'PED-0039',
--           '{"monto": 12345, "metodo": "transferencia"}'::jsonb,
--           'febo-ai:pago:PED-0039')                 -- clave estable → re-emitir no duplica
--   ON CONFLICT (idempotency_key) DO NOTHING
--   RETURNING id;
--
-- CONSUMIR (patrón cursor por consumidor; corre en un cron del consumidor):
--   -- 1) reclamar eventos nuevos para este consumidor
--   INSERT INTO eventos_consumo (consumidor, evento_id)
--   SELECT 'envios', e.id FROM eventos e
--   WHERE e.tipo = ANY(ARRAY['stock.cambio','pedido.creado'])
--     AND NOT EXISTS (SELECT 1 FROM eventos_consumo c WHERE c.consumidor='envios' AND c.evento_id=e.id)
--   ON CONFLICT DO NOTHING;
--   -- 2) procesar los pendientes y marcarlos
--   UPDATE eventos_consumo SET estado='procesado', procesado_at=now()
--   WHERE consumidor='envios' AND evento_id = $1;
-- ----------------------------------------------------------------------------
