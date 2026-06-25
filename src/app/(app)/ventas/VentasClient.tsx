"use client";
import { useEffect, useState, useCallback } from "react";
import { useWindows } from "../WindowManager";
import { letraFacturaPara } from "@/lib/talonarios";
import { tipoPorCodigo } from "@/lib/talonarios-tipos";

// Presupuestos = tabla real `presupuestos` (revendedores/coti). Pedidos = `pedidos`+`fv_pedidos`.
// Factura/Remito = fg_comprobantes. Pagos = fg_pagos. Proveedor = pedidos_proveedores.
// Vista/PDF/edición pública en coti.febecos.com (/p/{token}); edición interna embebida con ?rev.
// Parseo de respuestas a prueba de balas: si el server devuelve vacío (timeout/crash) o algo
// que no es JSON, NUNCA tira "Unexpected end of JSON input" → devuelve {ok:false, error claro}.
// Aislado: solo cambia el parseo, no toca ninguna lógica de negocio.
async function safeJson(r: Response): Promise<any> {
  let t = "";
  try { t = await r.text(); } catch { /* body ilegible */ }
  if (!t || !t.trim()) return { ok: false, error: `El servidor no respondió (HTTP ${r.status}${r.status === 504 ? " — timeout, reintentá" : ""}).` };
  try { return JSON.parse(t); } catch { return { ok: false, error: `Respuesta inválida del servidor (HTTP ${r.status}).` }; }
}

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
// Capitaliza la primera letra de cada palabra (nombre y apellido).
const titleCase = (s: any) => String(s || "").toLowerCase().replace(/(^|[\s,.-])([a-záéíóúñü])/g, (_m, sep, ch) => sep + ch.toUpperCase());
const fmt = (v: number, m = "$") => `${m} ` + Math.round(Number(v) || 0).toLocaleString("es-AR");
const fmtF = (v: string) => (v ? new Date(v).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");
const chip = (txt: string, col: string) => <span style={{ background: col + "22", color: col }} className="rounded px-2 py-0.5 text-[11px] font-semibold">{txt}</span>;
const EST_COL: Record<string, string> = { emitido: "#64748b", enviada: "#2563eb", pedido: "#7c3aed", pagado: "#059669", aprobado: "#059669", nuevo: "#2563eb", anulado: "#e53935", borrador: "#94a3b8", proforma: "#d97706", confirmado: "#7c3aed" };

const SECCIONES = [
  { k: "presupuestos", icon: "📝", label: "Presupuestos" },
  { k: "pedidos", icon: "📦", label: "Pedidos" },
  { k: "facturas", icon: "🧾", label: "Facturas" },
  { k: "notas", icon: "↩️", label: "Notas C/D" },
  { k: "recibos", icon: "🧾", label: "Recibos" },
  { k: "remitos", icon: "🚚", label: "Remitos" },
  { k: "pagos", icon: "💵", label: "Pagos" },
  { k: "ctacte", icon: "💳", label: "Cuentas corrientes" },
  { k: "comisiones", icon: "💰", label: "Comisiones" },
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
        {sec === "notas" && <Comprobantes tipo="nota_credito,nota_debito" titulo="Notas de Crédito / Débito" />}
        {sec === "recibos" && <Comprobantes tipo="recibo" titulo="Recibos" />}
        {sec === "remitos" && <Comprobantes tipo="remito" titulo="Remitos" />}
        {sec === "pagos" && <Pagos />}
        {sec === "ctacte" && <CuentasCorrientes />}
        {sec === "comisiones" && <ComisionesInternos />}
      </div>
    </div>
  );
}

// ---------- COMISIONES VENDEDORES INTERNOS (por tramos sobre facturación del período) ----------
function ComisionesInternos() {
  const hoy = new Date();
  const [desde, setDesde] = useState(`${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-01`);
  const [hasta, setHasta] = useState(hoy.toISOString().slice(0, 10));
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/comisiones-internos?desde=${desde}&hasta=${hasta}`)
      .then(safeJson).then((d) => { setData(d.ok ? d : null); setLoading(false); })
      .catch(() => setLoading(false));
  }, [desde, hasta]);
  useEffect(() => { load(); }, [load]);
  const fmt = (n: number) => "$ " + Math.round(Number(n) || 0).toLocaleString("es-AR");
  const filas = data?.filas || [];
  const totalCom = filas.reduce((a: number, f: any) => a + (Number(f.comision) || 0), 0);
  const inp = "border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm";
  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-gray-500">DESDE<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inp} /></label>
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-gray-500">HASTA<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={inp} /></label>
        <button onClick={load} className="bg-febo-azul text-white rounded-lg px-4 py-2 text-sm font-semibold">🔄 Actualizar</button>
        <div className="ml-auto text-sm text-gray-500">Comisión sobre <b>facturación total del período</b>{data?.dolar ? ` · TC $${data.dolar}` : ""}</div>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Vendedor interno</th>
              <th className="text-center px-4 py-3">Facturas</th>
              <th className="text-right px-4 py-3">Facturado ($)</th>
              <th className="text-center px-4 py-3">Tramo</th>
              <th className="text-center px-4 py-3">%</th>
              <th className="text-right px-4 py-3">Comisión ($)</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">Cargando…</td></tr>
            : filas.length === 0 ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">Sin facturas con vendedor en el período.</td></tr>
            : filas.map((f: any) => (
              <tr key={f.vendedor} className="border-t border-gray-100">
                <td className="px-4 py-2 font-semibold">{f.vendedor}</td>
                <td className="px-4 py-2 text-center text-gray-500">{f.n_facturas}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmt(f.facturado)}</td>
                <td className="px-4 py-2 text-center text-gray-600">{f.nivel}</td>
                <td className="px-4 py-2 text-center font-semibold text-emerald-700">{f.pct}%</td>
                <td className="px-4 py-2 text-right tabular-nums font-bold text-febo-azul">{fmt(f.comision)}</td>
              </tr>
            ))}
          </tbody>
          {filas.length > 0 && (
            <tfoot><tr className="border-t-2 border-gray-200 bg-gray-50">
              <td className="px-4 py-2 font-bold" colSpan={5}>Total a liquidar</td>
              <td className="px-4 py-2 text-right tabular-nums font-bold text-febo-azul">{fmt(totalCom)}</td>
            </tr></tfoot>
          )}
        </table>
      </div>
      {data?.tramos?.length > 0 && (
        <div className="mt-3 text-[11px] text-gray-400">
          Tramos: {data.tramos.map((t: any) => `${t.nivel} (${fmt(t.desde)}${t.hasta ? "–" + fmt(t.hasta) : "+"}) ${t.pct}%`).join(" · ")}
        </div>
      )}
    </div>
  );
}

// ---------- PRESUPUESTOS (tabla real, coti) ----------
type Presup = { id: number; numero: string; tipo: string; estado: string; cliente_display: string; cliente_nombre: string; cliente_apellido: string; cliente_razon_social: string; bomba_codigo: string; bomba_descripcion: string; precio_ofrecido: number; revendedor_nombre: string; public_token: string; revendedor_token: string; cliente_id: number | null; created_at: string; pedido_numero?: string | null; factura_numero?: string | null; vendedor?: string | null; vendedor_email?: string | null; moneda?: string | null; tc?: number | null; prov?: { n: number; enviados: number; completo: boolean | null } | null; email_enviado_at?: string | null };
const tienePedido = (r: Presup) => !!r.pedido_numero || ["pedido", "convertido", "pagado", "anulado"].includes((r.estado || "").toLowerCase());

function Presupuestos() {
  const { open, openFicha } = useWindows();
  const [rows, setRows] = useState<Presup[]>([]);
  const [tipo, setTipo] = useState(""); const [q, setQ] = useState("");
  const [estado, setEstado] = useState(""); const [vendedor, setVendedor] = useState("");
  const [estados, setEstados] = useState<string[]>([]); const [vendedores, setVendedores] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<number | null>(null);
  const [mailFor, setMailFor] = useState<Presup | null>(null);
  const [confFor, setConfFor] = useState<{ p: any; items: any[] } | null>(null);
  const abrirConfirmar = async (r: Presup) => {
    try {
      const res = await fetch("/api/presupuestos?detalle=" + encodeURIComponent(r.numero));
      const d = await safeJson(res);
      if (!d.ok) { alert("Error: " + (d.error || "no se pudo leer el detalle")); return; }
      setConfFor({ p: d.presupuesto, items: d.items || [] });
    } catch (e: any) { alert("Error: " + e.message); }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/presupuestos?" + new URLSearchParams({ tipo, q, estado, vendedor }));
      const d = await safeJson(r);
      if (d.ok) { setRows(d.presupuestos); if (d.estados) setEstados(d.estados); if (d.vendedores) setVendedores(d.vendedores); }
    } finally { setLoading(false); }
  }, [tipo, q, estado, vendedor]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  // Abre el visor/cotizador FV en modo INTERNO (con todos los botones): pide a gestión
  // un token efímero (server↔server) y lo pasa en el hash que fv lee como sesión admin.
  async function tokenInterno(): Promise<string> {
    try { const r = await fetch("/api/fv-session"); const d = await safeJson(r); if (d.ok && d.token) return "#admin_jwt=" + d.token; } catch {}
    return "";
  }
  async function abrirFvInterno(token: string, numero: string, cliente?: string) {
    const hash = await tokenInterno();
    if (!hash) { alert("⚠️ No se pudo abrir en modo interno (revisá FV_BRIDGE_SECRET)."); return; }
    open("presup-edit", { url: `https://fv.febecos.com/ver-presupuesto?token=${token}${hash}`, title: `☀️ ${numero}`, docTitle: `${cliente ? cliente + " - " : ""}${numero}` });
  }
  const nombreCli = (r: Presup) => titleCase(r.cliente_display || r.cliente_razon_social || [r.cliente_nombre, r.cliente_apellido].filter(Boolean).join(" ")) || "—";
  const selCls = "border border-gray-300 rounded-lg px-3 py-2 text-sm";
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar número / cliente / CUIT / bomba…" className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[240px]" />
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={selCls}>
          <option value="">Todo tipo</option><option value="bomba">Revendedores (bombas)</option><option value="fv">Fotovoltaico</option><option value="roi">ROI (simulador)</option>
        </select>
        <select value={vendedor} onChange={(e) => setVendedor(e.target.value)} className={selCls}>
          <option value="">Todos los vendedores</option>
          {vendedores.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value)} className={selCls}>
          <option value="">Todos los estados</option>
          {estados.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <button onClick={() => load()} disabled={loading} title="Actualizar la lista" className="px-3 py-2 rounded-lg bg-febo-azul text-white text-sm font-semibold disabled:opacity-50">{loading ? "…" : "🔄 Actualizar"}</button>
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
              <tr key={r.numero} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2 font-semibold">{r.numero}</td>
                <td className="px-4 py-2">{chip(r.tipo === "fv" ? "FV" : r.tipo === "roi" ? "ROI" : "Rev", r.tipo === "fv" ? "#d97706" : r.tipo === "roi" ? "#16a34a" : "#2563eb")}</td>
                <td className="px-4 py-2">{nombreCli(r)}</td>
                <td className="px-4 py-2 text-gray-600">{r.bomba_codigo || r.bomba_descripcion || "—"}</td>
                <td className="px-4 py-2 text-gray-500" title={r.vendedor_email || ""}>{r.vendedor || "—"}</td>
                <td className="px-4 py-2">
                  {chip(r.estado || "—", EST_COL[r.estado] || "#888")}
                  {r.email_enviado_at && <span className="ml-1 text-[10px] font-semibold text-emerald-600" title={"Cotización enviada al cliente · " + fmtF(r.email_enviado_at)}>📧✓</span>}
                  {(r.estado || "").toLowerCase() === "confirmado" && <span className="ml-1 text-[10px] font-semibold text-emerald-700" title="Confirmado al cliente (a la espera del pago)">✅</span>}
                  {r.prov && r.prov.n > 0 && (
                    <span className="ml-1 text-[10px] font-bold rounded px-1.5 py-0.5" style={{ background: (r.prov.completo ? "#16a34a" : "#d97706") + "22", color: r.prov.completo ? "#16a34a" : "#b45309" }}
                      title={`${r.prov.n} pedido(s) a proveedor · ${r.prov.enviados} enviado(s) · ${r.prov.completo ? "cubre todos los ítems" : "faltan ítems por pedir"}`}>
                      🏭 {r.prov.n}{r.prov.completo === false ? " parc." : r.prov.completo ? " ✓" : ""}
                    </span>
                  )}
                  {r.pedido_numero && <span className="ml-1 text-[10px] font-semibold text-violet-700" title="Pedido generado">📦 {r.pedido_numero}</span>}
                  {r.factura_numero && <span className="ml-1 text-[10px] font-semibold text-emerald-600" title="Facturado">🧾 {r.factura_numero}</span>}
                </td>
                <td className="px-4 py-2 text-gray-600">{fmtF(r.created_at)}</td>
                <td className="px-4 py-2 text-right font-semibold">{(r.moneda === "ARS" || r.moneda === "$") && Number(r.tc) > 0 ? `$ ${Math.round(Number(r.precio_ofrecido) * Number(r.tc)).toLocaleString("es-AR")}` : fmt(r.precio_ofrecido, r.tipo === "fv" ? "USD" : "$")}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {tienePedido(r)
                    ? <span title="Con pedido generado: no se edita" className="text-gray-300 mr-2">🔒</span>
                    : <>
                      {r.public_token && r.tipo !== "fv" && r.revendedor_token && <button onClick={() => open("presup-edit", { url: `${COTI}/p/${r.public_token}?rev=${r.revendedor_token}`, title: `✏️ ${r.numero}`, docTitle: `${r.cliente_display ? r.cliente_display + " - " : ""}${r.numero}` })} title="Editar (interno, en gestión)" className="text-gray-400 hover:text-febo-azul mr-2">✏️</button>}
                      {r.public_token && r.tipo === "fv" && <button onClick={() => abrirFvInterno(r.public_token, r.numero, r.cliente_display)} title="Editar/Operar FV (modo interno)" className="text-gray-400 hover:text-febo-azul mr-2">✏️</button>}
                    </>}
                  {r.public_token && <a href={linkPresup(r.tipo, r.public_token)} target="_blank" rel="noreferrer" title="Ver / Imprimir / PDF (público)" className="text-gray-400 hover:text-febo-azul mr-2">📄</a>}
                  {r.tipo === "roi" && <a href={`/api/roi-pdf?lead_id=${String(r.id).replace("roi-", "")}`} target="_blank" rel="noreferrer" title="Ver / Descargar PDF del análisis ROI" className="text-gray-400 hover:text-febo-azul mr-2">📄</a>}
                  {!["anulado", "pagado", "enviado"].includes((r.estado || "").toLowerCase()) && (
                    tienePedido(r)
                      ? <span title="Ya pasado a pedido" className="inline-flex items-center justify-center w-5 h-5 rounded bg-gray-200 text-gray-400 text-xs font-bold align-middle mr-2">✔</span>
                      : <button onClick={() => abrirConfirmar(r)} title="Convierte este presupuesto en un PEDIDO de venta (PED-####) en Ventas → Pedidos, para confirmar stock, facturar y despachar. NO envía mail al cliente ni pide al proveedor (eso se hace aparte desde el pedido). El presupuesto queda como 'pedido'." className="inline-flex items-center justify-center w-5 h-5 rounded bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold align-middle mr-2">✔</button>
                  )}
                  {r.public_token && r.revendedor_token && <button onClick={() => setMailFor(r)} title={r.email_enviado_at ? "Reenviar por email (ya enviado " + fmtF(r.email_enviado_at) + ")" : "Enviar por email (revendedor)"} className={(r.email_enviado_at ? "text-emerald-600 hover:text-emerald-700" : "text-gray-400 hover:text-febo-azul") + " mr-2"}>{r.email_enviado_at ? "🔁" : "📧"}</button>}
                  {r.cliente_id && <button onClick={() => openFicha(r.cliente_id as number, "operaciones")} title="Ventas y cuenta del cliente" className="text-gray-400 hover:text-febo-azul">👤</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editId && <EditarPresupuesto id={editId} onClose={() => setEditId(null)} onSaved={() => { setEditId(null); load(); }} />}
      {mailFor && <EnviarMailRev p={mailFor} onClose={() => setMailFor(null)} />}
      {confFor && <ConfirmarClienteModal data={confFor} onClose={() => setConfFor(null)} onDone={() => { setConfFor(null); load(); }} />}
    </div>
  );
}

// Checklist de ítems → cuando están TODOS tildados, manda el email de confirmación + pago al cliente.
function ConfirmarClienteModal({ data, onClose, onDone }: { data: { p: any; items: any[] }; onClose: () => void; onDone: () => void }) {
  const { p, items } = data;
  const [chk, setChk] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  // Si hay ítems, tildarlos todos; si no hay (bomba sin kit desglosado), igual se puede pasar a pedido.
  const todos = items.length === 0 || items.every((_, i) => chk[i]);
  // Total en la moneda CONFIRMADA del presupuesto. Base del precio_ofrecido por cotizador:
  // bomba = pesos (mostrar $ directo); FV = USD (si se confirmó en pesos → × TC).
  const monedaConf = String(p.moneda || "").toUpperCase();
  const confPesos = monedaConf === "ARS" || monedaConf === "$" || monedaConf === "PESOS";
  const ofrecido = Number(p.precio_ofrecido) || 0;
  let totalTxt: string;
  if (p.tipo === "bomba") {
    totalTxt = "$ " + Math.round(ofrecido).toLocaleString("es-AR");                       // bombas: pesos
  } else if (confPesos && Number(p.tc) > 0) {
    totalTxt = "$ " + Math.round(ofrecido * Number(p.tc)).toLocaleString("es-AR");          // FV confirmado en pesos
  } else {
    totalTxt = "USD " + ofrecido.toLocaleString("es-AR", { minimumFractionDigits: 2 });     // FV en USD
  }
  const crear = async (force_sin_stock = false) => {
    setBusy(true);
    try {
      const r = await fetch("/api/confirmar-cliente", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ numero: p.numero, force_sin_stock }) });
      const d = await safeJson(r);
      // Sin stock en el depósito → cartel para confirmar pedido SIN STOCK (pedir equipo al proveedor).
      if (!d.ok && d.sin_stock) {
        const falt = (d.faltantes || []).map((f: any) => `• ${f.codigo}${f.marca ? " (" + f.marca + ")" : ""} — pedido ${f.pedido}, en stock ${f.stock}`).join("\n");
        setBusy(false);
        if (confirm(`⚠️ SIN STOCK en el depósito para este pedido:\n\n${falt}\n\n¿Crear el pedido igual? Va a quedar marcado como "pedido SIN STOCK" y hay que PEDIR EL EQUIPO AL PROVEEDOR.`)) {
          return crear(true);
        }
        return;
      }
      if (!d.ok) throw new Error(d.error);
      alert("📦 Pasado a pedido" + (d.pedido_numero ? ": " + d.pedido_numero : "") + (d.sin_stock ? "\n⚠️ SIN STOCK — pedir el equipo al proveedor." : "") + ".");
      onDone();
    } catch (e: any) { alert("Error: " + e.message); } finally { setBusy(false); }
  };
  const enviar = async () => {
    if (!todos) return;
    if (!confirm(`¿Pasar el presupuesto ${p.numero} a PEDIDO?\n\nCrea un pedido de venta (PED) en Ventas → Pedidos para confirmar stock, facturar y despachar.\nNO envía mail al cliente ni pide al proveedor (eso se hace aparte desde el pedido).`)) return;
    await crear(false);
  };
  return (
    <div className="fixed inset-0 z-[130] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-[560px] max-h-[85vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="bg-orange-500 text-white rounded-t-xl px-5 py-3 flex items-center justify-between">
          <div className="font-bold">📦 Pasar a pedido — {p.numero}</div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-xl leading-none">✕</button>
        </div>
        <div className="p-4 overflow-auto">
          <div className="text-sm text-gray-600 mb-2">Validá que estén <b>todos</b> los elementos disponibles. Al tildarlos todos podés pasar el presupuesto a <b>pedido</b> (NO se envía mail al cliente).</div>
          <div className="flex justify-between items-center mb-2">
            <span className="flex gap-3">
              <button onClick={() => setChk(Object.fromEntries(items.map((_, i) => [i, true])))} className="text-xs text-febo-azul hover:underline">Marcar todos</button>
              <button onClick={() => setChk({})} className="text-xs text-gray-500 hover:underline">Desmarcar todos</button>
            </span>
            <span className="text-xs text-gray-500">{items.filter((_, i) => chk[i]).length}/{items.length} listos</span>
          </div>
          <div className="border border-gray-200 rounded-lg divide-y">
            {items.map((it, i) => (
              <label key={i} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-emerald-50">
                <input type="checkbox" checked={!!chk[i]} onChange={(e) => setChk((s) => ({ ...s, [i]: e.target.checked }))} />
                <span className="flex-1"><b className="text-febo-azul">{it.cantidad}×</b> {it.codigo} <span className="text-gray-500">{(it.descripcion || "").slice(0, 50)}</span></span>
              </label>
            ))}
            {!items.length && (p.tipo === "bomba"
              ? <div className="px-3 py-3 text-sm text-amber-700 bg-amber-50">⚠️ Kit sin desglosar — este presupuesto de bomba todavía no trae los componentes (cable, soga, sensor, etc.). El pedido se crea con la bomba sola; pedí al Portal que persista el kit para confirmar todo.</div>
              : <div className="px-3 py-3 text-sm text-gray-400">Sin ítems detallados.</div>)}
          </div>
          <div className="mt-3 text-sm">Total: <b className="text-orange-700">{totalTxt}</b></div>
        </div>
        <div className="border-t border-gray-200 p-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-gray-500">Cancelar</button>
          <button disabled={busy || !todos} onClick={enviar} className="px-4 py-1.5 rounded-lg bg-orange-500 text-white text-sm font-semibold disabled:opacity-50" title={!todos ? "Tildá todos los ítems" : ""}>📦 Pasar a pedido</button>
        </div>
      </div>
    </div>
  );
}

// Enviar presupuesto REV por email — email editable (prefill del CRM), sale de revende@.
function EnviarMailRev({ p, onClose }: { p: any; onClose: () => void }) {
  // Email del cliente: el del CRM (fuente única, resuelto por CUIT/cliente_id) tiene prioridad
  // sobre la copia plana del presupuesto. NO usamos el del revendedor para el cliente final.
  const mailCliente = (p.cliente_email_crm || p.cliente_email || "").trim();
  const mailRev = (p.revendedor_email || "").trim();
  const [dest, setDest] = useState<"cliente" | "rev">("cliente"); // buzón de salida + firma (ventas@ vs revende@)
  // El destino arranca con el mail del cliente (CRM). Cambiar el buzón de salida NO pisa el destino.
  const [email, setEmail] = useState(mailCliente || mailRev || "");
  const [mensaje, setMensaje] = useState("");
  const [pdf, setPdf] = useState<{ nombre: string; b64: string } | null>(null); // adjunto manual
  const [busy, setBusy] = useState(false);
  const tomarPdf = (f?: File) => { if (!f) { setPdf(null); return; } const r = new FileReader(); r.onload = () => setPdf({ nombre: f.name, b64: String(r.result).split(",")[1] }); r.readAsDataURL(f); };
  // Link PÚBLICO puro: nunca con ?rev=TOKEN (expone el token / abre modo edición).
  const link = linkPresup(p.tipo, p.public_token);
  const nombre = titleCase(p.cliente_display || p.cliente_razon_social || [p.cliente_nombre, p.cliente_apellido].filter(Boolean).join(" ") || p.revendedor_nombre || "");
  const enviar = async () => {
    if (!email.includes("@")) { alert("Ingresá un email válido."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/presupuesto-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ numero: p.numero, email: email.trim(), link, tipo: dest, nombre, mensaje, pdf_b64: pdf?.b64 || null, pdf_nombre: pdf?.nombre || null }) });
      const d = await safeJson(r); if (!d.ok) throw new Error(d.error);
      alert("✅ Email enviado a " + email.trim()); onClose();
    } catch (e: any) { alert("Error: " + e.message); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[130] bg-black/50 flex items-start justify-center py-10" onClick={onClose}>
      <div className="bg-white rounded-xl w-[440px] max-w-[94vw] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="bg-febo-azul text-white rounded-t-xl px-5 py-3 flex items-center justify-between">
          <div className="font-bold">📧 Enviar presupuesto {p.numero}</div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-5 space-y-3">
          <div><label className="block text-[10px] uppercase text-gray-400 font-semibold mb-0.5">Email destinatario (editable)</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="cliente@email.com" />
            {!mailCliente && !email && <div className="text-[11px] text-amber-600 mt-0.5">⚠️ Este cliente no tiene email cargado en el CRM. Cargalo en su ficha o escribilo acá.</div>}
          </div>
          <div><label className="block text-[10px] uppercase text-gray-400 font-semibold mb-0.5">¿A quién le enviás?</label>
            <select value={dest} onChange={(e) => setDest(e.target.value as "cliente" | "rev")} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="cliente">Cliente final → sale de ventas@ (firma Guillermo + Rodrigo)</option>
              <option value="rev">Revendedor → sale de revende@ (firma Guillermo)</option>
            </select></div>
          <div><label className="block text-[10px] uppercase text-gray-400 font-semibold mb-0.5">Adjuntar PDF (opcional)</label>
            <input type="file" accept="application/pdf" onChange={(e) => tomarPdf(e.target.files?.[0])} className="w-full text-xs" />
            {pdf && <div className="text-[11px] text-emerald-600 mt-0.5">✓ {pdf.nombre}</div>}
            <div className="text-[10px] text-gray-400 mt-0.5">Por ahora el PDF se adjunta a mano (bajalo desde "Ver presupuesto"). La generación automática queda pendiente.</div></div>
          <div className="text-[11px] text-gray-400">El email inicial viene del CRM. Sale con el link al presupuesto y la(s) firma(s) según el destinatario.</div>
          <div><label className="block text-[10px] uppercase text-gray-400 font-semibold mb-0.5">Mensaje (opcional)</label>
            <textarea value={mensaje} onChange={(e) => setMensaje(e.target.value)} rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y" placeholder="Mensaje para el cliente…" /></div>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm">Cancelar</button>
            <button disabled={busy} onClick={enviar} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50">{busy ? "Enviando…" : "Enviar"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Semáforo de avance del pedido del cliente: confirmado → stock prov → pagado → facturado → remitido.
function PasosPedido({ p }: { p: any }) {
  if (p.estado === "cancelado") return <span title="Cancelado">❌</span>;
  if (p.estado === "anulado") return <span title="Anulado (revertido)">🚫</span>;
  const pasos = [
    { ic: "✔", on: true, color: "#ea580c", t: "Pedido confirmado por el cliente" },
    { ic: "🏭", on: !!p.prov_confirmado, t: p.prov_confirmado ? "Stock confirmado con el proveedor" : "Falta confirmar stock con el proveedor" },
    { ic: "💰", on: !!p.pagado, t: p.pagado ? "Pagado" : "Falta el pago del cliente" },
    { txt: "FA", on: !!p.factura_numero, color: "#059669", t: p.factura_numero ? "Factura " + p.factura_numero : "Sin facturar", token: p.factura_token },
    // La NC solo aparece si existe (no es un paso de todo pedido)
    ...(p.nc_numero ? [{ txt: "NC", on: true, color: "#e11d48", t: "Nota de Crédito " + p.nc_numero, token: p.nc_token }] : []),
    { ic: "📦", on: !!p.remito_numero || p.estado === "enviado", t: p.remito_numero ? "Remito " + p.remito_numero : "Sin remito / despacho" },
  ] as { ic?: string; txt?: string; on: boolean; color?: string; t: string; token?: string }[];
  return <span className="inline-flex items-center gap-1 text-[15px]">{pasos.map((s, i) => {
    const style = { opacity: s.on ? 1 : 0.25, filter: s.on ? "none" : "grayscale(1)", color: s.color, fontWeight: (s.color || s.txt) ? 800 : undefined } as React.CSSProperties;
    const inner = s.txt
      ? <span className="inline-flex items-center justify-center rounded px-1 text-[10px] leading-[14px] border" style={{ borderColor: (s.color || "#888") + "66", background: s.on ? (s.color || "#888") + "14" : "transparent" }}>{s.txt}</span>
      : s.ic;
    const node = <span key={i} title={s.t} style={style}>{inner}</span>;
    return s.on && s.token
      ? <a key={i} href={`/p/${s.token}?admin=1`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title={s.t + " — ver"} style={style} className="hover:underline">{inner}</a>
      : node;
  })}</span>;
}

// ---------- PEDIDOS (bombas + fv unificados) ----------
function Pedidos() {
  const [rows, setRows] = useState<any[]>([]); const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const { openFicha } = useWindows();
  const load = () => fetch("/api/pedidos").then(safeJson).then((d) => { setRows(d.ok ? d.pedidos : []); setLoading(false); });
  useEffect(() => { load(); }, []);
  // Refrescar al volver a la ventana (ej. tras generar un pedido en el cotizador)
  useEffect(() => { const onFocus = () => load(); window.addEventListener("focus", onFocus); return () => window.removeEventListener("focus", onFocus); }, []);
  return (
    <>
    <div className="flex justify-end mb-2"><button onClick={load} className="text-sm text-febo-azul hover:underline">🔄 Actualizar</button></div>
    <Tabla loading={loading} count={rows.length} unidad="pedidos"
      cols={["Origen", "Número", "Cliente", "Detalle", "Estado", "Avance", "Fecha", "Total", ""]}>
      {rows.map((p, i) => (
        <tr key={i} className="border-t border-gray-100 hover:bg-blue-50 cursor-pointer" onClick={() => setSel(String(p.numero || p.ref))}>
          <td className="px-4 py-2">{chip(p.origen === "fv" ? "FV" : "Bomba", p.origen === "fv" ? "#d97706" : "#2563eb")}</td>
          <td className="px-4 py-2 font-semibold">{p.numero || (p.presup ? "↳ " + p.presup : "—")}</td>
          <td className="px-4 py-2">{titleCase(p.cliente) || "—"}</td>
          <td className="px-4 py-2 text-gray-600">{p.detalle}</td>
          <td className="px-4 py-2">{chip(p.estado, EST_COL[p.estado] || "#888")}</td>
          <td className="px-4 py-2 whitespace-nowrap">{p.origen === "fv" ? <PasosPedido p={p} /> : <span className="text-gray-300">—</span>}</td>
          <td className="px-4 py-2 text-gray-600">{fmtF(p.fecha)}</td>
          <td className="px-4 py-2 text-right font-semibold">{(p.moneda === "ARS" || p.moneda === "$") && Number(p.tc) > 0 ? `$ ${Math.round(Number(p.total) * Number(p.tc)).toLocaleString("es-AR")}` : fmt(p.total, p.moneda)}</td>
          <td className="px-4 py-2 text-right whitespace-nowrap">
            {p.cliente_id && (
              <button
                onClick={(e) => { e.stopPropagation(); openFicha(p.cliente_id, "datos"); }}
                title="Ver ficha del cliente en CRM"
                className="text-gray-400 hover:text-febo-azul mr-1"
              >👤</button>
            )}
            {p.token && <a onClick={(e) => e.stopPropagation()} href={linkPresup(p.origen === "fv" ? "fv" : "bomba", p.token)} target="_blank" rel="noreferrer" title="Ver presupuesto" className="text-gray-400 hover:text-febo-azul">📄</a>}
          </td>
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
  anulado: ["🚫 Anulado", "#9ca3af"],
};
function PedidoModal({ refId, onClose, onChanged }: { refId: string; onClose: () => void; onChanged: () => void }) {
  const [ped, setPed] = useState<any>(null);
  const [pesos, setPesos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nota, setNota] = useState("");
  const [dv, setDv] = useState({ condiciones_venta: "", forma_pago: "", lugar_entrega: "", tipo_transporte: "" });
  const [valorDecl, setValorDecl] = useState(""); // valor declarado para el transporte (propio del pedido)
  const [provData, setProvData] = useState<Record<string, { email: string; mensaje: string }>>({});
  const [provSel, setProvSel] = useState<Record<string, Record<number, boolean>>>({});
  const [unlockedProv, setUnlockedProv] = useState<Record<string, boolean>>({});
  const [vf, setVf] = useState({ tc: "", moneda: "usd", monto: "", redondeo: "", medio: "Transferencia", ret_pct: "", ret_cert: "", archivo_nombre: "", banco: "", ref_numero: "", fecha: "" });
  const [emailCli, setEmailCli] = useState("");
  const [tals, setTals] = useState<any[]>([]); const [talSel, setTalSel] = useState<string>("");
  const [facMoneda, setFacMoneda] = useState("USD"); const [facTc, setFacTc] = useState("");
  const [preview, setPreview] = useState<any | null>(null); // revisión previa (dry-run) de la factura
  const [arcaOpen, setArcaOpen] = useState(false); // modal de autorización ARCA (paso 2)
  const [avisarPagoOpen, setAvisarPagoOpen] = useState(false); // modal: avisar pago OK al cliente
  const [esOwner, setEsOwner] = useState(false); // confirmación de stock manual = solo owner (Guille)
  // Receptor de la factura: 0 = el revendedor mismo; o el id de un cliente final suyo.
  const [receptorId, setReceptorId] = useState<number>(0);
  const [finales, setFinales] = useState<any[]>([]);
  const [revCom, setRevCom] = useState<{ propia: number; revende: number }>({ propia: 0, revende: 0 });
  useEffect(() => { fetch("/api/talonarios?facturacion=1").then(safeJson).then((d) => { if (d.ok) { setTals(d.talonarios); const def = d.talonarios.find((t: any) => t.defecto) || d.talonarios[0]; if (def) setTalSel(String(def.id)); } }).catch(() => {}); }, []);
  const [tab, setTab] = useState<"cliente" | "prov" | "venta" | "envio" | "pago" | "factura">("cliente");
  const [monedaInit, setMonedaInit] = useState(false);
  const load = useCallback(() => fetch("/api/pedidos/" + encodeURIComponent(refId)).then(async (r) => { const t = await r.text(); return t ? JSON.parse(t) : { ok: false, error: `El servidor no respondió (HTTP ${r.status})` }; }).then((d) => {
    if (d.ok) {
      // Email del cliente: CRM (fuente única, resuelto por cliente_id) tiene prioridad sobre la copia del payload.
      setPed(d.pedido); setNota(d.pedido.payload?.notas_internas || ""); setEmailCli(d.pedido.cliente?.email || d.pedido.payload?.revendedor?.email || d.pedido.payload?.cliente?.email || "");
      // Datos de venta: lo guardado en el pedido o, si está vacío, lo que vino del presupuesto FV (condiciones).
      const dvp = d.pedido.payload?.datos_venta || {};
      const cond = d.pedido.payload?.condiciones || {};
      setDv({
        condiciones_venta: dvp.condiciones_venta || cond.pago || "",
        forma_pago: dvp.forma_pago || cond.forma || "",
        lugar_entrega: dvp.lugar_entrega || cond.lugar || "",
        tipo_transporte: dvp.tipo_transporte || "",
      });
      // Valor declarado: propio del pedido (fallback al que pudiera haber quedado en envio viejo).
      setValorDecl(String(d.pedido.payload?.valor_declarado ?? d.pedido.payload?.envio?.valor_declarado ?? ""));
      // Si el presupuesto se hizo en $ → arrancar pedido y factura en pesos con su TC (una sola vez).
      if (!monedaInit) {
        const tt = d.pedido.payload?.totales || {};
        if (tt.moneda === "ARS" || tt.moneda === "$") { setPesos(true); setFacMoneda("ARS"); if (tt.tc) setFacTc(String(tt.tc)); }
        setMonedaInit(true);
      }
    }
  }).catch((e: any) => console.error("[load pedido]", e?.message || e)), [refId, monedaInit]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch("/api/me").then(safeJson).then((d) => setEsOwner(!!d.es_owner)).catch(() => {}); }, []);
  // Clientes finales del revendedor + sus % de comisión (para elegir receptor y previsualizar comisión).
  useEffect(() => {
    const id = ped?.cliente?.id; if (!id) return;
    fetch(`/api/clientes/${id}/finales`).then(safeJson).then((d) => setFinales(d.ok ? d.finales : [])).catch(() => {});
    fetch(`/api/clientes/${id}`).then(safeJson).then((d) => { if (d.ok && d.cliente) setRevCom({ propia: Number(d.admin_descuento_pct ?? d.cliente.comision_propia_pct) || 0, revende: Number(d.cliente.comision_revende_pct) || 0 }); }).catch(() => {});
  }, [ped?.cliente?.id]);
  if (!ped) return null;
  const pl = ped.payload || {}; const items = pl.items || []; const tot = pl.totales || {};
  const rev = pl.revendedor || pl.cliente || {}; const dolar = Number(ped.dolar) || 0;
  // TC para mostrar pesos: si ya está facturado, manda el TC PACTADO de la factura (no el del día),
  // así los $ coinciden EXACTO con lo facturado; si no, el del presupuesto o el del día.
  const tcMostrar = Number(ped.factura?.tc) || Number(tot.tc) || dolar;
  const enP = pesos && tcMostrar > 0; const sym = enP ? "$" : "USD";
  const v = (usd: number) => usd == null ? null : (enP ? Math.round(usd * tcMostrar) : usd);
  const nf = (n: number | null) => n == null || isNaN(Number(n)) ? "—" : Number(n).toLocaleString("es-AR", { minimumFractionDigits: enP ? 0 : 2, maximumFractionDigits: enP ? 0 : 2 });
  const money = (usd: number) => { const x = v(usd); return x == null ? "—" : `${sym} ${nf(x)}`; };
  const costoTot = items.reduce((a: number, it: any) => a + (Number(it.costo_usd) || 0) * (Number(it.cantidad) || 1), 0);
  const badge = PED_BADGE[ped.estado] || [ped.estado, "#888"];
  const cancelado = ped.estado === "cancelado";
  // ── Datos fiscales del cliente + letra de factura AFIP ──
  const cli = ped.cliente || {};
  // Nombre canónico del CRM (no la copia del payload), capitalizado.
  const nombreCli = titleCase(cli.nombre || cli.razon_social || rev.nombre || "") || "(sin nombre)";
  const facturado = !!ped.factura_numero;
  const borrador = !facturado && ped.factura_estado === "borrador"; // facturado en gestión, falta autorizar ARCA
  const pagadoOk = ["pagado", "enviado"].includes(ped.estado) || (ped.pagos_recibidos || []).length > 0;
  const despachado = ped.estado === "enviado" || !!pl.remito_numero;
  // CRM = fuente única de los datos de envío: se leen EN VIVO de la ficha del cliente (cliente_envio).
  // Si el pedido tiene cliente resuelto en el CRM, manda SIEMPRE el CRM (aunque esté vacío) — nada de
  // copias viejas del payload. El fallback a pl.envio es solo para pedidos sin cliente en CRM.
  const envioCli = ped.cliente_id ? (ped.cliente_envio || {}) : (pl.envio || {});
  const envioCompleto = !!(envioCli.nombre && envioCli.direccion && envioCli.localidad && envioCli.provincia);
  // Receptor efectivo: el revendedor (default) o el cliente final elegido.
  const finalSel = receptorId ? finales.find((x) => x.id === receptorId) : null;
  const condCli = (finalSel?.condicion_fiscal) || cli.condicion_fiscal || rev.condicion_fiscal || "";
  const cuitCli = finalSel ? (finalSel.cuit || "") : (cli.cuit || rev.cuit || "");
  const domCli = finalSel
    ? [finalSel.domicilio, finalSel.localidad, finalSel.provincia].filter(Boolean).join(", ")
    : [cli.domicilio || rev.domicilio, cli.localidad || rev.localidad, cli.provincia || rev.provincia].filter(Boolean).join(", ");
  const nombreReceptor = finalSel ? (finalSel.razon_social || finalSel.nombre) : nombreCli;
  // Comisión previsualizada (USD, sobre neto): % de reventa si es a cliente final, % propio si es al revendedor.
  const comPct = receptorId ? revCom.revende : revCom.propia;
  const comMonto = +(((Number(tot.neto) || Number(tot.total) || 0)) * comPct / 100).toFixed(2);
  const letraReq = letraFacturaPara(condCli);
  const talsLetra = tals.filter((t) => (tipoPorCodigo(t.tipo_codigo)?.letra || "") === letraReq);
  const talDefLetra = talsLetra.find((t) => t.defecto) || talsLetra[0];
  const talEfectivo = talsLetra.some((t) => String(t.id) === talSel) ? talSel : (talDefLetra ? String(talDefLetra.id) : "");
  // ── PAGO: se compara en la MONEDA de la factura (no mezclar USD/pesos). Para pedidos en pesos
  //    se usa el TC PACTADO del pedido (tot.tc), no el del día → el saldo da exacto. ──
  // Si ya hay factura (borrador o emitida), la moneda/TC/total de COBRO los manda la FACTURA
  // (no la cotización) → el $ a cobrar coincide exacto con lo facturado.
  const fac = ped.factura || null;
  const pedMoneda = String(fac?.moneda || tot.moneda || "USD").toUpperCase();
  const tcPed = Number(fac?.tc) || Number(tot.tc) || dolar || 0;
  const enPesos = pedMoneda === "ARS";
  // Total USD REAL = neto + IVA (nunca el tot.total redondeado del cotizador) → coincide con el
  // presupuesto y con lo que va a facturar. Fallback a tot.total si el pedido no trae desglose.
  const ivaUsdTot = Array.isArray(tot.iva_detalle) ? tot.iva_detalle.reduce((a: number, d: any) => a + (Number(d.monto ?? d.importe) || 0), 0) : 0;
  const netoUsdTot = Number(tot.neto);
  const totalUsdReal = (Array.isArray(tot.iva_detalle) && tot.iva_detalle.length && !isNaN(netoUsdTot))
    ? +(netoUsdTot + ivaUsdTot).toFixed(2) : (Number(tot.total) || 0);
  const totalCobrar = fac?.total != null
    ? (enPesos ? Math.round(Number(fac.total)) : +Number(fac.total).toFixed(2))
    : (enPesos ? Math.round(totalUsdReal * tcPed) : +totalUsdReal.toFixed(2));
  const pagosRec: any[] = ped.pagos_recibidos || [];
  const pagoEnMonedaFactura = (p: any) => { const m = Number(p.monto) || 0; if (enPesos) return p.moneda === "usd" ? Math.round(m * tcPed) : m; return p.moneda === "ars" ? (tcPed ? +(m / tcPed).toFixed(2) : 0) : m; };
  const totalPagado = +pagosRec.reduce((a, p) => a + pagoEnMonedaFactura(p), 0).toFixed(2);
  const saldoCobrar = +(totalCobrar - totalPagado).toFixed(2);
  const pagoCubierto = pagosRec.length > 0 && Math.abs(saldoCobrar) <= (enPesos ? 1 : 0.02);
  // Se PUEDE facturar sin estar pagado: muchas empresas piden la factura antes de emitir su OC.
  // El pago deja de ser requisito; el saldo se sigue mostrando y se refleja en cta cte / recibo.
  const puedeFacturar = !cancelado && !!ped.stock_validado && !!ped.proveedor_confirmado && !!letraReq && talsLetra.length > 0;

  // Validar STOCK propio (depósito). Si faltan ítems → bloquea (salvo override de Guillermo/owner).
  const validarStockPed = async (override = false) => {
    setBusy(true);
    try {
      const r = await fetch("/api/pedidos/" + encodeURIComponent(refId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "validar_stock", override }) });
      const _t = await r.text();
      const d = _t ? JSON.parse(_t) : { ok: false, error: `El servidor no respondió (HTTP ${r.status})${r.status === 504 ? " — timeout" : ""}. Reintentá.` };
      if (d.ok) { await load(); onChanged(); return; }
      const falt = (d.faltantes || []).map((f: any) => `• ${f.codigo} — pedido ${f.pedido}, en stock ${f.stock}`).join("\n");
      if (d.puede_override) {
        if (confirm(`⚠️ Falta stock:\n\n${falt}\n\nSos Guillermo (owner). ¿Forzar la validación igual (override)?`)) { setBusy(false); return validarStockPed(true); }
      } else {
        alert(`❌ No se puede validar el stock — falta:\n\n${falt}\n\nCargá stock (remito/ajuste) o pedile a Guillermo que haga el override.`);
      }
    } catch (e: any) { alert("Error: " + e.message); } finally { setBusy(false); }
  };

  const accion = async (body: any, msg?: string) => {
    if (msg && !confirm(msg)) return;
    setBusy(true);
    try { const r = await fetch("/api/pedidos/" + encodeURIComponent(refId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const _t = await r.text(); const d = _t ? JSON.parse(_t) : { ok: false, error: `El servidor no respondió (HTTP ${r.status})${r.status === 504 ? " — timeout" : ""}. Reintentá.` }; if (!d.ok) throw new Error(d.error); await load(); onChanged(); return d; }
    catch (e: any) { alert("Error: " + e.message); } finally { setBusy(false); }
  };
  // Revisión previa (dry-run): muestra letra, condición IVA, neto, IVA, total SIN emitir CAE.
  const revisar = async () => {
    setBusy(true);
    try {
      const tcUsar = Number(facTc) || dolar || 0;
      const r = await fetch("/api/pedidos/" + encodeURIComponent(refId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "facturar_preview", talonario_id: talEfectivo ? Number(talEfectivo) : undefined, moneda: facMoneda, tc: facMoneda === "ARS" ? tcUsar : undefined, receptor_cliente_id: receptorId || undefined }) });
      const d = await safeJson(r); if (!d.ok) throw new Error(d.error);
      setPreview(d);
      if (d.arca?.persistida) { await load(); onChanged(); } // ARCA cargó la condición fiscal → refrescar ficha
    } catch (e: any) { alert("Error: " + e.message); } finally { setBusy(false); }
  };
  const aprobar = async () => {
    const d = await accion({ accion: "estado", estado: "aprobado" }, "¿Aprobar el pedido y avisar al cliente para el pago?");
    if (!d) return;
    const av = d.aviso_cliente;
    if (av && av.ok) alert("✅ Pedido aprobado. Aviso de pago enviado al cliente.");
    else if (av && !av.ok) alert("✅ Pedido aprobado, pero NO se pudo avisar al cliente:\n" + (av.error || "error") + "\n\nRevisá el email del cliente en la solapa Detalle.");
  };
  // Revertir el pedido (lo confirmó por error): borra el pedido y devuelve el presupuesto a "emitido".
  const revertir = async () => {
    if (!confirm("¿Revertir este pedido?\n\nSe borra el pedido (es el último número, se libera para reusar) y el presupuesto vuelve a 'emitido' (reaparece en Presupuestos para rehacerlo).")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/pedidos/" + encodeURIComponent(refId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "revertir" }) });
      const d = await safeJson(r);
      if (!d.ok) throw new Error(d.error);
      onChanged(); onClose();
    } catch (e: any) { alert("Error: " + e.message); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/50 flex items-stretch justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-[1180px] h-full flex flex-col shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="bg-febo-azul text-white rounded-t-xl px-5 py-3 flex items-center justify-between">
          <div>
            <div className="text-lg font-bold">{nombreCli}</div>
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
          {([["cliente", "📋 Cliente"], ["prov", "🏭 Proveedor / Stock"], ["venta", "🧾 Datos de venta"], ["pago", "💵 Pago"], ["factura", "📄 Factura"], ["envio", "📦 Envío / Remito"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 font-semibold border-b-2 -mb-px ${tab === k ? "border-febo-azul text-febo-azul" : "border-transparent text-gray-500 hover:text-gray-700"}`}>{l}</button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-5 flex flex-col gap-4">
          {cancelado && <div className="bg-red-50 border border-red-300 text-red-700 rounded-lg px-4 py-3 text-sm font-semibold">⛔ Pedido CANCELADO — NO SE PUEDE EDITAR. Para continuar, generá un nuevo pedido.</div>}
          {/* Checklist del pedido — qué falta para avanzar (cada chip lleva a su solapa) */}
          {!cancelado && (() => {
            const pasos: { l: string; ok: boolean; tab: typeof tab }[] = [
              { l: "Condición fiscal", ok: !!condCli, tab: "cliente" },
              { l: "Datos de venta", ok: !!(dv.condiciones_venta || dv.forma_pago), tab: "venta" },
              { l: "Stock confirmado", ok: !!ped.proveedor_confirmado, tab: "prov" },
              { l: "Pago", ok: pagadoOk, tab: "pago" },
              { l: "Facturado", ok: facturado, tab: "factura" },
              { l: "Datos de envío", ok: envioCompleto, tab: "envio" },
              { l: "Despachado", ok: despachado, tab: "envio" },
            ];
            const hechos = pasos.filter((p) => p.ok).length;
            return (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <div className="flex items-center justify-between mb-1.5"><span className="text-[11px] font-bold text-gray-400 uppercase">Progreso del pedido</span><span className="text-[11px] text-gray-500">{hechos}/{pasos.length}</span></div>
                <div className="flex flex-wrap gap-1.5">
                  {pasos.map((p, i) => (
                    <button key={i} onClick={() => setTab(p.tab)} title={p.ok ? "Completo" : "Pendiente — click para ir"} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${p.ok ? "bg-emerald-100 text-emerald-700" : "bg-white border border-gray-300 text-gray-500 hover:bg-gray-100"}`}>{p.ok ? "✓" : "○"} {p.l}</button>
                  ))}
                </div>
              </div>
            );
          })()}
          {/* === SOLAPA CLIENTE === */}
          {tab === "cliente" && (<>
          {/* Contacto */}
          <div>
            <div className="text-[11px] font-bold text-gray-400 uppercase mb-1 bg-gray-50 px-2 py-1 rounded">Contacto del cliente</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm px-2">
              {pl.presupuesto_numero && <Cell l="Origen" v={<span className="font-mono font-bold text-febo-azul bg-blue-50 px-2 rounded">{pl.presupuesto_numero}</span>} />}
              <Cell l="Nombre" v={nombreCli} />
              {rev.empresa && <Cell l="Empresa" v={rev.empresa} />}
              <Cell l="WhatsApp" v={cli.whatsapp || rev.whatsapp || rev.wa || "—"} />
              <div>
                <div className="text-[10px] uppercase text-gray-400">Email {!emailCli && <span className="text-red-500">· falta (cargalo en la ficha del cliente / CRM)</span>}</div>
                <div className="text-gray-800">{emailCli || "—"}</div>
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
                {(() => {
                  const desc = Number(tot.descuento_monto) || 0;
                  const subLista = (Number(tot.neto) || 0) + desc;   // subtotal de lista (antes del descuento)
                  const ivaDet = Array.isArray(tot.iva_detalle) ? tot.iva_detalle.filter((d: any) => Number(d.monto) > 0) : [];
                  // Total = neto (con descuento) + IVA discriminado, redondeando por línea (igual que el PDF).
                  const _totNI = (v(tot.neto) || 0) + (ivaDet.length ? ivaDet.reduce((a: number, d: any) => a + (v(d.monto) || 0), 0) : (v(tot.iva) || 0));
                  // Fallback: pedidos con total cargado pero neto=0 (ej. kit de bombas con precio global).
                  // OJO: si tot.moneda ya es ARS, tot.total está en pesos → NO aplicar v() (que multiplica por TC).
                  const _totGlobal = String(tot.moneda || "").toUpperCase() === "ARS" ? (Number(tot.total) || 0) : (v(Number(tot.total) || 0) || 0);
                  const totPesos = _totNI > 0 ? _totNI : _totGlobal;
                  return (<>
                    <tr><td colSpan={4} className="text-right px-2 py-1 text-gray-500">Subtotal s/IVA</td><td className="text-right px-2 py-1">{money(subLista)}</td></tr>
                    {desc > 0 && <tr><td colSpan={4} className="text-right px-2 py-1 text-gray-500">Descuento {tot.descuento_pct || ""}%</td><td className="text-right px-2 py-1 text-rose-600">– {money(desc)}</td></tr>}
                    {ivaDet.length
                      ? ivaDet.map((d: any, i: number) => <tr key={i}><td colSpan={4} className="text-right px-2 py-1 text-gray-500">IVA {d.pct}%</td><td className="text-right px-2 py-1">{money(d.monto)}</td></tr>)
                      : <tr><td colSpan={4} className="text-right px-2 py-1 text-gray-500">IVA</td><td className="text-right px-2 py-1">{money(tot.iva)}</td></tr>}
                    <tr className="border-t border-gray-200"><td colSpan={4} className="text-right px-2 py-2 font-bold text-febo-azul">TOTAL</td><td className="text-right px-2 py-2 font-bold text-febo-azul">{sym} {nf(totPesos)}</td></tr>
                  </>);
                })()}
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
                    <div className="mb-2">El stock se confirma <b>automáticamente</b> a medida que cada proveedor confirma su pedido en <b>Compras</b> (proforma / orden de compra / factura). El pedido queda confirmado cuando <b>todos</b> sus proveedores confirmaron.</div>
                    {/* Estado por proveedor (desde los pedidos a proveedor de este pedido) */}
                    {(ped.pedidos_proveedor || []).length > 0 ? (
                      <div className="space-y-0.5 mb-2">
                        {(ped.pedidos_proveedor || []).map((pp2: any, i: number) => {
                          const okc = ["confirmado", "pagado", "recibido_ok", "recibido_diferencias"].includes(pp2.estado);
                          return <div key={i} className="text-xs flex items-center gap-2"><span className={okc ? "text-emerald-600" : "text-amber-600"}>{okc ? "✓" : "⏳"}</span><span className="font-semibold">{pp2.proveedor}</span><span className="text-gray-500">{okc ? "confirmado" : "esperando confirmación (cargá la proforma en Compras)"}</span></div>;
                        })}
                      </div>
                    ) : <div className="text-xs text-gray-500 mb-2">Todavía no cargaste los ítems a Compras. Hacelo abajo en "Pedir a proveedor".</div>}
                    {esOwner && (
                      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-amber-200/60 mt-1">
                        <span className="text-[11px] text-gray-500">Solo administrador, ante demora:</span>
                        <label className="text-xs">Adjuntar proforma / mail: <input type="file" multiple onChange={(e) => confirmar(e.target.files)} className="text-xs" /></label>
                        <span className="text-xs text-gray-400">o</span>
                        <button disabled={busy} onClick={() => confirmar(null)} title="Override de Guillermo: marca el stock confirmado a mano (ante demora del proveedor)." className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600">✔ Forzar confirmación (manual)</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
          {/* ① Validación de STOCK propio (depósito) — sin esto NO se puede facturar (salvo override de Guillermo) */}
          <div className={`order-1 rounded-lg p-3 border ${ped.stock_validado ? "border-emerald-200 bg-emerald-50/40" : "border-red-300 bg-red-50/40"}`}>
            <div className="text-[11px] font-bold uppercase mb-2" style={{ color: ped.stock_validado ? "#059669" : "#dc2626" }}>① Stock propio (depósito) — se valida cada elemento del pedido</div>
            {ped.stock_validado ? (
              <div className="text-sm text-emerald-700 flex flex-wrap items-center gap-2">
                <span>✔ Stock validado{ped.stock_validado_at ? " · " + new Date(ped.stock_validado_at).toLocaleDateString("es-AR") : ""}{ped.stock_override_by ? ` · override por ${ped.stock_override_by}` : ""}</span>
              </div>
            ) : (
              <div className="text-sm text-red-800">
                <div className="mb-2">Valida que <b>todos</b> los elementos del pedido estén en stock. Si falta alguno, <b>no se puede facturar</b> (Guillermo puede forzarlo).</div>
                <button disabled={busy || cancelado} onClick={() => validarStockPed(false)} title="Chequea cada ítem del pedido contra el stock del depósito y lo descuenta. Si falta stock, no deja continuar salvo override de Guillermo." className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700">📦 Validar stock</button>
              </div>
            )}
          </div>

          {/* El PAGO A PROVEEDOR se gestiona en Compras → Pedidos a proveedores (no acá). */}

          {/* === SOLAPA PAGO / FACTURA === Comprobante de pago + verificar monto */}
          {tab === "pago" && !cancelado && (() => {
            const archivos = ped.comprobante_archivo || [];
            const montoN = Number(vf.monto) || 0;
            // Moneda del pago que se está cargando, llevada a la moneda de la FACTURA.
            const esteEnFactura = pagoEnMonedaFactura({ monto: montoN, moneda: vf.moneda });
            const saldoTrasEste = +(saldoCobrar - esteEnFactura).toFixed(2);
            const okPago = Math.abs(saldoTrasEste) <= (enPesos ? 1 : 0.02);
            const fmtP = (n: number) => (enPesos ? "$ " : "USD ") + Number(n).toLocaleString("es-AR", { minimumFractionDigits: enPesos ? 0 : 2, maximumFractionDigits: 2 });
            const toB64 = (f: File) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(f); });
            const subir = async (files: FileList | null) => {
              if (!files?.length) return; const arr: any[] = [];
              for (const f of Array.from(files)) arr.push({ nombre: f.name, tipo: f.type, b64: await toB64(f) });
              await accion({ accion: "comprobante", archivos: [...archivos, ...arr] });
            };
            // Lee el MONTO del último comprobante (PDF → texto; imagen → OCR gratis en el navegador).
            // Infiere el medio de pago del texto/nombre del comprobante (cheque, depósito, MP, etc.).
            const detectarMedio = (txt: string): string | null => {
              const s = (txt || "").toLowerCase();
              if (/cheque|e-?cheq|echeq/.test(s)) return "Cheque";
              if (/mercado\s*pago|\bmp\b/.test(s)) return "Mercado Pago";
              if (/dep[oó]sito/.test(s)) return "Depósito";
              if (/efectivo/.test(s)) return "Efectivo";
              if (/transferenc/.test(s)) return "Transferencia";
              return null;
            };
            const quitarArchivo = (i: number) => { if (confirm("¿Quitar este comprobante adjunto?")) accion({ accion: "comprobante", archivos: archivos.filter((_: any, j: number) => j !== i) }); };
            const leerComprobante = async (a: any) => {
              if (!a) a = archivos[archivos.length - 1];
              if (!a) { alert("Subí primero el comprobante (PDF o imagen)."); return; }
              try {
                let monto = 0; let texto = a.nombre || "";
                if (/pdf/i.test(a.tipo || "")) {
                  const d = await safeJson(await fetch("/api/parse-proforma", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ b64: a.b64, tipo: a.tipo }) }));
                  monto = Number(d?.monto?.monto) || 0;
                  texto += " " + String(d?.texto || d?.text || "");
                } else if (/image/i.test(a.tipo || "")) {
                  const T: any = await import("tesseract.js");
                  const { data } = await T.recognize(`data:${a.tipo};base64,${a.b64}`, "spa");
                  texto += " " + String(data?.text || "");
                  const nums = String(data?.text || "").match(/\d{1,3}(?:[.\s]\d{3})+(?:,\d{2})?|\d+,\d{2}/g) || [];
                  const vals = nums.map((s) => Number(s.replace(/[.\s]/g, "").replace(",", "."))).filter((n) => n > 0);
                  monto = vals.length ? Math.max(...vals) : 0; // el importe suele ser el mayor
                }
                const medio = detectarMedio(texto);
                const upd: any = { ...vf, archivo_nombre: a.nombre || "" };
                if (monto > 0) { upd.monto = String(monto); upd.moneda = enPesos ? "ars" : "usd"; }
                if (medio) upd.medio = medio;
                // N° de cheque desde el nombre/texto ("Cheque00022639" → 22639); sin ceros a la izquierda.
                if (medio === "Cheque" && !vf.ref_numero) { const mch = texto.match(/cheque[^0-9]*0*(\d{3,})/i); if (mch) upd.ref_numero = mch[1]; }
                setVf(upd);
                if (!(monto > 0)) alert("No pude leer el monto." + (medio ? ` (Detecté medio: ${medio}.)` : "") + " Cargalo a mano.");
              } catch (e: any) { alert("No se pudo leer el comprobante: " + e.message + "\nCargá el monto a mano."); }
            };
            const esRet = vf.medio === "Retención";
            const guardarPago = () => {
              if (!montoN) { alert("Ingresá el monto recibido"); return; }
              if (esRet && !archivos.length) { if (!confirm("Es una retención pero no subiste el certificado (img/pdf). ¿Guardar igual?")) return; }
              const montoUsd = enPesos ? +(esteEnFactura / (tcPed || 1)).toFixed(2) : esteEnFactura;
              const ultArch = vf.archivo_nombre || (archivos.length ? archivos[archivos.length - 1].nombre : null);
              const fechaPago = vf.fecha ? new Date(vf.fecha + "T12:00:00").toISOString() : new Date().toISOString();
              accion({ accion: "verificar", pago: { monto: montoN, moneda: vf.moneda, tc: tcPed, monto_usd: montoUsd, monto_factura: esteEnFactura, moneda_factura: enPesos ? "ars" : "usd", ok: okPago, fecha: fechaPago,
                medio: vf.medio, archivo_nombre: ultArch, banco: vf.banco || null, ref_numero: vf.ref_numero || null,
                retencion: esRet ? { pct: vf.ret_pct ? Number(vf.ret_pct) : null, certificado: vf.ret_cert || null } : null } });
              setVf({ ...vf, monto: "", ret_pct: "", ret_cert: "", archivo_nombre: "", banco: "", ref_numero: "", fecha: "" });
            };
            const generarRecibo = async () => {
              if (!pagosRec.length) { alert("Cargá al menos un pago antes de generar el recibo."); return; }
              const d = await accion({ accion: "recibo" }, "¿Generar Recibo X con el detalle de los pagos recibidos?");
              if (d?.ok && d.recibo_token) window.open(`/p/${d.recibo_token}?admin=1`, "_blank");
            };
            const eliminarPago = (i: number) => { if (confirm("¿Eliminar este pago? Se revierte su movimiento en cuenta corriente.")) accion({ accion: "eliminar_pago", index: i }); };
            return (
              <div className="border border-gray-200 rounded-lg p-3">
                <div className="text-[11px] font-bold text-gray-400 uppercase mb-2">📄 Comprobante de pago {ped.comprobante_recibido && <span className="text-emerald-600">· recibido</span>}</div>
                {archivos.length > 0 && <div className="flex flex-col gap-1 mb-2">{archivos.map((a: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <a href={`data:${a.tipo};base64,${a.b64}`} download={a.nombre} className="text-febo-azul underline truncate max-w-[280px]" title={a.nombre}>⬇ {a.nombre}</a>
                    <button disabled={busy} onClick={() => leerComprobante(a)} className="px-2 py-0.5 rounded border border-blue-300 text-blue-700 font-semibold hover:bg-blue-50" title="Lee monto + medio de ESTE comprobante y los pone en el formulario para guardarlo como pago">🔍 Leer</button>
                    <button onClick={() => quitarArchivo(i)} className="text-red-400 hover:text-red-600" title="Quitar este adjunto">✕</button>
                  </div>
                ))}</div>}
                <div className="flex items-center gap-2 mb-3">
                  <input type="file" accept="application/pdf,image/*" multiple onChange={(e) => subir(e.target.files)} className="text-xs" />
                </div>
                <div className="text-[11px] font-bold text-gray-500 uppercase mb-1">💵 Verificar monto recibido</div>
                <div className="text-xs mb-1">Total a cobrar: <b>{fmtP(totalCobrar)}</b>{enPesos ? ` (USD ${(fac?.total != null && tcPed ? Number(fac.total) / tcPed : totalUsdReal).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · TC ${tcPed})` : ""} · Pagado: <b>{fmtP(totalPagado)}</b> · Saldo: <b className={Math.abs(saldoCobrar) <= (enPesos ? 1 : 0.02) ? "text-emerald-600" : "text-red-600"}>{fmtP(saldoCobrar)}</b></div>
                <div className="flex flex-wrap gap-2 items-center">
                  <select value={vf.medio} onChange={(e) => setVf({ ...vf, medio: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm" title="Medio de pago"><option>Transferencia</option><option>Cheque</option><option>Efectivo</option><option>Depósito</option><option>Mercado Pago</option><option>Retención</option></select>
                  <select value={vf.moneda} onChange={(e) => setVf({ ...vf, moneda: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm"><option value="usd">USD</option><option value="ars">$ ARS</option></select>
                  <input type="number" value={vf.monto} onChange={(e) => setVf({ ...vf, monto: e.target.value })} placeholder="monto recibido" className="border border-gray-300 rounded px-2 py-1 text-sm w-36" />
                  {montoN > 0 && <span className={`text-xs font-semibold ${okPago ? "text-emerald-600" : "text-amber-600"}`}>{okPago ? "✔ saldo 0 — habilita facturar" : `quedaría saldo ${fmtP(saldoTrasEste)}`}</span>}
                  <button disabled={busy} onClick={guardarPago} className="px-3 py-1.5 rounded-lg bg-cyan-600 text-white text-xs font-semibold hover:bg-cyan-700">💾 Guardar pago</button>
                </div>
                {vf.medio !== "Efectivo" && vf.medio !== "Retención" && (
                  <div className="flex flex-wrap gap-2 items-center mt-2">
                    <input type="date" value={vf.fecha} onChange={(e) => setVf({ ...vf, fecha: e.target.value })} title="Fecha del pago" className="border border-gray-300 rounded px-2 py-1 text-sm" />
                    <input value={vf.banco} onChange={(e) => setVf({ ...vf, banco: e.target.value })} placeholder="Banco" className="border border-gray-300 rounded px-2 py-1 text-sm w-40" />
                    <input value={vf.ref_numero} onChange={(e) => setVf({ ...vf, ref_numero: e.target.value })} placeholder={vf.medio === "Cheque" ? "N° de cheque" : "N° de operación"} className="border border-gray-300 rounded px-2 py-1 text-sm w-44" />
                    <span className="text-[11px] text-gray-400">{vf.medio === "Cheque" ? "Datos del cheque (van en el recibo)" : "Banco y N° de operación (van en el recibo)"}</span>
                  </div>
                )}
                {esRet && (
                  <div className="flex flex-wrap gap-2 items-center mt-2 bg-amber-50 border border-amber-200 rounded-lg p-2">
                    <span className="text-[11px] font-bold text-amber-700 uppercase">↩️ Retención</span>
                    <input type="number" value={vf.ret_pct} onChange={(e) => setVf({ ...vf, ret_pct: e.target.value })} placeholder="% (opc.)" className="border border-amber-300 rounded px-2 py-1 text-sm w-24" />
                    <input value={vf.ret_cert} onChange={(e) => setVf({ ...vf, ret_cert: e.target.value })} placeholder="N° certificado (opc.)" className="border border-amber-300 rounded px-2 py-1 text-sm w-44" />
                    <span className="text-[11px] text-amber-700">Subí el certificado arriba (📄) — se computa como pago y baja el saldo.</span>
                  </div>
                )}
                {pagosRec.length > 0 && <div className="mt-2 space-y-0.5">{pagosRec.map((p: any, i: number) => <div key={i} className="text-xs text-gray-600 flex items-center gap-2"><span>• {new Date(p.fecha).toLocaleDateString("es-AR")}:</span>
                  <select value={p.medio || "Transferencia"} disabled={busy} onChange={(e) => accion({ accion: "editar_pago", index: i, medio: e.target.value })} title="Medio de pago (editable)" className="border border-gray-200 rounded px-1 py-0.5 text-xs bg-white"><option>Transferencia</option><option>Cheque</option><option>Efectivo</option><option>Depósito</option><option>Mercado Pago</option><option>Retención</option></select>
                  {p.retencion && <span className="text-amber-600">ret{p.retencion.pct ? " " + p.retencion.pct + "%" : ""}</span>}
                  <span>{p.moneda === "ars" ? "$" : "USD"} {Number(p.monto).toLocaleString("es-AR")} {p.ok ? "✔" : ""}</span>
                  <button onClick={() => eliminarPago(i)} title="Eliminar este pago" className="text-red-400 hover:text-red-600">🗑</button></div>)}</div>}
                {pagoCubierto && <div className="mt-2 text-xs text-emerald-700 font-semibold">✓ Pago completo (saldo 0) — ya podés facturar.</div>}
                {pagosRec.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap items-center gap-2">
                    <button disabled={busy} onClick={generarRecibo} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-40">🧾 Generar Recibo X</button>
                    {ped.recibo_token && <a href={`/p/${ped.recibo_token}?admin=1`} target="_blank" rel="noreferrer" className="text-xs text-indigo-700 font-semibold hover:underline">Ver último recibo ({ped.recibo_numero})</a>}
                    <span className="text-[11px] text-gray-400">Detalla cada pago y el saldo; se puede enviar al cliente para pedir el cobro.</span>
                  </div>
                )}
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
              try { const d = await safeJson(await fetch("/api/me")); if (d.ok && d.es_owner) { setUnlockedProv((p) => ({ ...p, [prov]: true })); } else alert("🔒 Solo el administrador (owner) puede desbloquear para re-enviar ítems ya pedidos."); }
              catch { alert("No se pudo validar el permiso."); }
            };
            // Carga los ítems elegidos a Compras → Pedidos a proveedores (PENDIENTE), identificados
            // por este pedido de cliente (fv_numero). El envío/unificación al proveedor se hace en Compras.
            const enviarProv = async (prov: string, its: any[]) => {
              const info = provData[prov] || { email: "", mensaje: "" };
              const elegidos = its.filter((it) => !isLocked(prov, it.codigo) && sel(prov, it._idx));
              if (!elegidos.length) { alert("Marcá al menos un ítem PENDIENTE para pedir."); return; }
              if (!confirm(`¿Cargar ${elegidos.length} ítem(s) de ${prov} a Compras → Pedidos a proveedores?\n\nDesde Compras se arma y envía el pedido completo (podés unificar varios pedidos del mismo proveedor identificando de qué pedido de cliente viene cada uno).`)) return;
              setBusy(true);
              try {
                const r = await fetch("/api/pedidos-proveedor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proveedor: prov, fv_numero: refId, email_destinatario: info.email || null, mensaje: info.mensaje || null, origen: "fv", items: elegidos.map((it) => ({ codigo: it.codigo, descripcion: it.descripcion, cantidad: it.cantidad, costo_usd: it.costo_usd })) }) });
                const d = await safeJson(r); if (!d.ok) throw new Error(d.error);
                alert(`📥 Cargado a Compras: ${elegidos.length} ítem(s) de ${prov} (pendiente${d.id ? " #" + d.id : ""}).\n\nCompletá el envío desde Compras → Pedidos a proveedores.`);
                await load();
              } catch (e: any) { alert("Error: " + e.message); } finally { setBusy(false); }
            };
            return (
              <div className="order-1 border border-violet-200 bg-violet-50/40 rounded-lg p-3">
                <div className="text-[11px] font-bold text-violet-700 uppercase mb-1">① Pedir a proveedor — seleccioná los ítems de cada proveedor</div>
                <div className="text-[11px] text-gray-500 mb-2">Se cargan a <b>Compras → Pedidos a proveedores</b> (quedan identificados con este pedido {refId}). Desde ahí se arma y envía el pedido completo, pudiendo <b>unificar</b> varios pedidos a un mismo proveedor.</div>
                {enviados.length > 0 && (
                  <div className="mb-3 text-xs bg-emerald-50 border border-emerald-200 rounded p-2">
                    <b className="text-emerald-700">Ya cargado a Compras:</b>
                    {enviados.map((e: any, i: number) => <div key={i} className="text-gray-600">✅ {e.proveedor} · {new Date(e.created_at).toLocaleString("es-AR")} · {(e.items?.length || 0)} ítem(s){e.estado ? ` · ${e.estado}` : ""}{e.gsa_numero ? ` · GSA ${e.gsa_numero}` : ""}</div>)}
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
                        <div className="font-semibold text-sm">{chip(prov, "#7c3aed")} <span className="text-gray-500 text-xs ml-1">{pendientes} pendiente(s) de {its.length}</span>{yaEnv && <span className="text-emerald-600 text-xs ml-2">✅ cargado a Compras</span>}</div>
                        <div className="flex gap-2">
                          {hayBloqueados && !unlockedProv[prov] && <button onClick={() => desbloquear(prov)} className="px-2.5 py-1.5 rounded-lg border border-gray-300 text-xs font-semibold text-gray-600 hover:bg-gray-50" title="Solo administrador">🔓 Desbloquear</button>}
                          <button disabled={busy || pendientes === 0} onClick={() => enviarProv(prov, its)} title="Carga estos ítems a Compras → Pedidos a proveedores (pendiente). El envío al proveedor se hace desde Compras." className={`px-3 py-1.5 rounded-lg text-white text-xs font-semibold ${pendientes === 0 ? "bg-gray-300 cursor-not-allowed" : "bg-violet-600 hover:bg-violet-700"}`}>{pendientes === 0 ? "✅ Cargado" : "📥 Cargar a Compras"}</button>
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

          {/* Datos de venta (salen en la factura) */}
          {tab === "venta" && <div className="border border-gray-200 rounded-lg p-3">
            <div className="text-[11px] font-bold text-gray-400 uppercase mb-2">🚚 Datos de venta (se imprimen en la factura)</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-gray-500">Condiciones de Venta
                <input value={dv.condiciones_venta} onChange={(e) => setDv({ ...dv, condiciones_venta: e.target.value })} placeholder="Ej: Anticipado / Contado / 30 días" className="block w-full border border-gray-300 rounded px-2 py-1 text-sm" /></label>
              <label className="text-[11px] text-gray-500">Forma de Pago
                <input value={dv.forma_pago} onChange={(e) => setDv({ ...dv, forma_pago: e.target.value })} placeholder="Ej: Transferencia / Efectivo" className="block w-full border border-gray-300 rounded px-2 py-1 text-sm" /></label>
              <label className="text-[11px] text-gray-500 col-span-2">Lugar de Entrega
                <input value={dv.lugar_entrega} onChange={(e) => setDv({ ...dv, lugar_entrega: e.target.value })} placeholder="Ej: Transporte indicado y flete a cargo del cliente" className="block w-full border border-gray-300 rounded px-2 py-1 text-sm" /></label>
              <label className="text-[11px] text-gray-500 col-span-2">Tipo de Transporte
                <input value={dv.tipo_transporte} onChange={(e) => setDv({ ...dv, tipo_transporte: e.target.value })} placeholder="Ej: De Terceros - Expreso XYZ (011) …" className="block w-full border border-gray-300 rounded px-2 py-1 text-sm" /></label>
            </div>
            <div className="flex justify-end mt-2">
              <button disabled={busy} onClick={() => accion({ accion: "datos_venta", datos_venta: dv })} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm hover:bg-gray-50">💾 Guardar datos de venta</button>
            </div>
          </div>}

          {/* Datos de envío del cliente */}
          {tab === "envio" && (() => {
            const env = envioCli;
            const completo = envioCompleto;
            const link = `https://visor.febecos.com/envio/${ped.public_token || ""}`;
            const tieneAlgo = !!(env.nombre || env.direccion || env.localidad || env.provincia || env.empresa);
            return (
              <div className="border border-gray-200 rounded-lg p-3">
                <div className="text-[11px] font-bold text-gray-400 uppercase mb-2">📦 Datos de envío {completo ? <span className="text-emerald-600">· ✅ completos</span> : <span className="text-amber-600">· ⏳ pendientes</span>}</div>
                {tieneAlgo ? (
                  <div className="text-xs text-gray-700 mb-2 leading-relaxed bg-gray-50 border border-gray-100 rounded-lg p-2.5">
                    <b>{env.nombre || "—"}</b>{env.dni ? ` · ${env.dni}` : ""}<br />
                    {env.direccion || "(sin dirección)"}{[env.localidad, env.provincia, env.cp].filter(Boolean).length ? " · " + [env.localidad, env.provincia, env.cp && `(${env.cp})`].filter(Boolean).join(", ") : ""}<br />
                    {[env.telefono, env.email].filter(Boolean).join(" · ")}
                    {(env.empresa || env.tipo_envio) && <><br />🚚 {[env.empresa, env.tipo_envio].filter(Boolean).join(" · ")}</>}
                    {(env.domicilio_transporte || env.telefono_transporte) && <><br /><span className="text-gray-400">{[env.domicilio_transporte, env.telefono_transporte].filter(Boolean).join(" · ")}</span></>}
                  </div>
                ) : (
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-2">⏳ Este cliente todavía no tiene datos de envío cargados. Cargalos en su ficha (CRM › Datos Envíos) o enviale el link para que los complete.</div>
                )}
                {!completo && tieneAlgo && <div className="text-[11px] text-amber-600 mb-2">Falta: {["nombre","direccion","localidad","provincia"].filter((k)=>!String((env as any)[k]||"").trim()).map((k)=>({nombre:"destinatario",direccion:"dirección",localidad:"localidad",provincia:"provincia"} as any)[k]).join(", ")}.</div>}

                {/* Valor declarado para el transporte — propio del pedido (lo indica el cliente). */}
                {(() => {
                  const netoUsd = Number(tot.neto) || 0;
                  const ivaUsd = tot.iva != null ? Number(tot.iva) : Math.max(0, (Number(tot.total) || 0) - netoUsd);
                  const totalUsd = netoUsd + ivaUsd;
                  return (
                    <div className="bg-blue-50/40 border border-blue-100 rounded-lg p-2.5 mb-2">
                      <div className="text-[11px] font-bold text-gray-500 uppercase mb-1.5">💰 Valor declarado (transporte)</div>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-600 mb-2">
                        <span>Neto del pedido: <b>{money(netoUsd)}</b></span>
                        <span>Con IVA: <b>{money(totalUsd)}</b></span>
                      </div>
                      <div className="flex items-end gap-2">
                        <label className="text-[11px] text-gray-500">Monto declarado por el cliente ($)
                          <input value={valorDecl} onChange={(e) => setValorDecl(e.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal" placeholder="0" className="block mt-0.5 w-40 border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
                        </label>
                        <button type="button" onClick={() => setValorDecl(String(Math.round(totalUsd * (enP ? tcMostrar : 1))))} className="px-2.5 py-1.5 rounded-lg border border-gray-300 text-[11px] hover:bg-gray-50" title="Usar el total con IVA del pedido">= Total c/IVA</button>
                        <button disabled={busy} onClick={() => accion({ accion: "valor_declarado", valor_declarado: valorDecl })} className="px-3 py-1.5 rounded-lg border border-febo-azul text-febo-azul text-sm font-semibold hover:bg-blue-50">💾 Guardar</button>
                      </div>
                    </div>
                  );
                })()}
                <div className="flex flex-wrap gap-2">
                  <button disabled={!ped.public_token} onClick={() => { navigator.clipboard.writeText(link); alert("Link copiado:\n" + link); }} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm hover:bg-gray-50">🔗 Copiar link para el cliente</button>
                  {ped.public_token && <a href={link} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm hover:bg-gray-50">✏️ Abrir formulario</a>}
                  {emailCli && <button disabled={busy} onClick={() => accion({ accion: "pedir_envio", email: emailCli, link })} className="px-3 py-1.5 rounded-lg border border-febo-azul text-febo-azul text-sm font-semibold hover:bg-blue-50">✉️ Enviar link al cliente</button>}
                </div>
                <div className="text-[11px] text-gray-400 mt-1">Los datos de envío se administran en la <b>ficha del cliente</b> (CRM › Datos Envíos) — acá se muestran de solo lectura. El cliente también puede cargarlos desde el link.</div>

                {/* Remito / Despacho — se habilita SOLO con los datos de envío validados (+ facturado + pagado) */}
                <div className="mt-4 pt-3 border-t border-gray-100">
                  <div className="text-[11px] font-bold text-gray-400 uppercase mb-2">📦 Remito / Despacho</div>
                  {pl.remito_numero ? (
                    <div className="text-sm text-gray-700 flex flex-wrap items-center gap-2">
                      <span>✅ Despachado · Remito <b>{pl.remito_numero}</b></span>
                      {pl.remito_token && <a href={`/p/${pl.remito_token}?admin=1`} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg border border-violet-300 text-violet-700 text-sm font-semibold hover:bg-violet-50">📦 Ver remito</a>}
                    </div>
                  ) : (() => {
                    const faltan = [!completo && "cargar los datos de envío del cliente", !facturado && "facturar", !pagadoOk && "registrar el pago"].filter(Boolean);
                    const habil = completo && facturado && pagadoOk;
                    return (
                      <div className="space-y-2">
                        {faltan.length > 0 && <div className="text-xs text-amber-600">Para generar el remito primero: {faltan.join(" · ")}.</div>}
                        <button disabled={busy || !habil}
                          title={habil ? "Generar remito y marcar despachado" : "Faltan pasos: " + faltan.join(", ")}
                          onClick={() => accion({ accion: "remitir" }, "¿Generar el REMITO y marcar el pedido como despachado?")}
                          className={`px-4 py-2 rounded-lg text-sm font-semibold ${habil ? "bg-violet-500 text-white hover:bg-violet-600" : "border border-gray-200 text-gray-300 cursor-not-allowed"}`}>📦 Generar remito y despachar</button>
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })()}

          {/* Nota interna (solapa Cliente) */}
          {tab === "cliente" && <div>
            <div className="text-[11px] font-bold text-gray-400 uppercase mb-1">Nota interna</div>
            <div className="flex gap-2">
              <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Observación interna…" className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              <button disabled={busy} onClick={() => accion({ accion: "nota", nota })} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm hover:bg-gray-50">💾 Nota</button>
            </div>
          </div>}

          {/* === SOLAPA FACTURA === */}
          {tab === "factura" && !cancelado && (
            <div className="border border-gray-200 rounded-lg p-3">
              <div className="text-[11px] font-bold text-gray-400 uppercase mb-2">📄 Factura</div>
              {!ped.factura_numero && (
                <div className="mb-3 rounded-lg border border-violet-200 bg-violet-50/40 p-2.5">
                  <label className="block text-[11px] font-semibold text-violet-700 mb-1">FACTURAR A</label>
                  <select value={receptorId} onChange={(e) => setReceptorId(Number(e.target.value))} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-full bg-white">
                    <option value={0}>{nombreCli} (revendedor)</option>
                    {finales.map((x) => <option key={x.id} value={x.id}>{x.razon_social || x.nombre} — cliente final</option>)}
                  </select>
                  <div className="mt-1.5 text-[11px] text-gray-600">
                    {finalSel
                      ? <>Receptor: <b>{nombreReceptor}</b> · {condCli || "sin cond. fiscal"}{cuitCli ? " · " + cuitCli : ""}</>
                      : <>Receptor: <b>{nombreCli}</b> (el revendedor)</>}
                    {comPct > 0 && <span className="ml-1 text-violet-700 font-semibold">· Comisión {comPct}% = USD {comMonto.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</span>}
                  </div>
                  {finalSel && !condCli && <div className="text-[11px] text-amber-600 mt-1">⚠ Cargá la condición fiscal del cliente final (en su ficha, dentro del revendedor) para poder facturar.</div>}
                </div>
              )}
              {ped.factura_numero ? (
                <div className="text-sm text-gray-700 space-y-2">
                  <div>✅ Factura emitida: <b>{ped.factura_numero}</b></div>
                  {ped.factura_token && <a href={`/p/${ped.factura_token}?admin=1`} target="_blank" rel="noreferrer" className="inline-block px-3 py-2 rounded-lg border border-emerald-300 text-emerald-700 text-sm font-semibold hover:bg-emerald-50">🧾 Ver / Imprimir factura</a>}
                </div>
              ) : borrador ? (
                <div className="text-sm text-gray-700 space-y-2 rounded-lg border border-amber-300 bg-amber-50/60 p-2.5">
                  <div className="font-semibold text-amber-800">🧾 Facturada en gestión (borrador)</div>
                  <div className="text-xs text-amber-700">Falta el <b>paso 2</b>: autorizar y enviar a ARCA para obtener el CAE. Hasta entonces NO es una factura fiscal válida y no mueve cuenta corriente.</div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button onClick={() => setArcaOpen(true)} className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">📡 Autorizar y enviar a ARCA</button>
                    {ped.factura_token && <a href={`/p/${ped.factura_token}?admin=1`} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm font-semibold hover:bg-white">👁 Ver borrador</a>}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-600 space-y-2">
                  <div>Todavía no se facturó este pedido.</div>
                  <ul className="text-xs text-gray-500 list-disc pl-4 space-y-0.5">
                    <li>{ped.proveedor_confirmado ? "✓" : "○"} Stock confirmado con el proveedor</li>
                    <li>{condCli ? "✓" : "○"} Condición fiscal del cliente {letraReq ? `→ Factura ${letraReq}` : ""}</li>
                    <li>{talsLetra.length > 0 ? "✓" : "○"} Talonario de Factura {letraReq || ""} cargado</li>
                    <li className="text-gray-400">{pagoCubierto ? "✓ Pago recibido = total (saldo 0)" : "○ Pago — opcional: se puede facturar antes de cobrar (queda saldo en cta cte)"}</li>
                  </ul>
                  <div className="text-xs text-gray-500">Cuando esté todo, usá el botón <b>Facturar</b> de abajo. Elegís talonario y moneda ahí mismo.</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer acciones */}
        <div className="border-t border-gray-200 p-3 flex flex-wrap gap-2 justify-end bg-gray-50 rounded-b-xl">
          <button onClick={() => setPesos(!pesos)} disabled={!dolar} title={dolar ? `TC $${dolar}` : "sin TC"} className="px-3 py-2 rounded-lg border border-gray-300 text-sm hover:bg-white">🔁 {enP ? "Ver USD" : "Ver $ ARS"}</button>
          <a href={`/pedido-prep/${encodeURIComponent(refId)}?print=1`} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-lg border border-gray-300 text-sm font-semibold hover:bg-white">🖨 Imprimir pedido</a>
          {ped.factura_numero
            ? <a href={`/p/${ped.factura_token}?admin=1`} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-lg border border-emerald-300 text-emerald-700 text-sm font-semibold hover:bg-emerald-50">🧾 Ver {ped.factura_numero}</a>
            : borrador
            ? <div className="flex items-center gap-1">
                {ped.factura_token && <a href={`/p/${ped.factura_token}?admin=1`} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm font-semibold hover:bg-white">👁 Borrador</a>}
                <button onClick={() => setArcaOpen(true)} className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">📡 Autorizar y enviar a ARCA</button>
              </div>
            : <div className="flex items-center gap-1">
                {puedeFacturar && talsLetra.length > 0 && <select value={talEfectivo} onChange={(e) => setTalSel(e.target.value)} title="Talonario" className="border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white">
                  {talsLetra.map((t) => <option key={t.id} value={t.id}>{t.tipo_nombre} · {String(t.sucursal || "1").replace(/\D/g, "").padStart(5, "0")}-{String(t.proximo_numero).padStart(8, "0")}{t.defecto ? " ★" : ""}</option>)}
                </select>}
                {puedeFacturar && <select value={facMoneda} onChange={(e) => setFacMoneda(e.target.value)} title="Moneda de la factura" className="border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white"><option value="USD">USD</option><option value="ARS">$ Pesos</option></select>}
                {puedeFacturar && facMoneda === "ARS" && <input type="number" value={facTc} onChange={(e) => setFacTc(e.target.value)} placeholder={"TC " + (dolar || "")} title="Tipo de cambio (editable)" className="border border-gray-300 rounded-lg px-2 py-2 text-sm w-24" />}
                <button disabled={busy} onClick={revisar} title="Revisión previa: muestra letra, condición IVA del receptor, neto, IVA por alícuota y total SIN emitir CAE. Para validar los cálculos antes de facturar." className="px-3 py-2 rounded-lg border border-blue-300 text-blue-700 text-sm font-semibold hover:bg-blue-50">🔍 Revisar</button>
                <button disabled={busy || !puedeFacturar}
                  title={cancelado ? "Pedido cancelado" : !ped.proveedor_confirmado ? "Confirmá el stock con el proveedor antes de facturar" : !letraReq ? "El cliente no tiene condición fiscal: cargala en Detalle/ficha del cliente" : talsLetra.length === 0 ? `No hay talonario de Factura ${letraReq} cargado (Configuración → Talonarios)` : !pagoCubierto ? "Falta que el pago recibido cubra el total exacto (saldo 0) para poder facturar" : `Facturar ${letraReq} en gestión (paso 1: borrador; después se autoriza a ARCA)`}
                  onClick={() => {
                    const tcUsar = Number(facTc) || dolar || 0;
                    if (facMoneda === "ARS" && !tcUsar) { alert("Ingresá el tipo de cambio para facturar en pesos."); return; }
                    // Desglose que se va a facturar (neto + IVA = total), en la moneda elegida → debe coincidir con el presupuesto.
                    const ars = facMoneda === "ARS";
                    const f$ = (usd: number) => ars ? "$ " + Math.round(usd * tcUsar).toLocaleString("es-AR") : "USD " + usd.toLocaleString("es-AR", { minimumFractionDigits: 2 });
                    const netoP = ars ? Math.round(netoUsdTot * tcUsar) : netoUsdTot;
                    const ivaP = ars ? Math.round(ivaUsdTot * tcUsar) : ivaUsdTot;
                    const totalP = ars ? "$ " + (netoP + ivaP).toLocaleString("es-AR") : "USD " + totalUsdReal.toLocaleString("es-AR", { minimumFractionDigits: 2 });
                    // Recomendación de carga: avisar si el presupuesto NO trae TC pactado (se usa el dólar del día → puede diferir).
                    const sinTcPactado = ars && !Number(tot.tc);
                    const aviso = sinTcPactado ? `\\n\\n⚠️ Este presupuesto no tiene TC pactado: se factura al dólar del día (${tcUsar}). Recomendado: fijar el TC en el presupuesto para que NO cambie entre cotizar y facturar.` : "";
                    accion({ accion: "facturar", talonario_id: talEfectivo ? Number(talEfectivo) : undefined, moneda: facMoneda, tc: ars ? tcUsar : undefined, receptor_cliente_id: receptorId || undefined },
                      `¿Facturar la ${letraReq} en GESTIÓN a ${nombreReceptor} en ${ars ? "PESOS (TC " + tcUsar + ")" : "USD"}?\\n\\nNeto: ${f$(netoUsdTot)}\\nIVA: ${f$(ivaUsdTot)}\\nTOTAL: ${totalP}\\n(coincide con el presupuesto)${aviso}\\n\\nQueda como BORRADOR. Después la autorizás y enviás a ARCA (paso 2) para el CAE.`); }}
                  className={`px-3 py-2 rounded-lg text-sm font-semibold ${puedeFacturar ? "border border-emerald-400 text-emerald-700 hover:bg-emerald-50" : "border border-gray-200 text-gray-300 cursor-not-allowed"}`}>🧾 Facturar en gestión{letraReq ? " " + letraReq : ""}</button>
              </div>}
          {ped.estado === "pendiente_confirmacion" && <>
            <button disabled={busy} onClick={() => accion({ accion: "estado", estado: "cancelado" }, "¿Rechazar el pedido?")} className="px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-semibold hover:bg-red-600">✕ Rechazar</button>
            <button disabled={busy || !ped.proveedor_confirmado} title={ped.proveedor_confirmado ? "" : "Primero confirmá el stock con el proveedor"} onClick={aprobar} className={`px-4 py-2 rounded-lg text-white text-sm font-semibold ${ped.proveedor_confirmado ? "bg-emerald-500 hover:bg-emerald-600" : "bg-gray-300 cursor-not-allowed"}`}>✅ Aprobar pedido</button>
          </>}
          {(ped.estado === "aprobado" || (ped.estado === "pagado" && pagosRec.length === 0)) && <button disabled={busy} onClick={() => setAvisarPagoOpen(true)} title="Confirma al cliente que su pago está OK (email desde administración) y marca el pedido como pagado" className="px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600">✅ Avisar pago OK al cliente</button>}
          {ped.estado === "pagado" && pagosRec.length > 0 && <button disabled={busy} onClick={() => accion({ accion: "estado", estado: "enviado" }, "¿Marcar como enviado?")} className="px-4 py-2 rounded-lg bg-violet-500 text-white text-sm font-semibold hover:bg-violet-600">📦 Marcar enviado</button>}
          {ped.es_ultimo && !facturado && !despachado && !pagadoOk && !ped.proveedor_confirmado && !["cancelado", "anulado"].includes(ped.estado) &&
            <button disabled={busy} onClick={revertir} title="Deshacer: borra el último pedido (sin pasos iniciados), libera el número y devuelve el presupuesto a Presupuestos" className="px-4 py-2 rounded-lg border border-amber-400 text-amber-700 text-sm font-semibold hover:bg-amber-50">↩ Revertir pedido</button>}
        </div>
      </div>
      {preview && <RevisionFacturaModal data={preview} onClose={() => setPreview(null)} />}
      {arcaOpen && <AutorizarArcaModal refId={refId} onClose={() => setArcaOpen(false)} onDone={() => { setArcaOpen(false); load(); onChanged(); }} />}
      {avisarPagoOpen && <AvisarPagoModal refId={refId} defaultEmail={emailCli} onClose={() => setAvisarPagoOpen(false)} onDone={() => { setAvisarPagoOpen(false); load(); onChanged(); }} />}
    </div>
  );
}

// Avisar al cliente que el PAGO está OK. Email editable SOLO PARA PRUEBAS (prefill del cliente)
// para poder ver el contenido del mail. El email sale desde administración (selector).
function AvisarPagoModal({ refId, defaultEmail, onClose, onDone }: { refId: string; defaultEmail: string; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState(defaultEmail || "");
  const [busy, setBusy] = useState(false);
  const enviar = async () => {
    if (!email.includes("@")) { alert("Ingresá un email válido."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/pedidos/" + encodeURIComponent(refId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "avisar_pago", email: email.trim() }) });
      const d = await safeJson(r); if (!d.ok) throw new Error(d.error);
      const av = d.aviso_cliente;
      if (av?.ok) alert("✅ Pedido marcado como pagado y aviso de pago OK enviado a " + email.trim());
      else alert("✅ Pedido marcado como pagado, pero el email NO salió:\n" + (av?.error || "error") + "\n\nRevisá el email.");
      onDone();
    } catch (e: any) { alert("Error: " + e.message); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[140] bg-black/50 flex items-start justify-center py-12 px-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-[440px] max-w-[94vw] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="bg-blue-600 text-white rounded-t-xl px-5 py-3 flex items-center justify-between">
          <div className="font-bold">✅ Avisar pago OK · {refId}</div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <div className="text-xs text-gray-600">Se le confirma al cliente que su <b>pago está OK</b> (email desde administración) y el pedido se marca como <b>pagado</b>.</div>
          <div>
            <label className="block text-[10px] uppercase text-gray-400 font-semibold mb-0.5">Email destinatario</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="cliente@email.com" />
            <div className="text-[11px] text-amber-600 mt-1">✏️ Trae el email del cliente. Editable <b>solo para pruebas</b> (poné el tuyo para ver el contenido del mail). En producción va al cliente.</div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm">Cancelar</button>
            <button disabled={busy} onClick={enviar} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50">{busy ? "Enviando…" : "✅ Avisar y marcar pagado"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Ayudas para los códigos de error más comunes de WSFE/ARCA (el mensaje oficial de ARCA
// siempre se muestra; esto es una pista extra). Ampliar a medida que aparezcan casos reales.
const ARCA_HINTS: Record<string, string> = {
  "501": "Servicio de AFIP no disponible momentáneamente — reintentá en unos minutos.",
  "600": "Error de autenticación con AFIP (Token/Sign WSAA) — revisar certificado/credenciales.",
  "10015": "El punto de venta no está habilitado para factura electrónica en ARCA.",
  "10016": "Revisá la fecha del comprobante (no puede diferir de la fecha actual más de lo permitido).",
  "10018": "Problema con la numeración del comprobante (correlatividad).",
  "10048": "Falta o es inválida la condición frente al IVA del receptor.",
};

// Paso 2: ventana de proceso de AUTORIZACIÓN a ARCA. Muestra los pasos en vivo y, si ARCA
// no responde / rechaza, un cartel claro "ARCA tiene un problema" con opción de reintentar.
function AutorizarArcaModal({ refId, onClose, onDone }: { refId: string; onClose: () => void; onDone: () => void }) {
  const PASOS = ["Preparando el comprobante", "Conectando con ARCA (WSAA)", "Solicitando el CAE a ARCA", "Registrando la factura"];
  const [fase, setFase] = useState(0);           // paso animado actual
  const [estado, setEstado] = useState<"idle" | "run" | "ok" | "error">("idle");
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string>("");
  const [arcaCaida, setArcaCaida] = useState(false);
  const [rechazo, setRechazo] = useState(false);
  const [detalle, setDetalle] = useState<{ code: string; msg: string }[]>([]); // errores/observaciones de ARCA con código

  const emitir = useCallback(async () => {
    setEstado("run"); setErr(""); setArcaCaida(false); setRechazo(false); setDetalle([]); setRes(null); setFase(0);
    // Animación de pasos mientras el request está en vuelo (la emisión real es un solo POST).
    const tick = setInterval(() => setFase((f) => Math.min(f + 1, PASOS.length - 1)), 900);
    try {
      const r = await fetch("/api/pedidos/" + encodeURIComponent(refId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "autorizar_arca" }) });
      const d = await safeJson(r);
      clearInterval(tick);
      if (d.ok) { setFase(PASOS.length); setRes(d); setEstado("ok"); }
      else {
        setArcaCaida(!!d.arca_caida); setRechazo(!!d.arca_rechazo);
        setDetalle([...(d.errores || []), ...(d.observaciones || [])]);
        setErr(d.error || "No se pudo autorizar"); setEstado("error");
      }
    } catch (e: any) { clearInterval(tick); setArcaCaida(true); setErr("No se pudo conectar: " + e.message); setEstado("error"); }
  }, [refId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { emitir(); }, [emitir]);

  return (
    <div className="fixed inset-0 z-[145] bg-black/50 flex items-start justify-center py-10 px-4" onClick={() => estado !== "run" && onClose()}>
      <div className="bg-white rounded-xl w-[460px] max-w-[94vw] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="bg-blue-600 text-white rounded-t-xl px-5 py-3 flex items-center justify-between">
          <div className="font-bold">📡 Autorización ARCA · {refId}</div>
          {estado !== "run" && <button onClick={onClose} className="text-white/80 hover:text-white text-xl">✕</button>}
        </div>
        <div className="p-5 space-y-3 text-sm">
          {estado === "error" && arcaCaida && (
            <div className="rounded-lg bg-red-50 border border-red-300 p-3">
              <div className="font-bold text-red-700">⚠️ ARCA tiene un problema</div>
              <div className="text-xs text-red-700 mt-1">ARCA no respondió (servicio caído o sin conexión). El borrador quedó guardado: <b>reintentá en unos minutos</b> sin perder nada.</div>
              {err && <div className="text-[11px] text-red-500 mt-1 break-words">Detalle: {err}</div>}
            </div>
          )}
          {estado === "error" && rechazo && (
            <div className="rounded-lg bg-rose-50 border border-rose-300 p-3">
              <div className="font-bold text-rose-700">❌ ARCA rechazó la factura</div>
              <div className="text-xs text-rose-700 mt-1">Hay un <b>dato a corregir</b>: reintentar tal cual no alcanza. Códigos que devolvió ARCA:</div>
              {detalle.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {detalle.map((x, i) => (
                    <li key={i} className="text-xs bg-white border border-rose-200 rounded px-2 py-1">
                      {x.code && <span className="font-mono font-semibold text-rose-700 mr-1">[{x.code}]</span>}<span className="text-gray-700">{x.msg}</span>
                      {ARCA_HINTS[x.code] && <div className="text-[11px] text-gray-500 mt-0.5">💡 {ARCA_HINTS[x.code]}</div>}
                    </li>
                  ))}
                </ul>
              ) : <div className="text-[11px] text-rose-500 mt-1 break-words">{err}</div>}
            </div>
          )}
          {estado === "error" && !arcaCaida && !rechazo && (
            <div className="rounded-lg bg-amber-50 border border-amber-300 p-3 text-amber-800"><div className="font-semibold">No se pudo autorizar</div><div className="text-xs mt-1 break-words">{err}</div></div>
          )}

          <ul className="space-y-1.5">
            {PASOS.map((p, i) => {
              const done = estado === "ok" ? true : i < fase;
              const cur = estado === "run" && i === fase;
              const failed = estado === "error" && i === fase;
              return (
                <li key={i} className="flex items-center gap-2">
                  <span className={`w-5 text-center ${done ? "text-emerald-600" : failed ? "text-red-600" : cur ? "text-blue-600" : "text-gray-300"}`}>{done ? "✓" : failed ? "✕" : cur ? "●" : "○"}</span>
                  <span className={done ? "text-gray-700" : failed ? "text-red-700" : cur ? "text-blue-700 font-medium" : "text-gray-400"}>{p}{cur && "…"}</span>
                </li>
              );
            })}
          </ul>

          {estado === "ok" && res && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-300 p-3 text-emerald-800">
              <div className="font-bold">✅ Factura autorizada por ARCA</div>
              <div className="text-sm mt-1"><b>{res.factura_numero}</b></div>
              <div className="text-xs">CAE: {res.cae || "—"}{res.cae_vto ? ` · Vto ${res.cae_vto}` : ""}</div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            {estado === "error" && <button onClick={emitir} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">🔁 Reintentar</button>}
            {estado === "ok"
              ? <button onClick={onDone} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700">Listo</button>
              : estado !== "run" && <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm">Cerrar</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

// Modal de REVISIÓN PREVIA de factura (dry-run): muestra todo lo que se va a facturar sin emitir CAE.
function RevisionFacturaModal({ data, onClose }: { data: any; onClose: () => void }) {
  const m = data.montos || {}; const r = data.receptor || {}; const t = data.talonario || {};
  const esARS = data.moneda === "ARS";
  const fmt = (n: number) => (esARS ? "$ " : "USD ") + Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const PCT: Record<number, string> = { 3: "0%", 4: "10,5%", 5: "21%", 6: "27%", 8: "5%", 9: "2,5%" };
  return (
    <div className="fixed inset-0 z-[140] bg-black/50 flex items-start justify-center py-8 px-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-[560px] max-w-[96vw] shadow-2xl max-h-[88vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="bg-blue-600 text-white rounded-t-xl px-5 py-3 flex items-center justify-between sticky top-0">
          <div className="font-bold">🔍 Revisión de factura · {data.ref}</div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <div className="text-[11px] text-gray-500 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">Esto es una <b>previsualización</b>. No se emite ningún CAE ni se guarda nada. Verificá los cálculos antes de facturar.</div>

          {data.bloqueos?.length > 0 && <div className="rounded-lg bg-red-50 border border-red-200 p-2.5"><div className="font-semibold text-red-700 text-xs mb-1">⛔ No se puede facturar todavía:</div><ul className="list-disc pl-4 text-xs text-red-700 space-y-0.5">{data.bloqueos.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></div>}
          {data.avisos?.length > 0 && <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-700">{data.avisos.map((x: string, i: number) => <div key={i}>⚠️ {x}</div>)}</div>}
          {data.puede_facturar && <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-xs text-emerald-700 font-semibold">✓ Todo OK para emitir la Factura {data.letra}.</div>}

          <div className="grid grid-cols-2 gap-3">
            <div className="border border-gray-200 rounded-lg p-2.5">
              <div className="text-[10px] uppercase text-gray-400 font-semibold mb-1">Receptor</div>
              <div className="font-semibold">{r.nombre || "—"}{r.es_cliente_final && <span className="ml-1 text-[10px] bg-violet-100 text-violet-700 rounded px-1">cliente final</span>}</div>
              <div className="text-xs text-gray-600">{r.cuit ? "CUIT " + r.cuit : "sin CUIT"}{r.doc_tipo ? ` · doc AFIP ${r.doc_tipo}` : ""}</div>
              <div className="text-xs mt-0.5">Cond. fiscal: <b className={r.condicion_fiscal ? "text-gray-700" : "text-red-600"}>{r.condicion_fiscal || "NO CARGADA"}</b></div>
              <div className="text-xs text-gray-500">Cond. IVA receptor (AFIP): {data.condicion_iva_receptor_id ?? "—"} {data.condicion_iva_receptor_txt ? `· ${data.condicion_iva_receptor_txt}` : ""}</div>
            </div>
            <div className="border border-gray-200 rounded-lg p-2.5">
              <div className="text-[10px] uppercase text-gray-400 font-semibold mb-1">Comprobante</div>
              <div className="font-semibold">Factura {data.letra || "—"}</div>
              <div className="text-xs text-gray-600">{t ? <>Talonario {t.tipo_codigo} · PV {String(t.punto_venta).padStart(5, "0")} · {t.electronica ? "electrónica (CAE)" : "manual"}</> : "sin talonario"}</div>
              <div className="text-xs mt-0.5">Moneda: <b>{data.moneda}</b>{esARS && data.tc ? ` · TC ${data.tc}` : ""}</div>
            </div>
          </div>

          {data.arca?.consultado && <div className={`text-[11px] rounded-lg px-3 py-2 ${data.arca.persistida ? "bg-emerald-50 border border-emerald-200 text-emerald-700" : "bg-gray-50 border border-gray-200 text-gray-500"}`}>{data.arca.persistida ? `✓ Condición fiscal cargada automáticamente desde ARCA: ${data.arca.condicion_fiscal}` : `ARCA: ${data.arca.nota || "sin condición IVA"}`}</div>}

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-[11px] uppercase"><tr><th className="text-left px-3 py-1.5">Alícuota</th><th className="text-right px-3 py-1.5">Base imponible</th><th className="text-right px-3 py-1.5">IVA</th></tr></thead>
              <tbody>
                {m.es_factura_c ? <tr><td colSpan={3} className="px-3 py-2 text-center text-gray-500 text-xs">Factura C — no discrimina IVA</td></tr>
                  : (m.iva || []).length ? (m.iva || []).map((x: any, i: number) => <tr key={i} className="border-t border-gray-100"><td className="px-3 py-1.5">{PCT[x.id] || x.id}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(x.base)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(x.importe)}</td></tr>)
                    : <tr><td colSpan={3} className="px-3 py-2 text-center text-gray-400 text-xs">sin alícuotas</td></tr>}
              </tbody>
              <tfoot className="bg-gray-50 text-xs font-semibold">
                <tr className="border-t border-gray-200"><td className="px-3 py-1.5">Neto gravado</td><td className="px-3 py-1.5 text-right tabular-nums" colSpan={2}>{fmt(m.neto)}</td></tr>
                <tr><td className="px-3 py-1.5">IVA total</td><td className="px-3 py-1.5 text-right tabular-nums" colSpan={2}>{fmt(m.imp_iva)}</td></tr>
                <tr className="border-t border-gray-200 text-blue-700 text-sm"><td className="px-3 py-2">TOTAL</td><td className="px-3 py-2 text-right tabular-nums" colSpan={2}>{fmt(m.total)}</td></tr>
              </tfoot>
            </table>
          </div>

          {data.leyendas?.length > 0 && <div className="text-[11px] text-gray-500"><b>Leyendas:</b> {Array.isArray(data.leyendas) ? data.leyendas.join(" · ") : String(data.leyendas)}</div>}
          <div className="flex justify-end"><button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm">Cerrar</button></div>
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
  const { openFicha } = useWindows();
  const [rows, setRows] = useState<any[]>([]); const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(0);
  const cargar = () => { setLoading(true); fetch("/api/ventas?tipo=" + tipo).then(safeJson).then((d) => { setRows(d.ok ? d.comprobantes : []); setLoading(false); }); };
  useEffect(() => { cargar(); }, [tipo]);
  const emitirNota = async (c: any, clase: "nota_credito" | "nota_debito") => {
    const nom = clase === "nota_credito" ? "Nota de Crédito" : "Nota de Débito";
    if (!confirm(`¿Emitir ${nom} (electrónica, con CAE) por el total de ${c.numero}?\nReferencia la factura original ante AFIP.`)) return;
    const motivo = prompt(`Motivo de la ${nom} (opcional):`, "") || "";
    setBusy(c.id);
    try {
      const r = await fetch(`/api/ventas/${c.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: clase, motivo }) });
      const d = await safeJson(r);
      if (d.ok) { alert(`✅ ${nom} emitida: ${d.numero}\nCAE: ${d.cae}`); if (d.token) window.open(`/p/${d.token}?admin=1`, "_blank"); cargar(); }
      else alert("⚠️ " + (d.error || "No se pudo emitir"));
    } catch (e: any) { alert("Error: " + e.message); } finally { setBusy(0); }
  };
  const esFactura = tipo === "factura";
  return (
    <Tabla loading={loading} count={rows.length} unidad={titulo.toLowerCase()}
      cols={["Número", "Cliente", "Estado", "Fecha", "Total", ""]} vacio={`Todavía no hay ${titulo.toLowerCase()} (se generan desde un pedido).`}>
      {rows.map((c) => (
        <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
          <td className="px-4 py-2 font-semibold">{c.numero}</td>
          <td className="px-4 py-2">{titleCase(c.cliente_nombre) || "—"}</td>
          <td className="px-4 py-2">{chip(c.estado || "—", EST_COL[c.estado] || "#888")}</td>
          <td className="px-4 py-2 text-gray-600">{fmtF(c.fecha)}</td>
          <td className="px-4 py-2 text-right font-semibold">{fmt(c.total)}</td>
          <td className="px-4 py-2 text-right whitespace-nowrap">
            {c.cliente_id && <button onClick={() => openFicha(c.cliente_id as number, "operaciones")} title="Ver cliente en el CRM (ventas y cuenta)" className="text-gray-400 hover:text-febo-azul mr-2">👤</button>}
            {c.token && <a href={`/p/${c.token}?admin=1`} target="_blank" rel="noreferrer" className="text-febo-azul hover:underline text-xs font-semibold">🧾 Ver</a>}
            {esFactura && c.afip_cae && (() => {
              const notas: any[] = Array.isArray(c.notas) ? c.notas : [];
              const nc = notas.find((n) => n.tipo === "nota_credito");
              const nd = notas.find((n) => n.tipo === "nota_debito");
              return (
                <>
                  {nc
                    ? <a href={`/p/${nc.token}?admin=1`} target="_blank" rel="noreferrer" title={`Ver ${nc.numero}`} className="ml-2 text-xs font-semibold text-rose-600 hover:underline">↩️ NC</a>
                    : <button disabled={busy === c.id} onClick={() => emitirNota(c, "nota_credito")} title="Emitir Nota de Crédito electrónica" className="ml-2 text-xs font-semibold text-rose-600 hover:underline disabled:opacity-40">{busy === c.id ? "…" : "NC"}</button>}
                  {nd
                    ? <a href={`/p/${nd.token}?admin=1`} target="_blank" rel="noreferrer" title={`Ver ${nd.numero}`} className="ml-2 text-xs font-semibold text-amber-600 hover:underline">↪️ ND</a>
                    : <button disabled={busy === c.id} onClick={() => emitirNota(c, "nota_debito")} title="Emitir Nota de Débito electrónica" className="ml-2 text-xs font-semibold text-amber-600 hover:underline disabled:opacity-40">{busy === c.id ? "…" : "ND"}</button>}
                </>
              );
            })()}
          </td>
        </tr>
      ))}
    </Tabla>
  );
}

// ---------- PAGOS (fg_pagos) ----------
function Pagos() {
  const [rows, setRows] = useState<any[]>([]); const [loading, setLoading] = useState(true);
  useEffect(() => { fetch("/api/pagos").then(safeJson).then((d) => { setRows(d.ok ? d.pagos : []); setLoading(false); }); }, []);
  return (
    <Tabla loading={loading} count={rows.length} unidad="pagos"
      cols={["Comprobante", "Cliente", "Medio", "Fecha", "Monto"]} vacio="Todavía no hay pagos registrados.">
      {rows.map((p) => (
        <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
          <td className="px-4 py-2 font-semibold">{p.comprobante_numero || "—"}</td>
          <td className="px-4 py-2">{titleCase(p.cliente_nombre) || "—"}</td>
          <td className="px-4 py-2 text-gray-600">{p.medio || "—"}</td>
          <td className="px-4 py-2 text-gray-600">{fmtF(p.fecha)}</td>
          <td className="px-4 py-2 text-right font-semibold text-emerald-600">{fmt(p.monto)}</td>
        </tr>
      ))}
    </Tabla>
  );
}

// ---------- PEDIDOS A PROVEEDOR (pedidos_proveedores) ----------
// (Pedidos a proveedor se gestionan en Compras/Proveedores — sección removida de Ventas)

// ---------- CUENTAS CORRIENTES (cliente + proveedor, en USD) ----------
function CuentasCorrientes() {
  const [amb, setAmb] = useState<"clientes" | "proveedores">("clientes");
  const [rows, setRows] = useState<any[]>([]); const [loading, setLoading] = useState(true);
  const [dolar, setDolar] = useState(0); const [owner, setOwner] = useState(false);
  const [sel, setSel] = useState<{ tipo: string; key: string | number; nombre: string } | null>(null);
  const load = useCallback(() => { setLoading(true); fetch("/api/ctacte?listar=" + amb).then(safeJson).then((d) => { setRows(d.ok ? d.cuentas : []); setDolar(d.dolar || 0); setLoading(false); }); }, [amb]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch("/api/me").then(safeJson).then((d) => setOwner(!!d.es_owner)).catch(() => {}); }, []);
  const totalSaldo = rows.reduce((a, r) => a + Number(r.saldo || 0), 0);
  const ars = (usd: number) => dolar > 0 ? ` · $ ${Math.round(usd * dolar).toLocaleString("es-AR")}` : "";
  const resetear = async () => {
    if (!confirm("¿PONER EN CERO toda la cuenta corriente (clientes y proveedores)? Esto borra todos los movimientos. Usar solo después de las pruebas.")) return;
    const r = await fetch("/api/ctacte?reset=1", { method: "DELETE" }); const d = await safeJson(r);
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
                <td className="px-4 py-2 font-semibold">{amb === "clientes" ? titleCase(r.nombre) : r.nombre}</td>
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
  const load = useCallback(() => { setLoading(true); fetch("/api/ctacte?" + qs).then(safeJson).then((d) => { setMovs(d.ok ? d.movimientos : []); setSaldo(d.saldo || 0); setDolar(d.dolar || 0); setLoading(false); }); }, [qs]);
  useEffect(() => { load(); }, [load]);
  // Pesos por movimiento al TC pactado del comprobante (factura) o del pago; si no, dólar del día.
  const tcDe = (m: any) => Number(m.comp_tc) || Number(m.detalle?.tc) || dolar || 0;
  const saldoPesos = Math.round(movs.reduce((a, m) => { const v = ((Number(m.debe) || 0) - (Number(m.haber) || 0)) * tcDe(m); return a + (ambito === "cliente" ? v : -v); }, 0));
  const fmt$ = (n: number) => "$ " + Math.round(n).toLocaleString("es-AR");
  let acumP = 0;
  return (
    <div className="fixed inset-0 z-[120] bg-black/50 flex items-stretch justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-[820px] h-full flex flex-col shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="bg-febo-azul text-white rounded-t-xl px-5 py-3 flex items-center justify-between">
          <div><div className="text-lg font-bold">💳 Cta cte · {nombre}</div><div className="text-xs opacity-90">{ambito === "cliente" ? "Cliente" : "Proveedor"} · pesos al TC pactado</div></div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-xl leading-none">✕</button>
        </div>
        <div className="px-5 py-2 border-b border-gray-200 bg-gray-50 text-sm">
          Saldo: <b className={saldoPesos > 1 ? "text-red-600" : "text-emerald-600"}>{fmt$(saldoPesos)}<span className="text-gray-400 font-normal text-xs"> · USD {saldo.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</span></b>
          <span className="text-gray-400 ml-2">{ambito === "cliente" ? (saldoPesos > 1 ? "(nos debe)" : "(al día)") : (saldoPesos > 1 ? "(le debemos)" : "(al día)")}</span>
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
                const tc = tcDe(m); const d = (Number(m.debe) || 0) * tc, h = (Number(m.haber) || 0) * tc;
                acumP += ambito === "cliente" ? (d - h) : (h - d);
                return (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{fmtF(m.fecha)}</td>
                    <td className="px-2 py-1.5">{m.concepto}{m.comprobante && <span className="text-gray-400 ml-1">· {m.comprobante}</span>}{m.pedido_ref && <span className="text-[10px] text-gray-400 ml-1">({m.pedido_ref})</span>}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{d ? fmt$(d) : ""}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{h ? fmt$(h) : ""}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{fmt$(acumP)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="text-[10px] text-gray-400 mt-2 px-2">Importes en pesos al TC pactado de cada comprobante.</div>
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
    fetch("/api/presupuestos/" + id).then(safeJson).then((d) => {
      if (d.ok) { const x = d.presupuesto; setP(x); setF({ descuento_pct: x.descuento_pct ?? "", precio_ofrecido: x.precio_ofrecido ?? "", estado: x.estado || "", cliente_nombre: [x.cliente_nombre, x.cliente_apellido].filter(Boolean).join(" ") || "", cliente_cuit: x.cliente_cuit || "", cliente_email: x.cliente_email || "", cliente_telefono: x.cliente_telefono || "" }); }
    });
  }, [id]);
  useEffect(() => { if (busq.length < 2) { setSug([]); return; } const t = setTimeout(async () => { const r = await fetch("/api/clientes?limit=6&q=" + encodeURIComponent(busq)); const d = await safeJson(r); if (d.ok) setSug(d.clientes); }, 250); return () => clearTimeout(t); }, [busq]);
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  async function guardar() { setSaving(true); try { const r = await fetch("/api/presupuestos/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) }); const d = await safeJson(r); if (!d.ok) throw new Error(d.error); onSaved(); } catch (e: any) { alert("Error: " + e.message); } finally { setSaving(false); } }
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
