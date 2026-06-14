"use client";
import { useRouter } from "next/navigation";
import { useWindows, WinKey } from "./WindowManager";

const MODULOS: { key: WinKey; label: string; icon: string }[] = [
  { key: "clientes", label: "Clientes", icon: "👥" },
  { key: "ventas", label: "Ventas", icon: "🧾" },
  { key: "productos", label: "Productos", icon: "📦" },
  { key: "cot-bomba", label: "Cotizar bomba", icon: "🔧" },
  { key: "cot-fv", label: "Cotizar FV", icon: "☀️" },
];
const SOON = [
  { label: "Compras", icon: "🛒" }, { label: "Tesorería", icon: "💰" }, { label: "Reportes", icon: "📊" },
];

export default function TopNav() {
  const router = useRouter();
  const { open } = useWindows();
  async function salir() { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-[5]">
      <div className="flex items-center gap-3 px-5 py-2 border-b border-gray-100">
        <span className="text-xl">🛰️</span>
        <span className="font-extrabold text-febo-azul">FEBO-GESTION</span>
        <span className="text-[10px] text-gray-400">ERP + CRM</span>
        <button onClick={salir} className="ml-auto text-sm text-gray-400 hover:text-gray-700">🚪 Salir</button>
      </div>
      <nav className="flex gap-1 px-3 py-2 overflow-x-auto">
        {MODULOS.map((m) => (
          <button key={m.key} onClick={() => open(m.key)}
            className="flex flex-col items-center justify-center min-w-[80px] px-2 py-2 rounded-lg text-gray-600 hover:bg-febo-azul/10 hover:text-febo-azul transition">
            <span className="text-2xl">{m.icon}</span>
            <span className="text-[11px] mt-0.5 font-semibold whitespace-nowrap">{m.label}</span>
          </button>
        ))}
        {SOON.map((m) => (
          <div key={m.label} className="flex flex-col items-center justify-center min-w-[78px] px-2 py-2 rounded-lg text-gray-300 cursor-default">
            <span className="text-2xl">{m.icon}</span>
            <span className="text-[11px] mt-0.5 whitespace-nowrap">{m.label}</span>
            <span className="text-[8px]">pronto</span>
          </div>
        ))}
      </nav>
    </header>
  );
}
