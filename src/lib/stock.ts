// Validación y descuento de stock (depósito propio = fg_productos.stock).
// Lo usan la confirmación de pedidos (bomba/kit y FV) para no avanzar/facturar sin stock.
import { syncCatalogStock } from "./catalog-stock";
// IDENTIDAD: un producto se identifica por CÓDIGO + MARCA (un mismo código puede existir con
// dos marcas distintas, ej. HD-...500 = HIKO (LV) y Handuro (Multiradio) → son productos distintos).

export type Faltante = { codigo: string; marca: string; descripcion: string; pedido: number; stock: number };

const esEmbalaje = (it: any) =>
  it?.es_embalaje === true || /embalaje/i.test(String(it?.codigo || "") + " " + String(it?.descripcion || ""));

// Marcas conocidas (mismo set que el mapa de marcas de bombas). Se detecta en la descripción.
const MARCAS = ["KUNZEL", "WEGA", "SEIF", "DIFULL", "HIKO", "HANDURO", "BGH", "CTT"];
const marcaDe = (it: any): string => {
  const txt = (String(it?.marca || it?.fabricante || "") + " " + String(it?.descripcion || "")).toUpperCase();
  return MARCAS.find((m) => txt.includes(m)) || "";
};

// Devuelve las filas de fg_productos que matchean el ítem por código (+ marca si aplica/desambigua).
// EXCLUYE los espejos del catálogo (origen pumps/kit_bomba): esos NO son depósito real, su stock
// se recalcula como suma del depósito (syncCatalogStock). Tocarlos descontaría la fila equivocada.
async function filasDe(sql: any, codigo: string, marca: string): Promise<any[]> {
  const rows = (await sql`SELECT id, descripcion, stock FROM fg_productos WHERE codigo=${codigo} AND activo=true AND COALESCE(origen,'') NOT IN ('pumps','kit_bomba')` as any[]);
  if (rows.length <= 1 || !marca) return rows;
  const m = marca.toUpperCase();
  const filtra = rows.filter((r) => String(r.descripcion || "").toUpperCase().includes(m));
  return filtra.length ? filtra : rows;   // si la marca no desambigua, devolver todas (suma)
}

// Chequea cada ítem del pedido contra el stock (código + marca). Devuelve los faltantes.
export async function validarStock(sql: any, items: any[]): Promise<{ ok: boolean; faltantes: Faltante[] }> {
  const faltantes: Faltante[] = [];
  for (const it of items || []) {
    if (esEmbalaje(it)) continue;
    const codigo = String(it.codigo || "").trim();
    const marca = marcaDe(it);
    const need = Number(it.cantidad) || 1;
    if (!codigo) {
      faltantes.push({ codigo: "(sin código)", marca, descripcion: it.descripcion || "", pedido: need, stock: 0 });
      continue;
    }
    const rows = await filasDe(sql, codigo, marca);
    const have = rows.reduce((a, r) => a + (Number(r.stock) || 0), 0);   // stock total de ese código+marca
    if (!rows.length || have < need) faltantes.push({ codigo, marca, descripcion: it.descripcion || "", pedido: need, stock: have });
  }
  return { ok: faltantes.length === 0, faltantes };
}

// Descuenta del stock (código + marca) y deja bitácora. Idempotencia por ref en el llamador.
export async function descontarStock(sql: any, items: any[], ref: string, usuario: string | null) {
  for (const it of items || []) {
    if (esEmbalaje(it)) continue;
    const codigo = String(it.codigo || "").trim();
    if (!codigo) continue;
    const marca = marcaDe(it);
    let need = Number(it.cantidad) || 1;
    const rows = await filasDe(sql, codigo, marca);
    // Descuenta fila por fila (por id) hasta cubrir lo pedido. Cada fila es único por id.
    for (const r of rows) {
      if (need <= 0) break;
      const actual = Number(r.stock) || 0;
      if (actual <= 0) continue;
      const baja = Math.min(actual, need);
      const nuevo = +(actual - baja).toFixed(2);
      await sql`UPDATE fg_productos SET stock=${nuevo} WHERE id=${r.id}`;
      await sql`INSERT INTO fg_stock_mov (codigo, descripcion, delta, tipo, motivo, ref, usuario, stock_resultante)
        VALUES (${codigo}, ${r.descripcion || null}, ${-baja}, 'salida', ${"Pedido " + ref + (marca ? " (" + marca + ")" : "")}, ${ref}, ${usuario}, ${nuevo})`;
      need -= baja;
    }
  }
  // Reflejar el consumo en el catálogo de bombas UNA sola vez (syncCatalogStock recalcula TODO;
  // llamarlo por ítem hacía N recálculos pesados → timeout en pedidos con muchos ítems/kits).
  await syncCatalogStock(sql);
}

// Devuelve el stock descontado por un pedido (inverso de descontarStock). Suma a la primera fila
// que matchea código+marca (el total por código+marca queda correcto, que es lo que valida el check).
// Se usa al REVERTIR/ANULAR un pedido cuyo stock se había descontado al confirmar.
export async function restituirStock(sql: any, items: any[], ref: string, usuario: string | null) {
  for (const it of items || []) {
    if (esEmbalaje(it)) continue;
    const codigo = String(it.codigo || "").trim();
    if (!codigo) continue;
    const marca = marcaDe(it);
    const need = Number(it.cantidad) || 1;
    const rows = await filasDe(sql, codigo, marca);
    if (!rows.length) continue;
    const r = rows[0];
    const nuevo = +((Number(r.stock) || 0) + need).toFixed(2);
    await sql`UPDATE fg_productos SET stock=${nuevo} WHERE id=${r.id}`;
    await sql`INSERT INTO fg_stock_mov (codigo, descripcion, delta, tipo, motivo, ref, usuario, stock_resultante)
      VALUES (${codigo}, ${r.descripcion || null}, ${need}, 'entrada', ${"Reversa pedido " + ref + (marca ? " (" + marca + ")" : "")}, ${ref}, ${usuario}, ${nuevo})`;
  }
  await syncCatalogStock(sql);   // recálculo del catálogo UNA sola vez (evita N recálculos → timeout)
}
