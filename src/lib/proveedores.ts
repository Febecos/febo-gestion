// Maestro de proveedores. resolveProveedor matchea por razón social / nombre de
// fantasía (case-insensitive) y, si no existe, lo crea — así la cta cte siempre
// queda vinculada por id (robusto ante renombres) y todo nombre de ítem termina
// como un registro del maestro.

export async function ensureProveedores(sql: any) {
  await sql`CREATE TABLE IF NOT EXISTS fg_proveedores (
    id SERIAL PRIMARY KEY,
    cuit TEXT, razon_social TEXT, nombre_fantasia TEXT,
    email TEXT, telefono TEXT, contacto TEXT,
    domicilio TEXT, localidad TEXT, provincia TEXT, cod_postal TEXT,
    condicion_iva TEXT, rubro TEXT, notas TEXT,
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
}

export async function resolveProveedor(sql: any, nombre: string): Promise<{ id: number; nombre: string } | null> {
  const n = String(nombre || "").trim();
  if (!n) return null;
  await ensureProveedores(sql);
  const f = await sql`SELECT id, razon_social, nombre_fantasia FROM fg_proveedores
    WHERE lower(coalesce(razon_social,''))=lower(${n}) OR lower(coalesce(nombre_fantasia,''))=lower(${n}) LIMIT 1` as any[];
  if (f[0]) return { id: f[0].id, nombre: f[0].razon_social || f[0].nombre_fantasia || n };
  const c = await sql`INSERT INTO fg_proveedores (razon_social, activo) VALUES (${n}, true) RETURNING id` as any[];
  return { id: c[0].id, nombre: n };
}
