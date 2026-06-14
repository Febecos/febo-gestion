"use client";
import { createContext, useContext, useState, useCallback, useRef, Suspense } from "react";
import ClientesClient from "./clientes/ClientesClient";
import VentasClient from "./ventas/VentasClient";
import ProductosClient from "./productos/ProductosClient";
import CotizadorEmbed from "./cotizadores/CotizadorEmbed";

export type WinKey = "clientes" | "ventas" | "productos" | "cot-bomba" | "cot-fv";
type Win = { id: number; key: WinKey; title: string; x: number; y: number; w: number; h: number; z: number; max: boolean };

const TITULOS: Record<WinKey, string> = {
  clientes: "👥 Clientes / CRM", ventas: "🧾 Ventas", productos: "📦 Productos",
  "cot-bomba": "🔧 Cotizador de bombas", "cot-fv": "☀️ Cotizador fotovoltaico",
};

const Ctx = createContext<{ open: (k: WinKey) => void } | null>(null);
export const useWindows = () => useContext(Ctx)!;

function Body({ k }: { k: WinKey }) {
  if (k === "clientes") return <ClientesClient />;
  if (k === "ventas") return <VentasClient />;
  if (k === "productos") return <ProductosClient />;
  return <CotizadorEmbed tipoProp={k === "cot-fv" ? "fv" : "bomba"} />;
}

export default function WindowManager({ children }: { children: React.ReactNode }) {
  const [wins, setWins] = useState<Win[]>([]);
  const zTop = useRef(10);
  const idSeq = useRef(1);

  const focus = useCallback((id: number) => {
    zTop.current += 1; const z = zTop.current;
    setWins((ws) => ws.map((w) => (w.id === id ? { ...w, z } : w)));
  }, []);

  const open = useCallback((k: WinKey) => {
    setWins((ws) => {
      const ex = ws.find((w) => w.key === k); // una ventana por tipo: si ya está, traer al frente
      zTop.current += 1;
      if (ex) return ws.map((w) => (w.id === ex.id ? { ...w, z: zTop.current } : w));
      const n = ws.length;
      const id = idSeq.current++;
      return [...ws, { id, key: k, title: TITULOS[k], x: 30 + n * 28, y: 20 + n * 24, w: 1000, h: 620, z: zTop.current, max: false }];
    });
  }, []);

  const close = (id: number) => setWins((ws) => ws.filter((w) => w.id !== id));
  const toggleMax = (id: number) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, max: !w.max } : w)));

  function startDrag(e: React.MouseEvent, id: number) {
    focus(id);
    const w = wins.find((x) => x.id === id); if (!w || w.max) return;
    const ox = e.clientX - w.x, oy = e.clientY - w.y;
    const move = (ev: MouseEvent) => setWins((ws) => ws.map((x) => (x.id === id ? { ...x, x: Math.max(0, ev.clientX - ox), y: Math.max(0, ev.clientY - oy) } : x)));
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
  }

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      <div className="relative">
        {wins.map((w) => (
          <div key={w.id} onMouseDown={() => focus(w.id)}
            className="fixed bg-white rounded-xl shadow-2xl border border-gray-300 flex flex-col overflow-hidden"
            style={w.max ? { left: 8, top: 96, right: 8, bottom: 8, zIndex: w.z } : { left: w.x, top: w.y + 88, width: w.w, height: w.h, zIndex: w.z }}>
            <div onMouseDown={(e) => startDrag(e, w.id)} onDoubleClick={() => toggleMax(w.id)}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 border-b border-gray-200 cursor-move select-none">
              <span className="font-semibold text-sm">{w.title}</span>
              <div className="ml-auto flex gap-1">
                <button onClick={() => toggleMax(w.id)} className="w-6 h-6 rounded hover:bg-gray-200 text-gray-500" title="Maximizar">▢</button>
                <button onClick={() => close(w.id)} className="w-6 h-6 rounded hover:bg-red-100 text-red-500" title="Cerrar">✕</button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <Suspense fallback={<div className="text-gray-400 text-sm">Cargando…</div>}><Body k={w.key} /></Suspense>
            </div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
