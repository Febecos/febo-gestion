import { NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Usuario del request (cookie fg_token): { email, nombre, es_owner }.
export async function getUser(req: NextRequest): Promise<{ email: string; nombre: string; es_owner: boolean } | null> {
  try {
    const token = req.cookies.get("fg_token")?.value;
    const secret = process.env.FG_JWT_SECRET;
    if (!token || !secret) return null;
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    return { email: String(payload.email || ""), nombre: String(payload.nombre || payload.email || ""), es_owner: !!payload.es_owner };
  } catch { return null; }
}

// ¿El request viene de un usuario owner? (lee la cookie fg_token)
export async function esOwner(req: NextRequest): Promise<boolean> {
  const u = await getUser(req);
  return !!u?.es_owner;
}
