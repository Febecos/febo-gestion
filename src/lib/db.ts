// Conexión a la Neon central COMPARTIDA (la misma del admin/selector).
// Misma convención que revendedores/src/lib/db.ts.
import { neon } from "@neondatabase/serverless";

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no configurada");
  return neon(url);
}
