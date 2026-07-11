"use client";
import { useState, useEffect } from "react";

// Pantalla "Parámetros de cálculo FV" (matriz viva). Edita fv_config (capa 2) que el motor dimensionar()
// lee EN VIVO. Optimizar la matriz = tunear acá, sin re-portar ni deploy. Grupos B–F de
// PARAMETROS-FV-CONFIG.md (los de precios A los maneja la config del cotizador aparte).

type Campo = { k: string; label: string; tipo: "num" | "pct" | "ratio" | "select" | "text"; min?: number; max?: number; step?: number; opts?: string[] };
type Grupo = { titulo: string; aplica?: string; campos: Campo[] };

const GRUPOS: Grupo[] = [
  { titulo: "Dimensionado — on-grid", aplica: "ON-GRID", campos: [
    { k: "cobertura_objetivo", label: "Cobertura objetivo", tipo: "ratio", min: 0.3, max: 1.5, step: 0.05 },
    { k: "ratio_min", label: "Oversizing DC/AC mínimo", tipo: "ratio", min: 1.0, max: 1.4, step: 0.01 },
    { k: "ratio_max", label: "Oversizing DC/AC máximo", tipo: "ratio", min: 1.0, max: 1.5, step: 0.01 },
    { k: "fraccion_diurna_default", label: "Fracción diurna (inyección cero)", tipo: "ratio", min: 0.2, max: 1.0, step: 0.05 },
  ] },
  { titulo: "Microinversor (sistemas chicos, inyección cero)", aplica: "ON-GRID", campos: [
    { k: "umbral_micro_paneles", label: "Umbral micro (≤ paneles)", tipo: "num", min: 1, max: 8, step: 1 },
    { k: "paneles_por_micro", label: "Paneles por micro", tipo: "num", min: 1, max: 4, step: 1 },
    { k: "micro_default", label: "Microinversor default (código)", tipo: "text" },
    { k: "codigo_micro_conector", label: "Conector trunk (código)", tipo: "text" },
    { k: "codigo_micro_endcap", label: "End cap trunk (código)", tipo: "text" },
  ] },
  { titulo: "Protecciones / embalaje", campos: [
    { k: "termica_min_a", label: "Térmica mínima (A)", tipo: "num", min: 10, max: 63, step: 1 },
    { k: "umbral_embalaje", label: "Umbral embalaje (≤ paneles)", tipo: "num", min: 1, max: 8, step: 1 },
    { k: "codigo_embalaje_x1", label: "Embalaje ×1 (código)", tipo: "text" },
    { k: "codigo_embalaje_x2", label: "Embalaje ×2 (código)", tipo: "text" },
  ] },
  { titulo: "Dimensionado — off-grid", aplica: "OFF-GRID", campos: [
    { k: "autonomia_dias", label: "Días de autonomía", tipo: "num", min: 1, max: 5, step: 1 },
    { k: "dod_litio", label: "DoD litio", tipo: "pct", min: 50, max: 100, step: 1 },
    { k: "dod_plomo", label: "DoD plomo", tipo: "pct", min: 30, max: 80, step: 1 },
    { k: "factor_autonomia_default", label: "Factor de autonomía", tipo: "ratio", min: 0.5, max: 1.5, step: 0.05 },
    { k: "pr_offgrid", label: "Performance ratio off-grid", tipo: "ratio", min: 0.5, max: 0.9, step: 0.01 },
    { k: "sobredim_paneles", label: "Sobredimensión paneles", tipo: "ratio", min: 1.0, max: 1.6, step: 0.05 },
    { k: "margen_inversor", label: "Margen del inversor", tipo: "ratio", min: 1.0, max: 1.5, step: 0.05 },
  ] },
  { titulo: "Validación de tensión", aplica: "con paneles", campos: [
    { k: "temp_diseno_frio", label: "Temp. diseño frío (°C)", tipo: "num", min: -25, max: 5, step: 1 },
    { k: "temp_diseno_calor", label: "Temp. diseño calor (°C)", tipo: "num", min: 45, max: 80, step: 1 },
    { k: "strings_por_mppt", label: "Máx. strings por MPPT", tipo: "num", min: 1, max: 3, step: 1 },
  ] },
  { titulo: "Armado del BOM", campos: [
    { k: "panel_default", label: "Panel de referencia (código)", tipo: "text" },
    { k: "estructura_default", label: "Estructura por defecto", tipo: "select", opts: ["chapa-inclinada", "chapa-coplanar", "teja", "suelo"] },
    { k: "paneles_por_estructura", label: "Paneles por kit de estructura", tipo: "num", min: 1, max: 10, step: 1 },
    { k: "metros_cable_default", label: "Cable solar (metros, default)", tipo: "num", min: 0, max: 500, step: 5 },
    { k: "metros_tierra_default", label: "Cable de tierra (metros, default)", tipo: "num", min: 0, max: 200, step: 5 },
    { k: "factor_proteccion", label: "Factor protecciones CA", tipo: "ratio", min: 1.1, max: 1.6, step: 0.05 },
    { k: "loss_pvgis", label: "Pérdidas PVGIS", tipo: "pct", min: 0, max: 25, step: 1 },
  ] },
  { titulo: "Códigos de ítems de norma", campos: [
    { k: "codigo_cable_tierra", label: "Cable de puesta a tierra", tipo: "text" },
    { k: "codigo_cable_solar_metro", label: "Cable solar (por metro)", tipo: "text" },
    { k: "codigo_jabalina", label: "Jabalina / electrodo", tipo: "text" },
    { k: "codigo_limitador_tri", label: "Limitador inyección trifásico", tipo: "text" },
    { k: "codigo_limitador_mono", label: "Limitador inyección monofásico", tipo: "text" },
  ] },
];

const lbl = "block text-[10px] uppercase text-gray-400 font-semibold mb-0.5";
const inp = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm";

export default function ParamsFvClient({ onClose }: { onClose?: () => void }) {
  const [vals, setVals] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/fv-config").then((r) => r.json()).then((d) => { if (d.ok) setVals(d.params); }).finally(() => setLoading(false));
  }, []);

  const set = (k: string, v: any) => setVals((p) => ({ ...p, [k]: v }));

  async function guardar() {
    setSaving(true); setMsg("");
    try {
      const params: Record<string, any> = {};
      for (const g of GRUPOS) for (const c of g.campos) {
        let v: any = vals[c.k];
        if (c.tipo !== "text" && c.tipo !== "select") v = v === "" || v == null ? null : Number(v);
        if (v != null && v !== "") params[c.k] = v;
      }
      const r = await fetch("/api/fv-config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ params }) });
      const d = await r.json();
      setMsg(d.ok ? `✅ Guardado (${d.guardados.length} parámetros). El motor los toma en vivo.` : "⚠️ " + (d.error || "error"));
    } catch (e: any) { setMsg("⚠️ " + e.message); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="p-8 text-center text-gray-400">Cargando parámetros…</div>;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-febo-azul">⚙️ Parámetros de cálculo FV</h2>
          <div className="text-[11px] text-gray-500">El motor de dimensionado los lee en vivo — tunealos sin re-deploy. (Los de precios se editan en la config del cotizador.)</div>
        </div>
        {onClose && <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm">← Volver</button>}
      </div>
      {GRUPOS.map((g) => (
        <div key={g.titulo} className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs uppercase font-bold text-febo-azul tracking-wide mb-3">{g.titulo}{g.aplica ? <span className="ml-2 text-[10px] font-semibold text-gray-400 normal-case">({g.aplica})</span> : null}</div>
          <div className="grid grid-cols-3 gap-3">
            {g.campos.map((c) => (
              <div key={c.k}>
                <label className={lbl}>{c.label}{c.tipo === "pct" ? " (%)" : ""}</label>
                {c.tipo === "select" ? (
                  <select value={vals[c.k] ?? ""} onChange={(e) => set(c.k, e.target.value)} className={inp}>{c.opts!.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                ) : c.tipo === "text" ? (
                  <input value={vals[c.k] ?? ""} onChange={(e) => set(c.k, e.target.value)} className={inp} />
                ) : (
                  <input type="number" value={vals[c.k] ?? ""} min={c.min} max={c.max} step={c.step} onChange={(e) => set(c.k, e.target.value)} className={inp} />
                )}
                {(c.min != null && c.max != null) && <div className="text-[9px] text-gray-400 mt-0.5">rango {c.min}–{c.max}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}
      {msg && <div className="text-sm px-4 py-2 rounded-lg bg-gray-50 border border-gray-200">{msg}</div>}
      <div className="flex justify-end"><button onClick={guardar} disabled={saving} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50">{saving ? "Guardando…" : "Guardar parámetros"}</button></div>
    </div>
  );
}
