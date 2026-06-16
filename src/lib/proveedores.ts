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
    condicion_iva TEXT, rubro TEXT, notas TEXT, alias TEXT,
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`ALTER TABLE fg_proveedores ADD COLUMN IF NOT EXISTS alias TEXT`.catch(() => {});
}

const norm = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

// Matchea el nombre/emisor contra el maestro de forma TOLERANTE (sin may/espacios/acentos,
// por "contiene" y por alias). Solo crea uno nuevo si no hay ninguna coincidencia razonable
// → evita duplicados como "Multisolar" cuando ya existe "MULTISOLAR S. A.".
export async function resolveProveedor(sql: any, nombre: string): Promise<{ id: number; nombre: string } | null> {
  const n = String(nombre || "").trim();
  if (!n) return null;
  await ensureProveedores(sql);
  const nn = norm(n);
  const all = await sql`SELECT id, razon_social, nombre_fantasia, alias FROM fg_proveedores` as any[];
  let best: any = null;
  for (const p of all) {
    const rs = norm(p.razon_social), nf = norm(p.nombre_fantasia);
    const aliases = String(p.alias || "").split(/[,;|]/).map((a: string) => norm(a)).filter(Boolean);
    if (rs === nn || nf === nn || aliases.includes(nn)) { best = p; break; }                 // match exacto/alias
    if (!best && nn.length >= 4 && (rs.includes(nn) || nf.includes(nn) || nn.includes(rs) && rs.length >= 4)) best = p; // contiene
  }
  if (best) return { id: best.id, nombre: best.razon_social || best.nombre_fantasia || n };
  const c = await sql`INSERT INTO fg_proveedores (razon_social, activo) VALUES (${n}, true) RETURNING id` as any[];
  return { id: c[0].id, nombre: n };
}
