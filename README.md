# FEBO-GESTION

ERP + CRM propio de Febecos (reemplaza Táctica). Next.js 14 + Neon (central compartida).

Ver `../FEBO-GESTION.md`, `../RADIOGRAFIA-TACTICA.md` y `../FEBECOS_REGLAS_GLOBALES.md`.

## Correr local
```bash
cp .env.local.example .env.local   # completar DATABASE_URL (Neon central)
npm install
npm run dev                        # http://localhost:3000 → /clientes
```

## Estado
- ✅ Scaffold + módulo **Clientes** (lee la tabla `clientes` de Neon — la misma del admin).
- ⏳ Pendiente: auth (JWT compartido) antes de deployar · Productos/Stock · Ventas · Compras · Tesorería · migración `empresas` de Táctica (`backup-tactica/tactica.sql`).

## Deploy
Repo `github.com/Febecos/febo-gestion` → Vercel (plan Pro) → dominio `gestion.febecos.com`.
⚠️ NO deployar sin auth. Cargar env vars en Vercel. DNS CNAME en lineadns.com.
