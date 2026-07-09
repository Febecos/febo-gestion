"use client";
import { useEffect, useState, useRef, Fragment } from "react";
import { useRouter } from "next/navigation";
import { useWindows, WinKey } from "./WindowManager";

const MODULOS: { key: WinKey; label: string; icon: string }[] = [
  { key: "clientes", label: "Clientes", icon: "👥" },
  { key: "proveedores", label: "Proveedores", icon: "🏭" },
  { key: "ventas", label: "Ventas", icon: "🧾" },
  { key: "productos", label: "Productos", icon: "📦" },
  { key: "cot-bomba", label: "Cotizar bomba", icon: "🔧" },
  { key: "cot-fv", label: "Cotizar FV", icon: "☀️" },
  { key: "proyecto-fv", label: "Proyecto FV", icon: "🏗️" },
  { key: "compras", label: "Compras", icon: "🛒" },
  { key: "transportistas", label: "Transportistas", icon: "🚚" },
];
const SOON = [
  { label: "Tesorería", icon: "💰" }, { label: "Reportes", icon: "📊" },
];

// 🔔 Alarma de pedidos online: poll del contador + beep/flash al entrar uno nuevo.
function beep() {
  try {
    const AC = (window.AudioContext || (window as any).webkitAudioContext);
    if (!AC) return;
    const ctx = new AC();
    const tone = (freq: number, start: number, dur: number) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = freq;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
      o.start(ctx.currentTime + start); o.stop(ctx.currentTime + start + dur);
    };
    tone(880, 0, 0.18); tone(1175, 0.2, 0.25); // ding-dong
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch { /* audio bloqueado: el badge visual igual avisa */ }
}

export default function TopNav() {
  const router = useRouter();
  const { open } = useWindows();
  const [esOwner, setEsOwner] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const [flash, setFlash] = useState(false);
  const lastSeen = useRef<string | null>(null);
  const [stockBajo, setStockBajo] = useState(0);
  useEffect(() => { fetch("/api/me").then((r) => r.json()).then((d) => setEsOwner(!!(d.ok && d.es_owner))).catch(() => {}); }, []);

  // Poll cada 30s. La primera lectura sólo inicializa (no alarma por pedidos viejos).
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const d = await (await fetch("/api/pedidos-online?count=1")).json();
        if (!alive || !d.ok) return;
        setOnlineCount(d.count || 0);
        const latest = d.latest ? String(d.latest) : "";
        if (lastSeen.current === null) { lastSeen.current = latest; return; }  // 1ª lectura sólo inicializa
        if (latest && latest > lastSeen.current) { lastSeen.current = latest; setFlash(true); beep(); }
      } catch { /* red caída: reintenta en el próximo tick */ }
    };
    tick();
    const iv = setInterval(tick, 30000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // Stock bajo: poll del contador (sólo badge, sin sonido).
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try { const d = await (await fetch("/api/stock?count=1")).json(); if (alive && d.ok) setStockBajo(d.count || 0); } catch {}
    };
    tick();
    const iv = setInterval(tick, 60000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  function abrirOnline() { setFlash(false); open("pedidos-online"); }
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
        <button onClick={abrirOnline} title="Pedidos de la tienda online (MercadoPago / Transferencia / NAVE). Suena y avisa al entrar uno nuevo."
          className={"relative flex flex-col items-center justify-center min-w-[80px] px-2 py-2 rounded-lg transition " + (flash ? "bg-red-500 text-white animate-pulse" : onlineCount > 0 ? "bg-red-50 text-red-600" : "text-gray-600 hover:bg-febo-azul/10 hover:text-febo-azul")}>
          <span className="text-2xl">🛍️</span>
          <span className="text-[11px] mt-0.5 font-semibold whitespace-nowrap">Pedidos online</span>
          {onlineCount > 0 && <span className="absolute top-1 right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">{onlineCount}</span>}
        </button>
        {MODULOS.map((m) => (
          <Fragment key={m.key}>
          <button onClick={() => (m.key === "cot-fv" ? abrirCotizarFv() : open(m.key))}
            className="flex flex-col items-center justify-center min-w-[80px] px-2 py-2 rounded-lg text-gray-600 hover:bg-febo-azul/10 hover:text-febo-azul transition">
            <span className="text-2xl">{m.icon}</span>
            <span className="text-[11px] mt-0.5 font-semibold whitespace-nowrap">{m.label}</span>
          </button>
          {m.key === "productos" && (
            <button onClick={() => open("stock")} title="Stock del depósito. El número = productos bajo el mínimo."
              className={"relative flex flex-col items-center justify-center min-w-[80px] px-2 py-2 rounded-lg transition " + (stockBajo > 0 ? "bg-amber-50 text-amber-700" : "text-gray-600 hover:bg-febo-azul/10 hover:text-febo-azul")}>
              <span className="text-2xl">🏬</span>
              <span className="text-[11px] mt-0.5 font-semibold whitespace-nowrap">Stock</span>
              {stockBajo > 0 && <span className="absolute top-1 right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">{stockBajo}</span>}
            </button>
          )}
          </Fragment>
        ))}
        {SOON.map((m) => (
          <div key={m.label} className="flex flex-col items-center justify-center min-w-[78px] px-2 py-2 rounded-lg text-gray-300 cursor-default">
            <span className="text-2xl">{m.icon}</span>
            <span className="text-[11px] mt-0.5 whitespace-nowrap">{m.label}</span>
            <span className="text-[8px]">pronto</span>
          </div>
        ))}
        {/* Autoservicio: generar listas de precios para revendedores cuando Guille quiera (al lado
            de Reportes). Abre el generador standalone /lista-precios (elige lista/rubro + PDF). */}
        <button onClick={() => window.open("/lista-precios", "_blank")} title="Generar listas de precios para revendedores (elegís lista/rubro y sale el PDF)."
          className="flex flex-col items-center justify-center min-w-[80px] px-2 py-2 rounded-lg text-gray-600 hover:bg-febo-azul/10 hover:text-febo-azul transition">
          <span className="text-2xl">📄</span>
          <span className="text-[11px] mt-0.5 font-semibold whitespace-nowrap">Listas de precios</span>
        </button>
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
