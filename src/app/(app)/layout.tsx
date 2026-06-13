import Link from "next/link";
import LogoutButton from "./LogoutButton";

// Módulos del ERP+CRM. `ready` = ya funcional; el resto aparece como "próximamente".
const MODULOS = [
  { href: "/clientes", label: "Clientes / CRM", icon: "👥", ready: true },
  { href: "/productos", label: "Productos / Stock", icon: "📦", ready: true },
  { href: "/ventas", label: "Ventas", icon: "🧾", ready: true },
  { href: "/compras", label: "Compras", icon: "🛒", ready: false },
  { href: "/tesoreria", label: "Tesorería", icon: "💰", ready: false },
  { href: "/reportes", label: "Reportes", icon: "📊", ready: false },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 bg-white border-r border-gray-200 p-4">
        <div className="flex items-center gap-2 px-2 mb-6">
          <span className="text-2xl">🛰️</span>
          <div>
            <div className="font-extrabold text-febo-azul leading-none">FEBO-GESTION</div>
            <div className="text-[10px] text-gray-400">ERP + CRM</div>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {MODULOS.map((m) => (
            <Link
              key={m.href}
              href={m.ready ? m.href : "#"}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                m.ready ? "hover:bg-gray-100 text-gray-700" : "text-gray-300 cursor-default"
              }`}
            >
              <span>{m.icon}</span>
              <span>{m.label}</span>
              {!m.ready && <span className="ml-auto text-[9px] text-gray-300">pronto</span>}
            </Link>
          ))}
        </nav>
        <div className="mt-6 pt-4 border-t border-gray-100"><LogoutButton /></div>
      </aside>
      <main className="flex-1 p-8 overflow-auto">{children}</main>
    </div>
  );
}
