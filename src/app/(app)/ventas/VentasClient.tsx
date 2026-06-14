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
                    {r.public_token && r.revendedor_token && <button onClick={() => open("presup-edit", { url: `${COTI}/p/${r.public_token}?rev=${r.revendedor_token}`, title: `✏️ ${r.numero}` })} title="Editar el presupuesto (interno, dentro de gestión)" className="text-gray-400 hover:text-febo-azul mr-2">✏️</button>}
                    {r.public_token && <a href={`${COTI}/p/${r.public_token}`} target="_blank" rel="noreferrer" title="Ver / Imprimir / PDF (link público, solo lectura)" className="text-gray-400 hover:text-febo-azul mr-2">📄</a>}
                    {r.cliente_id && <button onClick={() => open("clientes", { clienteId: r.cliente_id })} title="Ficha del cliente" className="text-gray-400 hover:text-febo-azul">👤</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 mt-3"><strong>✏️ Editar</strong> = abre el editor de revendedores con tu token interno, embebido acá (el cliente nunca ve esto). <strong>📄</strong> = link público de <strong>coti.febecos.com</strong> (solo lectura — lo que ve el cliente / email / PDF). Numeración <strong>PREV-AÑO-N</strong> correlativa.</p>
    </div>
  );
}

function EditarPresupuesto({ id, onClose, onSaved }: { id: number; onClose: () => void; onSaved: () => void }) {
  const [p, setP] = useState<any>(null);
  const [f, setF] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [busq, setBusq] = useState(""); const [sug, setSug] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/presupuestos/" + id).then((r) => r.json()).then((d) => {
      if (d.ok) {
        setP(d.presupuesto);
        const x = d.presupuesto;
        setF({
          descuento_pct: x.descuento_pct ?? "", precio_ofrecido: x.precio_ofrecido ?? "",
          tipo_precio: x.tipo_precio || "", estado: x.estado || "",
          cliente_nombre: [x.cliente_nombre, x.cliente_apellido].filter(Boolean).join(" ") || "",
          cliente_cuit: x.cliente_cuit || "", cliente_email: x.cliente_email || "",
          cliente_telefono: x.cliente_telefono || "", cliente_razon_social: x.cliente_razon_social || "",
        });
      }
    });
  }, [id]);

  useEffect(() => {
    if (busq.length < 2) { setSug([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch("/api/clientes?limit=6&q=" + encodeURIComponent(busq)); const d = await r.json();
      if (d.ok) setSug(d.clientes);
    }, 250); return () => clearTimeout(t);
  }, [busq]);

  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  const tomarCliente = (c: any) => {
    setF((s: any) => ({ ...s, cliente_nombre: c.nombre || "", cliente_cuit: c.cuit || "", cliente_email: c.email || "", cliente_telefono: c.whatsapp || "", cliente_razon_social: c.razon_social || "" }));
    setBusq(""); setSug([]);
  };

  async function guardar() {
    setSaving(true);
    try {
      const r = await fetch("/api/presupuestos/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      const d = await r.json(); if (!d.ok) throw new Error(d.error);
      onSaved();
    } catch (e: any) { alert("Error: " + e.message); } finally { setSaving(false); }
  }

  const inp = "border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm w-full";
  const lbl = "flex flex-col gap-1 text-[11px] font-semibold text-gray-600";
  if (!p) return null;
  return (
    <div className="fixed inset-0 bg-black/45 z-50 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-2xl mx-auto my-8 p-7 relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-5 text-2xl text-gray-400">✕</button>
        <h2 className="text-lg font-bold">✏️ Editar {p.numero}</h2>
        <p className="text-xs text-gray-400 mb-4">{p.bomba_codigo || p.bomba_descripcion || ""} · edición interna (coti queda solo-lectura)</p>

        <div className="text-[11px] font-semibold text-gray-500 uppercase mb-1.5">Cliente</div>
        <div className="relative mb-3">
          <input value={busq} onChange={(e) => setBusq(e.target.value)} placeholder="Buscar cliente en CRM para asignar…" className={inp} />
          {sug.length > 0 && (
            <div className="absolute z-10 bg-white border border-gray-200 rounded-lg mt-1 w-full shadow-sm max-h-48 overflow-auto">
              {sug.map((s) => <div key={s.id} onClick={() => tomarCliente(s)} className="px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer">{s.nombre} <span className="text-xs text-gray-400">{s.cuit || s.whatsapp || ""}</span></div>)}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <label className={lbl}>NOMBRE / RAZÓN SOCIAL<input value={f.cliente_nombre} onChange={(e) => set("cliente_nombre", e.target.value)} className={inp} /></label>
          <label className={lbl}>CUIT<input value={f.cliente_cuit} onChange={(e) => set("cliente_cuit", e.target.value)} className={inp} /></label>
          <label className={lbl}>EMAIL<input value={f.cliente_email} onChange={(e) => set("cliente_email", e.target.value)} className={inp} /></label>
          <label className={lbl}>TELÉFONO<input value={f.cliente_telefono} onChange={(e) => set("cliente_telefono", e.target.value)} className={inp} /></label>
        </div>

        <div className="text-[11px] font-semibold text-gray-500 uppercase mb-1.5">Precio</div>
        <div className="grid grid-cols-3 gap-3">
          <label className={lbl}>DESCUENTO %<input type="number" value={f.descuento_pct} onChange={(e) => set("descuento_pct", e.target.value)} className={inp} /></label>
          <label className={lbl}>PRECIO OFRECIDO<input type="number" value={f.precio_ofrecido} onChange={(e) => set("precio_ofrecido", e.target.value)} className={inp} /></label>
          <label className={lbl}>ESTADO<select value={f.estado} onChange={(e) => set("estado", e.target.value)} className={inp}>
            {["emitido", "enviada", "pedido", "pagado", "anulado", "borrador"].map((x) => <option key={x} value={x}>{x}</option>)}
          </select></label>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="border border-gray-300 rounded-lg px-5 py-2 text-sm">Cancelar</button>
          <button onClick={guardar} disabled={saving} className="bg-febo-azul text-white rounded-lg px-6 py-2 text-sm font-semibold disabled:opacity-50">{saving ? "Guardando…" : "Guardar cambios"}</button>
        </div>
      </div>
    </div>
  );
}
