"use client";
import { useEffect, useState, useCallback } from "react";

type Cliente = {
  id: number; tipo: string; nombre: string; email: string; whatsapp: string;
  cuit: string; provincia: string; localidad: string; razon_social?: string;
  domicilio?: string; cod_postal?: string; condicion_fiscal?: string; notas?: string;
  tags: string[]; origenes: string[]; email_opt_out?: boolean; descuento_pct?: number; transporte?: string;
  comision_propia_pct?: number; comision_revende_pct?: number; revendedor_padre_id?: number;
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
const CAMPOS = ["nombre", "razon_social", "email", "whatsapp", "cuit", "provincia", "localidad", "cod_postal", "domicilio", "condicion_fiscal", "notas", "comision_propia_pct", "comision_revende_pct"] as const;
const esRevendedor = (t: string) => (t || "").startsWith("revendedor");

export default function ClientesClient({ openClienteId, openClienteTab }: { openClienteId?: number; openClienteTab?: "datos" | "operaciones" | "envio" } = {}) {
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

const TIPOS_ENVIO = ["", "A domicilio", "Puerta a puerta", "A sucursal de transporte", "Retira en depósito", "Flete propio"];
function ClienteModal({ cliente, onClose, onSaved, initialTab }: { cliente: Cliente | null; onClose: () => void; onSaved: () => void; initialTab?: "datos" | "operaciones" | "envio" }) {
  const esNuevo = !cliente;
  const [f, setF] = useState<any>(() => ({
    tipo: cliente?.tipo || "contacto",
    nombre: [cliente?.nombre].filter(Boolean).join(" ") || "",
    razon_social: cliente?.razon_social || "", email: cliente?.email || "", whatsapp: cliente?.whatsapp || "",
    cuit: cliente?.cuit || "", provincia: cliente?.provincia || "", localidad: cliente?.localidad || "",
    cod_postal: cliente?.cod_postal || "", domicilio: cliente?.domicilio || "", condicion_fiscal: cliente?.condicion_fiscal || "",
    notas: cliente?.notas || "", transporte: cliente?.transporte || "",
    comision_propia_pct: cliente?.comision_propia_pct ?? "", comision_revende_pct: cliente?.comision_revende_pct ?? "",
  }));
  const [origComision, setOrigComision] = useState<{ propia: any; revende: any }>({ propia: cliente?.comision_propia_pct ?? null, revende: cliente?.comision_revende_pct ?? null });
  // Datos de envío (CRM = fuente única). Prefill: lo guardado en cliente.envio; si falta, los datos
  // fiscales/domicilio del cliente como punto de partida.
  const [envioForm, setEnvioForm] = useState<any>(() => {
    const e = (cliente as any)?.envio || {};
    return {
      nombre: e.nombre || cliente?.nombre || "", dni: e.dni || cliente?.cuit || "",
      telefono: e.telefono || cliente?.whatsapp || "", email: e.email || cliente?.email || "",
      direccion: e.direccion || cliente?.domicilio || "", localidad: e.localidad || cliente?.localidad || "",
      provincia: e.provincia || cliente?.provincia || "", cp: e.cp || cliente?.cod_postal || "",
      empresa: e.empresa || cliente?.transporte || "", tipo_envio: e.tipo_envio || "",
      domicilio_transporte: e.domicilio_transporte || "", telefono_transporte: e.telefono_transporte || "", cuit_transporte: e.cuit_transporte || "",
      valor_declarado: e.valor_declarado || "",
    };
  });
  const setE = (k: string, v: any) => setEnvioForm((p: any) => ({ ...p, [k]: v }));
  // Faltantes para poder despachar (mismos campos obligatorios que el visor / el remito).
  const envioFalta = ["nombre", "direccion", "localidad", "provincia"].filter((k) => !String(envioForm[k] || "").trim());
  const envioOk = envioFalta.length === 0;
  const [tags, setTags] = useState<string[]>(cliente?.tags || []);
  const [optOut, setOptOut] = useState<boolean>(!!cliente?.email_opt_out);
  const [arca, setArca] = useState(""); const [saving, setSaving] = useState(false);
  // Fusión de duplicados
  const [fusionOpen, setFusionOpen] = useState(false);
  const [fq, setFq] = useState(""); const [fres, setFres] = useState<any[]>([]);
  useEffect(() => {
    if (!fusionOpen) return; const q = fq.trim(); if (q.length < 2) { setFres([]); return; }
    const t = setTimeout(() => { fetch("/api/clientes?limit=8&q=" + encodeURIComponent(q)).then((r) => r.json()).then((d) => setFres((d.clientes || []).filter((x: any) => x.id !== cliente?.id))).catch(() => {}); }, 250);
    return () => clearTimeout(t);
  }, [fq, fusionOpen, cliente?.id]);
  async function fusionar(targetId: number, targetNombre: string) {
    if (!cliente) return;
    if (!confirm(`Fusionar "${cliente.nombre}" en "${targetNombre}".\n\nTodas las operaciones (presupuestos, pedidos, facturas, pagos) del duplicado pasan a "${targetNombre}" y este contacto se elimina.\n\n¿Confirmás?`)) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/clientes/${cliente.id}/merge`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target_id: targetId }) });
      const d = await r.json();
      if (d.ok) { const m = d.movidos || {}; alert(`✅ Fusionado. Movidos: ${m.presupuestos || 0} presup., ${m.operaciones || 0} pedidos, ${m.comprobantes || 0} facturas/remitos, ${m.pagos || 0} pagos.`); onSaved(); }
      else alert("⚠️ " + (d.error || "No se pudo fusionar"));
    } catch (e: any) { alert("Error: " + e.message); } finally { setSaving(false); }
  }
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const toggleTag = (t: string) => setTags((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  // Transporte habitual: sugerencias del maestro según la provincia/localidad del cliente.
  const [transportes, setTransportes] = useState<any[]>([]);
  useEffect(() => { fetch("/api/transportistas?soloActivos=true").then((r) => r.json()).then((d) => setTransportes(d.ok ? d.rows : [])).catch(() => {}); }, []);
  const normT = (s: any) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  // Sugerencias de transporte por la zona de ENVÍO (pestaña Datos Envíos).
  const sugeridos = (() => {
    const prov = normT(envioForm.provincia), loc = normT(envioForm.localidad);
    if (!prov && !loc) return [] as any[];
    return transportes.filter((t: any) =>
      (t.provincias || []).some((p: string) => prov && (normT(p).includes(prov) || prov.includes(normT(p)))) ||
      (t.zonas_detalle || []).some((z: any) => { const zt = normT([z.locality, z.province].filter(Boolean).join(" ")); return (loc && zt.includes(loc)) || (prov && zt.includes(prov)); })
    );
  })();

  // Hidratar comisiones al abrir (las filas de la lista no las traen).
  useEffect(() => {
    if (esNuevo || !cliente) return;
    fetch(`/api/clientes/${cliente.id}`).then((r) => r.json()).then((d) => {
      if (!d.ok || !d.cliente) return;
      const c = d.cliente;
      // "Compra para sí" = descuento del admin revendedor (fuente de verdad). Si hay link, gana el admin.
      const propia = (d.admin_descuento_pct ?? c.comision_propia_pct);
      (cliente as any).comision_propia_pct = propia;
      (cliente as any).comision_revende_pct = c.comision_revende_pct;
      (cliente as any).revendedor_padre_id = c.revendedor_padre_id;
      setOrigComision({ propia: propia ?? null, revende: c.comision_revende_pct ?? null });
      const ev = c.envio || {};
      if (ev && Object.keys(ev).length) setEnvioForm((p: any) => ({ ...p, ...ev }));
      setF((p: any) => ({
        ...p,
        comision_propia_pct: propia ?? (p.comision_propia_pct === "" ? "" : p.comision_propia_pct),
        comision_revende_pct: p.comision_revende_pct === "" ? (c.comision_revende_pct ?? "") : p.comision_revende_pct,
      }));
    }).catch(() => {});
  }, [cliente?.id, esNuevo]);

  async function buscarArca() {
    const cuit = (f.cuit || "").replace(/\D/g, "");
    if (cuit.length !== 11) { setArca("El CUIT debe tener 11 dígitos."); return; }
    setArca("Buscando en ARCA…");
    try {
      const r = await fetch("/api/consultar-cuit?cuit=" + cuit); const d = await r.json();
      if (!d.ok || d.valido === false) throw new Error(d.error || "CUIT sin datos");
      const dom = d.domicilio || {};
      const nom = d.razonSocial || d.denominacion || [d.nombre, d.apellido].filter(Boolean).join(" ");
      // La RAZÓN SOCIAL es el dato legal de AFIP: ARCA manda (pisa lo tipeado). El resto se completa si está vacío.
      setF((p: any) => ({ ...p, razon_social: d.razonSocial || d.denominacion || p.razon_social || "", nombre: p.nombre || nom || "", domicilio: p.domicilio || dom.direccion || "", localidad: p.localidad || dom.localidad || "", provincia: p.provincia || dom.provincia || "", cod_postal: p.cod_postal || dom.codPostal || "" }));
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
        // Datos de envío: se guardan como JSONB (y sincroniza la columna `transporte`).
        const envioOrig = JSON.stringify((cliente as any).envio || {});
        const envioLimpio: any = {}; for (const k of Object.keys(envioForm)) envioLimpio[k] = String(envioForm[k] ?? "").trim();
        if (JSON.stringify(envioLimpio) !== envioOrig) { await patch("envio", envioLimpio); (cliente as any).envio = envioLimpio; }
      }
      onSaved();
    } catch (e: any) { alert("Error: " + e.message); } finally { setSaving(false); }
  }

  async function eliminar() {
    if (!cliente) return;
    // El backend decide: permite borrar si es un DUPLICADO (hay otro contacto con el mismo
    // email/CUIT/WhatsApp que hereda las operaciones); bloquea si es el único con historial.
    const motivo = prompt("¿Por qué eliminás este contacto del CRM?");
    if (motivo === null) return;
    const r = await fetch(`/api/clientes/${cliente.id}?motivo=${encodeURIComponent(motivo)}`, { method: "DELETE" });
    const d = await r.json();
    if (d.ok) onSaved(); else alert("⚠️ " + (d.error || "No se pudo eliminar."));
  }

  const [tab, setTab] = useState<"datos" | "operaciones" | "envio">(initialTab || "datos");
  const lbl = "flex flex-col gap-1 text-[11px] font-semibold text-gray-600";
  const inp = "border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm";
  return (
    <div className="fixed inset-0 bg-black/45 z-[9999] overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-3xl mx-auto my-8 p-7 relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-5 text-2xl text-gray-400">✕</button>
        <h2 className="text-lg font-bold mb-1">{esNuevo ? "＋ Nuevo cliente" : "✏️ " + (f.nombre || "Cliente")}</h2>
        {!esNuevo && (
          <div className="flex gap-1 mb-4 border-b border-gray-200 -mx-1">
            {([["datos", "Datos"], ["envio", "🚚 Datos Envíos"], ["operaciones", "Operaciones / Cuenta"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${tab === k ? "border-febo-azul text-febo-azul" : "border-transparent text-gray-400 hover:text-gray-600"}`}>{l}{k === "envio" && !esNuevo ? <span className={envioOk ? "text-emerald-500" : "text-amber-500"}> {envioOk ? "✅" : "⏳"}</span> : null}</button>
            ))}
          </div>
        )}
        {!esNuevo && tab === "operaciones" ? (
          <OperacionesTab clienteId={cliente!.id} />
        ) : !esNuevo && tab === "envio" ? (
          <div>
            <div className={`rounded-lg px-3 py-2 mb-3 text-[12px] font-semibold ${envioOk ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-amber-50 text-amber-700 border border-amber-200"}`}>
              {envioOk ? "✅ Datos de envío completos — el remito se puede generar." : `⏳ Datos de envío pendientes — falta: ${envioFalta.map((k) => ({ nombre: "destinatario", direccion: "dirección", localidad: "localidad", provincia: "provincia" } as any)[k] || k).join(", ")}.`}
              <div className="font-normal text-[11px] mt-0.5 opacity-80">Estos datos son la fuente única: se ven (no editables) en el pedido y habilitan el remito. El cliente también puede cargarlos desde el link de envío.</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className={lbl + " col-span-2"}>📦 NOMBRE Y APELLIDO / RAZÓN SOCIAL *<input value={envioForm.nombre} onChange={(e) => setE("nombre", e.target.value)} className={inp} /></label>
              <label className={lbl}>DNI / CUIT<input value={envioForm.dni} onChange={(e) => setE("dni", e.target.value)} className={inp} /></label>
              <label className={lbl}>TELÉFONO DE CONTACTO<input value={envioForm.telefono} onChange={(e) => setE("telefono", e.target.value)} className={inp} placeholder="WhatsApp o celular" /></label>
              <label className={lbl + " col-span-2"}>DIRECCIÓN DE ENTREGA *<input value={envioForm.direccion} onChange={(e) => setE("direccion", e.target.value)} className={inp} placeholder="Calle, número, piso/depto" /></label>
              <label className={lbl}>PROVINCIA *<input value={envioForm.provincia} onChange={(e) => setE("provincia", e.target.value)} className={inp} /></label>
              <label className={lbl}>LOCALIDAD / CIUDAD *<input value={envioForm.localidad} onChange={(e) => setE("localidad", e.target.value)} className={inp} /></label>
              <label className={lbl}>CÓDIGO POSTAL<input value={envioForm.cp} onChange={(e) => setE("cp", e.target.value)} className={inp} /></label>
              <label className={lbl}>EMAIL<input value={envioForm.email} onChange={(e) => setE("email", e.target.value)} className={inp} /></label>
              <div className="col-span-2 border-t border-gray-100 mt-1 pt-2 text-[11px] font-bold text-gray-400 uppercase">🚚 Transporte</div>
              <label className={lbl + " col-span-2"}>EMPRESA DE TRANSPORTE
                <input value={envioForm.empresa} onChange={(e) => setE("empresa", e.target.value)} list="cli-transportes-envio" className={inp} placeholder={(envioForm.provincia || envioForm.localidad) ? "Elegí de la lista (sugeridos por zona) o escribí…" : "Cargá localidad/provincia para ver sugerencias"} />
                <datalist id="cli-transportes-envio">{[...sugeridos, ...transportes.filter((t: any) => !sugeridos.some((s: any) => s.id === t.id))].map((t: any) => <option key={t.id} value={t.nombre} />)}</datalist>
                {sugeridos.length > 0 && <span className="text-[10px] text-emerald-600 font-normal">✓ {sugeridos.length} sugeridos por zona ({envioForm.localidad || envioForm.provincia}) — la lista incluye TODOS los transportes</span>}
              </label>
              <label className={lbl + " col-span-2"}>TIPO DE ENVÍO<select value={envioForm.tipo_envio} onChange={(e) => setE("tipo_envio", e.target.value)} className={inp}>{TIPOS_ENVIO.map((t) => <option key={t} value={t}>{t || "Seleccioná…"}</option>)}</select></label>
              <label className={lbl + " col-span-2"}>DOMICILIO DE LA SUCURSAL<input value={envioForm.domicilio_transporte} onChange={(e) => setE("domicilio_transporte", e.target.value)} className={inp} placeholder="Si es a sucursal de transporte" /></label>
              <label className={lbl}>TELÉFONO DEL TRANSPORTE<input value={envioForm.telefono_transporte} onChange={(e) => setE("telefono_transporte", e.target.value)} className={inp} /></label>
              <label className={lbl}>CUIT DEL TRANSPORTE<input value={envioForm.cuit_transporte} onChange={(e) => setE("cuit_transporte", e.target.value)} className={inp} placeholder="Sale en el remito" /></label>
            </div>
          </div>
        ) : (
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 grid grid-cols-[1fr_auto] gap-2 items-end">
            <span className={lbl}>CUIT<input value={f.cuit} onChange={(e) => set("cuit", e.target.value)} className={inp + " w-full"} /></span>
            <button onClick={buscarArca} className="bg-febo-cyan text-white rounded-lg px-3 h-[34px] text-sm">🔍 ARCA</button>
          </label>
          {arca && <div className="col-span-2 text-[11px] -mt-2" style={{ color: arca.startsWith("✓") ? "#059669" : "#e53935" }}>{arca}</div>}
          <label className={lbl + " col-span-2"}>NOMBRE Y APELLIDO<input value={f.nombre} onChange={(e) => set("nombre", e.target.value)} className={inp} /></label>
          <label className={lbl + " col-span-2"}>RAZÓN SOCIAL / EMPRESA (oficial ARCA)
            <input value={f.razon_social} readOnly title="Se completa automáticamente desde ARCA (dato legal de AFIP). Usá el botón 🔍 ARCA." className={inp + " bg-gray-100 text-gray-700 cursor-not-allowed"} placeholder="Se completa desde ARCA" />
          </label>
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
          {!esNuevo && <div className="col-span-2 text-[11px] text-gray-400">🚚 El transporte y los datos de envío están en la pestaña <b>Datos Envíos</b>.</div>}
          <label className={lbl + " col-span-2"}>NOTAS<textarea value={f.notas} onChange={(e) => set("notas", e.target.value)} rows={2} className={inp} /></label>
          {esRevendedor(f.tipo) && (
            <div className="col-span-2 rounded-lg border border-violet-200 bg-violet-50/40 p-3 mt-1">
              <div className="text-[12px] font-bold text-violet-700 mb-2">🤝 Revendedor — comisiones y clientes finales</div>
              <div className="grid grid-cols-2 gap-3">
                <label className={lbl}>COMISIÓN % — compra para sí
                  <input type="number" value={f.comision_propia_pct} onChange={(e) => set("comision_propia_pct", e.target.value)} className={inp} placeholder="0" /></label>
                <label className={lbl}>COMISIÓN % — venta a su cliente
                  <input type="number" value={f.comision_revende_pct} onChange={(e) => set("comision_revende_pct", e.target.value)} className={inp} placeholder="0" /></label>
              </div>
              {esNuevo
                ? <div className="text-[11px] text-gray-500 mt-2">Guardá el revendedor para poder cargar sus clientes finales (a quienes se factura).</div>
                : <ClientesFinales revendedorId={cliente!.id} />}
            </div>
          )}
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
        {!esNuevo && tab === "datos" && (
          <div className="mt-5 border border-gray-200 rounded-lg p-3">
            <button onClick={() => setFusionOpen((o) => !o)} className="text-sm font-semibold text-febo-azul">🔀 Fusionar con otro cliente (eliminar duplicado)</button>
            {fusionOpen && (
              <div className="mt-2">
                <div className="text-[11px] text-gray-500 mb-1">Buscá el cliente que querés <b>conservar</b>. Las operaciones de <b>{f.nombre || "este contacto"}</b> pasan a ese y este se elimina.</div>
                <input value={fq} onChange={(e) => setFq(e.target.value)} placeholder="Buscar cliente a conservar…" className={inp} />
                {fres.length > 0 && (
                  <div className="border border-gray-200 rounded-lg mt-1 max-h-44 overflow-auto">
                    {fres.map((r) => (
                      <button key={r.id} onClick={() => fusionar(r.id, r.nombre || r.razon_social || "cliente #" + r.id)} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50">
                        <b>{r.nombre || r.razon_social || "—"}</b> <span className="text-gray-400 text-xs">{[r.email, r.whatsapp, r.localidad].filter(Boolean).join(" · ")}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {(esNuevo || tab === "datos" || tab === "envio") && (
        <div className="flex justify-between items-center mt-6">
          {esNuevo || tab !== "datos" ? <span /> : <button onClick={eliminar} className="bg-red-50 text-red-700 border border-red-200 rounded-lg px-4 py-2 text-sm font-semibold">🗑 Eliminar del CRM</button>}
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
  // TC de cada movimiento: factura → TC pactado del comprobante; pago → su TC; si no, dólar del día.
  const tcDe = (m: any) => Number(m.comp_tc) || Number(m.detalle?.tc) || dolar || 0;
  const pesosDe = (m: any) => ((Number(m.debe) || 0) - (Number(m.haber) || 0)) * tcDe(m);
  // Saldo en PESOS al TC pactado de cada factura (coincide con "Facturado"), no al dólar del día.
  const saldoPesos = Math.round(movs.reduce((a, m) => a + pesosDe(m), 0));
  const fmt$ = (n: number) => "$ " + Math.round(n).toLocaleString("es-AR");
  let acumP = 0;
  return (
    <div className="mb-3 rounded-lg border border-gray-200 bg-white">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-3 py-2 text-sm">
        <span className="font-semibold text-febo-azul">💳 Cuenta corriente</span>
        <span className="flex items-center gap-2">
          <b className={saldoPesos > 1 ? "text-red-600" : "text-emerald-600"}>{fmt$(saldoPesos)}<span className="text-gray-400 font-normal text-[11px]"> · USD {saldo.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</span></b>
          <span className="text-gray-400 text-xs">{saldoPesos > 1 ? "(nos debe)" : "(al día)"}</span>
          <span className="text-gray-400">{open ? "▲" : "▼"}</span>
        </span>
      </button>
      {open && <div className="border-t border-gray-100 px-3 py-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase text-gray-400"><tr><th className="text-left py-1">Fecha</th><th className="text-left py-1">Concepto</th><th className="text-right py-1">Debe</th><th className="text-right py-1">Haber</th><th className="text-right py-1">Saldo</th></tr></thead>
          <tbody>
            {movs.map((m, i) => { const tc = tcDe(m); const d = (Number(m.debe) || 0) * tc, h = (Number(m.haber) || 0) * tc; acumP += d - h; return (
              <tr key={i} className="border-t border-gray-100">
                <td className="py-1 text-gray-500 whitespace-nowrap">{m.fecha ? new Date(m.fecha).toLocaleDateString("es-AR") : "—"}</td>
                <td className="py-1">{m.concepto}{m.comprobante ? " · " + m.comprobante : ""}</td>
                <td className="py-1 text-right tabular-nums text-gray-600">{d ? fmt$(d) : ""}</td>
                <td className="py-1 text-right tabular-nums text-gray-600">{h ? fmt$(h) : ""}</td>
                <td className="py-1 text-right tabular-nums font-semibold">{fmt$(acumP)}</td>
              </tr>
            ); })}
          </tbody>
        </table>
        <div className="text-[10px] text-gray-400 mt-1">Importes en pesos al TC pactado de cada comprobante.</div>
      </div>}
    </div>
  );
}

// Clientes finales de un revendedor: a ellos se les factura (datos fiscales propios).
function ClientesFinales({ revendedorId }: { revendedorId: number }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [add, setAdd] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [f, setF] = useState<any>({});
  const [arca, setArca] = useState(""); const [saving, setSaving] = useState(false);
  const lbl = "flex flex-col gap-1 text-[11px] font-semibold text-gray-600";
  const inp = "border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm";

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/clientes/${revendedorId}/finales`).then((r) => r.json()).then((d) => { setRows(d.ok ? d.finales : []); setLoading(false); }).catch(() => setLoading(false));
  }, [revendedorId]);
  useEffect(() => { load(); }, [load]);

  const abrirNuevo = () => { setF({ condicion_fiscal: "" }); setArca(""); setEdit(null); setAdd(true); };
  const abrirEdit = (r: any) => { setF({ ...r }); setArca(""); setAdd(false); setEdit(r); };
  const cerrar = () => { setAdd(false); setEdit(null); setF({}); setArca(""); };
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));

  async function buscarArca() {
    const cuit = (f.cuit || "").replace(/\D/g, "");
    if (cuit.length !== 11) { setArca("El CUIT debe tener 11 dígitos."); return; }
    setArca("Buscando en ARCA…");
    try {
      const r = await fetch("/api/consultar-cuit?cuit=" + cuit); const d = await r.json();
      if (!d.ok || d.valido === false) throw new Error(d.error || "CUIT sin datos");
      const dom = d.domicilio || {};
      const nom = d.razonSocial || d.denominacion || [d.nombre, d.apellido].filter(Boolean).join(" ");
      // La RAZÓN SOCIAL es el dato legal de AFIP: ARCA manda (pisa lo tipeado). El resto se completa si está vacío.
      setF((p: any) => ({ ...p, razon_social: d.razonSocial || d.denominacion || p.razon_social || "", nombre: p.nombre || nom || "", domicilio: p.domicilio || dom.direccion || "", localidad: p.localidad || dom.localidad || "", provincia: p.provincia || dom.provincia || "", cod_postal: p.cod_postal || dom.codPostal || "" }));
      setArca("✓ " + (nom || cuit));
    } catch (e: any) { setArca("✕ " + e.message); }
  }

  async function guardar() {
    if (!(f.nombre || f.razon_social || "").trim()) { alert("Cargá al menos nombre o razón social."); return; }
    setSaving(true);
    try {
      if (edit) {
        const id = edit.id;
        const campos = ["nombre", "razon_social", "cuit", "condicion_fiscal", "domicilio", "localidad", "provincia", "cod_postal", "email", "whatsapp"];
        for (const k of campos) {
          const nv = (f[k] ?? "").toString().trim() || null;
          if (nv !== ((edit[k] ?? null) || null)) {
            const r = await fetch(`/api/clientes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field: k, value: nv }) });
            const d = await r.json(); if (!d.ok) throw new Error(d.error);
          }
        }
      } else {
        const r = await fetch(`/api/clientes/${revendedorId}/finales`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
        const d = await r.json(); if (!d.ok) throw new Error(d.error);
      }
      cerrar(); load();
    } catch (e: any) { alert("Error: " + e.message); } finally { setSaving(false); }
  }

  async function eliminar(r: any) {
    if (!confirm(`¿Eliminar el cliente final "${r.razon_social || r.nombre}"?`)) return;
    const res = await fetch(`/api/clientes/${r.id}?motivo=${encodeURIComponent("cliente final eliminado")}`, { method: "DELETE" });
    const d = await res.json();
    if (d.ok) load(); else alert("⚠️ " + (d.error || "No se pudo eliminar."));
  }

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[11px] font-semibold text-gray-600">CLIENTES FINALES (a quienes se factura)</div>
        {!add && !edit && <button onClick={abrirNuevo} className="text-[12px] font-semibold text-febo-azul">＋ Agregar</button>}
      </div>
      {loading ? <div className="text-[11px] text-gray-400 py-2">Cargando…</div>
        : (add || edit) ? (
          <div className="rounded-lg border border-gray-200 bg-white p-3 grid grid-cols-2 gap-2">
            <label className="col-span-2 grid grid-cols-[1fr_auto] gap-2 items-end">
              <span className={lbl}>CUIT<input value={f.cuit || ""} onChange={(e) => set("cuit", e.target.value)} className={inp + " w-full"} /></span>
              <button type="button" onClick={buscarArca} className="bg-febo-cyan text-white rounded-lg px-3 h-[34px] text-sm">🔍 ARCA</button>
            </label>
            {arca && <div className="col-span-2 text-[11px] -mt-1" style={{ color: arca.startsWith("✓") ? "#059669" : "#e53935" }}>{arca}</div>}
            <label className={lbl + " col-span-2"}>NOMBRE / CONTACTO<input value={f.nombre || ""} onChange={(e) => set("nombre", e.target.value)} className={inp} /></label>
            <label className={lbl + " col-span-2"}>RAZÓN SOCIAL (oficial ARCA)
              <input value={f.razon_social || ""} readOnly title="Se completa automáticamente desde ARCA. Usá el botón 🔍 ARCA." className={inp + " bg-gray-100 text-gray-700 cursor-not-allowed"} placeholder="Se completa desde ARCA" />
            </label>
            <label className={lbl}>CONDICIÓN FISCAL<select value={f.condicion_fiscal || ""} onChange={(e) => set("condicion_fiscal", e.target.value)} className={inp}>
              <option value="">— sin datos —</option>
              <option value="responsable_inscripto">Responsable Inscripto</option>
              <option value="monotributista">Monotributista</option>
              <option value="consumidor_final">Consumidor Final</option>
              <option value="exento">Exento</option>
            </select></label>
            <label className={lbl}>EMAIL<input value={f.email || ""} onChange={(e) => set("email", e.target.value)} className={inp} /></label>
            <label className={lbl}>WHATSAPP<input value={f.whatsapp || ""} onChange={(e) => set("whatsapp", e.target.value)} className={inp} /></label>
            <label className={lbl}>PROVINCIA<input value={f.provincia || ""} onChange={(e) => set("provincia", e.target.value)} className={inp} /></label>
            <label className={lbl}>LOCALIDAD<input value={f.localidad || ""} onChange={(e) => set("localidad", e.target.value)} className={inp} /></label>
            <label className={lbl}>CÓDIGO POSTAL<input value={f.cod_postal || ""} onChange={(e) => set("cod_postal", e.target.value)} className={inp} /></label>
            <label className={lbl + " col-span-2"}>DOMICILIO<input value={f.domicilio || ""} onChange={(e) => set("domicilio", e.target.value)} className={inp} /></label>
            <div className="col-span-2 flex justify-end gap-2 mt-1">
              <button onClick={cerrar} className="border border-gray-300 rounded-lg px-4 py-1.5 text-sm">Cancelar</button>
              <button onClick={guardar} disabled={saving} className="bg-febo-azul text-white rounded-lg px-5 py-1.5 text-sm font-semibold disabled:opacity-50">{saving ? "Guardando…" : edit ? "Guardar" : "Agregar"}</button>
            </div>
          </div>
        ) : rows.length === 0 ? <div className="text-[11px] text-gray-400 py-1">Sin clientes finales cargados.</div>
          : (
            <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
              {rows.map((r) => (
                <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <div className="flex-1">
                    <span className="font-semibold">{r.razon_social || r.nombre || "—"}</span>
                    <span className="text-gray-400 text-xs ml-2">{[r.cuit, r.condicion_fiscal, r.localidad].filter(Boolean).join(" · ")}</span>
                  </div>
                  <button onClick={() => abrirEdit(r)} className="text-gray-400 hover:text-febo-azul" title="Editar">✏️</button>
                  <button onClick={() => eliminar(r)} className="text-gray-300 hover:text-red-500" title="Eliminar">🗑</button>
                </div>
              ))}
            </div>
          )}
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

// Modal de ficha de cliente AUTÓNOMO: se abre como overlay encima de cualquier ventana
// (Ventas, Proveedores, etc.) sin cambiar la ventana de fondo. ESC/✕ cierran y seguís donde estabas.
export function ClienteFichaModal({ clienteId, tab, onClose }: { clienteId: number; tab?: "datos" | "operaciones"; onClose: () => void }) {
  const [cli, setCli] = useState<Cliente | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let vivo = true;
    fetch(`/api/clientes/${clienteId}`).then((r) => r.json()).then((d) => {
      if (!vivo) return; if (d.ok) setCli(d.cliente); else setErr(d.error || "No encontrado");
    }).catch((e) => vivo && setErr(e.message));
    return () => { vivo = false; };
  }, [clienteId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (err) return <div className="fixed inset-0 bg-black/45 z-[9999] flex items-center justify-center" onClick={onClose}><div className="bg-white rounded-xl p-6 text-sm text-gray-600" onClick={(e) => e.stopPropagation()}>⚠️ {err}</div></div>;
  if (!cli) return null;
  return <ClienteModal cliente={cli} initialTab={tab} onClose={onClose} onSaved={onClose} />;
}
