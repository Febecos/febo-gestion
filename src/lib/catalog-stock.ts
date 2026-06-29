import { emitEvento } from "./eventos";

// Liga el stock del CATÁLOGO de bombas (tabla `pumps`, área DEV ROI) al stock del DEPÓSITO
// (fg_productos del módulo Stock). pumps.stock = SUMA del depósito por código NORMALIZADO
// (sin espacios, case-insensitive) + un mapa de equivalencias (fg_codigo_map) para los códigos
// que difieren entre lista y catálogo (ej. AC/DC vs ACDC, sufijo 220v).
// Se llama tras cada cambio de stock. ROI: campo bloqueado + su sync no pisa pumps.stock.

// Recalcula TODO el catálogo (es barato: ~28 pumps). Lo llamamos en cada cambio de stock.
// Bus (C5/colisión #1): tras recalcular, emite `stock.cambiado` por cada SKU cuyo stock
// cambió, con stock_anterior (clave: el consumidor de Envíos detecta la transición 0→>0).
export async function syncCatalogStockAll(sql: any) {
  try {
    const antes = (await sql`SELECT codigo, stock FROM pumps` as any[]);
    const mapAntes = new Map<string, number>(antes.map((r: any) => [r.codigo, Number(r.stock) || 0]));
    await sql`
      UPDATE pumps p SET stock = COALESCE((
        SELECT SUM(f.stock) FROM fg_productos f
        WHERE f.activo = true AND COALESCE(f.origen,'') NOT IN ('pumps','kit_bomba')
          AND (
            regexp_replace(lower(f.codigo),'[[:space:]]','','g') = regexp_replace(lower(p.codigo),'[[:space:]]','','g')
            OR EXISTS (
              SELECT 1 FROM fg_codigo_map m WHERE m.activo
                AND regexp_replace(lower(m.cod_deposito),'[[:space:]]','','g') = regexp_replace(lower(f.codigo),'[[:space:]]','','g')
                AND regexp_replace(lower(m.cod_catalogo),'[[:space:]]','','g') = regexp_replace(lower(p.codigo),'[[:space:]]','','g')
            )
          )
      ), 0)`;
    // Diff before/after → emitir solo los SKU que cambiaron (fire-and-forget vía emitEvento).
    const despues = (await sql`SELECT codigo, stock FROM pumps` as any[]);
    const ts = new Date().toISOString();
    for (const r of despues) {
      const anterior = mapAntes.get(r.codigo);
      const nuevo = Number(r.stock) || 0;
      if (anterior === undefined || anterior === nuevo) continue;
      await emitEvento(sql, {
        tipo: "stock.cambiado", entidad: "producto", entidadId: r.codigo,
        payload: { codigo: r.codigo, stock_anterior: anterior, stock_nuevo: nuevo, ts },
        idempotencyKey: `gestion:stock.cambiado:${r.codigo}:${ts}`,
      });
    }
  } catch { /* pumps es de ROI; si falla no rompe el flujo de stock */ }
}

// Se mantiene la firma (codigo) por compatibilidad, pero recalcula todo (barato y cubre el mapa).
export async function syncCatalogStock(sql: any, _codigo?: string) {
  await syncCatalogStockAll(sql);
}
