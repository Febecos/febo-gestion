"use client";
import { useEffect, useState, useCallback } from "react";
import { useWindows } from "../WindowManager";

// Presupuestos = tabla real `presupuestos` (revendedores/coti). Pedidos = `pedidos`+`fv_pedidos`.
// Factura/Remito = fg_comprobantes. Pagos = fg_pagos. Proveedor = pedidos_proveedores.
// Vista/PDF/edición pública en coti.febecos.com (/p/{token}); edición interna embebida con ?rev.
const COTI = "https://coti.febecos.com";

const fmt = (v: number, m = "$") => `${m} ` + Math.round(Number(v) || 0).toLocaleString("es-AR");
const fmtF = (v: string) => (v ? new Date(v).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");
const chip = (txt: string, col: string) => <span style={{ background: col + "22", color: col }} className="rounded px-2 py-0.5 text-[11px] font-semibold">{txt}</span>;
const EST_COL: Record<string, string> = { emitido: "#64748b", enviada: "#2563eb", pedido: "#7c3aed", pagado: "#059669", aprobado: "#059669", nuevo: "#2563eb", anulado: "#e53935", borrador: "#94a3b8", proforma: "#d97706", confirmado: "#7c3aed" };

const SECCIONES = [
  { k: "presupuestos", icon: "📝", label: "Presupuestos" },
  { k: "pedidos", icon: "📦", label: "Pedidos" },
  { k: "facturas", icon: "🧾", label: "Facturas" },
  { k: "remitos", icon: "🚚", label: "Remitos" },
  { k: "pagos", icon: "💵", label: "Pagos" },
  { k: "prov", icon: "🏭", label: "Pedidos a proveedor" },
] as const;
type Seccion = (typeof SECCIONES)[number]["k"];

export default function VentasClient() {
  const { setTitle } = useWindows();
  const [sec, setSec] = useState<Seccion>("presupuestos");
  useEffect(() => {
    const lbl = SECCIONES.find((s) => s.k === sec)?.label || "Presupuestos";
    setTitle("ventas", `🧾 Ventas / ${lbl}`);
  }, [sec, setTitle]);
  return (
    <div className="flex gap-4 h-full">
      <aside className="w-44 shrink-0 border-r border-gray-200 pr-2">
        {SECCIONES.map((s) => (
          <button key={s.k} onClick={() => setSec(s.k)}
            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-left mb-0.5 ${sec === s.k ? "bg-febo-azul text-white font-semibold" : "text-gray-600 hover:bg-gray-100"}`}>
            <span>{s.icon}</span><span>{s.label}</span>
          </button>
        ))}
      </aside>
      <div className="flex-1 min-w-0">
        {sec === "presupuestos" && <Presupuestos />}
        {sec === "pedidos" && <Pedidos />}
        {sec === "facturas" && <Comprobantes tipo="factura" titulo="Facturas" />}
        {sec === "remitos" && <Comprobantes tipo="remito" titulo="Remitos" />}
        {sec === "pagos" && <Pagos />}
        {sec === "prov" && <PedidosProveedor />}
      </div>
    </div>
  );
}

// ---------- PRESUPUESTOS (tabla real, coti) ----------
type Presup = { id: number; numero: string; tipo: string; estado: string; cliente_display: string; cliente_nombre: string; cliente_apellido: string; cliente_razon_social: string; bomba_codigo: string; bomba_descripcion: string; precio_ofrecido: number; revendedor_nombre: string; public_token: string; revendedor_token: string; cliente_id: number | null; created_at: string };

function Presupuestos() {
  const { open } = useWindows();
  const [rows, setRows] = useState<Presup[]>([]);
  const [tipo, setTipo] = useState(""); const [q, setQ] = useState("");
  const [estado, setEstado] = useState(""); const [vendedor, setVendedor] = useState("");
  const [estados, setEstados] = useState<string[]>([]); const [vendedores, setVendedores] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/presupuestos?" + new URLSearchParams({ tipo, q, estado, vendedor }));
      const d = await r.json();
      if (d.ok) { setRows(d.presupuestos); if (d.estados) setEstados(d.estados); if (d.vendedores) setVendedores(d.vendedores); }
    } finally { setLoading(false); }
  }, [tipo, q, estado, vendedor]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const nombreCli = (r: Presup) => r.cliente_display || r.cliente_razon_social || [r.cliente_nombre, r.cliente_apellido].filter(Boolean).join(" ") || "—";
  const selCls = "border border-gray-300 rounded-lg px-3 py-2 text-sm";
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar número / cliente / CUIT / bomba…" className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[240px]" />
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={selCls}>
          <option value="">Todo tipo</option><option value="bomba">Revendedores (bombas)</option><option value="fv">Fotovoltaico</option>
        </select>
        <select value={vendedor} onChange={(e) => setVendedor(e.target.value)} className={selCls}>
          <option value="">Todos los vendedores</option>
          {vendedores.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value)} className={selCls}>
          <option value="">Todos los estados</option>
          {estados.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <span className="text-sm text-gray-500">{rows.length}</span>
        <a href={COTI} target="_blank" rel="noreferrer" className="ml-auto bg-febo-verde text-white rounded-lg px-3 py-2 text-sm font-semibold">＋ Nuevo en coti ↗</a>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr>
            <th className="text-left px-4 py-3">Número</th><th className="text-left px-4 py-3">Tipo</th><th className="text-left px-4 py-3">Cliente</th><th className="text-left px-4 py-3">Detalle</th><th className="text-left px-4 py-3">Vendedor</th><th className="text-left px-4 py-3">Estado</th><th className="text-left px-4 py-3">Fecha</th><th className="text-right px-4 py-3">Precio</th><th></th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={9} className="text-center py-8 text-gray-400">Cargando…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={9} className="text-center py-8 text-gray-400">Sin presupuestos</td></tr>
            : rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2 font-semibold">{r.numero}</td>
                <td className="px-4 py-2">{chip(r.tipo === "fv" ? "FV" : "Rev", r.tipo === "fv" ? "#d97706" : "#2563eb")}</td>
                <td className="px-4 py-2">{nombreCli(r)}</td>
                <td className="px-4 py-2 text-gray-600">{r.bomba_codigo || r.bomba_descripcion || "—"}</td>
                <td className="px-4 py-2 text-gray-500">{r.revendedor_nombre || "—"}</td>
                <td className="px-4 py-2">{chip(r.estado || "—", EST_COL[r.estado] || "#888")}</td>
                <td className="px-4 py-2 text-gray-600">{fmtF(r.created_at)}</td>
                <td className="px-4 py-2 text-right font-semibold">{fmt(r.precio_ofrecido, r.tipo === "fv" ? "USD" : "$")}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {r.public_token && r.revendedor_token && <button onClick={() => open("presup-edit", { url: `${COTI}/p/${r.public_token}?rev=${r.revendedor_token}`, title: `✏️ ${r.numero}` })} title="Editar (interno, en gestión)" className="text-gray-400 hover:text-febo-azul mr-2">✏️</button>}
                  {r.public_token && <a href={`${COTI}/p/${r.public_token}`} target="_blank" rel="noreferrer" title="Ver / Imprimir / PDF (público)" className="text-gray-400 hover:text-febo-azul mr-2">📄</a>}
                  {r.cliente_id && <button onClick={() => open("clientes", { clienteId: r.cliente_id })} title="Ficha del cliente" className="text-gray-400 hover:text-febo-azul">👤</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editId && <EditarPresupuesto id={editId} onClose={() => setEditId(null)} onSaved={() => { setEditId(null); load(); }} />}
    </div>
  );
}

// ---------- PEDIDOS (bombas + fv unificados) ----------
function Pedidos() {
  const [rows, setRows] = useState<any[]>([]); const [loading, setLoading] = useState(true);
  useEffect(() => { fetch("/api/pedidos").then((r) => r.json()).then((d) => { setRows(d.ok ? d.pedidos : []); setLoading(false); }); }, []);
  return (
    <Tabla loading={loading} count={rows.length} unidad="pedidos"
      cols={["Origen", "Número", "Cliente", "Detalle", "Estado", "Fecha", "Total", ""]}>
      {rows.map((p, i) => (
        <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
          <td className="px-4 py-2">{chip(p.origen === "fv" ? "FV" : "Bomba", p.origen === "fv" ? "#d97706" : "#2563eb")}</td>
          <td className="px-4 py-2 font-semibold">{p.numero || (p.presup ? "↳ " + p.presup : "—")}</td>
          <td className="px-4 py-2">{p.cliente}</td>
          <td className="px-4 py-2 text-gray-600">{p.detalle}</td>
          <td className="px-4 py-2">{chip(p.estado, EST_COL[p.estado] || "#888")}</td>
          <td className="px-4 py-2 text-gray-600">{fmtF(p.fecha)}</td>
          <td className="px-4 py-2 text-right font-semibold">{fmt(p.total, p.moneda)}</td>
          <td className="px-4 py-2 text-right">{p.token && <a href={`${COTI}/p/${p.token}`} target="_blank" rel="noreferrer" title="Ver" className="text-gray-400 hover:text-febo-azul">📄</a>}</td>
        </tr>
      ))}
    </Tabla>
  );
}

// ---------- FACTURAS / REMITOS (fg_comprobantes) ----------
function Comprobantes({ tipo, titulo }: { tipo: string; titulo: string }) {
  const [rows, setRows] = useState<any[]>([]); const [loading, setLoading] = useState(true);
  useEffect(() => { fetch("/api/ventas?tipo=" + tipo).then((r) => r.json()).then((d) => { setRows(d.ok ? d.comprobantes : []); setLoading(false); }); }, [tipo]);
  return (
    <Tabla loading={loading} count={rows.length} unidad={titulo.toLowerCase()}
      cols={["Número", "Cliente", "Estado", "Fecha", "Total"]} vacio={`Todavía no hay ${titulo.toLowerCase()} (se generan desde un pedido).`}>
      {rows.map((c) => (
        <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
          <td className="px-4 py-2 font-semibold">{c.numero}</td>
          <td className="px-4 py-2">{c.cliente_nombre || "—"}</td>
          <td className="px-4 py-2">{chip(c.estado || "—", EST_COL[c.estado] || "#888")}</td>
          <td className="px-4 py-2 text-gray-600">{fmtF(c.fecha)}</td>
          <td className="px-4 py-2 text-right font-semibold">{fmt(c.total)}</td>
        </tr>
      ))}
    </Tabla>
  );
}

// ---------- PAGOS (fg_pagos) ----------
function Pagos() {
  const [rows, setRows] = useState<any[]>([]); const [loading, setLoading] = useState(true);
  useEffect(() => { fetch("/api/pagos").then((r) => r.json()).then((d) => { setRows(d.ok ? d.pagos : []); setLoading(false); }); }, []);
  return (
    <Tabla loading={loading} count={rows.length} unidad="pagos"
      cols={["Comprobante", "Cliente", "Medio", "Fecha", "Monto"]} vacio="Todavía no hay pagos registrados.">
      {rows.map((p) => (
        <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
          <td className="px-4 py-2 font-semibold">{p.comprobante_numero || "—"}</td>
          <td className="px-4 py-2">{p.cliente_nombre || "—"}</td>
          <td className="px-4 py-2 text-gray-600">{p.medio || "—"}</td>
          <td className="px-4 py-2 text-gray-600">{fmtF(p.fecha)}</td>
          <td className="px-4 py-2 text-right font-semibold text-emerald-600">{fmt(p.monto)}</td>
        </tr>
      ))}
    </Tabla>
  );
}

// ---------- PEDIDOS A PROVEEDOR (pedidos_proveedores) ----------
function PedidosProveedor() {
  const [rows, setRows] = useState<any[]>([]); const [loading, setLoading] = useState(true);
  useEffect(() => { fetch("/api/pedidos-proveedor").then((r) => r.json()).then((d) => { setRows(d.ok ? d.pedidos : []); setLoading(false); }); }, []);
  return (
    <Tabla loading={loading} count={rows.length} unidad="pedidos a proveedor"
      cols={["Proveedor", "FV/Ref", "Remito", "Estado", "Fecha", "Costo USD"]}>
      {rows.map((p) => (
        <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
          <td className="px-4 py-2 font-semibold">{p.proveedor || "—"}</td>
          <td className="px-4 py-2 text-gray-600">{p.fv_numero || p.gsa_numero || "—"}</td>
          <td className="px-4 py-2 text-gray-600">{p.numero_remito || "—"}</td>
          <td className="px-4 py-2">{chip(p.estado || "—", EST_COL[p.estado] || "#888")}</td>
          <td className="px-4 py-2 text-gray-600">{fmtF(p.created_at)}</td>
          <td className="px-4 py-2 text-right font-semibold">{fmt(p.total_costo_usd, "USD")}</td>
        </tr>
      ))}
    </Tabla>
  );
}

// ---------- Tabla genérica ----------
function Tabla({ loading, count, unidad, cols, children, vacio }: { loading: boolean; count: number; unidad: string; cols: string[]; children: React.ReactNode; vacio?: string }) {
  return (
    <div>
      <div className="text-sm text-gray-500 mb-3">{count} {unidad}</div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr>
            {cols.map((c, i) => <th key={i} className={`px-4 py-3 ${c === "Total" || c === "Monto" || c.includes("USD") ? "text-right" : "text-left"}`}>{c}</th>)}
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={cols.length} className="text-center py-8 text-gray-400">Cargando…</td></tr>
            : count === 0 ? <tr><td colSpan={cols.length} className="text-center py-8 text-gray-400">{vacio || "Sin registros"}</td></tr>
            : children}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Editor nativo de datos (rápido) ----------
function EditarPresupuesto({ id, onClose, onSaved }: { id: number; onClose: () => void; onSaved: () => void }) {
  const [p, setP] = useState<any>(null);
  const [f, setF] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [busq, setBusq] = useState(""); const [sug, setSug] = useState<any[]>([]);
  useEffect(() => {
    fetch("/api/presupuestos/" + id).then((r) => r.json()).then((d) => {
      if (d.ok) { const x = d.presupuesto; setP(x); setF({ descuento_pct: x.descuento_pct ?? "", precio_ofrecido: x.precio_ofrecido ?? "", estado: x.estado || "", cliente_nombre: [x.cliente_nombre, x.cliente_apellido].filter(Boolean).join(" ") || "", cliente_cuit: x.cliente_cuit || "", cliente_email: x.cliente_email || "", cliente_telefono: x.cliente_telefono || "" }); }
    });
  }, [id]);
  useEffect(() => { if (busq.length < 2) { setSug([]); return; } const t = setTimeout(async () => { const r = await fetch("/api/clientes?limit=6&q=" + encodeURIComponent(busq)); const d = await r.json(); if (d.ok) setSug(d.clientes); }, 250); return () => clearTimeout(t); }, [busq]);
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  async function guardar() { setSaving(true); try { const r = await fetch("/api/presupuestos/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) }); const d = await r.json(); if (!d.ok) throw new Error(d.error); onSaved(); } catch (e: any) { alert("Error: " + e.message); } finally { setSaving(false); } }
  const inp = "border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm w-full"; const lbl = "flex flex-col gap-1 text-[11px] font-semibold text-gray-600";
  if (!p) return null;
  return (
    <div className="fixed inset-0 bg-black/45 z-50 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-2xl mx-auto my-8 p-7 relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-5 text-2xl text-gray-400">✕</button>
        <h2 className="text-lg font-bold mb-4">✏️ Editar datos {p.numero}</h2>
        <div className="relative mb-3">
          <input value={busq} onChange={(e) => setBusq(e.target.value)} placeholder="Buscar cliente en CRM…" className={inp} />
          {sug.length > 0 && <div className="absolute z-10 bg-white border border-gray-200 rounded-lg mt-1 w-full shadow-sm max-h-48 overflow-auto">{sug.map((s) => <div key={s.id} onClick={() => { setF((x: any) => ({ ...x, cliente_nombre: s.nombre || "", cliente_cuit: s.cuit || "", cliente_email: s.email || "", cliente_telefono: s.whatsapp || "" })); setBusq(""); setSug([]); }} className="px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer">{s.nombre} <span className="text-xs text-gray-400">{s.cuit || s.whatsapp || ""}</span></div>)}</div>}
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <label className={lbl}>NOMBRE / RAZÓN SOCIAL<input value={f.cliente_nombre} onChange={(e) => set("cliente_nombre", e.target.value)} className={inp} /></label>
          <label className={lbl}>CUIT<input value={f.cliente_cuit} onChange={(e) => set("cliente_cuit", e.target.value)} className={inp} /></label>
          <label className={lbl}>EMAIL<input value={f.cliente_email} onChange={(e) => set("cliente_email", e.target.value)} className={inp} /></label>
          <label className={lbl}>TELÉFONO<input value={f.cliente_telefono} onChange={(e) => set("cliente_telefono", e.target.value)} className={inp} /></label>
          <label className={lbl}>DESCUENTO %<input type="number" value={f.descuento_pct} onChange={(e) => set("descuento_pct", e.target.value)} className={inp} /></label>
          <label className={lbl}>PRECIO OFRECIDO<input type="number" value={f.precio_ofrecido} onChange={(e) => set("precio_ofrecido", e.target.value)} className={inp} /></label>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="border border-gray-300 rounded-lg px-5 py-2 text-sm">Cancelar</button>
          <button onClick={guardar} disabled={saving} className="bg-febo-azul text-white rounded-lg px-6 py-2 text-sm font-semibold disabled:opacity-50">{saving ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    </div>
  );
}
