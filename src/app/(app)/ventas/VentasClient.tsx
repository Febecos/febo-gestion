"use client";
import { useEffect, useState, useCallback } from "react";
import { useWindows } from "../WindowManager";

// Presupuestos = tabla real `presupuestos` (revendedores/coti). Pedidos = `pedidos`+`fv_pedidos`.
// Factura/Remito = fg_comprobantes. Pagos = fg_pagos. Proveedor = pedidos_proveedores.
// Vista/PDF/edición pública en coti.febecos.com (/p/{token}); edición interna embebida con ?rev.
const COTI = "https://coti.febecos.com";
// Link al presupuesto público según tipo: FV usa el visor FV; bombas usa coti.
const linkPresup = (tipo: string, token: string) =>
  tipo === "fv" ? `https://fv.febecos.com/ver-presupuesto?token=${token}` : `${COTI}/p/${token}`;

const fmt = (v: number, m = "$") => `${m} ` + Math.round(Number(v) || 0).toLocaleString("es-AR");
const fmtF = (v: string) => (v ? new Date(v).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");
const chip = (txt: string, col: string) => <span style={{ background: col + "22", color: col }} className="rounded px-2 py-0.5 text-[11px] font-semibold">{txt}</span>;
const EST_COL: Record<string, string> = { emitido: "#64748b", enviada: "#2563eb", pedido: "#7c3aed", pagado: "#059669", aprobado: "#059669", nuevo: "#2563eb", anulado: "#e53935", borrador: "#94a3b8", proforma: "#d97706", confirmado: "#7c3aed" };

const SECCIONES = [
  { k: "presupuestos", icon: "📝", label: "Presupuestos" },
  { k: "pedidos", icon: "📦", label: "Pedidos" },
  { k: "operaciones", icon: "🔄", label: "Operaciones" },
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
        {sec === "operaciones" && <Operaciones />}
        {sec === "facturas" && <Comprobantes tipo="factura" titulo="Facturas" />}
        {sec === "remitos" && <Comprobantes tipo="remito" titulo="Remitos" />}
        {sec === "pagos" && <Pagos />}
        {sec === "prov" && <PedidosProveedor />}
      </div>
    </div>
  );
}

// ---------- PRESUPUESTOS (tabla real, coti) ----------
type Presup = { id: number; numero: string; tipo: string; estado: string; cliente_display: string; cliente_nombre: string; cliente_apellido: string; cliente_razon_social: string; bomba_codigo: string; bomba_descripcion: string; precio_ofrecido: number; revendedor_nombre: string; public_token: string; revendedor_token: string; cliente_id: number | null; created_at: string; pedido_numero?: string | null; factura_numero?: string | null; vendedor?: string | null; vendedor_email?: string | null };
const tienePedido = (r: Presup) => !!r.pedido_numero || ["pedido", "convertido", "pagado", "anulado"].includes((r.estado || "").toLowerCase());

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

  // Abre el visor/cotizador FV en modo INTERNO (con todos los botones): pide a gestión
  // un token efímero (server↔server) y lo pasa en el hash que fv lee como sesión admin.
  async function tokenInterno(): Promise<string> {
    try { const r = await fetch("/api/fv-session"); const d = await r.json(); if (d.ok && d.token) return "#admin_jwt=" + d.token; } catch {}
    return "";
  }
  async function abrirFvInterno(token: string, numero: string) {
    const hash = await tokenInterno();
    if (!hash) { alert("⚠️ No se pudo abrir en modo interno (revisá FV_BRIDGE_SECRET)."); return; }
    open("presup-edit", { url: `https://fv.febecos.com/ver-presupuesto?token=${token}${hash}`, title: `☀️ ${numero}` });
  }
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
                <td className="px-4 py-2 text-gray-500" title={r.vendedor_email || ""}>{r.vendedor || "—"}</td>
                <td className="px-4 py-2">
                  {chip(r.estado || "—", EST_COL[r.estado] || "#888")}
                  {r.pedido_numero && <span className="ml-1 text-[10px] font-semibold text-violet-700" title="Pedido generado">📦 {r.pedido_numero}</span>}
                  {r.factura_numero && <span className="ml-1 text-[10px] font-semibold text-emerald-600" title="Facturado">🧾 {r.factura_numero}</span>}
                </td>
                <td className="px-4 py-2 text-gray-600">{fmtF(r.created_at)}</td>
                <td className="px-4 py-2 text-right font-semibold">{fmt(r.precio_ofrecido, r.tipo === "fv" ? "USD" : "$")}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {tienePedido(r)
                    ? <span title="Con pedido generado: no se edita" className="text-gray-300 mr-2">🔒</span>
                    : <>
                      {r.public_token && r.tipo !== "fv" && r.revendedor_token && <button onClick={() => open("presup-edit", { url: `${COTI}/p/${r.public_token}?rev=${r.revendedor_token}`, title: `✏️ ${r.numero}` })} title="Editar (interno, en gestión)" className="text-gray-400 hover:text-febo-azul mr-2">✏️</button>}
                      {r.public_token && r.tipo === "fv" && <button onClick={() => abrirFvInterno(r.public_token, r.numero)} title="Editar/Operar FV (modo interno)" className="text-gray-400 hover:text-febo-azul mr-2">✏️</button>}
                    </>}
                  {r.public_token && <a href={linkPresup(r.tipo, r.public_token)} target="_blank" rel="noreferrer" title="Ver / Imprimir / PDF (público)" className="text-gray-400 hover:text-febo-azul mr-2">📄</a>}
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
  const [sel, setSel] = useState<string | null>(null);
  const load = () => fetch("/api/pedidos").then((r) => r.json()).then((d) => { setRows(d.ok ? d.pedidos : []); setLoading(false); });
  useEffect(() => { load(); }, []);
  return (
    <>
    <Tabla loading={loading} count={rows.length} unidad="pedidos"
      cols={["Origen", "Número", "Cliente", "Detalle", "Estado", "Fecha", "Total", ""]}>
      {rows.map((p, i) => (
        <tr key={i} className="border-t border-gray-100 hover:bg-blue-50 cursor-pointer" onClick={() => setSel(String(p.numero || p.ref))}>
          <td className="px-4 py-2">{chip(p.origen === "fv" ? "FV" : "Bomba", p.origen === "fv" ? "#d97706" : "#2563eb")}</td>
          <td className="px-4 py-2 font-semibold">{p.numero || (p.presup ? "↳ " + p.presup : "—")}</td>
          <td className="px-4 py-2">{p.cliente}</td>
          <td className="px-4 py-2 text-gray-600">{p.detalle}</td>
          <td className="px-4 py-2">{chip(p.estado, EST_COL[p.estado] || "#888")}</td>
          <td className="px-4 py-2 text-gray-600">{fmtF(p.fecha)}</td>
          <td className="px-4 py-2 text-right font-semibold">{fmt(p.total, p.moneda)}</td>
          <td className="px-4 py-2 text-right">{p.token && <a onClick={(e) => e.stopPropagation()} href={`${COTI}/p/${p.token}`} target="_blank" rel="noreferrer" title="Ver presupuesto" className="text-gray-400 hover:text-febo-azul">📄</a>}</td>
        </tr>
      ))}
    </Tabla>
    {sel && <PedidoModal refId={sel} onClose={() => setSel(null)} onChanged={load} />}
    </>
  );
}

// ---------- MODAL DE PEDIDO (detalle completo, estilo admin) ----------
const PED_BADGE: Record<string, [string, string]> = {
  pendiente_confirmacion: ["⏳ Pendiente", "#fbbf24"], aprobado: ["✅ Aprobado", "#22c55e"],
  pagado: ["💰 Pagado", "#3b82f6"], enviado: ["📦 Enviado", "#8b5cf6"], cancelado: ["❌ Cancelado", "#ef4444"],
};
function PedidoModal({ refId, onClose, onChanged }: { refId: string; onClose: () => void; onChanged: () => void }) {
  const [ped, setPed] = useState<any>(null);
  const [pesos, setPesos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nota, setNota] = useState("");
  const [provData, setProvData] = useState<Record<string, { email: string; mensaje: string }>>({});
  const [provSel, setProvSel] = useState<Record<string, Record<number, boolean>>>({});
  const [unlockedProv, setUnlockedProv] = useState<Record<string, boolean>>({});
  const [vf, setVf] = useState({ tc: "", moneda: "usd", monto: "", redondeo: "" });
  const [emailCli, setEmailCli] = useState(""); const [editEmail, setEditEmail] = useState(false);
  const [tab, setTab] = useState<"detalle" | "prov" | "pago">("detalle");
  const load = useCallback(() => fetch("/api/pedidos/" + encodeURIComponent(refId)).then((r) => r.json()).then((d) => { if (d.ok) { setPed(d.pedido); setNota(d.pedido.payload?.notas_internas || ""); setEmailCli(d.pedido.payload?.revendedor?.email || d.pedido.payload?.cliente?.email || ""); } }), [refId]);
  useEffect(() => { load(); }, [load]);
  if (!ped) return null;
  const pl = ped.payload || {}; const items = pl.items || []; const tot = pl.totales || {};
  const rev = pl.revendedor || pl.cliente || {}; const dolar = Number(ped.dolar) || 0;
  const enP = pesos && dolar > 0; const sym = enP ? "$" : "USD";
  const v = (usd: number) => usd == null ? null : (enP ? Math.round(usd * dolar) : usd);
  const nf = (n: number | null) => n == null || isNaN(Number(n)) ? "—" : Number(n).toLocaleString("es-AR", { minimumFractionDigits: enP ? 0 : 2, maximumFractionDigits: enP ? 0 : 2 });
  const money = (usd: number) => { const x = v(usd); return x == null ? "—" : `${sym} ${nf(x)}`; };
  const costoTot = items.reduce((a: number, it: any) => a + (Number(it.costo_usd) || 0) * (Number(it.cantidad) || 1), 0);
  const badge = PED_BADGE[ped.estado] || [ped.estado, "#888"];
  const cancelado = ped.estado === "cancelado";

  const accion = async (body: any, msg?: string) => {
    if (msg && !confirm(msg)) return;
    setBusy(true);
    try { const r = await fetch("/api/pedidos/" + encodeURIComponent(refId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const d = await r.json(); if (!d.ok) throw new Error(d.error); await load(); onChanged(); }
    catch (e: any) { alert("Error: " + e.message); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/50 flex items-stretch justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-[1180px] h-full flex flex-col shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="bg-febo-azul text-white rounded-t-xl px-5 py-3 flex items-center justify-between">
          <div>
            <div className="text-lg font-bold">{rev.nombre || "(sin nombre)"}</div>
            <div className="text-xs opacity-90 flex gap-2 items-center mt-0.5">
              <span>☀️ {ped.origen === "fv" ? "Fotovoltaico" : "Bomba"}</span><span>{ped.numero}</span><span>{fmtF(ped.fecha)}</span>
              <span style={{ background: badge[1] }} className="rounded px-2 py-0.5 font-bold text-[11px]">{badge[0]}</span>
              <span className="bg-white/20 rounded px-2 py-0.5 font-bold text-[11px]">{sym}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-xl leading-none">✕</button>
        </div>

        {/* Solapas */}
        <div className="flex gap-1 px-4 pt-2 border-b border-gray-200 bg-gray-50 text-sm shrink-0">
          {([["detalle", "📋 Detalle"], ["prov", "🏭 Proveedor / Stock"], ["pago", "💵 Pago / Factura"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 font-semibold border-b-2 -mb-px ${tab === k ? "border-febo-azul text-febo-azul" : "border-transparent text-gray-500 hover:text-gray-700"}`}>{l}</button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {cancelado && <div className="bg-red-50 border border-red-300 text-red-700 rounded-lg px-4 py-3 text-sm font-semibold">⛔ Pedido CANCELADO — NO SE PUEDE EDITAR. Para continuar, generá un nuevo pedido.</div>}
          {/* === SOLAPA DETALLE === */}
          {tab === "detalle" && (<>
          {/* Contacto */}
          <div>
            <div className="text-[11px] font-bold text-gray-400 uppercase mb-1 bg-gray-50 px-2 py-1 rounded">Contacto del cliente</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm px-2">
              {pl.presupuesto_numero && <Cell l="Origen" v={<span className="font-mono font-bold text-febo-azul bg-blue-50 px-2 rounded">{pl.presupuesto_numero}</span>} />}
              <Cell l="Nombre" v={rev.nombre || "—"} />
              {rev.empresa && <Cell l="Empresa" v={rev.empresa} />}
              <Cell l="WhatsApp" v={rev.whatsapp || rev.wa || "—"} />
              <div>
                <div className="text-[10px] uppercase text-gray-400">Email {!emailCli && <span className="text-red-500">· falta (necesario p/ avisar al cliente)</span>}</div>
                {editEmail || !emailCli ? (
                  <div className="flex gap-1 items-center">
                    <input value={emailCli} onChange={(e) => setEmailCli(e.target.value)} placeholder="cliente@mail.com" className="border border-gray-300 rounded px-2 py-0.5 text-sm w-44" />
                    <button disabled={busy} onClick={async () => { await accion({ accion: "email_cliente", email: emailCli }); setEditEmail(false); }} className="text-xs text-emerald-600 font-semibold">guardar</button>
                  </div>
                ) : (
                  <div className="text-gray-800">{emailCli} <button onClick={() => setEditEmail(true)} className="text-xs text-febo-azul ml-1">editar</button></div>
                )}
              </div>
              {rev.localidad && <Cell l="Localidad" v={rev.localidad} />}
              {rev.cuit && <Cell l="CUIT/CUIL" v={rev.cuit} />}
              <Cell l="Nota del revendedor" v={pl.notas || "—"} />
            </div>
          </div>

          {/* Items */}
          <div>
            <div className="text-[11px] font-bold text-gray-400 uppercase mb-1 bg-gray-50 px-2 py-1 rounded">Detalle del pedido</div>
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase text-gray-400"><tr>
                <th className="text-left px-2 py-1">Producto</th><th className="text-center px-2 py-1">Cant</th>
                <th className="text-right px-2 py-1">Costo</th><th className="text-right px-2 py-1">PVP s/IVA</th><th className="text-right px-2 py-1">Subtotal</th>
              </tr></thead>
              <tbody>
                {items.map((it: any, i: number) => (
                  <tr key={i} className="border-t border-gray-100 align-top">
                    <td className="px-2 py-1.5"><div className="font-semibold text-febo-azul">{it.codigo} {it.proveedor && chip(it.proveedor, "#64748b")}</div><div className="text-xs text-gray-500">{it.descripcion}</div></td>
                    <td className="px-2 py-1.5 text-center font-bold">{it.cantidad}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{nf(v(it.costo_usd))}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{nf(v(it.pvp_sin_iva_usd))}</td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{nf(v(it.subtotal))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-sm">
                {costoTot > 0 && <tr className="text-[11px] text-gray-400"><td colSpan={4} className="text-right px-2 py-1">Costo total FEBECOS</td><td className="text-right px-2 py-1">{money(costoTot)}</td></tr>}
                <tr><td colSpan={4} className="text-right px-2 py-1 text-gray-500">Subtotal s/IVA</td><td className="text-right px-2 py-1">{money(tot.neto)}</td></tr>
                <tr><td colSpan={4} className="text-right px-2 py-1 text-gray-500">IVA</td><td className="text-right px-2 py-1">{money(tot.iva)}</td></tr>
                <tr className="border-t border-gray-200"><td colSpan={4} className="text-right px-2 py-2 font-bold text-febo-azul">TOTAL</td><td className="text-right px-2 py-2 font-bold text-febo-azul">{money(tot.total)}</td></tr>
              </tfoot>
            </table>
          </div>

          </>)}

          {/* === SOLAPA PROVEEDOR / STOCK === */}
          {/* Confirmación de proveedor / stock (compuerta antes de aprobar) */}
          {tab === "prov" && !cancelado && (() => {
            const conf = ped.proveedor_confirmado;
            const proformas = ped.proforma_archivo || [];
            const toB64 = (f: File) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(f); });
            const confirmar = async (files: FileList | null) => {
              const arr: any[] = [];
              if (files) for (const f of Array.from(files)) arr.push({ nombre: f.name, tipo: f.type, b64: await toB64(f) });
              setPed((p: any) => ({ ...p, proveedor_confirmado: true }));
              await accion({ accion: "confirmar_proveedor", archivos: arr });
            };
            return (
              <div className={`rounded-lg p-3 border ${conf ? "border-emerald-200 bg-emerald-50/40" : "border-amber-300 bg-amber-50/40"}`}>
                <div className="text-[11px] font-bold uppercase mb-2" style={{ color: conf ? "#059669" : "#b45309" }}>🏭 Confirmación de proveedor / stock</div>
                {conf ? (
                  <div className="text-sm text-emerald-700 flex flex-wrap items-center gap-3">
                    <span>✔ Stock confirmado{ped.proveedor_confirmado_at ? " · " + new Date(ped.proveedor_confirmado_at).toLocaleDateString("es-AR") : ""}</span>
                    {proformas.map((a: any, i: number) => <a key={i} href={`data:${a.tipo};base64,${a.b64}`} download={a.nombre} className="text-xs text-febo-azul underline">⬇ {a.nombre}</a>)}
                    <button disabled={busy} onClick={() => { setPed((p: any) => ({ ...p, proveedor_confirmado: false })); accion({ accion: "desconfirmar_proveedor" }); }} className="text-xs text-gray-400 underline hover:text-red-500">quitar confirmación</button>
                  </div>
                ) : (
                  <div className="text-sm text-amber-800">
                    <div className="mb-2">Hasta no confirmar el stock con el proveedor (proforma / captura del mail) <b>no se puede aprobar</b> el pedido.</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="text-xs">Adjuntar proforma / mail: <input type="file" multiple onChange={(e) => confirmar(e.target.files)} className="text-xs" /></label>
                      <span className="text-xs text-gray-500">o</span>
                      <button disabled={busy} onClick={() => confirmar(null)} className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600">✔ Confirmar stock (manual)</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* === SOLAPA PAGO / FACTURA === Comprobante de pago + verificar monto */}
          {tab === "pago" && !cancelado && (() => {
            const archivos = ped.comprobante_archivo || [];
            const pagos = ped.pagos_recibidos || [];
            const tcV = Number(vf.tc) || dolar || 0;
            const montoN = Number(vf.monto) || 0, redN = Number(vf.redondeo) || 0;
            const montoUSD = vf.moneda === "ars" ? (tcV ? montoN / tcV : 0) : montoN;
            const redUSD = vf.moneda === "ars" ? (tcV ? redN / tcV : 0) : redN;
            const efUSD = montoUSD + redUSD;
            const yaPagado = pagos.reduce((a: number, p: any) => a + (Number(p.monto_usd) || 0), 0);
            const totUSD = Number(tot.total) || 0;
            const restante = +(totUSD - yaPagado).toFixed(2);
            const diff = +(efUSD - restante).toFixed(2);
            const okPago = Math.abs(diff) <= 0.02;
            const toB64 = (f: File) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(f); });
            const subir = async (files: FileList | null) => {
              if (!files?.length) return; const arr: any[] = [];
              for (const f of Array.from(files)) arr.push({ nombre: f.name, tipo: f.type, b64: await toB64(f) });
              await accion({ accion: "comprobante", archivos: [...archivos, ...arr] });
            };
            const guardarPago = () => {
              if (!montoN) { alert("Ingresá el monto recibido"); return; }
              accion({ accion: "verificar", pago: { monto: montoN, moneda: vf.moneda, tc: tcV, redondeo: redN, monto_usd: +efUSD.toFixed(2), diff_usd: diff, ok: okPago, fecha: new Date().toISOString() } });
              setVf({ ...vf, monto: "", redondeo: "" });
            };
            return (
              <div className="border border-gray-200 rounded-lg p-3">
                <div className="text-[11px] font-bold text-gray-400 uppercase mb-2">📄 Comprobante de pago {ped.comprobante_recibido && <span className="text-emerald-600">· recibido</span>}</div>
                {archivos.length > 0 && <div className="flex flex-wrap gap-2 mb-2">{archivos.map((a: any, i: number) => <a key={i} href={`data:${a.tipo};base64,${a.b64}`} download={a.nombre} className="text-xs text-febo-azul underline">⬇ {a.nombre}</a>)}</div>}
                <input type="file" multiple onChange={(e) => subir(e.target.files)} className="text-xs mb-3" />
                <div className="text-[11px] font-bold text-gray-500 uppercase mb-1">💵 Verificar monto recibido</div>
                <div className="text-xs text-gray-500 mb-1">Total: <b>USD {totUSD.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</b>{dolar ? ` · $ ${Math.round(totUSD * dolar).toLocaleString("es-AR")}` : ""}{yaPagado > 0 && ` · ya pagado USD ${yaPagado.toFixed(2)} · restante USD ${restante.toFixed(2)}`}</div>
                <div className="flex flex-wrap gap-2 items-center">
                  <label className="text-xs text-gray-500">TC <input type="number" value={vf.tc} onChange={(e) => setVf({ ...vf, tc: e.target.value })} placeholder={String(dolar || "")} className="border border-gray-300 rounded px-2 py-1 text-sm w-20 ml-1" /></label>
                  <select value={vf.moneda} onChange={(e) => setVf({ ...vf, moneda: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm"><option value="usd">USD</option><option value="ars">$ ARS</option></select>
                  <input type="number" value={vf.monto} onChange={(e) => setVf({ ...vf, monto: e.target.value })} placeholder="monto recibido" className="border border-gray-300 rounded px-2 py-1 text-sm w-32" />
                  <input type="number" value={vf.redondeo} onChange={(e) => setVf({ ...vf, redondeo: e.target.value })} placeholder="redondeo" title="ajuste por diferencia de redondeo" className="border border-gray-300 rounded px-2 py-1 text-sm w-24" />
                  {montoN > 0 && <span className={`text-xs font-semibold ${okPago ? "text-emerald-600" : "text-amber-600"}`}>{okPago ? "✔ cubre el total" : `dif USD ${diff.toFixed(2)}`}</span>}
                  <button disabled={busy} onClick={guardarPago} className="px-3 py-1.5 rounded-lg bg-cyan-600 text-white text-xs font-semibold hover:bg-cyan-700">💾 Guardar pago</button>
                </div>
                {pagos.length > 0 && <div className="mt-2 text-xs text-gray-600">{pagos.map((p: any, i: number) => <div key={i}>• {new Date(p.fecha).toLocaleDateString("es-AR")}: {p.moneda === "ars" ? "$" : "USD"} {Number(p.monto).toLocaleString("es-AR")} (USD {Number(p.monto_usd).toFixed(2)}) {p.ok ? "✔" : ""}</div>)}</div>}
              </div>
            );
          })()}

          {/* Pedido a proveedor — checkboxes por ítem, parcial, anti-doble envío */}
          {tab === "prov" && !cancelado && (() => {
            const grupos: Record<string, any[]> = {};
            items.forEach((it: any, idx: number) => { const k = it.proveedor || "Sin proveedor"; (grupos[k] = grupos[k] || []).push({ ...it, _idx: idx }); });
            const enviados = ped.pedidos_proveedor || [];
            // Ítems ya pedidos (por código) por proveedor → quedan bloqueados salvo desbloqueo (admin)
            const orderedCodes: Record<string, Set<string>> = {};
            enviados.forEach((e: any) => (e.items || []).forEach((it: any) => { (orderedCodes[e.proveedor] = orderedCodes[e.proveedor] || new Set()).add(String(it.codigo || "").toUpperCase()); }));
            const isLocked = (prov: string, code: string) => !unlockedProv[prov] && !!orderedCodes[prov]?.has(String(code || "").toUpperCase());
            const sel = (prov: string, idx: number) => provSel[prov]?.[idx] !== false; // default checked
            const toggle = (prov: string, idx: number) => setProvSel({ ...provSel, [prov]: { ...(provSel[prov] || {}), [idx]: !sel(prov, idx) } });
            const desbloquear = async (prov: string) => {
              try { const d = await (await fetch("/api/me")).json(); if (d.ok && d.es_owner) { setUnlockedProv((p) => ({ ...p, [prov]: true })); } else alert("🔒 Solo el administrador (owner) puede desbloquear para re-enviar ítems ya pedidos."); }
              catch { alert("No se pudo validar el permiso."); }
            };
            const enviarProv = async (prov: string, its: any[]) => {
              const info = provData[prov] || { email: "", mensaje: "" };
              if (!info.email) { alert("Ingresá el email del proveedor " + prov); return; }
              const elegidos = its.filter((it) => !isLocked(prov, it.codigo) && sel(prov, it._idx));
              if (!elegidos.length) { alert("Marcá al menos un ítem PENDIENTE para pedir."); return; }
              const yaEnv = enviados.find((e: any) => e.proveedor === prov);
              const msg = yaEnv
                ? `⚠️ Ya enviaste un pedido a ${prov} el ${new Date(yaEnv.created_at).toLocaleString("es-AR")}. ¿Enviar OTRO con ${elegidos.length} ítem(s)?`
                : `¿Enviar pedido a ${prov} (${elegidos.length} ítem/s) a ${info.email}?`;
              if (!confirm(msg)) return;
              setBusy(true);
              try {
                const r = await fetch("/api/pedidos/" + encodeURIComponent(refId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "proveedor", proveedor: prov, email_destinatario: info.email, mensaje: info.mensaje, items: elegidos.map((it) => ({ codigo: it.codigo, descripcion: it.descripcion, cantidad: it.cantidad, costo_usd: it.costo_usd })) }) });
                const d = await r.json(); if (!d.ok) throw new Error(d.error);
                alert(`✅ Pedido enviado a ${prov}` + (d.gsa_numero ? ` (GSA ${d.gsa_numero})` : ""));
                await load();
              } catch (e: any) { alert("Error: " + e.message); } finally { setBusy(false); }
            };
            return (
              <div className="border border-violet-200 bg-violet-50/40 rounded-lg p-3">
                <div className="text-[11px] font-bold text-violet-700 uppercase mb-2">🏭 Pedido a proveedor — marcá los ítems a pedir (podés pedir parcial)</div>
                {enviados.length > 0 && (
                  <div className="mb-3 text-xs bg-emerald-50 border border-emerald-200 rounded p-2">
                    <b className="text-emerald-700">Ya enviado:</b>
                    {enviados.map((e: any, i: number) => <div key={i} className="text-gray-600">✅ {e.proveedor} · {new Date(e.created_at).toLocaleString("es-AR")} · {(e.items?.length || 0)} ítem(s) · {e.email_destinatario}{e.gsa_numero ? ` · GSA ${e.gsa_numero}` : ""}</div>)}
                  </div>
                )}
                <div className="space-y-3">
                  {Object.entries(grupos).map(([prov, its]) => {
                    const yaEnv = enviados.find((e: any) => e.proveedor === prov);
                    const hayBloqueados = its.some((it) => isLocked(prov, it.codigo));
                    const pendientes = its.filter((it) => !isLocked(prov, it.codigo)).length;
                    return (
                    <div key={prov} className="bg-white border border-gray-200 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-semibold text-sm">{chip(prov, "#7c3aed")} <span className="text-gray-500 text-xs ml-1">{pendientes} pendiente(s) de {its.length}</span>{yaEnv && <span className="text-emerald-600 text-xs ml-2">✅ enviado</span>}</div>
                        <div className="flex gap-2">
                          {hayBloqueados && !unlockedProv[prov] && <button onClick={() => desbloquear(prov)} className="px-2.5 py-1.5 rounded-lg border border-gray-300 text-xs font-semibold text-gray-600 hover:bg-gray-50" title="Solo administrador">🔓 Desbloquear</button>}
                          <button disabled={busy || pendientes === 0} onClick={() => enviarProv(prov, its)} className={`px-3 py-1.5 rounded-lg text-white text-xs font-semibold ${pendientes === 0 ? "bg-gray-300 cursor-not-allowed" : yaEnv ? "bg-amber-500 hover:bg-amber-600" : "bg-violet-600 hover:bg-violet-700"}`}>{pendientes === 0 ? "✅ Todo pedido" : yaEnv ? "📤 Enviar pendientes" : (prov === "Multiradio" ? "📤 Generar Excel y Enviar" : "📤 Enviar pedido")}</button>
                        </div>
                      </div>
                      <table className="w-full text-xs mb-2">
                        <tbody>
                          {its.map((it) => {
                            const locked = isLocked(prov, it.codigo);
                            return (
                            <tr key={it._idx} className={`border-t border-gray-100 ${locked ? "opacity-50" : ""}`}>
                              <td className="py-1 w-6"><input type="checkbox" disabled={locked} checked={locked ? false : sel(prov, it._idx)} onChange={() => toggle(prov, it._idx)} /></td>
                              <td className="py-1 font-semibold text-febo-azul w-40">{it.codigo}</td>
                              <td className="py-1 text-gray-600">{(it.descripcion || "").slice(0, 50)}{locked && <span className="text-emerald-600 ml-1">· ✅ ya pedido</span>}</td>
                              <td className="py-1 text-center w-10 font-bold">{it.cantidad}</td>
                            </tr>
                          );})}
                        </tbody>
                      </table>
                      <div className="grid grid-cols-2 gap-2">
                        <input placeholder="email del proveedor *" value={(provData[prov]?.email) || ""} onChange={(e) => setProvData({ ...provData, [prov]: { ...(provData[prov] || { mensaje: "" }), email: e.target.value } })} className="border border-gray-300 rounded px-2 py-1 text-sm" />
                        <input placeholder="mensaje (opcional)" value={(provData[prov]?.mensaje) || ""} onChange={(e) => setProvData({ ...provData, [prov]: { ...(provData[prov] || { email: "" }), mensaje: e.target.value } })} className="border border-gray-300 rounded px-2 py-1 text-sm" />
                      </div>
                    </div>
                  );})}
                </div>
              </div>
            );
          })()}

          {/* Nota interna (solapa Detalle) */}
          {tab === "detalle" && <div>
            <div className="text-[11px] font-bold text-gray-400 uppercase mb-1">Nota interna</div>
            <div className="flex gap-2">
              <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Observación interna…" className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              <button disabled={busy} onClick={() => accion({ accion: "nota", nota })} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm hover:bg-gray-50">💾 Nota</button>
            </div>
          </div>}
        </div>

        {/* Footer acciones */}
        <div className="border-t border-gray-200 p-3 flex flex-wrap gap-2 justify-end bg-gray-50 rounded-b-xl">
          <button onClick={() => setPesos(!pesos)} disabled={!dolar} title={dolar ? `TC $${dolar}` : "sin TC"} className="px-3 py-2 rounded-lg border border-gray-300 text-sm hover:bg-white">🔁 {enP ? "Ver USD" : "Ver $ ARS"}</button>
          <a href={`/pedido-prep/${encodeURIComponent(refId)}?print=1`} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-lg border border-gray-300 text-sm font-semibold hover:bg-white">🖨 Imprimir pedido</a>
          {ped.factura_numero
            ? <a href={`${COTI}/p/${ped.factura_token}`} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-lg border border-emerald-300 text-emerald-700 text-sm font-semibold hover:bg-emerald-50">🧾 {ped.factura_numero}</a>
            : <button disabled={busy || cancelado || !ped.proveedor_confirmado} title={cancelado ? "Pedido cancelado" : ped.proveedor_confirmado ? "" : "Confirmá el stock antes de facturar"} onClick={() => accion({ accion: "facturar" }, "¿Generar la factura?")} className={`px-3 py-2 rounded-lg text-sm font-semibold ${!cancelado && ped.proveedor_confirmado ? "border border-emerald-400 text-emerald-700 hover:bg-emerald-50" : "border border-gray-200 text-gray-300 cursor-not-allowed"}`}>🧾 Facturar</button>}
          {ped.estado === "pendiente_confirmacion" && <>
            <button disabled={busy} onClick={() => accion({ accion: "estado", estado: "cancelado" }, "¿Rechazar el pedido?")} className="px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-semibold hover:bg-red-600">✕ Rechazar</button>
            <button disabled={busy || !ped.proveedor_confirmado} title={ped.proveedor_confirmado ? "" : "Primero confirmá el stock con el proveedor"} onClick={() => accion({ accion: "estado", estado: "aprobado" }, "¿Aprobar el pedido y avisar al cliente para el pago?")} className={`px-4 py-2 rounded-lg text-white text-sm font-semibold ${ped.proveedor_confirmado ? "bg-emerald-500 hover:bg-emerald-600" : "bg-gray-300 cursor-not-allowed"}`}>✅ Aprobar pedido</button>
          </>}
          {ped.estado === "aprobado" && <button disabled={busy} onClick={() => accion({ accion: "estado", estado: "pagado" }, "¿Marcar como pagado?")} className="px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600">💰 Marcar pagado</button>}
          {ped.estado === "pagado" && <button disabled={busy} onClick={() => accion({ accion: "estado", estado: "enviado" }, "¿Marcar como enviado?")} className="px-4 py-2 rounded-lg bg-violet-500 text-white text-sm font-semibold hover:bg-violet-600">📦 Marcar enviado</button>}
        </div>
      </div>
    </div>
  );
}
function Cell({ l, v }: { l: string; v: React.ReactNode }) {
  return <div><div className="text-[10px] uppercase text-gray-400">{l}</div><div className="text-gray-800">{v}</div></div>;
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

// ---------- OPERACIONES (cockpit del circuito interno) ----------
const FLUJO_OP: { estado: string; label: string; col: string }[] = [
  { estado: "pedido_proveedor", label: "Pedido a proveedor", col: "#64748b" },
  { estado: "reservado_proveedor", label: "Reservado x proveedor", col: "#2563eb" },
  { estado: "confirmado_cliente", label: "Confirmado al cliente", col: "#7c3aed" },
  { estado: "pagado_cliente", label: "Pagado x cliente", col: "#0891b2" },
  { estado: "pagado_proveedor", label: "Pagado al proveedor", col: "#d97706" },
  { estado: "facturado", label: "Facturado", col: "#059669" },
];

// Circuito derivado (solo lectura). Se calcula en vivo desde el pedido real.
const CIRCUITO = ["pedido_proveedor", "reservado_proveedor", "confirmado_cliente", "pagado_cliente", "facturado"];
function Operaciones() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await fetch("/api/operaciones"); const d = await r.json(); if (d.ok) setRows(d.operaciones); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const idx = (e: string) => CIRCUITO.indexOf(e);
  return (
    <div>
      <div className="text-sm text-gray-500 mb-3">{rows.length} operaciones · circuito: pedido → reservado → confirmado → pagado cliente → facturado. <span className="text-gray-400">Vista de solo lectura — hacé clic en una fila para operar el pedido.</span></div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr>
            <th className="text-left px-4 py-3">Pedido</th><th className="text-left px-4 py-3">Origen</th><th className="text-left px-4 py-3">Cliente</th>
            <th className="text-left px-4 py-3">Vendedor</th>
            <th className="text-left px-4 py-3">Estado</th><th className="text-right px-4 py-3">Total</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">Cargando…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">Sin operaciones</td></tr>
            : rows.map((op, i) => {
              const fl = FLUJO_OP.find((f) => f.estado === op.estado);
              const anulado = op.estado === "anulado";
              return (
                <tr key={i} className="border-t border-gray-100 hover:bg-blue-50 cursor-pointer" onClick={() => setSel(op.ref)}>
                  <td className="px-4 py-2 font-semibold">{op.numero}</td>
                  <td className="px-4 py-2">{chip(op.origen === "fv" ? "FV" : "Bomba", op.origen === "fv" ? "#d97706" : "#2563eb")}</td>
                  <td className="px-4 py-2">{op.cliente_nombre || "—"}</td>
                  <td className="px-4 py-2 text-gray-500">{op.vendedor || "—"}</td>
                  <td className="px-4 py-2">
                    {anulado ? chip("anulado", "#e53935") : <>
                      {chip(fl?.label || op.estado, fl?.col || "#888")}
                      <span className="ml-2 text-[10px] text-gray-400">{idx(op.estado) + 1}/{CIRCUITO.length}</span>
                      {op.factura_numero && <span className="ml-2 text-[11px] font-semibold text-emerald-600">{op.factura_numero}</span>}
                    </>}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold">{fmt(op.total, op.moneda === "USD" ? "USD" : "$")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sel && <PedidoModal refId={sel} onClose={() => setSel(null)} onChanged={load} />}
    </div>
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
