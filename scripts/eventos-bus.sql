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
  tipo            TEXT        NOT NULL,                       -- 'pedido.creado' | 'pago.recibido' | 'stock.cambiado' | 'cotizacion.creada' | ...
  origen          TEXT        NOT NULL,                       -- productor: 'gestion' | 'febo-ai' | 'febo-rev' | 'envios' | 'selector' | 'ads'
  entidad         TEXT,                                       -- 'pedido' | 'presupuesto' | 'cliente' | 'stock' | ...
  entidad_id      TEXT,                                       -- clave de negocio: 'PED-0039' | 'PREV-2026-0223' | cuit | sku
  payload         JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- datos del evento (snapshot mínimo necesario para reaccionar)
  idempotency_key TEXT        UNIQUE,                         -- dedupe del productor (re-emisión segura). NULL = sin dedupe.
  cliente_id      BIGINT,                                     -- cliente resuelto (CRM clientes.id), top-level. NULL si no aplica/aún no resuelto.
                                                              --   Desnormalizado para filtrar por cliente SIN parsear JSONB (pedido D1 del coordinador).
                                                              --   El productor la puebla apenas tenga el cliente_id (FEBO AI se compromete a poblarla).
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eventos_tipo_idx        ON eventos (tipo);
CREATE INDEX IF NOT EXISTS eventos_entidad_idx     ON eventos (entidad, entidad_id);
CREATE INDEX IF NOT EXISTS eventos_created_at_idx  ON eventos (created_at);
CREATE INDEX IF NOT EXISTS eventos_cliente_id_idx  ON eventos (cliente_id) WHERE cliente_id IS NOT NULL;
-- Migración aditiva sobre tablas v1 (que no tenían cliente_id):
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS cliente_id BIGINT;

-- ----------------------------------------------------------------------------
-- CATÁLOGO DE TIPOS (D2). `tipo` es texto libre (sin enum) → los productores pueden
-- emitir YA; el catálogo es el acuerdo de nombres entre productor y consumidores.
-- Convención: entidad.acción en PARTICIPIO PASADO (lower). Ej: pedido.creado · pago.recibido · stock.cambiado ·
--   CANÓNICO: stock.cambiado (NO 'stock.cambio') · pago.recibido (NO 'pago.aprobado') — fijado 29/06 para zanjar duplicados.
--   cotizacion.creada · cliente.actualizado · lead.creado
--   conversacion.escalada  ← FEBO AI: escalación de conversación al humano.
--        entidad='conversacion', entidad_id=<conv_id/whatsapp>,
--        payload={motivo, canal, ...}, idempotency_key='febo-ai:escalada:<conv_id>'.
--   GESTIÓN (productor, origen='gestion'): presupuesto.aceptado · pedido.creado ·
--        proveedor.confirmado · pago.recibido · factura.emitida.
--   pedido.estado_cambiado  ← GESTIÓN (C1): aviso de estado al cliente. Consumen Envíos (email)
--        y FEBO AI (WhatsApp). entidad='pedido', entidad_id=<PED-xxxx>,
--        payload={pedido_ref, estado_nuevo, cliente_id, telefono, email},
--        estado_nuevo ∈ {aprobado|pagado|facturado|despachado|enviado|cancelado},
--        idempotency_key='gestion:pedido.estado_cambiado:<ref>:<estado>'.
-- ----------------------------------------------------------------------------

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
--   INSERT INTO eventos (tipo, origen, entidad, entidad_id, payload, idempotency_key, cliente_id)
--   VALUES ('pago.recibido', 'gestion', 'pedido', 'PED-0039',
--           '{"monto": 12345, "medio": "transferencia"}'::jsonb,
--           'gestion:pago.recibido:PED-0039', 4231)  -- clave estable → re-emitir no duplica
--   -- idempotency_key = '<origen>:<tipo>:<id>'
--   ON CONFLICT (idempotency_key) DO NOTHING
--   RETURNING id;
--
-- CONSUMIR (patrón cursor por consumidor; corre en un cron del consumidor):
--   -- 1) reclamar eventos nuevos para este consumidor
--   INSERT INTO eventos_consumo (consumidor, evento_id)
--   SELECT 'envios', e.id FROM eventos e
--   WHERE e.tipo = ANY(ARRAY['stock.cambiado','pedido.creado'])
--     AND NOT EXISTS (SELECT 1 FROM eventos_consumo c WHERE c.consumidor='envios' AND c.evento_id=e.id)
--   ON CONFLICT DO NOTHING;
--   -- 2) procesar los pendientes y marcarlos
--   UPDATE eventos_consumo SET estado='procesado', procesado_at=now()
--   WHERE consumidor='envios' AND evento_id = $1;
-- ----------------------------------------------------------------------------

-- ============================================================================
-- CONTRATO PARA PRODUCTORES EXTERNOS (confirmado por DEV Gestión, dueño del bus · 29/06)
-- Cualquier repo puede ESCRIBIR en `eventos` directo (INSERT, sin helper ni HTTP
-- cross-dominio) — es append-only y desacoplado. Reglas obligatorias:
--
--   1) COLUMNAS:  tipo, origen, entidad, entidad_id, payload (jsonb), idempotency_key,
--                 + cliente_id (BIGINT top-level) apenas se resuelva (para filtrar sin parsear JSONB).
--   2) origen POR REPO (string fijo):
--        'gestion'      → DEV ERP Gestión (febo-gestion)
--        'revendedores' → DEV Portal      (repo revendedores)
--        'selector'     → DEV Admin       (febecos-selector)
--        'febo-ai'      → DEV FEBO AI
--        'ads'          → DEV Facebook
--   3) idempotency_key = '<origen>:<tipo>:<id>'  (id = clave de negocio estable: PED-xxxx,
--        PREV-xxxx, public_token, etc.). Ej: 'revendedores:cotizacion.creada:PREV-2026-0223'.
--        Si querés dedup por sub-evento, sufijá: '<origen>:<tipo>:<id>:<discriminante>'.
--   4) SIEMPRE  ON CONFLICT (idempotency_key) DO NOTHING  → re-emisión segura.
--   5) FIRE-AND-FORGET: envolvé el INSERT en try/catch; un fallo del bus NUNCA debe
--        romper tu flujo de negocio (POST/GET).
--   6) tipo: usar el catálogo D2 de arriba (convención entidad.acción, lower). Es texto
--        libre → podés emitir ya; el catálogo es el acuerdo de nombres con los consumidores.
--
-- Productores externos en cola (29/06): Portal → cotizacion.creada / cotizacion.vista ·
--   Admin → pedido.creado (checkout) / lead.creado.
-- ⚠️ stock.cambiado lo emite GESTIÓN (colisión #1): es el ÚNICO escritor de pumps.stock
--   (recalc en catalog-stock.ts desde el depósito; el checkout del selector ya NO decrementa
--   pumps.stock — ROI sacó esos decrementos en 30d97c1). Admin NO emite stock.cambiado.
-- ============================================================================
