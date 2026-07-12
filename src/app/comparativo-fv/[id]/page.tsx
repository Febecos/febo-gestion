"use client";
import { useEffect, useState } from "react";

// COMPARATIVO DE 3 OPCIONES (entregable estrella para el cliente): on-grid / off-grid / híbrido lado a
// lado + la recomendación ⭐ con el "por qué", en el estilo oficial (verde/redondeado). Datos:
// fv_proyectos.opciones (las 3 variantes generadas por el botón "Generar las 3 opciones") + recomendacion.
// Página interna (auth de gestión). Imprimir/Guardar PDF → carpeta del proyecto.

const n0 = (v: any) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
const fmt = (v: any, d = 0) => n0(v).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
const V = "#1f8a4c"; // verde FEBECOS

export default function ComparativoFv({ params }: { params: { id: string } }) {
  const [p, setP] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    fetch("/api/fv-proyectos?id=" + params.id).then((r) => r.json())
      .then((d) => {
        if (!d.ok) { setErr(d.error || "no encontrado"); return; }
        setP(d.proyecto);
        const cli = d.proyecto?.inputs?.cliente?.razon_social || d.proyecto?.inputs?.cliente?.nombre || "";
        document.title = `Comparativo 3 opciones - ${cli}`.replace(/[/\\:*?"<>|]/g, " ").replace(/\s{2,}/g, " ").trim();
      })
      .catch((e) => setErr(e.message));
  }, [params.id]);

  if (err) return <div className="p-10 text-center text-red-600">⚠️ {err}</div>;
  if (!p) return <div className="p-10 text-center text-gray-400">Cargando comparativo…</div>;

  const i = p.inputs || {}, c = i.cliente || {}, u = i.ubicacion || {};
  const ops = (Array.isArray(p.opciones) ? p.opciones : []).filter((o: any) => o.ok);
  const rec = p.recomendacion || null;
  const fecha = new Date().toLocaleDateString("es-AR");

  if (!ops.length) return <div className="p-10 text-center text-gray-500">Este proyecto todavía no tiene las 3 opciones generadas. Volvé al proyecto y tocá «Generar las 3 opciones».</div>;

  // Filas de la tabla comparativa (label + accessor + formato).
  const filas: { k: string; label: string; get: (o: any) => any }[] = [
    { k: "kwp", label: "Potencia instalada", get: (o) => `${o.sistema?.kwp ?? "—"} kWp (${o.sistema?.n_paneles ?? "?"} paneles)` },
    { k: "inv", label: "Inversor", get: (o) => `${o.sistema?.inversor_codigo ?? "—"}${o.sistema?.inversor_kw ? ` (${o.sistema.inversor_kw} kW)` : ""}` },
    { k: "banco", label: "Banco de baterías", get: (o) => (o.sistema?.banco_kwh ? `${o.sistema.banco_kwh} kWh` : "—") },
    { k: "gen", label: "Generación anual", get: (o) => `${fmt(o.sistema?.generacion_anual_kwh)} kWh` },
    { k: "cob", label: "Cobertura del consumo", get: (o) => `${Math.round((o.sistema?.cobertura || 0) * 100)}%` },
    { k: "auton", label: "Autonomía ante cortes", get: (o) => (o.autonomia?.horas != null ? `${o.autonomia.horas} h (~${o.autonomia.dias} día/s)` : o.autonomia?.dias != null ? `${o.autonomia.dias} días` : "—") },
    { k: "ahorro", label: "Ahorro estimado / mes", get: (o) => (o.ahorro_mensual_ars != null ? `$ ${fmt(o.ahorro_mensual_ars)}` : "—") },
    { k: "inv$", label: "Inversión (USD)", get: (o) => (o.inversion_usd != null ? `US$ ${fmt(o.inversion_usd)}` : "—") },
    { k: "repago", label: "Repago estimado", get: (o) => (o.repago_anios != null ? `${o.repago_anios} años` : "—"), },
  ];

  return (
    <div className="mx-auto max-w-[980px] bg-white text-gray-800 p-8 print:p-0" style={{ fontFamily: "system-ui, sans-serif" }}>
      <style>{`@media print { .no-print{display:none!important} body{background:#fff} } @page { size: A4 landscape; margin: 10mm; }`}</style>
      <div className="no-print flex justify-end mb-4">
        <button onClick={() => window.print()} className="px-4 py-2 rounded-lg text-white text-sm font-semibold" style={{ background: V }}>🖨️ Imprimir / Guardar PDF</button>
      </div>

      {/* Encabezado */}
      <div className="rounded-2xl px-6 py-5 mb-5 text-white" style={{ background: `linear-gradient(135deg, ${V}, #14663a)` }}>
        <div className="text-[22px] font-bold">Tu sistema solar — 3 opciones comparadas</div>
        <div className="text-[13px] opacity-90 mt-1">
          {c.razon_social || c.nombre || "Cliente"}{u.localidad ? ` · ${[u.localidad, u.provincia].filter(Boolean).join(", ")}` : ""} · {fecha}
        </div>
      </div>

      {/* Recomendación */}
      {rec && (
        <div className="rounded-2xl border-2 px-5 py-4 mb-5" style={{ borderColor: V, background: "#f2fbf5" }}>
          <div className="text-[15px] font-bold" style={{ color: V }}>⭐ Nuestra recomendación: {rec.label}</div>
          <div className="text-[13px] text-gray-700 mt-1">{rec.motivo}</div>
        </div>
      )}

      {/* Tabla comparativa */}
      <div className="overflow-x-auto rounded-2xl border border-gray-200">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="text-left px-4 py-3 bg-gray-50 font-semibold text-gray-500 w-52">&nbsp;</th>
              {ops.map((o: any) => {
                const esRec = rec?.modo === o.modo;
                return (
                  <th key={o.modo} className="px-4 py-3 text-center font-bold text-white" style={{ background: esRec ? V : "#5b7085" }}>
                    {esRec ? "⭐ " : ""}{o.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filas.map((f, ri) => (
              <tr key={f.k} className={ri % 2 ? "bg-gray-50/60" : ""}>
                <td className="px-4 py-2.5 font-semibold text-gray-600">{f.label}</td>
                {ops.map((o: any) => {
                  const esRec = rec?.modo === o.modo;
                  const destacar = f.k === "repago";
                  return (
                    <td key={o.modo} className="px-4 py-2.5 text-center" style={esRec ? { background: "#f2fbf5" } : undefined}>
                      <span className={destacar ? "font-bold" : ""} style={destacar && esRec ? { color: V } : undefined}>{f.get(o)}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Nota + faltantes */}
      <div className="text-[11px] text-gray-500 mt-4 space-y-1">
        <div>Los valores de generación y ahorro son estimados con radiación de Global Solar Atlas para tu ubicación; la producción real varía con el clima y el sombreado. Validez de los precios: 48 horas.</div>
        {ops.some((o: any) => o.faltantes?.length) && (
          <div className="text-amber-700">Nota interna: ítems sin precio en catálogo → {Array.from(new Set(ops.flatMap((o: any) => o.faltantes || []))).join(", ")}.</div>
        )}
        <div className="pt-1">Cada opción tiene su presupuesto detallado{ops.map((o: any) => o.presupuesto_numero).filter(Boolean).length ? `: ${ops.map((o: any) => o.presupuesto_numero).filter(Boolean).join(" · ")}` : ""}.</div>
      </div>

      <div className="border-t border-gray-200 mt-6 pt-2 text-[10px] text-gray-400 flex justify-between">
        <span>FEBECOS · Energía Solar · febecos.com</span><span>Comparativo generado por la plataforma de proyectos FV</span>
      </div>
    </div>
  );
}
