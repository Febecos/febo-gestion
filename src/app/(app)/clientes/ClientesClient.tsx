"use client";
import { useEffect, useState, useCallback } from "react";

type Cliente = {
  id: number; tipo: string; nombre: string; email: string; whatsapp: string;
  cuit: string; provincia: string; localidad: string; razon_social?: string;
  domicilio?: string; cod_postal?: string; condicion_fiscal?: string; notas?: string;
  tags: string[]; origenes: string[]; email_opt_out?: boolean;
  total_pedidos: number; monto_total: number; ultimo_contacto_at: string;
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
const CAMPOS = ["nombre", "razon_social", "email", "whatsapp", "cuit", "provincia", "localidad", "cod_postal", "domicilio", "condicion_fiscal", "notas"] as const;

export default function ClientesClient({ openClienteId }: { openClienteId?: number } = {}) {
  const [rows, setRows] = useState<Cliente[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState(""); const [tipo, setTipo] = useState("");
  const [page, setPage] = useState(1); const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<Cliente | null>(null);
  const [nuevo, setNuevo] = useState(false);
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
        <div className="ml-auto flex gap-2">
          <button onClick={() => setNuevo(true)} className="bg-febo-verde text-white rounded-lg px-3 py-2 text-sm font-semibold">＋ Nuevo cliente</button>
          <button onClick={exportarCSV} className="bg-febo-azul text-white rounded-lg px-3 py-2 text-sm font-semibold">⬇ CSV</button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr><th className="text-left px-4 py-3">Nombre</th><th className="text-left px-4 py-3">Email</th><th className="text-left px-4 py-3">WhatsApp</th><th className="text-left px-4 py-3">Tipo</th><th className="text-left px-4 py-3">Provincia</th><th className="text-center px-4 py-3">Pedidos</th><th className="text-right px-4 py-3">Monto total</th><th></th></tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={8} className="text-center py-8 text-gray-400">Cargando…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={8} className="text-center py-8 text-gray-400">Sin resultados</td></tr>
            : rows.map((r) => {
              const extra = (r.tags || []).filter((t) => t !== r.tipo && !(r.tipo === "cliente_final" && t === "cliente"));
              return (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => setEdit(r)}>
                  <td className="px-4 py-2 font-semibold">{r.nombre || "—"}</td>
                  <td className="px-4 py-2 text-gray-600">{r.email || "—"}</td>
                  <td className="px-4 py-2 text-gray-600">{r.whatsapp || "—"}</td>
                  <td className="px-4 py-2">{badge(r.tipo || "—")}{extra.length > 0 && <span className="ml-1 text-[10px] text-indigo-500 font-bold">+{extra.length}</span>}</td>
                  <td className="px-4 py-2 text-gray-600">{r.provincia || "—"}</td>
                  <td className="px-4 py-2 text-center">{r.total_pedidos || 0}</td>
                  <td className="px-4 py-2 text-right font-semibold">{fmtMonto(r.monto_total)}</td>
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

      {(edit || nuevo) && <ClienteModal cliente={edit} onClose={() => { setEdit(null); setNuevo(false); }} onSaved={() => { setEdit(null); setNuevo(false); load(); }} />}
    </div>
  );
}

function ClienteModal({ cliente, onClose, onSaved }: { cliente: Cliente | null; onClose: () => void; onSaved: () => void }) {
  const esNuevo = !cliente;
  const [f, setF] = useState<any>(() => ({
    tipo: cliente?.tipo || "contacto",
    nombre: [cliente?.nombre].filter(Boolean).join(" ") || "",
    razon_social: cliente?.razon_social || "", email: cliente?.email || "", whatsapp: cliente?.whatsapp || "",
    cuit: cliente?.cuit || "", provincia: cliente?.provincia || "", localidad: cliente?.localidad || "",
    cod_postal: cliente?.cod_postal || "", domicilio: cliente?.domicilio || "", condicion_fiscal: cliente?.condicion_fiscal || "",
    notas: cliente?.notas || "",
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
        const r = await fetch("/api/clientes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, tags }) });
        const d = await r.json(); if (!d.ok) throw new Error(d.error);
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
    const motivo = prompt("¿Por qué eliminás este contacto del CRM?");
    if (motivo === null) return;
    const r = await fetch(`/api/clientes/${cliente.id}?motivo=${encodeURIComponent(motivo)}`, { method: "DELETE" });
    const d = await r.json(); if (d.ok) onSaved(); else alert("Error: " + d.error);
  }

  const [tab, setTab] = useState<"datos" | "operaciones">("datos");
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

function OperacionesTab({ clienteId }: { clienteId: number }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let vivo = true;
    setLoading(true);
    fetch(`/api/clientes/${clienteId}/operaciones`).then((r) => r.json()).then((d) => {
      if (vivo) { setData(d.ok ? d : { comprobantes: [], pagos: [], resumen: {} }); setLoading(false); }
    }).catch(() => vivo && setLoading(false));
    return () => { vivo = false; };
  }, [clienteId]);

  if (loading) return <div className="text-gray-400 text-sm py-8 text-center">Cargando operaciones…</div>;
  const comps = data?.comprobantes || [];
  const presupuestos = data?.presupuestos || [];
  const compras = data?.compras || [];
  const pagos = data?.pagos || [];
  const r = data?.resumen || {};
  const COTI = "https://coti.febecos.com";
  const tipoP = (t: string) => (t === "fv" ? ["FV", "#d97706"] : ["Rev", "#2563eb"]);

  // Agrupar comprobantes por operación (cabeza = presupuesto). Cada operación = una cadena.
  const ops = new Map<number, any[]>();
  for (const c of comps) {
    const k = c.operacion_id || c.id;
    if (!ops.has(k)) ops.set(k, []);
    ops.get(k)!.push(c);
  }
  const operaciones = Array.from(ops.entries()).map(([opId, list]) => {
    const ordenada = [...list].sort((a, b) => (TIPO_COMP[a.tipo]?.o ?? 9) - (TIPO_COMP[b.tipo]?.o ?? 9));
    const cabeza = ordenada.find((c) => c.tipo === "presupuesto") || ordenada[0];
    const pagosOp = pagos.filter((p: any) => ordenada.some((c) => c.id === p.comprobante_id));
    return { opId, cabeza, docs: ordenada, pagos: pagosOp };
  }).sort((a, b) => b.opId - a.opId);
  const estadoChip = r.estado_derivado === "compro" ? ["✅ Cliente que compró", "#059669"]
    : r.estado_derivado === "cotizo" ? ["📝 Cliente que cotizó", "#d97706"]
    : ["📇 Sin operaciones", "#64748b"];

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4">
        <span style={{ background: (estadoChip[1] as string) + "1a", color: estadoChip[1] as string }} className="rounded-lg px-3 py-1.5 text-sm font-semibold">{estadoChip[0]}</span>
        <div className="ml-auto flex gap-4 text-sm">
          <div className="text-right"><div className="text-[10px] text-gray-400 uppercase">Facturado</div><div className="font-bold">{fmtMonto(r.facturado)}</div></div>
          <div className="text-right"><div className="text-[10px] text-gray-400 uppercase">Pagado</div><div className="font-bold text-emerald-600">{fmtMonto(r.pagado)}</div></div>
          <div className="text-right"><div className="text-[10px] text-gray-400 uppercase">Saldo</div><div className={`font-bold ${r.saldo > 0 ? "text-red-600" : "text-gray-700"}`}>{fmtMonto(r.saldo)}</div></div>
        </div>
      </div>

      {presupuestos.length === 0 && comps.length === 0 && compras.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm border border-dashed border-gray-200 rounded-xl">
          Este cliente todavía no tiene operaciones.<br />
          <span className="text-xs">Creá un presupuesto en coti.febecos.com con su CUIT o email.</span>
        </div>
      ) : (
        <div className="space-y-4">
          {presupuestos.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-gray-500 uppercase mb-1.5">Presupuestos (coti)</div>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <tr><th className="text-left px-3 py-2">Número</th><th className="text-left px-3 py-2">Tipo</th><th className="text-left px-3 py-2">Detalle</th><th className="text-left px-3 py-2">Fecha</th><th className="text-left px-3 py-2">Estado</th><th className="text-right px-3 py-2">Precio</th><th></th></tr>
                  </thead>
                  <tbody>
                    {presupuestos.map((p: any) => {
                      const tp = tipoP(p.tipo); const m = p.tipo === "fv" ? "USD" : "$";
                      return (
                        <tr key={p.id} className="border-t border-gray-100">
                          <td className="px-3 py-2 font-semibold">{p.numero}</td>
                          <td className="px-3 py-2"><span style={{ background: (tp[1] as string) + "1a", color: tp[1] as string }} className="rounded px-2 py-0.5 text-[11px] font-semibold">{tp[0]}</span></td>
                          <td className="px-3 py-2 text-gray-600">{p.bomba_codigo || p.bomba_descripcion || "—"}</td>
                          <td className="px-3 py-2 text-gray-500">{p.created_at ? new Date(p.created_at).toLocaleDateString("es-AR") : "—"}</td>
                          <td className="px-3 py-2 text-gray-500">{p.estado || "—"}</td>
                          <td className="px-3 py-2 text-right font-semibold">{m} {Math.round(Number(p.precio_ofrecido) || 0).toLocaleString("es-AR")}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {p.public_token && <a href={`${COTI}/p/${p.public_token}`} target="_blank" rel="noreferrer" title="Ver / Imprimir / PDF" className="text-gray-400 hover:text-febo-azul mr-1">📄</a>}
                            {p.public_token && p.revendedor_token && <a href={`${COTI}/p/${p.public_token}?rev=${p.revendedor_token}`} target="_blank" rel="noreferrer" title="Editar (interno, con token)" className="text-gray-400 hover:text-febo-azul">✏️</a>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {operaciones.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-gray-500 uppercase mb-1.5">Operaciones (FEBO-GESTION)</div>
              <div className="space-y-3">
                {operaciones.map((op) => {
                  const tc = TIPO_COMP[op.cabeza.tipo] || { l: op.cabeza.tipo, c: "#888", o: 9 };
                  const fcab = op.cabeza.fecha || op.cabeza.created_at;
                  return (
                    <div key={op.opId} className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="flex items-center gap-2 bg-gray-50 px-3 py-2 border-b border-gray-100">
                        <span className="font-bold text-sm">Operación #{op.opId}</span>
                        <span className="text-xs text-gray-400">{op.cabeza.numero}</span>
                        <span className="text-xs text-gray-400 ml-1">{fcab ? new Date(fcab).toLocaleDateString("es-AR") : ""}</span>
                        <span className="ml-auto font-bold text-sm">{fmtMonto(Number(op.cabeza.total))}</span>
                      </div>
                      <div className="divide-y divide-gray-50">
                        {op.docs.map((c: any, i: number) => {
                          const t = TIPO_COMP[c.tipo] || { l: c.tipo, c: "#888", o: 9 };
                          const fecha = c.fecha || c.created_at;
                          return (
                            <div key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                              <span className="text-gray-300">{i === 0 ? "" : "└─"}</span>
                              <span style={{ background: t.c + "1a", color: t.c }} className="rounded px-2 py-0.5 text-[11px] font-semibold">{t.l}</span>
                              <span className="font-semibold">{c.numero || "—"}</span>
                              <span className="text-xs text-gray-400">{c.estado}</span>
                              <span className="text-xs text-gray-400">{fecha ? new Date(fecha).toLocaleDateString("es-AR") : ""}</span>
                              <span className="ml-auto text-gray-600">{fmtMonto(Number(c.total))}</span>
                              {c.token && <a href={`/p/${c.token}`} target="_blank" rel="noreferrer" title="Ver / Imprimir" className="text-gray-400 hover:text-febo-azul ml-1">📄</a>}
                            </div>
                          );
                        })}
                        {op.pagos.map((p: any) => (
                          <div key={"p" + p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm bg-emerald-50/40">
                            <span className="text-gray-300">└─</span>
                            <span className="bg-emerald-100 text-emerald-700 rounded px-2 py-0.5 text-[11px] font-semibold">💵 Pago</span>
                            <span className="text-xs text-gray-500">{p.medio || ""}</span>
                            <span className="text-xs text-gray-400">{p.fecha ? new Date(p.fecha).toLocaleDateString("es-AR") : ""}</span>
                            <span className="ml-auto font-semibold text-emerald-700">{fmtMonto(Number(p.monto))}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {compras.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-gray-500 uppercase mb-1.5">Compras / Facturas externas (Tango)</div>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <tr><th className="text-left px-3 py-2">Factura</th><th className="text-left px-3 py-2">Fecha</th><th className="text-left px-3 py-2">Descripción</th><th className="text-right px-3 py-2">Monto</th></tr>
                  </thead>
                  <tbody>
                    {compras.map((c: any) => (
                      <tr key={c.id} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-semibold">{c.nro_factura || "—"} {c.tiene_archivo && <span title="tiene PDF">📎</span>}</td>
                        <td className="px-3 py-2 text-gray-500">{c.fecha ? new Date(c.fecha).toLocaleDateString("es-AR") : "—"}</td>
                        <td className="px-3 py-2 text-gray-600">{c.descripcion || "—"}</td>
                        <td className="px-3 py-2 text-right font-semibold">{fmtMonto(Number(c.monto))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
