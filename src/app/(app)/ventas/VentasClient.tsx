"use client";
import { useEffect, useState, useCallback } from "react";
import { useWindows } from "../WindowManager";
import { letraFacturaPara } from "@/lib/talonarios";
import { tipoPorCodigo } from "@/lib/talonarios-tipos";

// Presupuestos = tabla real `presupuestos` (revendedores/coti). Pedidos = `pedidos`+`fv_pedidos`.
// Factura/Remito = fg_comprobantes. Pagos = fg_pagos. Proveedor = pedidos_proveedores.
// Vista/PDF/edición pública en coti.febecos.com (/p/{token}); edición interna embebida con ?rev.
const COTI = "https://coti.febecos.com";
// Link al presupuesto público según tipo: FV usa el visor FV; bombas usa coti.
const linkPresup = (tipo: string, token: string) =>
  tipo === "fv" ? `https://fv.febecos.com/ver-presupuesto?token=${token}` : `${COTI}/p/${token}`;

// Etiqueta linda de la condición fiscal (igual que el CRM): toma el valor del CRM y lo formatea.
const COND_LABEL: Record<string, string> = {
  responsable_inscripto: "Responsable Inscripto", monotributista: "Monotributista", monotributo: "Monotributista",
  consumidor_final: "Consumidor Final", exento: "Exento", no_categorizado: "No Categorizado", exterior: "Exterior",
};
const fmtCond = (c: string) => COND_LABEL[(c || "").toLowerCase()] || (c || "").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
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
  { k: "ctacte", icon: "💳", label: "Cuentas corrientes" },
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
        {sec === "ctacte" && <CuentasCorrientes />}
        {sec === "prov" && <PedidosProveedor />}
      </div>
    </div>
  );
}

// ---------- PRESUPUESTOS (tabla real, coti) ----------
type Presup = { id: number; numero: string; tipo: string; estado: string; cliente_display: string; cliente_nombre: string; cliente_apellido: string; cliente_razon_social: string; bomba_codigo: string; bomba_descripcion: string; precio_ofrecido: number; revendedor_nombre: string; public_token: string; revendedor_token: string; cliente_id: number | null; created_at: string; pedido_numero?: string | null; factura_numero?: string | null; vendedor?: string | null; vendedor_email?: string | null; moneda?: string | null; tc?: number | null };
const tienePedido = (r: Presup) => !!r.pedido_numero || ["pedido", "convertido", "pagado", "anulado"].includes((r.estado || "").toLowerCase());

function Presupuestos() {
  const { open, openFicha } = useWindows();
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
                <td className="px-4 py-2 text-right font-semibold">{(r.moneda === "ARS" || r.moneda === "$") && Number(r.tc) > 0 ? `$ ${Math.round(Number(r.precio_ofrecido) * Number(r.tc)).toLocaleString("es-AR")}` : fmt(r.precio_ofrecido, r.tipo === "fv" ? "USD" : "$")}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {tienePedido(r)
                    ? <span title="Con pedido generado: no se edita" className="text-gray-300 mr-2">🔒</span>
                    : <>
                      {r.public_token && r.tipo !== "fv" && r.revendedor_token && <button onClick={() => open("presup-edit", { url: `${COTI}/p/${r.public_token}?rev=${r.revendedor_token}`, title: `✏️ ${r.numero}` })} title="Editar (interno, en gestión)" className="text-gray-400 hover:text-febo-azul mr-2">✏️</button>}
                      {r.public_token && r.tipo === "fv" && <button onClick={() => abrirFvInterno(r.public_token, r.numero)} title="Editar/Operar FV (modo interno)" className="text-gray-400 hover:text-febo-azul mr-2">✏️</button>}
                    </>}
                  {r.public_token && <a href={linkPresup(r.tipo, r.public_token)} target="_blank" rel="noreferrer" title="Ver / Imprimir / PDF (público)" className="text-gray-400 hover:text-febo-azul mr-2">📄</a>}
                  {r.cliente_id && <button onClick={() => openFicha(r.cliente_id as number, "operaciones")} title="Ventas y cuenta del cliente" className="text-gray-400 hover:text-febo-azul">👤</button>}
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
  // Refrescar al volver a la ventana (ej. tras generar un pedido en el cotizador)
  useEffect(() => { const onFocus = () => load(); window.addEventListener("focus", onFocus); return () => window.removeEventListener("focus", onFocus); }, []);
  return (
    <>
    <div className="flex justify-end mb-2"><button onClick={load} className="text-sm text-febo-azul hover:underline">🔄 Actualizar</button></div>
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
          <td className="px-4 py-2 text-right font-semibold">{(p.moneda === "ARS" || p.moneda === "$") && Number(p.tc) > 0 ? `$ ${Math.round(Number(p.total) * Number(p.tc)).toLocaleString("es-AR")}` : fmt(p.total, p.moneda)}</td>
          <td className="px-4 py-2 text-right">{p.token && <a onClick={(e) => e.stopPropagation()} href={linkPresup(p.origen === "fv" ? "fv" : "bomba", p.token)} target="_blank" rel="noreferrer" title="Ver presupuesto" className="text-gray-400 hover:text-febo-azul">📄</a>}</td>
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
  const [pp, setPp] = useState({ proveedor: "", tc: "", medio: "pesos", monto: "", provUsd: "", fecha: "", nota: "" });
  const [tals, setTals] = useState<any[]>([]); const [talSel, setTalSel] = useState<string>("");
  const [facMoneda, setFacMoneda] = useState("USD"); const [facTc, setFacTc] = useState("");
  useEffect(() => { fetch("/api/talonarios?facturacion=1").then((r) => r.json()).then((d) => { if (d.ok) { setTals(d.talonarios); const def = d.talonarios.find((t: any) => t.defecto) || d.talonarios[0]; if (def) setTalSel(String(def.id)); } }).catch(() => {}); }, []);
  const [tab, setTab] = useState<"detalle" | "prov" | "pago">("detalle");
  const [monedaInit, setMonedaInit] = useState(false);
  const load = useCallback(() => fetch("/api/pedidos/" + encodeURIComponent(refId)).then((r) => r.json()).then((d) => {
    if (d.ok) {
      setPed(d.pedido); setNota(d.pedido.payload?.notas_internas || ""); setEmailCli(d.pedido.payload?.revendedor?.email || d.pedido.payload?.cliente?.email || "");
      // Si el presupuesto se hizo en $ → arrancar pedido y factura en pesos con su TC (una sola vez).
      if (!monedaInit) {
        const tt = d.pedido.payload?.totales || {};
        if (tt.moneda === "ARS" || tt.moneda === "$") { setPesos(true); setFacMoneda("ARS"); if (tt.tc) setFacTc(String(tt.tc)); }
        setMonedaInit(true);
      }
    }
  }), [refId, monedaInit]);
  useEffect(() => { load(); }, [load]);
  if (!ped) return null;
  const pl = ped.payload || {}; const items = pl.items || []; const tot = pl.totales || {};
  const rev = pl.revendedor || pl.cliente || {}; const dolar = Number(ped.dolar) || 0;
  const tcMostrar = Number(tot.tc) || dolar; // TC del presupuesto si quedó fijado; si no, el del día
  const enP = pesos && tcMostrar > 0; const sym = enP ? "$" : "USD";
  const v = (usd: number) => usd == null ? null : (enP ? Math.round(usd * tcMostrar) : usd);
  const nf = (n: number | null) => n == null || isNaN(Number(n)) ? "—" : Number(n).toLocaleString("es-AR", { minimumFractionDigits: enP ? 0 : 2, maximumFractionDigits: enP ? 0 : 2 });
  const money = (usd: number) => { const x = v(usd); return x == null ? "—" : `${sym} ${nf(x)}`; };
  const costoTot = items.reduce((a: number, it: any) => a + (Number(it.costo_usd) || 0) * (Number(it.cantidad) || 1), 0);
  const badge = PED_BADGE[ped.estado] || [ped.estado, "#888"];
  const cancelado = ped.estado === "cancelado";
  // ── Datos fiscales del cliente + letra de factura AFIP ──
  const cli = ped.cliente || {};
  const condCli = cli.condicion_fiscal || rev.condicion_fiscal || "";
  const cuitCli = cli.cuit || rev.cuit || "";
  const domCli = [cli.domicilio || rev.domicilio, cli.localidad || rev.localidad, cli.provincia || rev.provincia].filter(Boolean).join(", ");
  const letraReq = letraFacturaPara(condCli);
  const talsLetra = tals.filter((t) => (tipoPorCodigo(t.tipo_codigo)?.letra || "") === letraReq);
  const talDefLetra = talsLetra.find((t) => t.defecto) || talsLetra[0];
  const talEfectivo = talsLetra.some((t) => String(t.id) === talSel) ? talSel : (talDefLetra ? String(talDefLetra.id) : "");
  const puedeFacturar = !cancelado && !!ped.proveedor_confirmado && !!letraReq && talsLetra.length > 0;

  const accion = async (body: any, msg?: string) => {
    if (msg && !confirm(msg)) return;
    setBusy(true);
    try { const r = await fetch("/api/pedidos/" + encodeURIComponent(refId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const d = await r.json(); if (!d.ok) throw new Error(d.error); await load(); onChanged(); return d; }
    catch (e: any) { alert("Error: " + e.message); } finally { setBusy(false); }
  };
  const aprobar = async () => {
    const d = await accion({ accion: "estado", estado: "aprobado" }, "¿Aprobar el pedido y avisar al cliente para el pago?");
    if (!d) return;
    const av = d.aviso_cliente;
    if (av && av.ok) alert("✅ Pedido aprobado. Aviso de pago enviado al cliente.");
    else if (av && !av.ok) alert("✅ Pedido aprobado, pero NO se pudo avisar al cliente:\n" + (av.error || "error") + "\n\nRevisá el email del cliente en la solapa Detalle.");
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

        <div className="flex-1 overflow-auto p-5 flex flex-col gap-4">
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
              {(cli.razon_social) && <Cell l="Razón social" v={cli.razon_social} />}
              {(cli.localidad || rev.localidad) && <Cell l="Localidad" v={cli.localidad || rev.localidad} />}
              <Cell l="CUIT/CUIL" v={cuitCli || <span className="text-red-500">falta</span>} />
              <Cell l="Condición fiscal" v={condCli ? <span>{fmtCond(condCli)} {letraReq && <span className="ml-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 rounded">Factura {letraReq}</span>}</span> : <span className="text-red-500 font-semibold">⚠️ sin condición — no se puede facturar</span>} />
              {domCli && <Cell l="Domicilio" v={domCli} />}
              <Cell l="Nota del revendedor" v={pl.notas || "—"} />
            </div>
            {!cli.id && <div className="text-[11px] text-amber-600 mt-1 px-2">⚠️ Este pedido no está vinculado a un cliente del CRM (sin ficha). Los datos fiscales pueden faltar. <button onClick={() => alert('Vinculá el cliente desde el presupuesto/CRM para traer CUIT y condición fiscal.')} className="underline">¿por qué?</button></div>}
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
                    <td className="px-2 py-1.5"><div className="font-semibold text-febo-azul">{it.codigo} {(it.emisor || it.proveedor) && chip(it.emisor || it.proveedor, "#64748b")}</div><div className="text-xs text-gray-500">{it.descripcion}</div></td>
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
              <div className={`order-2 rounded-lg p-3 border ${conf ? "border-emerald-200 bg-emerald-50/40" : "border-amber-300 bg-amber-50/40"}`}>
                <div className="text-[11px] font-bold uppercase mb-2" style={{ color: conf ? "#059669" : "#b45309" }}>② Confirmación del proveedor / stock — cargá la proforma cuando confirme</div>
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

          {/* === Pago AL PROVEEDOR (cotejo) === TC manual; medio USD/pesos/cheque propio/endosado */}
          {tab === "prov" && !cancelado && (() => {
            const MEDIOS: Record<string, string> = { usd: "USD (efvo/transf)", pesos: "Pesos (efvo/transf)", cheque_propio: "Cheque propio", cheque_endosado: "Cheque endosado" };
            const pagos: any[] = Array.isArray(ped.pago_proveedor) ? ped.pago_proveedor : (ped.pago_proveedor ? [ped.pago_proveedor] : []);
            // proveedores presentes en el pedido + su costo
            const costoProv: Record<string, number> = {};
            items.forEach((it: any) => { const k = it.emisor || it.proveedor || "Sin proveedor"; costoProv[k] = (costoProv[k] || 0) + (Number(it.costo_usd) || 0) * (Number(it.cantidad) || 1); });
            const provs = Object.keys(costoProv);
            const provSel = pp.proveedor || provs[0] || "Sin proveedor";
            const costoP = costoProv[provSel] || 0;
            const esUSD = pp.medio === "usd";
            const tcV = Number(pp.tc) || 0;
            const montoN = Number(pp.monto) || 0;
            const provUsd = Number(pp.provUsd) || 0;
            const montoUsd = esUSD ? montoN : (tcV ? montoN / tcV : 0);
            const diffPed = +(montoUsd - costoP).toFixed(2);
            const diffProv = provUsd ? +(montoUsd - provUsd).toFixed(2) : null;
            const okProv = diffProv == null ? null : Math.abs(diffProv) <= 0.5;
            const guardar = () => {
              if (!esUSD && !tcV) { alert("Ingresá el TC USD del momento del pago (es manual)."); return; }
              if (!montoN) { alert("Ingresá el monto pagado al proveedor."); return; }
              accion({ accion: "pago_proveedor", pago: {
                proveedor: provSel, medio: pp.medio, costo_pedido_usd: +costoP.toFixed(2),
                tc_usd: esUSD ? null : tcV, monto: montoN, monto_usd: +montoUsd.toFixed(2),
                monto_proveedor_usd: provUsd || null, diff_vs_pedido: diffPed, diff_vs_proveedor: diffProv, ok: okProv,
                fecha: pp.fecha || new Date().toISOString().slice(0, 10), nota: pp.nota || "",
              }});
              setPp({ proveedor: provSel, tc: "", medio: pp.medio, monto: "", provUsd: "", fecha: "", nota: "" });
            };
            return (
              <div className="order-3 border border-amber-200 bg-amber-50/40 rounded-lg p-3">
                <div className="text-[11px] font-bold text-amber-700 uppercase mb-2">③ Pago al proveedor — TC manual (cambio del momento del pago)</div>
                {pagos.length > 0 && <div className="mb-3 space-y-1">
                  {pagos.map((reg: any, i: number) => (
                    <div key={i} className="text-sm text-gray-700 bg-white border border-gray-200 rounded p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {chip(reg.proveedor || "—", "#7c3aed")}
                        <span>✅ <b>Pagado</b> {reg.fecha ? "· " + new Date(reg.fecha).toLocaleDateString("es-AR") : ""} · {MEDIOS[reg.medio] || reg.medio} · {reg.medio === "usd" ? "USD" : "$"} {Number(reg.monto).toLocaleString("es-AR")}{reg.tc_usd ? " @ TC " + reg.tc_usd : ""} = <b>USD {Number(reg.monto_usd).toFixed(2)}</b></span>
                        <button disabled={busy} onClick={() => accion({ accion: "pago_proveedor", quitar: reg.proveedor })} className="text-xs text-gray-400 underline hover:text-red-500">quitar</button>
                      </div>
                      <div className="text-xs mt-0.5 flex flex-wrap gap-3">
                        <span className={Math.abs(reg.diff_vs_pedido) <= 0.5 ? "text-emerald-600" : "text-amber-600"}>vs costo: {reg.diff_vs_pedido > 0 ? "+" : ""}{reg.diff_vs_pedido} USD</span>
                        {reg.monto_proveedor_usd != null && <span className={reg.ok ? "text-emerald-600" : "text-red-600"}>proveedor informó USD {Number(reg.monto_proveedor_usd).toFixed(2)} → {reg.ok ? "✔ coincide" : `⚠️ dif ${reg.diff_vs_proveedor}`}</span>}
                        {reg.nota && <span className="text-gray-500">📝 {reg.nota}</span>}
                      </div>
                    </div>
                  ))}
                </div>}
                <div className="flex flex-wrap gap-2 items-end">
                  {provs.length > 1 && <label className="text-xs text-gray-500">Proveedor<select value={provSel} onChange={(e) => setPp({ ...pp, proveedor: e.target.value })} className="block border border-gray-300 rounded px-2 py-1 text-sm">{provs.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>}
                  <label className="text-xs text-gray-500">Medio<select value={pp.medio} onChange={(e) => setPp({ ...pp, medio: e.target.value })} className="block border border-gray-300 rounded px-2 py-1 text-sm">{Object.entries(MEDIOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  {!esUSD && <label className="text-xs text-gray-500">TC USD (manual)<input type="number" value={pp.tc} onChange={(e) => setPp({ ...pp, tc: e.target.value })} placeholder={String(dolar || "")} className="block border border-gray-300 rounded px-2 py-1 text-sm w-24" /></label>}
                  <label className="text-xs text-gray-500">Monto pagado ({esUSD ? "USD" : "$"})<input type="number" value={pp.monto} onChange={(e) => setPp({ ...pp, monto: e.target.value })} placeholder="0" className="block border border-gray-300 rounded px-2 py-1 text-sm w-32" /></label>
                  <label className="text-xs text-gray-500">Informa proveedor (USD)<input type="number" value={pp.provUsd} onChange={(e) => setPp({ ...pp, provUsd: e.target.value })} placeholder="opcional" className="block border border-gray-300 rounded px-2 py-1 text-sm w-32" /></label>
                  <label className="text-xs text-gray-500">Fecha<input type="date" value={pp.fecha} onChange={(e) => setPp({ ...pp, fecha: e.target.value })} className="block border border-gray-300 rounded px-2 py-1 text-sm" /></label>
                  <label className="text-xs text-gray-500 flex-1 min-w-[140px]">Nota<input value={pp.nota} onChange={(e) => setPp({ ...pp, nota: e.target.value })} placeholder="referencia / nº cheque" className="block border border-gray-300 rounded px-2 py-1 text-sm w-full" /></label>
                </div>
                <div className="text-xs mt-1.5 flex flex-wrap gap-3 items-center">
                  <span className="text-gray-500">Costo {provSel}: <b>USD {costoP.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</b></span>
                  {montoN > 0 && (esUSD || tcV > 0) && <>
                    <span className="text-gray-500">= USD {montoUsd.toFixed(2)}</span>
                    <span className={Math.abs(diffPed) <= 0.5 ? "text-emerald-600" : "text-amber-600"}>vs costo {diffPed > 0 ? "+" : ""}{diffPed}</span>
                    {okProv != null && <span className={okProv ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>{okProv ? "✔ coincide c/ proveedor" : `⚠️ dif proveedor ${diffProv}`}</span>}
                  </>}
                  <button disabled={busy} onClick={guardar} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 ml-auto">💾 Registrar pago a {provSel}</button>
                </div>
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
            items.forEach((it: any, idx: number) => { const k = it.emisor || it.proveedor || "Sin proveedor"; (grupos[k] = grupos[k] || []).push({ ...it, _idx: idx }); });
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
              <div className="order-1 border border-violet-200 bg-violet-50/40 rounded-lg p-3">
                <div className="text-[11px] font-bold text-violet-700 uppercase mb-2">① Pedido al proveedor — marcá los ítems a pedir y enviá (podés pedir parcial)</div>
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
                          <button disabled={busy || pendientes === 0} onClick={() => enviarProv(prov, its)} className={`px-3 py-1.5 rounded-lg text-white text-xs font-semibold ${pendientes === 0 ? "bg-gray-300 cursor-not-allowed" : yaEnv ? "bg-amber-500 hover:bg-amber-600" : "bg-violet-600 hover:bg-violet-700"}`}>{pendientes === 0 ? "✅ Todo pedido" : yaEnv ? "📤 Enviar pendientes" : (/^multi(radio|solar)$/i.test(prov) ? "📤 Generar Excel y Enviar" : "📤 Enviar pedido")}</button>
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
            ? <a href={`/p/${ped.factura_token}?admin=1`} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-lg border border-emerald-300 text-emerald-700 text-sm font-semibold hover:bg-emerald-50">🧾 Ver {ped.factura_numero}</a>
            : <div className="flex items-center gap-1">
                {puedeFacturar && talsLetra.length > 0 && <select value={talEfectivo} onChange={(e) => setTalSel(e.target.value)} title="Talonario" className="border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white">
                  {talsLetra.map((t) => <option key={t.id} value={t.id}>{t.tipo_nombre} · {String(t.sucursal || "1").replace(/\D/g, "").padStart(5, "0")}-{String(t.proximo_numero).padStart(8, "0")}{t.defecto ? " ★" : ""}</option>)}
                </select>}
                {puedeFacturar && <select value={facMoneda} onChange={(e) => setFacMoneda(e.target.value)} title="Moneda de la factura" className="border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white"><option value="USD">USD</option><option value="ARS">$ Pesos</option></select>}
                {puedeFacturar && facMoneda === "ARS" && <input type="number" value={facTc} onChange={(e) => setFacTc(e.target.value)} placeholder={"TC " + (dolar || "")} title="Tipo de cambio (editable)" className="border border-gray-300 rounded-lg px-2 py-2 text-sm w-24" />}
                <button disabled={busy || !puedeFacturar}
                  title={cancelado ? "Pedido cancelado" : !ped.proveedor_confirmado ? "Confirmá el stock con el proveedor antes de facturar" : !letraReq ? "El cliente no tiene condición fiscal: cargala en Detalle/ficha del cliente" : talsLetra.length === 0 ? `No hay talonario de Factura ${letraReq} cargado (Configuración → Talonarios)` : `Emitir Factura ${letraReq}`}
                  onClick={() => { const tcUsar = Number(facTc) || dolar || 0; if (facMoneda === "ARS" && !tcUsar) { alert("Ingresá el tipo de cambio para facturar en pesos."); return; } accion({ accion: "facturar", talonario_id: talEfectivo ? Number(talEfectivo) : undefined, moneda: facMoneda, tc: facMoneda === "ARS" ? tcUsar : undefined }, `¿Generar la Factura ${letraReq} en ${facMoneda === "ARS" ? "PESOS (TC " + tcUsar + ")" : "USD"}?`); }}
                  className={`px-3 py-2 rounded-lg text-sm font-semibold ${puedeFacturar ? "border border-emerald-400 text-emerald-700 hover:bg-emerald-50" : "border border-gray-200 text-gray-300 cursor-not-allowed"}`}>🧾 Facturar{letraReq ? " " + letraReq : ""}</button>
              </div>}
          {ped.estado === "pendiente_confirmacion" && <>
            <button disabled={busy} onClick={() => accion({ accion: "estado", estado: "cancelado" }, "¿Rechazar el pedido?")} className="px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-semibold hover:bg-red-600">✕ Rechazar</button>
            <button disabled={busy || !ped.proveedor_confirmado} title={ped.proveedor_confirmado ? "" : "Primero confirmá el stock con el proveedor"} onClick={aprobar} className={`px-4 py-2 rounded-lg text-white text-sm font-semibold ${ped.proveedor_confirmado ? "bg-emerald-500 hover:bg-emerald-600" : "bg-gray-300 cursor-not-allowed"}`}>✅ Aprobar pedido</button>
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
      cols={["Número", "Cliente", "Estado", "Fecha", "Total", ""]} vacio={`Todavía no hay ${titulo.toLowerCase()} (se generan desde un pedido).`}>
      {rows.map((c) => (
        <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
          <td className="px-4 py-2 font-semibold">{c.numero}</td>
          <td className="px-4 py-2">{c.cliente_nombre || "—"}</td>
          <td className="px-4 py-2">{chip(c.estado || "—", EST_COL[c.estado] || "#888")}</td>
          <td className="px-4 py-2 text-gray-600">{fmtF(c.fecha)}</td>
          <td className="px-4 py-2 text-right font-semibold">{fmt(c.total)}</td>
          <td className="px-4 py-2 text-right">{c.token && <a href={`/p/${c.token}?admin=1`} target="_blank" rel="noreferrer" className="text-febo-azul hover:underline text-xs font-semibold">🧾 Ver</a>}</td>
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

// ---------- CUENTAS CORRIENTES (cliente + proveedor, en USD) ----------
function CuentasCorrientes() {
  const [amb, setAmb] = useState<"clientes" | "proveedores">("clientes");
  const [rows, setRows] = useState<any[]>([]); const [loading, setLoading] = useState(true);
  const [dolar, setDolar] = useState(0); const [owner, setOwner] = useState(false);
  const [sel, setSel] = useState<{ tipo: string; key: string | number; nombre: string } | null>(null);
  const load = useCallback(() => { setLoading(true); fetch("/api/ctacte?listar=" + amb).then((r) => r.json()).then((d) => { setRows(d.ok ? d.cuentas : []); setDolar(d.dolar || 0); setLoading(false); }); }, [amb]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch("/api/me").then((r) => r.json()).then((d) => setOwner(!!d.es_owner)).catch(() => {}); }, []);
  const totalSaldo = rows.reduce((a, r) => a + Number(r.saldo || 0), 0);
  const ars = (usd: number) => dolar > 0 ? ` · $ ${Math.round(usd * dolar).toLocaleString("es-AR")}` : "";
  const resetear = async () => {
    if (!confirm("¿PONER EN CERO toda la cuenta corriente (clientes y proveedores)? Esto borra todos los movimientos. Usar solo después de las pruebas.")) return;
    const r = await fetch("/api/ctacte?reset=1", { method: "DELETE" }); const d = await r.json();
    if (d.ok) { alert("✅ Cuenta corriente en cero."); load(); } else alert("Error: " + d.error);
  };
  return (
    <div>
      <div className="flex gap-1 mb-3 text-sm items-center">
        {(["clientes", "proveedores"] as const).map((k) => (
          <button key={k} onClick={() => setAmb(k)} className={`px-4 py-1.5 rounded-lg font-semibold ${amb === k ? "bg-febo-azul text-white" : "bg-gray-100 text-gray-600"}`}>{k === "clientes" ? "👤 Clientes" : "🏭 Proveedores"}</button>
        ))}
        {owner && <button onClick={resetear} className="ml-auto px-3 py-1.5 rounded-lg border border-red-200 text-red-500 text-xs font-semibold hover:bg-red-50" title="Borra todos los movimientos (post-pruebas)">🧹 Poner en cero (pruebas)</button>}
      </div>
      <div className="text-sm text-gray-500 mb-3">{rows.length} cuenta(s) con saldo · {amb === "clientes" ? "saldo > 0 = el cliente nos debe" : "saldo > 0 = le debemos al proveedor"} · Total: <b className="text-febo-azul">USD {totalSaldo.toLocaleString("es-AR", { minimumFractionDigits: 2 })}{ars(totalSaldo)}</b></div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr>
            <th className="text-left px-4 py-3">{amb === "clientes" ? "Cliente" : "Proveedor"}</th>
            <th className="text-right px-4 py-3">Debe</th><th className="text-right px-4 py-3">Haber</th><th className="text-right px-4 py-3">Saldo (USD)</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={4} className="text-center py-8 text-gray-400">Cargando…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={4} className="text-center py-8 text-gray-400">Sin saldos pendientes</td></tr>
            : rows.map((r, i) => (
              <tr key={i} className="border-t border-gray-100 hover:bg-blue-50 cursor-pointer" onClick={() => setSel({ tipo: amb === "clientes" ? "cliente" : "proveedor", key: amb === "clientes" ? r.cliente_id : (Number(r.proveedor_id) > 0 ? r.proveedor_id : r.nombre), nombre: r.nombre })}>
                <td className="px-4 py-2 font-semibold">{r.nombre}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-500">{Number(r.debe).toLocaleString("es-AR", { minimumFractionDigits: 2 })}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-500">{Number(r.haber).toLocaleString("es-AR", { minimumFractionDigits: 2 })}</td>
                <td className={`px-4 py-2 text-right tabular-nums font-bold ${Number(r.saldo) > 0.01 ? "text-red-600" : "text-emerald-600"}`}>{Number(r.saldo).toLocaleString("es-AR", { minimumFractionDigits: 2 })}<span className="block text-[10px] font-normal text-gray-400">{dolar > 0 ? "$ " + Math.round(Number(r.saldo) * dolar).toLocaleString("es-AR") : ""}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sel && <CtaCteDetalle ambito={sel.tipo} keyVal={sel.key} nombre={sel.nombre} onClose={() => { setSel(null); load(); }} />}
    </div>
  );
}

function CtaCteDetalle({ ambito, keyVal, nombre, onClose }: { ambito: string; keyVal: string | number; nombre: string; onClose: () => void }) {
  const [movs, setMovs] = useState<any[]>([]); const [saldo, setSaldo] = useState(0); const [loading, setLoading] = useState(true); const [dolar, setDolar] = useState(0);
  const qs = ambito === "cliente"
    ? "ambito=cliente&cliente_id=" + keyVal
    : (typeof keyVal === "number" ? "ambito=proveedor&proveedor_id=" + keyVal : "ambito=proveedor&proveedor=" + encodeURIComponent(String(keyVal)));
  const load = useCallback(() => { setLoading(true); fetch("/api/ctacte?" + qs).then((r) => r.json()).then((d) => { setMovs(d.ok ? d.movimientos : []); setSaldo(d.saldo || 0); setDolar(d.dolar || 0); setLoading(false); }); }, [qs]);
  useEffect(() => { load(); }, [load]);
  let acum = 0;
  return (
    <div className="fixed inset-0 z-[120] bg-black/50 flex items-stretch justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-[820px] h-full flex flex-col shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="bg-febo-azul text-white rounded-t-xl px-5 py-3 flex items-center justify-between">
          <div><div className="text-lg font-bold">💳 Cta cte · {nombre}</div><div className="text-xs opacity-90">{ambito === "cliente" ? "Cliente" : "Proveedor"} · saldo en USD</div></div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-xl leading-none">✕</button>
        </div>
        <div className="px-5 py-2 border-b border-gray-200 bg-gray-50 text-sm">
          Saldo: <b className={saldo > 0.01 ? "text-red-600" : "text-emerald-600"}>USD {saldo.toLocaleString("es-AR", { minimumFractionDigits: 2 })}{dolar > 0 ? " · $ " + Math.round(saldo * dolar).toLocaleString("es-AR") : ""}</b>
          <span className="text-gray-400 ml-2">{ambito === "cliente" ? (saldo > 0.01 ? "(nos debe)" : "(al día)") : (saldo > 0.01 ? "(le debemos)" : "(al día)")}</span>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase text-gray-400 sticky top-0 bg-white"><tr>
              <th className="text-left px-2 py-1">Fecha</th><th className="text-left px-2 py-1">Concepto</th>
              <th className="text-right px-2 py-1">Debe</th><th className="text-right px-2 py-1">Haber</th><th className="text-right px-2 py-1">Saldo</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={5} className="text-center py-8 text-gray-400">Cargando…</td></tr>
              : movs.length === 0 ? <tr><td colSpan={5} className="text-center py-8 text-gray-400">Sin movimientos</td></tr>
              : movs.map((m, i) => {
                const d = Number(m.debe) || 0, h = Number(m.haber) || 0;
                acum += ambito === "cliente" ? (d - h) : (h - d);
                return (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{fmtF(m.fecha)}</td>
                    <td className="px-2 py-1.5">{m.concepto}{m.comprobante && <span className="text-gray-400 ml-1">· {m.comprobante}</span>}{m.pedido_ref && <span className="text-[10px] text-gray-400 ml-1">({m.pedido_ref})</span>}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{d ? d.toLocaleString("es-AR", { minimumFractionDigits: 2 }) : ""}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{h ? h.toLocaleString("es-AR", { minimumFractionDigits: 2 }) : ""}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{acum.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
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
