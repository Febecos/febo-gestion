"use client";
import { useEffect, useState } from "react";
import { TIPOS_COMPROBANTE, tipoPorCodigo } from "@/lib/talonarios-tipos";

const chip = (txt: string, color: string) => (
  <span style={{ background: color + "1a", color }} className="rounded px-2 py-0.5 text-[11px] font-semibold">{txt}</span>
);

const SECCIONES = [
  { k: "empresa", icon: "🏢", label: "Datos de la empresa (AFIP)" },
  { k: "talonarios", icon: "🔢", label: "Talonarios / Numeración" },
  { k: "arca", icon: "📋", label: "Monitor normativa ARCA" },
] as const;
type Sec = (typeof SECCIONES)[number]["k"];

export default function ConfigClient() {
  const [sec, setSec] = useState<Sec>("talonarios");
  const [denied, setDenied] = useState(false);
  useEffect(() => { fetch("/api/me").then((r) => r.json()).then((d) => { if (!d.ok || !d.es_owner) setDenied(true); }); }, []);
  if (denied) return <div className="p-8 text-center text-gray-500">🔒 Sección exclusiva del administrador (owner).</div>;
  return (
    <div className="flex gap-4 h-full">
      <aside className="w-52 shrink-0 border-r border-gray-200 pr-2">
        <div className="text-[11px] uppercase text-gray-400 font-bold px-2 py-2">⚙️ Configuración</div>
        {SECCIONES.map((s) => (
          <button key={s.k} onClick={() => setSec(s.k)} className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-left mb-0.5 ${sec === s.k ? "bg-febo-azul text-white font-semibold" : "text-gray-600 hover:bg-gray-100"}`}>
            <span>{s.icon}</span><span>{s.label}</span>
          </button>
        ))}
      </aside>
      <div className="flex-1 min-w-0 overflow-auto">{sec === "empresa" ? <Empresa /> : sec === "arca" ? <MonitorArca /> : <Talonarios />}</div>
    </div>
  );
}

function MonitorArca() {
  const [activo, setActivo] = useState<boolean | null>(null);
  const [info, setInfo] = useState<any>({}); const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/arca-monitor").then((r) => r.json()).then((d) => { if (d.ok) { setActivo(!!d.activo); setInfo(d); } }); }, []);
  const toggle = async () => {
    setBusy(true);
    const r = await fetch("/api/arca-monitor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activo: !activo }) });
    const d = await r.json(); if (d.ok) setActivo(d.activo); setBusy(false);
  };
  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-bold text-febo-azul mb-1">📋 Monitor de normativa ARCA</h2>
      <div className="text-sm text-gray-500 mb-4">Una vez por mes, Claude revisa la normativa ARCA de <b>facturación</b> y, si hay cambios relevantes, te avisa por email a <b>guille.aol@gmail.com</b>. Está pensado para tener al día la facturación electrónica.</div>
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">{activo === null ? "…" : activo ? "✅ Monitor ACTIVO" : "⏸️ Monitor desactivado"}</div>
            <div className="text-xs text-gray-500 mt-0.5">{activo ? "Corre el día 1 de cada mes." : "No se ejecuta hasta que lo actives."}</div>
          </div>
          <button onClick={toggle} disabled={busy || activo === null}
            className={`px-4 py-2 rounded-lg text-white text-sm font-semibold ${activo ? "bg-gray-500 hover:bg-gray-600" : "bg-emerald-500 hover:bg-emerald-600"} disabled:opacity-50`}>
            {busy ? "…" : activo ? "Desactivar" : "Activar monitor"}
          </button>
        </div>
        {info.last_run && <div className="text-xs text-gray-500 mt-3 border-t border-gray-100 pt-3">Última revisión: {new Date(info.last_run).toLocaleString("es-AR")}{info.last_summary ? " · " + String(info.last_summary).slice(0, 200) : ""}</div>}
      </div>
      <div className="text-[11px] text-gray-400 mt-3">⚠️ Orientativo: validá siempre con tu contador antes de aplicar cambios a la facturación.</div>
    </div>
  );
}

function Empresa() {
  const [e, setE] = useState<any>(null); const [loading, setLoading] = useState(true);
  const [arca, setArca] = useState(""); const [msg, setMsg] = useState("");
  useEffect(() => { fetch("/api/empresa").then((r) => r.json()).then((d) => { setE(d.empresa || {}); setLoading(false); }); }, []);
  const patch = async (campo: string, valor: any) => {
    setE((p: any) => ({ ...p, [campo]: valor }));
    await fetch("/api/empresa", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campo, valor }) });
    setMsg("Guardado ✓"); setTimeout(() => setMsg(""), 1500);
  };
  const traerArca = async () => {
    const cuit = String(e.cuit || "").replace(/\D/g, "");
    if (cuit.length !== 11) { setArca("El CUIT debe tener 11 dígitos."); return; }
    setArca("Buscando en ARCA…");
    try {
      const r = await fetch("/api/consultar-cuit?cuit=" + cuit); const d = await r.json();
      if (!d.ok || d.valido === false) throw new Error(d.error || "CUIT sin datos");
      const dom = d.domicilio || {};
      const bulk: any = {
        razon_social: d.razonSocial || d.denominacion || [d.nombre, d.apellido].filter(Boolean).join(" "),
        domicilio: dom.direccion || "", localidad: dom.localidad || "", provincia: dom.provincia || "",
        cod_postal: dom.codPostal || "", condicion_iva: d.condicionFiscal || d.condicion_iva || "",
      };
      setE((p: any) => ({ ...p, ...bulk }));
      await fetch("/api/empresa", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bulk }) });
      setArca("✓ " + (bulk.razon_social || cuit));
    } catch (err: any) { setArca("✕ " + err.message); }
  };
  if (loading) return <div className="text-gray-400 py-8 text-center">Cargando…</div>;
  const lbl = "block text-[11px] uppercase text-gray-500 font-semibold mb-1";
  const inp = "w-full border border-gray-300 rounded px-2 py-1.5 text-sm";
  const Fld = (campo: string, label: string, span = false) => (
    <label key={campo} className={span ? "col-span-2" : ""}><span className={lbl}>{label}</span>
      <input defaultValue={e[campo] ?? ""} onBlur={(ev) => ev.target.value !== (e[campo] ?? "") && patch(campo, ev.target.value)} className={inp} /></label>
  );
  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-bold text-febo-azul mb-1">🏢 Datos de la empresa (AFIP)</h2>
      <div className="text-sm text-gray-500 mb-3">Datos legales del emisor según ARCA/AFIP. Se usan como <b>sucursal / domicilio fiscal</b> por defecto en los talonarios y comprobantes.</div>
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-end gap-2 mb-4">
          <label className="flex-1"><span className={lbl}>CUIT</span>
            <input defaultValue={e.cuit ?? ""} onBlur={(ev) => ev.target.value !== (e.cuit ?? "") && patch("cuit", ev.target.value)} className={inp} placeholder="30xxxxxxxxx" /></label>
          <button onClick={traerArca} className="bg-febo-cyan text-white rounded-lg px-3 h-[34px] text-sm whitespace-nowrap">🔍 Traer de ARCA</button>
        </div>
        {arca && <div className="text-[11px] mb-3 -mt-2" style={{ color: arca.startsWith("✓") ? "#059669" : "#e53935" }}>{arca}</div>}
        <div className="grid grid-cols-2 gap-3">
          {Fld("razon_social", "Razón social", true)}
          {Fld("nombre_fantasia", "Nombre de fantasía", true)}
          {Fld("domicilio", "Domicilio fiscal", true)}
          {Fld("localidad", "Localidad")}
          {Fld("provincia", "Provincia")}
          {Fld("cod_postal", "Código postal")}
          {Fld("condicion_iva", "Condición frente al IVA")}
          {Fld("iibb", "Ingresos Brutos")}
          {Fld("inicio_actividades", "Inicio de actividades")}
        </div>
        {msg && <div className="text-[11px] text-green-600 mt-3">{msg}</div>}
      </div>
    </div>
  );
}

function Talonarios() {
  const [rows, setRows] = useState<any[]>([]); const [loading, setLoading] = useState(true); const [err, setErr] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [nuevoTipo, setNuevoTipo] = useState("");
  const load = () => fetch("/api/talonarios").then((r) => r.json()).then((d) => { if (d.ok) setRows(d.talonarios); else setErr(d.error || "Error"); setLoading(false); });
  useEffect(() => { load(); }, []);
  const crear = async () => {
    if (!nuevoTipo) return;
    const r = await fetch("/api/talonarios", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo_codigo: nuevoTipo }) });
    const d = await r.json(); if (d.ok) { setNuevoTipo(""); load(); setEditId(d.id); }
  };
  if (loading) return <div className="text-gray-400 py-8 text-center">Cargando…</div>;
  if (err) return <div className="text-red-600 py-8 text-center">{err}</div>;
  const fmtNum = (n: any) => n == null ? "—" : String(n).padStart(8, "0");
  return (
    <div>
      <h2 className="text-lg font-bold text-febo-azul mb-1">🔢 Talonarios / Numeración</h2>
      <div className="text-sm text-gray-500 mb-3">Numeración por comprobante (igual a Táctica). Las facturas/NC/ND <b>no electrónicas</b> generan <b>proforma</b>; las electrónicas (AFIP) quedan para más adelante.</div>

      <div className="flex items-center gap-2 mb-3">
        <select value={nuevoTipo} onChange={(e) => setNuevoTipo(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
          <option value="">+ Nuevo talonario — elegí tipo…</option>
          <optgroup label="Operativos">{TIPOS_COMPROBANTE.filter(t => t.grupo === "operativo").map(t => <option key={t.codigo} value={t.codigo}>{t.codigo} · {t.nombre}</option>)}</optgroup>
          <optgroup label="Facturas">{TIPOS_COMPROBANTE.filter(t => t.grupo === "factura").map(t => <option key={t.codigo} value={t.codigo}>{t.codigo} · {t.nombre}</option>)}</optgroup>
          <optgroup label="Notas de Crédito">{TIPOS_COMPROBANTE.filter(t => t.grupo === "nc").map(t => <option key={t.codigo} value={t.codigo}>{t.codigo} · {t.nombre}</option>)}</optgroup>
          <optgroup label="Notas de Débito">{TIPOS_COMPROBANTE.filter(t => t.grupo === "nd").map(t => <option key={t.codigo} value={t.codigo}>{t.codigo} · {t.nombre}</option>)}</optgroup>
        </select>
        <button onClick={crear} disabled={!nuevoTipo} className="px-3 py-1.5 rounded-lg bg-febo-azul text-white text-sm font-semibold disabled:opacity-40">➕ Agregar</button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr>
            <th className="text-left px-3 py-3">Tipo</th><th className="text-left px-3 py-3">Pto. vta</th><th className="text-left px-3 py-3">Serie</th>
            <th className="text-right px-3 py-3">Próximo</th><th className="text-left px-3 py-3">Vto.</th>
            <th className="text-center px-3 py-3">Defecto</th><th className="text-center px-3 py-3">Activo</th><th className="text-center px-3 py-3">Bloq.</th><th></th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={9} className="text-center py-8 text-gray-400">Sin talonarios. Agregá uno arriba.</td></tr> :
            rows.map((t) => (
              <tr key={t.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2"><div className="font-semibold">{t.tipo_nombre}</div><div className="text-[10px] text-gray-400 font-mono">{t.tipo_codigo}{t.electronica ? " · AFIP" : " · proforma"}</div></td>
                <td className="px-3 py-2 font-mono">{t.sucursal}</td>
                <td className="px-3 py-2">{t.serie || "—"}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">{fmtNum(t.proximo_numero)}</td>
                <td className="px-3 py-2 text-gray-500">{t.vencimiento ? String(t.vencimiento).slice(0, 10) : "—"}</td>
                <td className="px-3 py-2 text-center">{t.defecto ? "✔" : ""}</td>
                <td className="px-3 py-2 text-center">{t.activo ? chip("activo", "#16a34a") : chip("inactivo", "#94a3b8")}</td>
                <td className="px-3 py-2 text-center">{t.bloqueado ? "🔒" : ""}</td>
                <td className="px-3 py-2 text-right"><button onClick={() => setEditId(t.id)} className="text-febo-azul hover:underline text-xs">✏️ Editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editId != null && <TalonarioModal tal={rows.find((r) => r.id === editId)} onClose={() => setEditId(null)} onSaved={load} />}
    </div>
  );
}

function TalonarioModal({ tal, onClose, onSaved }: { tal: any; onClose: () => void; onSaved: () => void }) {
  const [t, setT] = useState({ ...tal });
  const tipo = tipoPorCodigo(t.tipo_codigo);
  const esFactura = tipo && (tipo.grupo === "factura" || tipo.grupo === "nc" || tipo.grupo === "nd");
  const patch = async (campo: string, valor: any) => {
    setT((p: any) => ({ ...p, [campo]: valor }));
    await fetch("/api/talonarios", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, campo, valor }) });
    onSaved();
  };
  const del = async () => { if (!confirm("¿Eliminar este talonario?")) return; await fetch("/api/talonarios?id=" + t.id, { method: "DELETE" }); onSaved(); onClose(); };
  const lbl = "block text-[11px] uppercase text-gray-500 font-semibold mb-1";
  const inp = "w-full border border-gray-300 rounded px-2 py-1.5 text-sm";
  // Funciones (NO componentes) → no remontan el input, así el date-picker funciona
  const F = (campo: string, label: string, type = "text") => (
    <label key={campo}><span className={lbl}>{label}</span>
      <input type={type} defaultValue={type === "date" ? (t[campo] ? String(t[campo]).slice(0, 10) : "") : (t[campo] ?? "")}
        onChange={type === "date" ? (e) => patch(campo, e.target.value) : undefined}
        onBlur={type !== "date" ? (e) => String(e.target.value) !== String(t[campo] ?? "") && patch(campo, e.target.value) : undefined}
        className={inp} /></label>
  );
  const C = (campo: string, label: string) => (
    <label key={campo} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!t[campo]} onChange={(e) => patch(campo, e.target.checked)} />{label}</label>
  );
  return (
    <div className="fixed inset-0 z-[130] bg-black/50 flex items-start justify-center overflow-auto py-6" onClick={onClose}>
      <div className="bg-white rounded-xl w-[620px] max-w-[96vw] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="bg-febo-azul text-white rounded-t-xl px-5 py-3 flex items-center justify-between">
          <div><div className="font-bold">Talonario · {t.tipo_nombre}</div><div className="text-xs opacity-80 font-mono">{t.tipo_codigo}{t.electronica ? " · Electrónica (AFIP)" : " · manual → proforma"}</div></div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-3">
          {F("serie", "Serie")}
          {F("sucursal", "Punto de venta / Sucursal")}
          <label className="col-span-2"><span className={lbl}>Dirección de sucursal (domicilio legal — se precarga desde Datos de empresa)</span><input defaultValue={t.direccion_sucursal ?? ""} onBlur={(e) => e.target.value !== (t.direccion_sucursal ?? "") && patch("direccion_sucursal", e.target.value)} className={inp} /></label>
          {F("modelo_impresora", "Modelo impresora")}
          {F("cantidad_max_items", "Cant. máx. de ítems", "number")}
          {F("nro_desde", "Desde", "number")}
          {F("nro_hasta", "Hasta", "number")}
          {F("proximo_numero", "Próximo número a emitir", "number")}
          {F("vencimiento", "Fecha de vencimiento", "date")}
          {esFactura && <>
            {F("cai", "CAI")}
            {F("nro_autorizacion", "Nº de autorización")}
            {F("fecha_autorizacion", "Fecha de autorización", "date")}
          </>}
          <div className="col-span-2 border-t border-gray-100 pt-3 grid grid-cols-2 gap-2">
            {C("es_bono_fiscal", "Es Bono Fiscal (solo factura electrónica)")}
            {C("informar_traslado", "Informar traslado (solo remitos)")}
            {C("excluir_facturacion", "Excluir de facturación (pedidos/remitos)")}
            {C("defecto", "Por defecto para este tipo")}
            {C("activo", "Activo")}
            {C("bloqueado", "Bloquear")}
          </div>
        </div>
        <div className="border-t border-gray-200 p-3 flex justify-between bg-gray-50 rounded-b-xl">
          <button onClick={del} className="text-red-500 text-sm hover:underline">🗑 Eliminar</button>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-febo-azul text-white text-sm font-semibold">Listo</button>
        </div>
      </div>
    </div>
  );
}
