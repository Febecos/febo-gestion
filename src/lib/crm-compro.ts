import { emitEvento } from "./eventos";

// Marca 'compro' en clientes.tags de forma ADITIVA cuando hay evidencia real de compra
// (factura emitida / pago recibido). NUNCA lo saca — el override manual (checkbox en la
// ficha) convive con esto sin pisarse: auto solo agrega, jamás quita. Idempotente (no re-emite
// el evento si ya estaba marcado). Pedido de Guille (vía coordinador, 02/07): flag "🛒 Compró"
// ortogonal al tipo, para reactivación/campañas.
export async function marcarCompro(sql: any, clienteId: number | null | undefined): Promise<void> {
  if (!clienteId) return;
  try {
    const r = (await sql`
      UPDATE clientes SET tags = (SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(tags,'{}') || ARRAY['compro']))), updated_at = now()
      WHERE id=${clienteId} AND NOT ('compro' = ANY(COALESCE(tags,'{}')))
      RETURNING id` as any[]);
    if (r.length) {
      await emitEvento(sql, {
        tipo: "cliente.actualizado", entidad: "cliente", entidadId: String(clienteId),
        payload: { cliente_id: clienteId, campo: "tags", motivo: "compro_auto" },
        idempotencyKey: `gestion:cliente.actualizado:${clienteId}:${Date.now()}`, clienteId,
      });
    }
  } catch { /* nunca debe romper el flujo de facturación/pago */ }
}
