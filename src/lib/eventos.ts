// Productor del BUS DE EVENTOS central (OBJETIVO-99, C5). Dueño del schema: DEV Gestión.
// Fire-and-forget + idempotente: NUNCA rompe el flujo de negocio (try/catch silencioso).
// Tabla `eventos` (Neon central): tipo, origen, entidad, entidad_id, payload, idempotency_key, cliente_id.
// Ver febo-gestion/scripts/eventos-bus.sql. Convención de tipo: entidad.acción (lower).

type EmitArgs = {
  tipo: string;                 // 'pedido.creado' | 'factura.emitida' | ...
  entidad?: string | null;      // 'pedido' | 'presupuesto' | 'factura' | ...
  entidadId?: string | null;    // 'PED-0041' | 'PREV-2026-0223' | ...
  payload?: any;                // snapshot mínimo para reaccionar
  idempotencyKey?: string | null; // dedupe del productor (re-emisión segura)
  clienteId?: number | null;    // clientes.id resuelto (top-level, para filtrar sin parsear JSONB)
};

// Emite un evento al bus. `sql` = instancia neon ya abierta (la del handler).
export async function emitEvento(sql: any, a: EmitArgs): Promise<void> {
  try {
    await sql`
      INSERT INTO eventos (tipo, origen, entidad, entidad_id, payload, idempotency_key, cliente_id)
      VALUES (${a.tipo}, 'gestion', ${a.entidad ?? null}, ${a.entidadId ?? null},
              ${JSON.stringify(a.payload ?? {})}::jsonb, ${a.idempotencyKey ?? null}, ${a.clienteId ?? null})
      ON CONFLICT (idempotency_key) DO NOTHING`;
  } catch (e: any) {
    // El bus NO debe afectar el flujo operativo. Solo log.
    console.error("[emitEvento] no se pudo emitir", a.tipo, e?.message);
  }
}
