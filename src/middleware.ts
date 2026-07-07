import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// Protege TODO salvo /login y /api/auth/*. Valida el JWT (cookie fg_token) firmado
// con ADMIN_JWT_SECRET — el mismo del admin del selector (login compartido).
// /p/[token] y /api/public/* son públicos: el token aleatorio del comprobante ES
// la credencial (sin token no se accede). El resto exige sesión.
const PUBLIC = ["/login", "/api/auth/login", "/api/auth/verify", "/p/", "/api/public/", "/envio/", "/visor-precios"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const token = req.cookies.get("fg_token")?.value;
  const secret = process.env.FG_JWT_SECRET;
  if (token && secret) {
    try {
      await jwtVerify(token, new TextEncoder().encode(secret));
      return NextResponse.next();
    } catch { /* token inválido/expirado → cae a redirect */ }
  }

  // API → 401 JSON; páginas → redirect a /login
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  // todo menos assets estáticos de Next y públicos (/images, /favicon, archivos con extensión)
  matcher: ["/((?!_next/static|_next/image|favicon.ico|images/|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|woff2?|ttf)$).*)"],
};
