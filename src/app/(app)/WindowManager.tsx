"use client";
import { createContext, useContext, useState, useCallback, useRef, Suspense } from "react";
import ClientesClient from "./clientes/ClientesClient";
import VentasClient from "./ventas/VentasClient";
import ProductosClient from "./productos/ProductosClient";
import CotizadorEmbed from "./cotizadores/CotizadorEmbed";

export type WinKey = "clientes" | "ventas" | "productos" | "cot-bomba" | "cot-fv" | "presup-edit";
type Win = { id: number; key: WinKey; title: string; x: number; y: number; w: number; h: number; z: number; max: boolean; min: boolean; payload?: any };

const TITULOS: Record<WinKey, string> = {
  clientes: "👥 Clientes / CRM", ventas: "🧾 Ventas / Presupuestos", productos: "📦 Productos",
  "cot-bomba": "🔧 Cotizador de bombas", "cot-fv": "☀️ Cotizador fotovoltaico",
  "presup-edit": "✏️ Editar presupuesto",
};

const Ctx = createContext<{ open: (k: WinKey, payload?: any) => void } | null>(null);
export const useWindows = () => useContext(Ctx)!;

function Body({ k, payload }: { k: WinKey; payload?: any }) {
  if (k === "clientes") return <ClientesClient openClienteId={payload?.clienteId} />;
  if (k === "ventas") return <VentasClient />;
  if (k === "productos") return <ProductosClient />;
  if (k === "presup-edit") return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-1 border-b border-gray-100 text-[11px] text-gray-400 shrink-0">
        <span className="bg-emerald-100 text-emerald-700 rounded px-2 py-0.5 font-semibold">edición interna (token)</span>
        {payload?.url && <a href={payload.url} target="_blank" rel="noreferrer" className="ml-auto text-febo-azul">abrir en pestaña ↗</a>}
      </div>
      {payload?.url
        ? <iframe src={payload.url} className="flex-1 w-full border-0" title="Editar presupuesto" />
        : <div className="text-gray-400 text-sm p-4">Sin presupuesto</div>}
    </div>
  );
  return <CotizadorEmbed tipoProp={k === "cot-fv" ? "fv" : "bomba"} />;
}

export default function WindowManager({ children }: { children: React.ReactNode }) {
  const [wins, setWins] = useState<Win[]>([]);
  const zTop = useRef(10);
  const idSeq = useRef(1);
  const deskRef = useRef<HTMLDivElement>(null);

  const focus = useCallback((id: number) => {
    zTop.current += 1; const z = zTop.current;
    setWins((ws) => ws.map((w) => (w.id === id ? { ...w, z } : w)));
  }, []);

  const open = useCallback((k: WinKey, payload?: any) => {
    setWins((ws) => {
      const ex = ws.find((w) => w.key === k);
      zTop.current += 1;
      if (ex) return ws.map((w) => (w.id === ex.id ? { ...w, z: zTop.current, min: false, payload: payload ?? w.payload } : w));
      const d = deskRef.current;
      const dw = d?.clientWidth || 1200, dh = d?.clientHeight || 700;
      const n = ws.length;
      const w = Math.min(1000, dw - 40), h = Math.min(620, dh - 40);
      return [...ws, { id: idSeq.current++, key: k, title: TITULOS[k], x: Math.min(20 + n * 26, Math.max(0, dw - w - 10)), y: Math.min(16 + n * 22, Math.max(0, dh - h - 10)), w, h, z: zTop.current, max: true, min: false, payload }];
    });
  }, []);

  const close = (id: number) => setWins((ws) => ws.filter((w) => w.id !== id));
  const setFlag = (id: number, f: "max" | "min") => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, [f]: !w[f], ...(f === "min" && !w.min ? {} : {}) } : w)));
  const restore = (id: number) => { setWins((ws) => ws.map((w) => (w.id === id ? { ...w, min: false } : w))); focus(id); };

  function startDrag(e: React.MouseEvent, id: number) {
    focus(id);
    const w = wins.find((x) => x.id === id); if (!w || w.max) return;
    const d = deskRef.current; const dw = d?.clientWidth || 1200, dh = d?.clientHeight || 700;
    const ox = e.clientX - w.x, oy = e.clientY - w.y;
    const move = (ev: MouseEvent) => setWins((ws) => ws.map((x) => {
      if (x.id !== id) return x;
      const nx = Math.max(0, Math.min(ev.clientX - ox, dw - 80));
      const ny = Math.max(0, Math.min(ev.clientY - oy, dh - 40));
      return { ...x, x: nx, y: ny };
    }));
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
  }

  const visibles = wins.filter((w) => !w.min);
  const minimizadas = wins.filter((w) => w.min);

  return (
    <Ctx.Provider value={{ open }}>
      <div className="h-screen flex flex-col">
        {children}
        <div className="flex flex-1 overflow-hidden">
        <aside className="w-16 shrink-0 bg-slate-900 flex flex-col items-center gap-1 py-3">
          {([
            { k: "clientes", icon: "👥", label: "Clientes" },
            { k: "ventas", icon: "🧾", label: "Ventas" },
            { k: "productos", icon: "📦", label: "Productos" },
            { k: "cot-bomba", icon: "🔧", label: "Bomba" },
            { k: "cot-fv", icon: "☀️", label: "FV" },
          ] as { k: WinKey; icon: string; label: string }[]).map((b) => (
            <button key={b.k} onClick={() => open(b.k)} title={b.label}
              className="w-14 flex flex-col items-center gap-0.5 py-2 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition">
              <span className="text-xl">{b.icon}</span>
              <span className="text-[9px]">{b.label}</span>
            </button>
          ))}
        </aside>
        <div ref={deskRef} className="relative flex-1 overflow-hidden bg-slate-700" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,.06) 1px, transparent 0)", backgroundSize: "22px 22px" }}>
          {wins.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-slate-300 select-none p-10 pointer-events-none">
              <div className="text-5xl mb-3 opacity-80">🛰️</div>
              <div className="text-lg font-semibold text-slate-100">FEBO-GESTION</div>
              <div className="text-sm mt-1 text-slate-300">Abrí un módulo desde el menú de arriba — cada uno se abre en su ventana.</div>
              <div className="text-xs mt-4 text-slate-400">Arrastrá del título · ▢ maximizar · ─ minimizar · ✕ cerrar (libera memoria)</div>
            </div>
          )}
          {visibles.map((w) => (
            <div key={w.id} onMouseDown={() => focus(w.id)}
              className="absolute bg-white rounded-xl shadow-2xl border border-gray-300 flex flex-col overflow-hidden"
              style={w.max ? { left: 6, top: 6, right: 6, bottom: 6, zIndex: w.z } : { left: w.x, top: w.y, width: w.w, height: w.h, zIndex: w.z }}>
              <div onMouseDown={(e) => startDrag(e, w.id)} onDoubleClick={() => setFlag(w.id, "max")}
                className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 border-b border-gray-200 cursor-move select-none">
                <span className="font-semibold text-sm">{w.payload?.title || w.title}</span>
                <div className="ml-auto flex gap-1">
                  <button onClick={() => setFlag(w.id, "min")} className="w-6 h-6 rounded hover:bg-gray-200 text-gray-500" title="Minimizar">─</button>
                  <button onClick={() => setFlag(w.id, "max")} className="w-6 h-6 rounded hover:bg-gray-200 text-gray-500" title="Maximizar">▢</button>
                  <button onClick={() => close(w.id)} className="w-6 h-6 rounded hover:bg-red-100 text-red-500" title="Cerrar">✕</button>
                </div>
              </div>
              <div className={`flex-1 min-h-0 ${w.key.startsWith("cot-") || w.key === "presup-edit" ? "overflow-hidden" : "overflow-auto p-4"}`}>
                <Suspense fallback={<div className="text-gray-400 text-sm p-4">Cargando…</div>}><Body k={w.key} payload={w.payload} /></Suspense>
              </div>
            </div>
          ))}
          {minimizadas.length > 0 && (
            <div className="absolute bottom-0 left-0 right-0 flex gap-2 px-2 py-1.5 bg-slate-800/70">
              {minimizadas.map((w) => (
                <button key={w.id} onClick={() => restore(w.id)} className="flex items-center gap-2 bg-white/90 rounded px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-white">
                  {w.title}
                </button>
              ))}
            </div>
          )}
        </div>
        </div>
      </div>
    </Ctx.Provider>
  );
}
