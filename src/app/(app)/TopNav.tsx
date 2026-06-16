"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWindows, WinKey } from "./WindowManager";

const MODULOS: { key: WinKey; label: string; icon: string }[] = [
  { key: "clientes", label: "Clientes", icon: "👥" },
  { key: "proveedores", label: "Proveedores", icon: "🏭" },
  { key: "ventas", label: "Ventas", icon: "🧾" },
  { key: "productos", label: "Productos", icon: "📦" },
  { key: "cot-bomba", label: "Cotizar bomba", icon: "🔧" },
  { key: "cot-fv", label: "Cotizar FV", icon: "☀️" },
  { key: "compras", label: "Compras", icon: "🛒" },
];
const SOON = [
  { label: "Tesorería", icon: "💰" }, { label: "Reportes", icon: "📊" },
];

export default function TopNav() {
  const router = useRouter();
  const { open } = useWindows();
  const [esOwner, setEsOwner] = useState(false);
  useEffect(() => { fetch("/api/me").then((r) => r.json()).then((d) => setEsOwner(!!(d.ok && d.es_owner))).catch(() => {}); }, []);
  async function salir() { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }

  // "Cotizar FV" abre el cotizador FV en modo INTERNO, EMBEBIDO en una ventana de gestión
  // (como Cotizar bomba). Pasa la sesión efímera del puente en el hash.
  async function abrirCotizarFv() {
    let hash = "";
    try { const r = await fetch("/api/fv-session"); const d = await r.json(); if (d.ok && d.token) hash = "#admin_jwt=" + d.token; } catch {}
    if (!hash) { alert("⚠️ No se pudo abrir el cotizador FV interno (revisá FV_BRIDGE_SECRET)."); return; }
    open("presup-edit", { url: "https://fv.febecos.com/cotizar" + hash, title: "☀️ Cotizar FV (interno)" });
  }

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
          <button key={m.key} onClick={() => (m.key === "cot-fv" ? abrirCotizarFv() : open(m.key))}
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
        {esOwner && (
          <button onClick={() => open("config")} title="Solo administrador"
            className="flex flex-col items-center justify-center min-w-[80px] px-2 py-2 rounded-lg text-gray-600 hover:bg-febo-azul/10 hover:text-febo-azul transition ml-auto">
            <span className="text-2xl">⚙️</span>
            <span className="text-[11px] mt-0.5 font-semibold whitespace-nowrap">Configuración</span>
          </button>
        )}
      </nav>
    </header>
  );
}
