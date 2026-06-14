"use client";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";

const MODULOS = [
  { href: "/clientes", label: "Clientes", icon: "👥" },
  { href: "/ventas", label: "Ventas", icon: "🧾" },
  { href: "/productos", label: "Productos", icon: "📦" },
  { href: "/cotizadores?t=bomba", label: "Cotizar bomba", icon: "🔧", match: "/cotizadores", t: "bomba" },
  { href: "/cotizadores?t=fv", label: "Cotizar FV", icon: "☀️", match: "/cotizadores", t: "fv" },
  { href: "/compras", label: "Compras", icon: "🛒", soon: true },
  { href: "/tesoreria", label: "Tesorería", icon: "💰", soon: true },
  { href: "/reportes", label: "Reportes", icon: "📊", soon: true },
];

export default function TopNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tActual = searchParams.get("t");
  const router = useRouter();
  async function salir() { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
      <div className="flex items-center gap-3 px-5 py-2 border-b border-gray-100">
        <span className="text-xl">🛰️</span>
        <span className="font-extrabold text-febo-azul">FEBO-GESTION</span>
        <span className="text-[10px] text-gray-400">ERP + CRM</span>
        <button onClick={salir} className="ml-auto text-sm text-gray-400 hover:text-gray-700">🚪 Salir</button>
      </div>
      <nav className="flex gap-1 px-3 py-2 overflow-x-auto">
        {MODULOS.map((m) => {
          const base = (m.match || m.href).split("?")[0];
          const act = m.t ? (pathname.startsWith(base) && tActual === m.t) : (pathname.startsWith(base) && pathname !== "/cotizadores");
          return m.soon ? (
            <div key={m.href} className="flex flex-col items-center justify-center min-w-[78px] px-2 py-2 rounded-lg text-gray-300 cursor-default">
              <span className="text-2xl">{m.icon}</span>
              <span className="text-[11px] mt-0.5">{m.label}</span>
              <span className="text-[8px]">pronto</span>
            </div>
          ) : (
            <Link key={m.href} href={m.href} className={`flex flex-col items-center justify-center min-w-[78px] px-2 py-2 rounded-lg transition ${act ? "bg-febo-azul/10 text-febo-azul" : "text-gray-600 hover:bg-gray-100"}`}>
              <span className="text-2xl">{m.icon}</span>
              <span className="text-[11px] mt-0.5 font-semibold whitespace-nowrap">{m.label}</span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
