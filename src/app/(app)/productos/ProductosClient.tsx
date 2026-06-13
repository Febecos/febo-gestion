"use client";
import { useEffect, useState, useCallback } from "react";

type Prod = { id: number; codigo: string; descripcion: string; categoria: string; origen: string; marca: string; proveedor: string; precio: number; costo_usd: number; iva_pct: number; stock: number };

const fmt = (v: number) => (v ? "$ " + Math.round(Number(v)).toLocaleString("es-AR") : "—");
const fmtU = (v: number) => (v ? "US$ " + Number(v).toLocaleString("es-AR") : "—");

export default function ProductosClient() {
  const [rows, setRows] = useState<Prod[]>([]);
  const [cats, setCats] = useState<{ categoria: string; n: number }[]>([]);
  const [q, setQ] = useState(""); const [cat, setCat] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ q, categoria: cat, limit: "100" });
      const r = await fetch("/api/productos?" + p); const d = await r.json();
      if (d.ok) { setRows(d.productos); setCats(d.categorias); }
    } finally { setLoading(false); }
  }, [q, cat]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar código / descripción / marca…" className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[260px]" />
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">Todas las categorías</option>
          {cats.map((c) => <option key={c.categoria} value={c.categoria}>{c.categoria} ({c.n})</option>)}
        </select>
        <span className="text-sm text-gray-500">{rows.length} productos</span>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr>
            <th className="text-left px-4 py-3">Código</th><th className="text-left px-4 py-3">Descripción</th><th className="text-left px-4 py-3">Categoría</th><th className="text-left px-4 py-3">Marca</th><th className="text-right px-4 py-3">Precio / Costo</th><th className="text-center px-4 py-3">IVA</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">Cargando…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">Sin resultados</td></tr>
            : rows.map((p) => (
              <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2 font-mono text-xs">{p.codigo || "—"}</td>
                <td className="px-4 py-2">{p.descripcion}</td>
                <td className="px-4 py-2 text-gray-500 text-xs">{p.categoria}</td>
                <td className="px-4 py-2 text-gray-600">{p.marca || "—"}</td>
                <td className="px-4 py-2 text-right font-semibold">{p.origen === "fv" ? fmtU(p.costo_usd) : fmt(p.precio)}</td>
                <td className="px-4 py-2 text-center text-xs text-gray-500">{p.iva_pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
