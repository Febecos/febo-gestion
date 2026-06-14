"use client";
import { useEffect, useState, useCallback } from "react";
import { useWindows } from "../WindowManager";

// Lee la tabla REAL `presupuestos` (la misma de revendedores/coti). La vista/edición/PDF
// del presupuesto vive en coti.febecos.com (ya armada). Acá listamos y enlazamos.
// URL pública: /p/{public_token} (el slug ES el token). Edición interna: + ?rev={revendedor_token}.
const COTI = "https://coti.febecos.com";

type Presup = {
  id: number; numero: string; tipo: string; estado: string;
  cliente_nombre: string; cliente_apellido: string; cliente_cuit: string; cliente_email: string;
  cliente_razon_social: string; bomba_codigo: string; bomba_descripcion: string;
  precio_ofrecido: number; precio_publico: number; revendedor_nombre: string;
  public_token: string; revendedor_token: string; cliente_id: number | null; created_at: string;
};

const fmt = (v: number, m = "$") => `${m} ` + Math.round(Number(v) || 0).toLocaleString("es-AR");
const fmtF = (v: string) => (v ? new Date(v).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");
const TIPO_COL: Record<string, { l: string; c: string }> = {
  bomba: { l: "Rev", c: "#2563eb" }, fv: { l: "FV", c: "#d97706" }, roi: { l: "ROI", c: "#059669" },
};
const EST_COL: Record<string, string> = { emitido: "#64748b", enviada: "#2563eb", pedido: "#7c3aed", pagado: "#059669", anulado: "#e53935", borrador: "#94a3b8" };

export default function VentasClient() {
  const { open } = useWindows();
  const [rows, setRows] = useState<Presup[]>([]);
  const [tipo, setTipo] = useState(""); const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ tipo, q });
      const r = await fetch("/api/presupuestos?" + p); const d = await r.json();
      if (d.ok) setRows(d.presupuestos);
    } finally { setLoading(false); }
  }, [tipo, q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const chip = (txt: string, col: string) => <span style={{ background: col + "22", color: col }} className="rounded px-2 py-0.5 text-[11px] font-semibold">{txt}</span>;
  const nombreCli = (r: Presup) => r.cliente_razon_social || [r.cliente_nombre, r.cliente_apellido].filter(Boolean).join(" ") || "—";
  const moneda = (r: Presup) => (r.tipo === "fv" ? "USD" : "$");

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar número / cliente / CUIT / bomba / vendedor…" className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[280px]" />
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">Todos</option><option value="bomba">Revendedores (bombas)</option><option value="fv">Fotovoltaico</option>
        </select>
        <span className="text-sm text-gray-500">{rows.length} presupuestos</span>
        <a href={COTI} target="_blank" rel="noreferrer" className="ml-auto bg-febo-verde text-white rounded-lg px-3 py-2 text-sm font-semibold">＋ Nuevo en coti ↗</a>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr>
            <th className="text-left px-4 py-3">Número</th><th className="text-left px-4 py-3">Tipo</th>
            <th className="text-left px-4 py-3">Cliente</th><th className="text-left px-4 py-3">Detalle</th>
            <th className="text-left px-4 py-3">Vendedor</th><th className="text-left px-4 py-3">Estado</th>
            <th className="text-left px-4 py-3">Fecha</th><th className="text-right px-4 py-3">Precio</th><th></th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={9} className="text-center py-8 text-gray-400">Cargando…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={9} className="text-center py-8 text-gray-400">Sin presupuestos</td></tr>
            : rows.map((r) => {
              const tc = TIPO_COL[r.tipo] || { l: r.tipo, c: "#888" };
              return (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2 font-semibold">{r.numero}</td>
                  <td className="px-4 py-2">{chip(tc.l, tc.c)}</td>
                  <td className="px-4 py-2">{nombreCli(r)}</td>
                  <td className="px-4 py-2 text-gray-600">{r.bomba_codigo || r.bomba_descripcion || "—"}</td>
                  <td className="px-4 py-2 text-gray-500">{r.revendedor_nombre || "—"}</td>
                  <td className="px-4 py-2">{chip(r.estado || "—", EST_COL[r.estado] || "#888")}</td>
                  <td className="px-4 py-2 text-gray-600">{fmtF(r.created_at)}</td>
                  <td className="px-4 py-2 text-right font-semibold">{fmt(r.precio_ofrecido, moneda(r))}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {r.public_token && <a href={`${COTI}/p/${r.public_token}`} target="_blank" rel="noreferrer" title="Ver / Imprimir / PDF" className="text-gray-400 hover:text-febo-azul mr-2">📄</a>}
                    {r.public_token && r.revendedor_token && <a href={`${COTI}/p/${r.public_token}?rev=${r.revendedor_token}`} target="_blank" rel="noreferrer" title="Editar (vendedor interno, con token)" className="text-gray-400 hover:text-febo-azul mr-2">✏️</a>}
                    {r.cliente_id && <button onClick={() => open("clientes", { clienteId: r.cliente_id })} title="Ficha del cliente" className="text-gray-400 hover:text-febo-azul">👤</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 mt-3">El presupuesto se ve, edita, imprime y envía por email en <strong>coti.febecos.com</strong> (📄). La numeración <strong>PREV-AÑO-N</strong> es correlativa y compartida con todos los orígenes.</p>
    </div>
  );
}
