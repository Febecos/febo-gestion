import { NextRequest } from "next/server";
import { jwtVerify } from "jose";

// ¿El request viene de un usuario owner? (lee la cookie fg_token)
export async function esOwner(req: NextRequest): Promise<boolean> {
  try {
    const token = req.cookies.get("fg_token")?.value;
    const secret = process.env.FG_JWT_SECRET;
    if (!token || !secret) return false;
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    return !!payload.es_owner;
  } catch { return false; }
}
