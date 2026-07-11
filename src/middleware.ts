import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// Protege TODO salvo /login y /api/auth/*. Valida el JWT (cookie fg_token) firmado
// con ADMIN_JWT_SECRET — el mismo del admin del selector (login compartido).
// /p/[token] y /api/public/* son públicos: el token aleatorio del comprobante ES
// la credencial (sin token no se accede). El resto exige sesión.
const PUBLIC = ["/login", "/api/auth/login", "/api/auth/verify", "/p/", "/api/public/", "/envio/", "/lista-precios-revendedores"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── DOMINIO VISOR (visor.febecos.com) ──────────────────────────────────────────────
  // Se usa un dominio propio para el visor público de precios: así nadie descubre el dominio
  // real de gestión (aporte de seguridad, pedido de Guille 07/07). En ese host SOLO existe el
  // visor de precios + su API pública; TODO lo demás devuelve 404 (no se revela que es gestión,
  // no hay login ni rutas del ERP). La raíz "/" del visor sirve directamente el visor.
  // (Requiere aliasear visor.febecos.com → este proyecto en Vercel; hasta que se aliasee, este
  //  bloque no se activa porque ningún request llega con ese host.)
  // La RAÍZ del dominio visor NO muestra nada (se reserva para otros usos, pedido de Guille 07/07):
  // el visor de precios vive SOLO en la subcarpeta /lista-precios-revendedores (activable aparte).
  // En ese host: se sirve esa ruta + su API pública; TODO lo demás (incluida la raíz) → 404.
  const host = (req.headers.get("host") || "").toLowerCase();
  if (host.startsWith("visor.")) {
    if (pathname === "/lista-precios-revendedores" || pathname.startsWith("/api/public/")) return NextResponse.next();
    return new NextResponse("No encontrado", { status: 404 });
  }

  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // Endpoints server↔server: pasan el middleware SOLO si traen Authorization Bearer — la validación
  // REAL del secret la hace el propio endpoint (FV_BRIDGE_SECRET/INTERNAL_SERVICE_SECRET) y devuelve
  // su propio 401 si no coincide. Sin esto, el middleware cortaba con 401 ANTES de llegar al endpoint
  // (root cause del 401 de FEBOCAR: el secret podía estar bien, el middleware nunca lo dejaba entrar).
  const S2S = ["/api/clientes/upsert"];
  if (S2S.some((p) => pathname.startsWith(p)) && (req.headers.get("authorization") || "").startsWith("Bearer ")) {
    return NextResponse.next();
  }

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
