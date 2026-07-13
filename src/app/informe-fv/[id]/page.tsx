"use client";
import { useEffect, useState } from "react";

// "PROPUESTA DE CÁLCULOS" — informe TÉCNICO del proyecto FV (salida B). Estructura definida por
// CÁLCULOS FV (8 secciones): encabezado/dimensionado · consumo mensual · recurso solar · dimensionado ·
// GEN vs CONSUMO mensual (el corazón) · validación inversor ✔/✗ · BOM sin precios · ahorro y repago.
// Página interna (detrás del auth de gestión). Imprimir/Guardar PDF → carpeta del proyecto.
// Datos: fv_proyectos (inputs + sistema + meta del motor + bom).

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const n0 = (v: any) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
const fmt = (v: any, d = 0) => n0(v).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });

export default function InformeFv({ params }: { params: { id: string } }) {
  const [p, setP] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    fetch("/api/fv-proyectos?id=" + params.id).then((r) => r.json())
      .then((d) => {
        if (!d.ok) { setErr(d.error || "no encontrado"); return; }
        // ?opcion=on-grid|off-grid|hibrido → superpone la variante generada (sistema/meta/bom/PREV) sobre
        // el proyecto, reusando este mismo informe para cada opción sin duplicar la página.
        const proyecto = d.proyecto;
        // Con opciones y sin ?opcion= explícito → usa la RECOMENDADA (nunca el nº base del proyecto).
        const tieneOps = Array.isArray(proyecto?.opciones) && proyecto.opciones.length > 0;
        const modo = new URLSearchParams(window.location.search).get("opcion")
          || (tieneOps ? (proyecto.recomendacion?.modo || proyecto.opciones[0]?.modo) : null);
        if (modo && tieneOps) {
          const op = proyecto.opciones.find((o: any) => o.modo === modo);
          if (op) Object.assign(proyecto, { sistema: op.sistema, meta: op.meta, bom: op.bom, presupuesto_numero: op.presupuesto_numero || proyecto.presupuesto_numero, _opcion_label: op.label });
        }
        setP(proyecto);
        // NORMA nombre de PDF: "{NÚMERO} - {cliente} - Informe tecnico" (el título del documento es el
        // nombre que sugiere el navegador al Guardar como PDF — nunca "FEBO-GESTION.pdf").
        const cli = d.proyecto?.inputs?.cliente?.razon_social || d.proyecto?.inputs?.cliente?.nombre || "";
        const num = d.proyecto?.presupuesto_numero || `PROY-${d.proyecto?.id}`;
        document.title = `${num} - ${cli} - Informe tecnico`.replace(/[/\\:*?"<>|]/g, " ").replace(/\s{2,}/g, " ").trim();
      })
      .catch((e) => setErr(e.message));
  }, [params.id]);

  if (err) return <div className="p-10 text-center text-red-600">⚠️ {err}</div>;
  if (!p) return <div className="p-10 text-center text-gray-400">Cargando informe…</div>;

  const i = p.inputs || {}, s = p.sistema || {}, m = p.meta || {}, c = i.cliente || {}, u = i.ubicacion || {};
  const con = i.consumo || {};
  const gen: number[] = Array.isArray(m.perfil_mensual_gen) ? m.perfil_mensual_gen.map(n0) : [];
  const cons: number[] = Array.isArray(m.perfil_mensual_consumo) ? m.perfil_mensual_consumo.map(n0) : [];
  const comp = Array.isArray(m.comparacion_mensual) ? m.comparacion_mensual : [];
  const maxY = Math.max(...gen, ...cons, 1);
  const v = m.validacion_inversor || {};
  const sup = m.supuestos || {};
  const fecha = new Date().toLocaleDateString("es-AR");
  const consumoAnual = cons.length === 12 ? cons.reduce((a, b) => a + b, 0) : (con.kwh_mes ? con.kwh_mes * 12 : null);

  const Check = ({ ok, label }: { ok: boolean | null | undefined; label: string }) => (
    <div className="flex items-center gap-2 text-[12px]"><span className={ok ? "text-emerald-600 font-bold" : ok === false ? "text-red-600 font-bold" : "text-gray-400"}>{ok ? "✔" : ok === false ? "✗" : "—"}</span><span>{label}</span></div>
  );

  return (
    <div className="max-w-[800px] mx-auto bg-white text-[13px] text-gray-800 p-8 print:p-0">
      <style>{`@media print { .no-print { display:none !important } body { background:#fff } } @page { size: A4 portrait; margin: 12mm; }`}</style>
      <div className="no-print flex justify-end gap-2 mb-4">
        <button onClick={() => window.print()} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold">🖨️ Imprimir / Guardar PDF</button>
      </div>

      {/* 0. Encabezado */}
      <div className="border-b-4 border-[#0b3d6b] pb-3 mb-4 flex justify-between items-end">
        <div>
          <div className="text-[20px] font-black text-[#0b3d6b]">PROPUESTA DE CÁLCULOS</div>
          <div className="text-[11px] text-gray-500">Informe técnico de dimensionado fotovoltaico · FEBECOS</div>
        </div>
        <div className="text-right text-[11px] text-gray-600">
          <div className="font-bold text-[#0b3d6b]">Proyecto FV #{p.id}</div>
          <div>{fecha}{p.presupuesto_numero ? ` · Presupuesto ${p.presupuesto_numero}` : ""}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3 text-[12px]">
        <div><b>Cliente:</b> {c.razon_social || c.nombre || "—"}{c.cuit ? ` · CUIT ${c.cuit}` : ""}</div>
        <div><b>Ubicación:</b> {[u.localidad, u.provincia].filter(Boolean).join(", ") || "—"}{u.lat != null ? ` (${Number(u.lat).toFixed(2)}, ${Number(u.lng).toFixed(2)})` : ""}</div>
        <div><b>Tipo:</b> {s.tipo || i.tipo_conexion} · {s.fase === "tri" || i.fase === "tri" ? "trifásico" : "monofásico"} · inyección {sup.inyeccion || i.inyeccion || "cero"}</div>
        <div><b>Techo/estructura:</b> {i.tipo_techo || "—"}</div>
      </div>
      <div className="rounded-lg border-2 border-[#0b3d6b] bg-[#f0f6fc] px-4 py-2 mb-5 flex flex-wrap gap-x-8 gap-y-1 text-[13px]">
        <span><b className="text-[#0b3d6b]">{s.kwp} kWp</b></span>
        <span>{s.n_paneles} × {s.panel_codigo}</span>
        <span>Inversor <b>{s.inversor_codigo}</b> ({s.inversor_kw} kW)</span>
        {s.banco_kwh ? <span>Banco {s.banco_kwh} kWh</span> : null}
        <span>PVOUT <b>{fmt(m.pvout)}</b> kWh/kWp/año</span>
      </div>

      {/* 1. Consumo */}
      <h2 className="text-[13px] font-bold text-[#0b3d6b] uppercase border-b border-gray-300 mb-2">1 · Consumo (de la factura)</h2>
      <div className="mb-1 text-[12px]">Consumo anual estimado: <b>{consumoAnual ? fmt(consumoAnual) + " kWh" : "—"}</b> · promedio {consumoAnual ? fmt(consumoAnual / 12) : "—"} kWh/mes{i.potencia_contratada_kw ? ` · potencia contratada ${i.potencia_contratada_kw} kW` : ""}{(p.factura_ref?.datos?.tarifa) ? ` · tarifa ${p.factura_ref.datos.tarifa}` : ""}{(p.factura_ref?.datos?.distribuidora) ? ` · ${p.factura_ref.datos.distribuidora}` : ""}</div>
      {cons.length === 12 && (
        <table className="w-full text-[10.5px] mb-4 border border-gray-200"><tbody>
          <tr className="bg-gray-50">{MESES.map((mm) => <td key={mm} className="px-1 py-0.5 text-center font-semibold text-gray-500">{mm}</td>)}</tr>
          <tr>{cons.map((x, j) => <td key={j} className="px-1 py-0.5 text-center">{fmt(x)}</td>)}</tr>
        </tbody></table>
      )}

      {/* 2. Recurso solar */}
      <h2 className="text-[13px] font-bold text-[#0b3d6b] uppercase border-b border-gray-300 mb-2">2 · Recurso solar</h2>
      <div className="mb-1 text-[12px]">Fuente: <b>Global Solar Atlas</b> (base al óptimo del sitio) · <b>{fmt(m.pvout)} kWh/kWp/año</b> al plano del proyecto.</div>
      {sup.inclinacion_grados != null && (
        <div className="mb-4 text-[12px]">Plano real: <b>inclinación {sup.inclinacion_grados}°</b> · orientación norte{sup.azimut_grados ? ` (desvío ${sup.azimut_grados}°)` : ""}{sup.factor_transposicion != null ? <> · rendimiento del plano: <b>{Math.round(sup.factor_transposicion * 100)}%</b> del óptimo{sup.factor_transposicion < 0.9 ? <span className="text-amber-600"> ⚠ el plano rinde menos del 90% del óptimo</span> : null}</> : null}</div>
      )}
      {sup.inclinacion_grados == null && <div className="mb-4" />}

      {/* 3. Dimensionado */}
      <h2 className="text-[13px] font-bold text-[#0b3d6b] uppercase border-b border-gray-300 mb-2">3 · Dimensionado</h2>
      <div className="mb-4 text-[12px] space-y-0.5">
        <div>Criterio: {(() => {
          // El modo real: sup.inyeccion (motor) → i.inyeccion (form). "off-grid" SOLO si el tipo lo es
          // (bug: proyectos viejos sin sup.inyeccion caían al label "off-grid" siendo on-grid).
          const iny = sup.inyeccion || i.inyeccion;
          const esOff = /off/i.test(String(s.tipo || i.tipo_conexion || ""));
          if (esOff) return "off-grid";
          if (iny === "futuro") return "cobertura 100% + limitador (inyección a futuro)";
          if (iny === "con-inyeccion") return "cobertura 100% con inyección";
          return <>on-grid inyección <b>cero</b> — se dimensiona al consumo diurno (fracción diurna {sup.fraccion_diurna ?? "0.5"})</>;
        })()}{sup.cobertura_dimensionada ? ` · cobertura dimensionada ${Math.round(sup.cobertura_dimensionada * 100)}%` : ""}</div>
        <div>Generación anual estimada: <b>{fmt(s.generacion_anual_kwh)} kWh</b> = {s.kwp} kWp × {fmt(m.pvout)} · Cobertura del consumo: <b>{Math.round((s.cobertura || 0) * 100)}%</b></div>
        {sup.ratio_dc_ac ? <div>Ratio DC/AC: <b>{sup.ratio_dc_ac}</b> {sup.ratio_ok ? "✔ dentro de rango" : "⚠ fuera de rango objetivo"}</div> : null}
        {sup.autonomia_dias ? <div>Off-grid: autonomía {sup.autonomia_dias} días · DoD {sup.dod}%</div> : null}
      </div>

      {/* 4. Generación vs consumo mensual */}
      <h2 className="text-[13px] font-bold text-[#0b3d6b] uppercase border-b border-gray-300 mb-2">4 · Generación vs consumo — mensual</h2>
      {gen.length === 12 ? (
        <>
          <svg viewBox="0 0 720 200" className="w-full mb-2">
            {gen.map((g, j) => {
              const x = 20 + j * 58, bw = 34, h = (g / maxY) * 150;
              return (
                <g key={j}>
                  <rect x={x} y={175 - h} width={bw} height={h} fill="#f5b301" rx={2} />
                  <text x={x + bw / 2} y={168 - h} textAnchor="middle" fontSize={9} fill="#555">{fmt(g)}</text>
                  <text x={x + bw / 2} y={190} textAnchor="middle" fontSize={9} fill="#888">{MESES[j]}</text>
                </g>
              );
            })}
            {cons.length === 12 && (
              <polyline fill="none" stroke="#0b3d6b" strokeWidth={2}
                points={cons.map((cx, j) => `${20 + j * 58 + 17},${175 - (cx / maxY) * 150}`).join(" ")} />
            )}
            <rect x={560} y={8} width={10} height={10} fill="#f5b301" /><text x={574} y={17} fontSize={10} fill="#555">Generación</text>
            <line x1={640} y1={13} x2={660} y2={13} stroke="#0b3d6b" strokeWidth={2} /><text x={664} y={17} fontSize={10} fill="#555">Consumo</text>
          </svg>
          {comp.length === 12 && (
            <table className="w-full text-[10.5px] mb-2 border border-gray-200">
              <thead><tr className="bg-gray-50 text-gray-500"><th className="px-1 py-0.5 text-left">Mes</th><th className="px-1 py-0.5 text-right">Consumo</th><th className="px-1 py-0.5 text-right">Generación</th><th className="px-1 py-0.5 text-right">Exced./Déficit</th><th className="px-1 py-0.5 text-right">Cobertura</th></tr></thead>
              <tbody>{comp.map((r: any, j: number) => (
                <tr key={j} className={j % 2 ? "bg-gray-50" : ""}><td className="px-1 py-0.5">{MESES[j]}</td><td className="px-1 py-0.5 text-right">{fmt(r.consumo)}</td><td className="px-1 py-0.5 text-right">{fmt(r.generacion)}</td><td className={"px-1 py-0.5 text-right " + (n0(r.generacion) - n0(r.consumo) >= 0 ? "text-emerald-600" : "text-red-600")}>{fmt(n0(r.generacion) - n0(r.consumo))}</td><td className="px-1 py-0.5 text-right">{r.consumo ? Math.round((n0(r.generacion) / n0(r.consumo)) * 100) + "%" : "—"}</td></tr>
              ))}</tbody>
            </table>
          )}
          <div className="text-[11px] text-gray-600 mb-4">Cobertura anual: <b>{Math.round((s.cobertura || 0) * 100)}%</b>{comp.length ? ` · meses con déficit: ${comp.filter((r: any) => n0(r.generacion) < n0(r.consumo)).length}` : ""}</div>
        </>
      ) : <div className="text-[12px] text-gray-400 mb-4">Sin perfil mensual (re-dimensioná el proyecto para regenerarlo).</div>}

      {/* 5. Validación del inversor */}
      <h2 className="text-[13px] font-bold text-[#0b3d6b] uppercase border-b border-gray-300 mb-2">5 · Validación del inversor</h2>
      <div className="mb-4">
        {/* Validación COMPLETA para TODA topología (checks del motor: a_voc_max, b_arranque,
            c_rango_mppt, d_corriente) — con el valor medido; nunca "revisar" genérico. */}
        {v.ok != null && v.checks ? (
          <div className="grid grid-cols-2 gap-x-6">
            <Check ok={v.ok} label={v.topologia === "micro"
              ? `Microinversor — MPPT por panel (${v.n_micros ?? "?"} unidad/es), sin strings serie`
              : `Configuración: ${v.n_serie ?? "?"} paneles en serie × ${v.n_strings ?? "?"} string(s)`} />
            <Check ok={v.checks.a_voc_max ?? v.ok} label={`Voc en frío ${v.voc_frio ?? "?"} V ≤ Voc máx del inversor`} />
            <Check ok={v.checks.b_arranque ?? v.checks.b_vmp_min ?? v.ok} label={`Vmp en calor ${v.vmp_calor ?? "?"} V > tensión de arranque`} />
            <Check ok={v.checks.c_rango_mppt ?? v.checks.c_mppt ?? v.ok} label={`Vmp STC ${v.vmp_stc ?? "?"} V dentro del rango MPPT`} />
            <Check ok={v.checks.d_corriente ?? v.ok} label={`Corriente ${v.i_string ?? v.i_panel ?? "?"} A ≤ máx por MPPT`} />
            {v.checks.e_potencia != null ? <Check ok={v.checks.e_potencia} label="Potencia PV ≤ máx del microinversor" /> : null}
            {v.sin_dato?.length ? <div className="text-[10px] text-gray-400 col-span-2">Spec sin dato (pasa con nota): {v.sin_dato.join(", ")}</div> : null}
          </div>
        ) : v.topologia === "micro" ? (
          <Check ok={true} label={`Microinversor — MPPT por panel (${v.n_micros ?? "?"} unidad/es), sin strings serie. ${v.nota || ""}`} />
        ) : <div className="text-[12px] text-gray-500">{v.motivo || "Sin datos de validación."}</div>}
      </div>

      {/* 6. BOM técnico */}
      <h2 className="text-[13px] font-bold text-[#0b3d6b] uppercase border-b border-gray-300 mb-2">6 · Lista de componentes (sin precios)</h2>
      <table className="w-full text-[11px] mb-4 border border-gray-200">
        <thead><tr className="bg-gray-50 text-gray-500"><th className="px-2 py-1 text-left w-10">Cant</th><th className="px-2 py-1 text-left">Descripción</th><th className="px-2 py-1 text-left w-44">Código</th></tr></thead>
        <tbody>{(p.bom || []).map((b: any, j: number) => (
          <tr key={j} className={j % 2 ? "bg-gray-50" : ""}><td className="px-2 py-1">×{b.cantidad}</td><td className="px-2 py-1">{b.descripcion_corta || b.descripcion || "—"}</td><td className="px-2 py-1 font-mono text-[10px] text-gray-500">{b.codigo}</td></tr>
        ))}</tbody>
      </table>
      <div className="text-[10px] text-gray-400 mb-4">Los precios se detallan en el presupuesto{p.presupuesto_numero ? ` ${p.presupuesto_numero}` : ""}.</div>

      {/* 7. Ahorro y repago */}
      <h2 className="text-[13px] font-bold text-[#0b3d6b] uppercase border-b border-gray-300 mb-2">7 · Ahorro y repago</h2>
      <div className="mb-4 text-[12px]">
        {m.ahorro ? (
          <>Ahorro estimado: <b>$ {fmt(m.ahorro.mensual)}/mes</b> · $ {fmt(m.ahorro.anual)}/año{m.repago_anios ? <> · Repago estimado: <b>{m.repago_anios} años</b></> : null}</>
        ) : <span className="text-gray-500">Para calcular el ahorro/repago se necesita la tarifa ($/kWh) de la factura{p.presupuesto_numero ? " y el total del presupuesto" : ""} — cargala en el proyecto y re-dimensioná.</span>}
      </div>

      {/* 8. Balance de cargas (off-grid / híbrido): qué podés hacer funcionar — en criollo */}
      {m.balance?.cargas?.length ? (
        <>
          <h2 className="text-[13px] font-bold text-[#0b3d6b] uppercase border-b border-gray-300 mb-2">8 · Balance de cargas — qué podés hacer funcionar</h2>
          <table className="w-full text-[11px] mb-2 border border-gray-200">
            <thead><tr className="bg-gray-50 text-gray-500"><th className="px-2 py-1 text-left">Equipo</th><th className="px-2 py-1 text-right w-20">Potencia (W)</th><th className="px-2 py-1 text-right w-20">Horas/día</th><th className="px-2 py-1 text-right w-24">Consumo (Wh/día)</th></tr></thead>
            <tbody>
              {m.balance.cargas.map((c: any, j: number) => (
                <tr key={j} className={j % 2 ? "bg-gray-50" : ""}><td className="px-2 py-1">{c.nombre}</td><td className="px-2 py-1 text-right">{fmt(c.potencia_w)}</td><td className="px-2 py-1 text-right">{c.horas_dia}</td><td className="px-2 py-1 text-right">{fmt(c.wh_dia)}</td></tr>
              ))}
              <tr className="border-t-2 border-gray-300 font-bold"><td className="px-2 py-1">Total</td><td className="px-2 py-1 text-right">{fmt(m.balance.potencia_cargas_w)}</td><td className="px-2 py-1" /><td className="px-2 py-1 text-right">{fmt((m.balance.consumo_cargas_kwh_dia || 0) * 1000)}</td></tr>
            </tbody>
          </table>
          <div className="mb-1 text-[12px]">Capacidad del sistema: inversor <b>{fmt(m.balance.potencia_inversor_w)} W</b>{m.balance.banco_utilizable_kwh != null ? <> · banco utilizable <b>{m.balance.banco_utilizable_kwh} kWh</b> (de {m.balance.banco_kwh} kWh)</> : null}.</div>
          <div className="mb-1 text-[12px]">Con todo prendido a la vez usás <b>{fmt(m.balance.potencia_cargas_w)} W de {fmt(m.balance.potencia_inversor_w)} W</b> → te quedan <b>{fmt(m.balance.potencia_libre_w)} W libres</b>.{m.balance.autonomia_horas != null ? <> El banco sostiene estas cargas <b>{m.balance.autonomia_horas} horas</b> (~{m.balance.autonomia_dias} día/s) sin sol.</> : null}</div>
          {m.balance.cobertura === "backup" ? (
            <div className="mb-4 text-[11px] text-amber-700">🔋 Respaldo preparado para estas cargas básicas (canasto crítico) — NO cubre el consumo total de la casa (aire acondicionado, termotanque eléctrico, etc.).</div>
          ) : m.balance.cobertura === "desconexion" ? (
            <div className="mb-4 text-[11px] text-gray-600">🔌 Dimensionado para la lista completa de cargas (desconexión de la red).</div>
          ) : <div className="mb-4" />}
        </>
      ) : null}

      {/* Supuestos */}
      <h2 className="text-[13px] font-bold text-[#0b3d6b] uppercase border-b border-gray-300 mb-2">Notas y supuestos</h2>
      <div className="text-[11px] text-gray-600 space-y-0.5 mb-8">
        <div>· Inyección: {sup.inyeccion || "cero"}{sup.fraccion_diurna ? ` (fracción diurna ${sup.fraccion_diurna})` : ""} · Fuente radiación: Global Solar Atlas (PVOUT neto).</div>
        {sup.termica_a ? <div>· Protecciones CA: térmica {sup.termica_a} A (corriente {sup.corriente_ca_a} A).</div> : null}
        <div>· Valores de generación estimados; la producción real varía con el clima y el sombreado del sitio.</div>
      </div>
      <div className="border-t border-gray-300 pt-2 text-[10px] text-gray-400 flex justify-between"><span>FEBECOS · Energía Solar · febecos.com</span><span>Informe técnico generado por la plataforma de proyectos FV</span></div>
    </div>
  );
}
