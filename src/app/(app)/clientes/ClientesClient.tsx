"use client";
import { useEffect, useState, useCallback } from "react";

type Cliente = {
  id: number; tipo: string; nombre: string; email: string; whatsapp: string;
  cuit: string; provincia: string; localidad: string; razon_social?: string;
  domicilio?: string; cod_postal?: string; condicion_fiscal?: string; notas?: string;
  tags: string[]; origenes: string[]; email_opt_out?: boolean; descuento_pct?: number;
  n_presup?: number; n_pedidos?: number; monto_ars?: number; monto_usd?: number;
  ultimo_contacto_at: string;
};

const ESTADOS = [
  ["contacto", "📇 Contacto (no compró)"], ["cliente_final", "✅ Cliente (compró)"],
  ["revendedor_interesado", "Revendedor interesado"], ["revendedor_manual", "Revendedor manual"],
  ["revendedor", "Revendedor (autorizado)"], ["vendedor_interno", "🏢 Vendedor interno"], ["proveedor", "Proveedor"],
];
const TAGS = [
  ["pocero", "⛏️ Pocero"], ["instalador", "🔧 Instalador"], ["interesado_revender", "Interesado en revender"],
  ["prospecto_curso", "🎓 Prospecto curso"], ["alumno", "Alumno"],
];
const COLORES: Record<string, string> = {
  contacto: "#64748b", cliente_final: "#2563eb", revendedor: "#7c3aed",
  revendedor_interesado: "#a78bfa", revendedor_manual: "#8b5cf6", vendedor_interno: "#0891b2",
  proveedor: "#059669", pocero: "#0d9488", instalador: "#ea580c", prospecto_curso: "#db2777",
};
const fmtMonto = (v: number) => (v ? "$ " + Math.round(v).toLocaleString("es-AR") : "—");
const CAMPOS = ["nombre", "razon_social", "email", "whatsapp", "cuit", "provincia", "localidad", "cod_postal", "domicilio", "condicion_fiscal", "notas", "descuento_pct"] as const;

export default function ClientesClient({ openClienteId, openClienteTab }: { openClienteId?: number; openClienteTab?: "datos" | "operaciones" } = {}) {
  const [rows, setRows] = useState<Cliente[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState(""); const [tipo, setTipo] = useState("");
  const [page, setPage] = useState(1); const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<Cliente | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [verMontos, setVerMontos] = useState(false);
  const limit = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ q, tipo, page: String(page), limit: String(limit) });
      const r = await fetch("/api/clientes?" + p); const d = await r.json();
      if (d.ok) { setRows(d.clientes); setTotal(d.total); }
    } finally { setLoading(false); }
  }, [q, tipo, page]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  // Abrir la ficha de un cliente puntual cuando se entra desde otro módulo (Ventas → 👤)
  useEffect(() => {
    if (!openClienteId) return;
    fetch(`/api/clientes/${openClienteId}`).then((r) => r.json()).then((d) => {
      if (d.ok) setEdit(d.cliente);
    }).catch(() => {});
  }, [openClienteId]);

  async function exportarCSV() {
    const r = await fetch("/api/clientes?limit=99999"); const d = await r.json();
    const cols = ["nombre", "tipo", "email", "whatsapp", "cuit", "provincia", "localidad", "monto_total"];
    const csv = [cols.join(",")].concat(
      (d.clientes || []).map((c: any) => cols.map((k) => `"${String(c[k] ?? "").replace(/"/g, '""')}"`).join(","))
    ).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "clientes-febecos.csv"; a.click();
  }

  const pages = Math.ceil(total / limit) || 1;
  const badge = (t: string) => (
    <span style={{ background: (COLORES[t] || "#888") + "22", color: COLORES[t] || "#888" }} className="rounded px-2 py-0.5 text-[11px] font-semibold">{t}</span>
  );

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} placeholder="Buscar nombre / email / WhatsApp / CUIT…" className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[260px]" />
        <select value={tipo} onChange={(e) => { setPage(1); setTipo(e.target.value); }} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">Todos los tipos</option>
          {ESTADOS.concat(TAGS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span className="text-sm text-gray-500">{total.toLocaleString("es-AR")} contactos</span>
        <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
          <input type="checkbox" checked={verMontos} onChange={(e) => setVerMontos(e.target.checked)} /> 💲 Ver montos
        </label>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setNuevo(true)} className="bg-febo-verde text-white rounded-lg px-3 py-2 text-sm font-semibold">＋ Nuevo cliente</button>
          <button onClick={exportarCSV} className="bg-febo-azul text-white rounded-lg px-3 py-2 text-sm font-semibold">⬇ CSV</button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Nombre</th><th className="text-left px-4 py-3">Email</th><th className="text-left px-4 py-3">WhatsApp</th><th className="text-left px-4 py-3">Tipo</th><th className="text-left px-4 py-3">Provincia</th>
              <th className="text-center px-4 py-3">Presup.</th><th className="text-center px-4 py-3">Pedidos</th>
              {verMontos && <><th className="text-right px-4 py-3">Monto $</th><th className="text-right px-4 py-3">Monto USD</th></>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={verMontos ? 10 : 8} className="text-center py-8 text-gray-400">Cargando…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={verMontos ? 10 : 8} className="text-center py-8 text-gray-400">Sin resultados</td></tr>
            : rows.map((r) => {
              const extra = (r.tags || []).filter((t) => t !== r.tipo && !(r.tipo === "cliente_final" && t === "cliente"));
              return (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => setEdit(r)}>
                  <td className="px-4 py-2 font-semibold">{r.nombre || "—"}</td>
                  <td className="px-4 py-2 text-gray-600">{r.email || "—"}</td>
                  <td className="px-4 py-2 text-gray-600">{r.whatsapp || "—"}</td>
                  <td className="px-4 py-2">{badge(r.tipo || "—")}{extra.length > 0 && <span className="ml-1 text-[10px] text-indigo-500 font-bold">+{extra.length}</span>}</td>
                  <td className="px-4 py-2 text-gray-600">{r.provincia || "—"}</td>
                  <td className="px-4 py-2 text-center">{r.n_presup || 0}</td>
                  <td className="px-4 py-2 text-center font-semibold text-violet-700">{r.n_pedidos || 0}</td>
                  {verMontos && <>
                    <td className="px-4 py-2 text-right font-semibold">{r.monto_ars ? "$ " + Math.round(r.monto_ars).toLocaleString("es-AR") : "—"}</td>
                    <td className="px-4 py-2 text-right font-semibold text-amber-600">{r.monto_usd ? "USD " + Math.round(r.monto_usd).toLocaleString("es-AR") : "—"}</td>
                  </>}
                  <td className="px-4 py-2 text-right text-gray-400">✏️</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex justify-center gap-2 mt-4 items-center text-sm">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40">‹</button>
          <span className="text-gray-500">Pág {page} de {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40">›</button>
        </div>
      )}

      {(edit || nuevo) && <ClienteModal cliente={edit} initialTab={edit && openClienteId === edit.id ? openClienteTab : undefined} onClose={() => { setEdit(null); setNuevo(false); }} onSaved={() => { setEdit(null); setNuevo(false); load(); }} />}
    </div>
  );
}

function ClienteModal({ cliente, onClose, onSaved, initialTab }: { cliente: Cliente | null; onClose: () => void; onSaved: () => void; initialTab?: "datos" | "operaciones" }) {
  const esNuevo = !cliente;
  const [f, setF] = useState<any>(() => ({
    tipo: cliente?.tipo || "contacto",
    nombre: [cliente?.nombre].filter(Boolean).join(" ") || "",
    razon_social: cliente?.razon_social || "", email: cliente?.email || "", whatsapp: cliente?.whatsapp || "",
    cuit: cliente?.cuit || "", provincia: cliente?.provincia || "", localidad: cliente?.localidad || "",
    cod_postal: cliente?.cod_postal || "", domicilio: cliente?.domicilio || "", condicion_fiscal: cliente?.condicion_fiscal || "",
    notas: cliente?.notas || "", descuento_pct: cliente?.descuento_pct ?? "",
  }));
  const [tags, setTags] = useState<string[]>(cliente?.tags || []);
  const [optOut, setOptOut] = useState<boolean>(!!cliente?.email_opt_out);
  const [arca, setArca] = useState(""); const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const toggleTag = (t: string) => setTags((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  async function buscarArca() {
    const cuit = (f.cuit || "").replace(/\D/g, "");
    if (cuit.length !== 11) { setArca("El CUIT debe tener 11 dígitos."); return; }
    setArca("Buscando en ARCA…");
    try {
      const r = await fetch("/api/consultar-cuit?cuit=" + cuit); const d = await r.json();
      if (!d.ok || d.valido === false) throw new Error(d.error || "CUIT sin datos");
      const dom = d.domicilio || {};
      const nom = d.razonSocial || d.denominacion || [d.nombre, d.apellido].filter(Boolean).join(" ");
      setF((p: any) => ({ ...p, razon_social: p.razon_social || d.razonSocial || d.denominacion || "", nombre: p.nombre || nom || "", domicilio: p.domicilio || dom.direccion || "", localidad: p.localidad || dom.localidad || "", provincia: p.provincia || dom.provincia || "", cod_postal: p.cod_postal || dom.codPostal || "" }));
      setArca("✓ " + (nom || cuit));
    } catch (e: any) { setArca("✕ " + e.message); }
  }

  async function guardar() {
    setSaving(true);
    try {
      if (esNuevo) {
        let r = await fetch("/api/clientes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, tags }) });
        let d = await r.json();
        if (d.duplicado) {
          const ex = d.existente || {};
          const ok = confirm(`Ya existe un cliente con ese ${d.campo}:\n\n${ex.nombre || "(sin nombre)"} — ${ex.cuit || ex.email || ex.whatsapp || ""}\n\n¿Cargar igualmente como cliente nuevo?`);
          if (!ok) { setSaving(false); return; }
          r = await fetch("/api/clientes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, tags, forzar: true }) });
          d = await r.json();
        }
        if (!d.ok) throw new Error(d.error);
      } else {
        const id = cliente!.id;
        const patch = async (field: string, value: any) => {
          const r = await fetch(`/api/clientes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field, value }) });
          const d = await r.json(); if (!d.ok) throw new Error(d.error);
        };
        for (const k of ["tipo", ...CAMPOS]) {
          const nuevoV = (f[k] ?? "").toString().trim() || null;
          const orig = (cliente as any)[k] || null;
          if (nuevoV !== orig) await patch(k, nuevoV);
        }
        const tagsOrig = JSON.stringify((cliente!.tags || []).slice().sort());
        if (JSON.stringify(tags.slice().sort()) !== tagsOrig) await patch("tags", tags);
        if (optOut !== !!cliente!.email_opt_out) await patch("email_opt_out", optOut);
      }
      onSaved();
    } catch (e: any) { alert("Error: " + e.message); } finally { setSaving(false); }
  }

  async function eliminar() {
    if (!cliente) return;
    // Chequear ANTES si tiene operaciones enlazadas → si tiene, avisar y NO permitir eliminar.
    try {
      const ro = await fetch(`/api/clientes/${cliente.id}/operaciones`);
      const od = await ro.json();
      if (od.ok) {
        const nP = (od.presupuestos || []).length;
        const nPed = (od.resumen?.pedidos_count) || 0;
        const nFac = (od.comprobantes || []).filter((c: any) => c.tipo === "factura").length + (od.compras || []).length;
        if (nP + nFac > 0) {
          const partes = [nP && `${nP} presupuesto(s)`, nPed && `${nPed} pedido(s)`, nFac && `${nFac} factura(s)/compra(s)`].filter(Boolean).join(", ");
          alert(`⚠️ No se puede eliminar este contacto.\n\nTiene operaciones enlazadas: ${partes}.\n\nUn cliente con presupuestos, pedidos o facturas no se borra (para no perder el historial).`);
          return;
        }
      }
    } catch { /* si falla el chequeo, el backend igual bloquea (409) */ }
    const motivo = prompt("¿Por qué eliminás este contacto del CRM?");
    if (motivo === null) return;
    const r = await fetch(`/api/clientes/${cliente.id}?motivo=${encodeURIComponent(motivo)}`, { method: "DELETE" });
    const d = await r.json(); if (d.ok) onSaved(); else alert("Error: " + d.error);
  }

  const [tab, setTab] = useState<"datos" | "operaciones">(initialTab || "datos");
  const lbl = "flex flex-col gap-1 text-[11px] font-semibold text-gray-600";
  const inp = "border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm";
  return (
    <div className="fixed inset-0 bg-black/45 z-50 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-3xl mx-auto my-8 p-7 relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-5 text-2xl text-gray-400">✕</button>
        <h2 className="text-lg font-bold mb-1">{esNuevo ? "＋ Nuevo cliente" : "✏️ " + (f.nombre || "Cliente")}</h2>
        {!esNuevo && (
          <div className="flex gap-1 mb-4 border-b border-gray-200 -mx-1">
            {([["datos", "Datos"], ["operaciones", "Operaciones / Cuenta"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${tab === k ? "border-febo-azul text-febo-azul" : "border-transparent text-gray-400 hover:text-gray-600"}`}>{l}</button>
            ))}
          </div>
        )}
        {!esNuevo && tab === "operaciones" ? (
          <OperacionesTab clienteId={cliente!.id} />
        ) : (
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 grid grid-cols-[1fr_auto] gap-2 items-end">
            <span className={lbl}>CUIT<input value={f.cuit} onChange={(e) => set("cuit", e.target.value)} className={inp + " w-full"} /></span>
            <button onClick={buscarArca} className="bg-febo-cyan text-white rounded-lg px-3 h-[34px] text-sm">🔍 ARCA</button>
          </label>
          {arca && <div className="col-span-2 text-[11px] -mt-2" style={{ color: arca.startsWith("✓") ? "#059669" : "#e53935" }}>{arca}</div>}
          <label className={lbl + " col-span-2"}>NOMBRE Y APELLIDO<input value={f.nombre} onChange={(e) => set("nombre", e.target.value)} className={inp} /></label>
          <label className={lbl + " col-span-2"}>RAZÓN SOCIAL / EMPRESA<input value={f.razon_social} onChange={(e) => set("razon_social", e.target.value)} className={inp} /></label>
          <label className={lbl}>EMAIL<input value={f.email} onChange={(e) => set("email", e.target.value)} className={inp} /></label>
          <label className={lbl}>WHATSAPP<input value={f.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} className={inp} /></label>
          <label className={lbl}>ESTADO<select value={f.tipo} onChange={(e) => set("tipo", e.target.value)} className={inp}>{ESTADOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className={lbl}>CONDICIÓN FISCAL<select value={f.condicion_fiscal} onChange={(e) => set("condicion_fiscal", e.target.value)} className={inp}>
            <option value="">— sin datos —</option>
            <option value="responsable_inscripto">Responsable Inscripto</option>
            <option value="monotributista">Monotributista</option>
            <option value="consumidor_final">Consumidor Final</option>
            <option value="exento">Exento</option>
          </select></label>
          <label className={lbl}>DESCUENTO % (predeterminado)<input type="number" value={f.descuento_pct} onChange={(e) => set("descuento_pct", e.target.value)} className={inp} placeholder="0" /></label>
          <label className={lbl}>PROVINCIA<input value={f.provincia} onChange={(e) => set("provincia", e.target.value)} className={inp} /></label>
          <label className={lbl}>LOCALIDAD<input value={f.localidad} onChange={(e) => set("localidad", e.target.value)} className={inp} /></label>
          <label className={lbl}>CÓDIGO POSTAL<input value={f.cod_postal} onChange={(e) => set("cod_postal", e.target.value)} className={inp} /></label>
          <label className={lbl}>DOMICILIO<input value={f.domicilio} onChange={(e) => set("domicilio", e.target.value)} className={inp} /></label>
          <label className={lbl + " col-span-2"}>NOTAS<textarea value={f.notas} onChange={(e) => set("notas", e.target.value)} rows={2} className={inp} /></label>
          <div className="col-span-2">
            <div className="text-[11px] font-semibold text-gray-600 mb-1.5">ETIQUETAS</div>
            <div className="flex flex-wrap gap-2">
              {TAGS.map(([v, l]) => (
                <label key={v} className={`flex items-center gap-1.5 text-sm rounded-lg border px-2.5 py-1 cursor-pointer ${tags.includes(v) ? "bg-indigo-50 border-indigo-200" : "bg-gray-50 border-gray-200"}`}>
                  <input type="checkbox" checked={tags.includes(v)} onChange={() => toggleTag(v)} />{l}
                </label>
              ))}
            </div>
          </div>
          <label className="col-span-2 flex items-center gap-2 text-sm text-gray-700 mt-1">
            <input type="checkbox" checked={optOut} onChange={(e) => setOptOut(e.target.checked)} />
            Email opt-out (no enviar marketing)
          </label>
        </div>
        )}
        {(esNuevo || tab === "datos") && (
        <div className="flex justify-between items-center mt-6">
          {esNuevo ? <span /> : <button onClick={eliminar} className="bg-red-50 text-red-700 border border-red-200 rounded-lg px-4 py-2 text-sm font-semibold">🗑 Eliminar del CRM</button>}
          <div className="flex gap-2">
            <button onClick={onClose} className="border border-gray-300 rounded-lg px-5 py-2 text-sm">Cancelar</button>
            <button onClick={guardar} disabled={saving} className="bg-febo-azul text-white rounded-lg px-6 py-2 text-sm font-semibold disabled:opacity-50">{saving ? "Guardando…" : esNuevo ? "Crear" : "Guardar cambios"}</button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

const TIPO_COMP: Record<string, { l: string; c: string; o: number }> = {
  presupuesto: { l: "Presupuesto", c: "#64748b", o: 0 }, pedido: { l: "Pedido", c: "#2563eb", o: 1 },
  factura: { l: "Factura", c: "#059669", o: 2 }, remito: { l: "Remito", c: "#7c3aed", o: 3 },
};

const FICHA_TABS = [
  { k: "presupuestos", l: "Presupuestos" }, { k: "pedidos", l: "Pedidos" },
  { k: "facturas", l: "Facturas" }, { k: "remitos", l: "Remitos" }, { k: "pagos", l: "Pagos" },
] as const;
type FichaTab = (typeof FICHA_TABS)[number]["k"];
const COTI_BASE = "https://coti.febecos.com";
const linkPresup = (tipo: string, token: string) =>
  tipo === "fv" ? `https://fv.febecos.com/ver-presupuesto?token=${token}` : `${COTI_BASE}/p/${token}`;
const esPedidoEstado = (e: string) => ["pedido", "convertido"].includes((e || "").toLowerCase());

function CtaCteCliente({ clienteId }: { clienteId: number }) {
  const [movs, setMovs] = useState<any[]>([]); const [saldo, setSaldo] = useState(0); const [dolar, setDolar] = useState(0); const [open, setOpen] = useState(false); const [loaded, setLoaded] = useState(false);
  useEffect(() => { fetch(`/api/ctacte?ambito=cliente&cliente_id=${clienteId}`).then((r) => r.json()).then((d) => { if (d.ok) { setMovs(d.movimientos || []); setSaldo(d.saldo || 0); setDolar(d.dolar || 0); } setLoaded(true); }).catch(() => setLoaded(true)); }, [clienteId]);
  if (!loaded || (movs.length === 0 && Math.abs(saldo) < 0.01)) return null;
  let acum = 0;
  return (
    <div className="mb-3 rounded-lg border border-gray-200 bg-white">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-3 py-2 text-sm">
        <span className="font-semibold text-febo-azul">💳 Cuenta corriente</span>
        <span className="flex items-center gap-2">
          <b className={saldo > 0.01 ? "text-red-600" : "text-emerald-600"}>USD {saldo.toLocaleString("es-AR", { minimumFractionDigits: 2 })}{dolar > 0 ? " · $ " + Math.round(saldo * dolar).toLocaleString("es-AR") : ""}</b>
          <span className="text-gray-400 text-xs">{saldo > 0.01 ? "(nos debe)" : "(al día)"}</span>
          <span className="text-gray-400">{open ? "▲" : "▼"}</span>
        </span>
      </button>
      {open && <div className="border-t border-gray-100 px-3 py-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase text-gray-400"><tr><th className="text-left py-1">Fecha</th><th className="text-left py-1">Concepto</th><th className="text-right py-1">Debe</th><th className="text-right py-1">Haber</th><th className="text-right py-1">Saldo</th></tr></thead>
          <tbody>
            {movs.map((m, i) => { const d = Number(m.debe) || 0, h = Number(m.haber) || 0; acum += d - h; return (
              <tr key={i} className="border-t border-gray-100">
                <td className="py-1 text-gray-500 whitespace-nowrap">{m.fecha ? new Date(m.fecha).toLocaleDateString("es-AR") : "—"}</td>
                <td className="py-1">{m.concepto}{m.comprobante ? " · " + m.comprobante : ""}</td>
                <td className="py-1 text-right tabular-nums text-gray-600">{d ? d.toLocaleString("es-AR", { minimumFractionDigits: 2 }) : ""}</td>
                <td className="py-1 text-right tabular-nums text-gray-600">{h ? h.toLocaleString("es-AR", { minimumFractionDigits: 2 }) : ""}</td>
                <td className="py-1 text-right tabular-nums font-semibold">{acum.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</td>
              </tr>
            ); })}
          </tbody>
        </table>
      </div>}
    </div>
  );
}

function OperacionesTab({ clienteId }: { clienteId: number }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState<FichaTab>("presupuestos");
  useEffect(() => {
    let vivo = true;
    setLoading(true);
    fetch(`/api/clientes/${clienteId}/operaciones`).then((r) => r.json()).then((d) => {
      if (vivo) { setData(d.ok ? d : {}); setLoading(false); }
    }).catch(() => vivo && setLoading(false));
    return () => { vivo = false; };
  }, [clienteId]);

  if (loading) return <div className="text-gray-400 text-sm py-8 text-center">Cargando operaciones…</div>;
  const comps = data?.comprobantes || [];
  const presupuestos = data?.presupuestos || [];
  const compras = data?.compras || [];
  const pagos = data?.pagos || [];
  const r = data?.resumen || {};
  const pedidos = (data?.pedidos && data.pedidos.length)
    ? data.pedidos
    : presupuestos.filter((p: any) => esPedidoEstado(p.estado));
  const facturasFg = comps.filter((c: any) => c.tipo === "factura");
  const remitos = comps.filter((c: any) => c.tipo === "remito");
  const estadoChip = r.estado_derivado === "compro" ? ["✅ Cliente que compró", "#059669"]
    : r.estado_derivado === "cotizo" ? ["📝 Cliente que cotizó", "#d97706"]
    : ["📇 Sin operaciones", "#64748b"];
  const cuenta: Record<FichaTab, number> = {
    presupuestos: presupuestos.length, pedidos: pedidos.length,
    facturas: facturasFg.length + compras.length, remitos: remitos.length, pagos: pagos.length,
  };

  return (
    <div>
      <CtaCteCliente clienteId={clienteId} />
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <span style={{ background: (estadoChip[1] as string) + "1a", color: estadoChip[1] as string }} className="rounded-lg px-3 py-1.5 text-sm font-semibold">{estadoChip[0]}</span>
        <div className="ml-auto grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-1 text-sm">
          <div className="text-right">
            <div className="text-[10px] text-gray-400 uppercase">Presupuestos ({r.presup_count || 0})</div>
            <div className="font-bold">{r.coti_ars ? "$ " + Math.round(r.coti_ars).toLocaleString("es-AR") : "—"}</div>
            {r.coti_usd ? <div className="font-bold text-amber-600 text-xs">USD {Math.round(r.coti_usd).toLocaleString("es-AR")}</div> : null}
          </div>
          <div className="text-right">
            <div className="text-[10px] text-gray-400 uppercase">Pedidos ({r.pedidos_count || 0})</div>
            <div className="font-bold text-violet-700">{r.ped_ars ? "$ " + Math.round(r.ped_ars).toLocaleString("es-AR") : "—"}</div>
            {r.ped_usd ? <div className="font-bold text-amber-600 text-xs">USD {Math.round(r.ped_usd).toLocaleString("es-AR")}</div> : null}
          </div>
          {(r.facturado > 0 || r.pagado > 0) && <>
            <div className="text-right"><div className="text-[10px] text-gray-400 uppercase">Facturado</div><div className="font-bold">{fmtMonto(r.facturado)}</div></div>
            <div className="text-right"><div className="text-[10px] text-gray-400 uppercase">Saldo</div><div className={`font-bold ${r.saldo > 0 ? "text-red-600" : "text-gray-700"}`}>{fmtMonto(r.saldo)}</div></div>
          </>}
        </div>
      </div>

      {/* Solapas internas: Presupuestos / Pedidos / Facturas / Remitos / Pagos */}
      <div className="flex gap-1 border-b border-gray-200 mb-3 text-sm">
        {FICHA_TABS.map((t) => (
          <button key={t.k} onClick={() => setSub(t.k)}
            className={`px-3 py-1.5 font-semibold border-b-2 -mb-px ${sub === t.k ? "border-febo-azul text-febo-azul" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
            {t.l} <span className="text-[11px] text-gray-400">({cuenta[t.k]})</span>
          </button>
        ))}
      </div>

      {sub === "presupuestos" && <TablaPresup rows={presupuestos} vacio="Sin presupuestos." />}
      {sub === "pedidos" && <TablaPresup rows={pedidos} vacio="Sin pedidos (presupuestos confirmados como pedido)." />}
      {sub === "facturas" && (
        (facturasFg.length + compras.length) === 0
          ? <Vacio txt="Sin facturas." />
          : <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr><th className="text-left px-3 py-2">Comprobante</th><th className="text-left px-3 py-2">Origen</th><th className="text-left px-3 py-2">Fecha</th><th className="text-right px-3 py-2">Monto</th></tr></thead>
                <tbody>
                  {facturasFg.map((c: any) => <tr key={"f" + c.id} className="border-t border-gray-100"><td className="px-3 py-2 font-semibold">{c.numero}</td><td className="px-3 py-2 text-gray-500">FEBO-GESTION</td><td className="px-3 py-2 text-gray-500">{c.fecha ? new Date(c.fecha).toLocaleDateString("es-AR") : "—"}</td><td className="px-3 py-2 text-right font-semibold">{fmtMonto(Number(c.total))}</td></tr>)}
                  {compras.map((c: any) => <tr key={"x" + c.id} className="border-t border-gray-100"><td className="px-3 py-2 font-semibold">{c.nro_factura || "—"} {c.tiene_archivo && <span title="PDF">📎</span>}</td><td className="px-3 py-2 text-gray-500">Tango (externa)</td><td className="px-3 py-2 text-gray-500">{c.fecha ? new Date(c.fecha).toLocaleDateString("es-AR") : "—"}</td><td className="px-3 py-2 text-right font-semibold">{fmtMonto(Number(c.monto))}</td></tr>)}
                </tbody>
              </table>
            </div>
      )}
      {sub === "remitos" && (
        remitos.length === 0 ? <Vacio txt="Sin remitos." /> :
        <div className="border border-gray-200 rounded-xl overflow-hidden"><table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr><th className="text-left px-3 py-2">Número</th><th className="text-left px-3 py-2">Fecha</th><th className="text-left px-3 py-2">Estado</th></tr></thead>
          <tbody>{remitos.map((c: any) => <tr key={c.id} className="border-t border-gray-100"><td className="px-3 py-2 font-semibold">{c.numero}</td><td className="px-3 py-2 text-gray-500">{c.fecha ? new Date(c.fecha).toLocaleDateString("es-AR") : "—"}</td><td className="px-3 py-2 text-gray-500">{c.estado}</td></tr>)}</tbody>
        </table></div>
      )}
      {sub === "pagos" && (
        pagos.length === 0 ? <Vacio txt="Sin pagos registrados." /> :
        <div className="border border-gray-200 rounded-xl overflow-hidden"><table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr><th className="text-left px-3 py-2">Fecha</th><th className="text-left px-3 py-2">Medio</th><th className="text-right px-3 py-2">Monto</th></tr></thead>
          <tbody>{pagos.map((p: any) => <tr key={p.id} className="border-t border-gray-100"><td className="px-3 py-2 text-gray-500">{p.fecha ? new Date(p.fecha).toLocaleDateString("es-AR") : "—"}</td><td className="px-3 py-2 text-gray-600">{p.medio || "—"}</td><td className="px-3 py-2 text-right font-semibold text-emerald-600">{fmtMonto(Number(p.monto))}</td></tr>)}</tbody>
        </table></div>
      )}
    </div>
  );
}

function Vacio({ txt }: { txt: string }) {
  return <div className="text-center py-10 text-gray-400 text-sm border border-dashed border-gray-200 rounded-xl">{txt}</div>;
}

function TablaPresup({ rows, vacio }: { rows: any[]; vacio: string }) {
  if (!rows.length) return <Vacio txt={vacio} />;
  const tipoP = (t: string) => (t === "fv" ? ["FV", "#d97706"] : ["Rev", "#2563eb"]);
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
          <tr><th className="text-left px-3 py-2">Número</th><th className="text-left px-3 py-2">Tipo</th><th className="text-left px-3 py-2">Detalle</th><th className="text-left px-3 py-2">Fecha</th><th className="text-left px-3 py-2">Estado</th><th className="text-right px-3 py-2">Precio</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((p: any) => {
            const tp = tipoP(p.tipo);
            // Moneda de ORIGEN del presupuesto: si se emitió en pesos (moneda ARS/$ + tc) muestra $ convertido; si no, USD (fv) o $ (bomba).
            const enPesos = (p.moneda === "ARS" || p.moneda === "$") && Number(p.tc) > 0;
            const precioTxt = enPesos
              ? `$ ${Math.round((Number(p.precio_ofrecido) || 0) * Number(p.tc)).toLocaleString("es-AR")}`
              : `${p.tipo === "fv" ? "USD" : "$"} ${Math.round(Number(p.precio_ofrecido) || 0).toLocaleString("es-AR")}`;
            return (
              <tr key={p.id} className="border-t border-gray-100">
                <td className="px-3 py-2 font-semibold">{p.numero}{p.presup_numero && <div className="text-[10px] font-normal text-gray-400">de {p.presup_numero}</div>}</td>
                <td className="px-3 py-2"><span style={{ background: (tp[1] as string) + "1a", color: tp[1] as string }} className="rounded px-2 py-0.5 text-[11px] font-semibold">{tp[0]}</span></td>
                <td className="px-3 py-2 text-gray-600">{p.bomba_codigo || p.bomba_descripcion || "—"}</td>
                <td className="px-3 py-2 text-gray-500">{p.created_at ? new Date(p.created_at).toLocaleDateString("es-AR") : "—"}</td>
                <td className="px-3 py-2 text-gray-500">{p.estado || "—"}</td>
                <td className="px-3 py-2 text-right font-semibold">{precioTxt}</td>
                <td className="px-3 py-2 text-right">{p.public_token && <a href={linkPresup(p.tipo, p.public_token)} target="_blank" rel="noreferrer" title="Ver / Imprimir / PDF" className="text-gray-400 hover:text-febo-azul">📄</a>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
