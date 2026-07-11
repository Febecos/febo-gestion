"use client";
import { useEffect, useState } from "react";

// PRESENTACIÓN COMERCIAL del proyecto FV (salida C) — el documento para el CLIENTE.
// REGLA DURA (propuesta vs presupuesto): la propuesta va AGRUPADA en 3-4 líneas SIN precios
// unitarios — solo el TOTAL. El detalle con precios vive únicamente en el presupuesto (PREV).
// Estiliza los números del informe técnico (no recalcula nada): sistema, generación, cobertura,
// chip "inversor validado ✔", y el TOTAL del presupuesto si ya se generó.

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const n0 = (v: any) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
const fmt = (v: any, d = 0) => n0(v).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });

// Agrupa la BOM en 3-4 renglones comerciales (sin precios): sistema / estructura / eléctrica / medición.
function agruparBom(bom: any[], sistema: any): { titulo: string; detalle: string }[] {
  const grupos: { titulo: string; detalle: string }[] = [];
  const kwp = sistema?.kwp ? `${String(sistema.kwp).replace(".", ",")} kWp` : "";
  const wp = String(sistema?.panel_codigo || "").match(/(\d{3})\s*W/i)?.[1];
  const esMicro = /NEO|micro/i.test(sistema?.inversor_codigo || "");
  grupos.push({
    titulo: `Sistema fotovoltaico ${kwp}`,
    detalle: `${sistema?.n_paneles || "?"} paneles solares${wp ? ` de ${wp}W` : ""} + ${esMicro ? "microinversor" : "inversor"} ${sistema?.inversor_codigo || ""} (${sistema?.inversor_kw || "?"} kW)${sistema?.banco_kwh ? ` + banco de baterías ${sistema.banco_kwh} kWh` : ""}`,
  });
  const esEstructura = (b: any) => /estructura|chiko|coplanar|triang/i.test((b.descripcion_corta || "") + " " + (b.codigo || ""));
  const esMedicion = (b: any) => /medidor|eastron|SPM-E|TPM-E|limitador/i.test((b.descripcion_corta || "") + " " + (b.codigo || ""));
  const estructuras = (bom || []).filter(esEstructura);
  if (estructuras.length) grupos.push({ titulo: "Estructura de montaje", detalle: "Soportería de aluminio con fijaciones, apta intemperie, para el tipo de techo del proyecto" });
  grupos.push({ titulo: "Instalación eléctrica y protecciones", detalle: "Protecciones CC y CA (térmicas, disyuntor, descargadores de sobretensión), cableado solar, conectores y puesta a tierra según norma" });
  const medicion = (bom || []).filter(esMedicion);
  if (medicion.length) grupos.push({ titulo: "Medición y control de inyección", detalle: "Medidor inteligente para operar en modo inyección cero (sin volcar excedentes a la red)" });
  return grupos.slice(0, 4);
}

export default function PresentacionFv({ params }: { params: { id: string } }) {
  const [p, setP] = useState<any>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    fetch("/api/fv-proyectos?id=" + params.id).then((r) => r.json())
      .then(async (d) => {
        if (!d.ok) { setErr(d.error || "no encontrado"); return; }
        setP(d.proyecto);
        if (d.proyecto?.presupuesto_numero) {
          try {
            const pr = await (await fetch("/api/presupuestos?detalle=" + encodeURIComponent(d.proyecto.presupuesto_numero))).json();
            if (pr.ok && pr.presupuesto?.precio_ofrecido != null) setTotal(Number(pr.presupuesto.precio_ofrecido));
          } catch {}
        }
      }).catch((e) => setErr(e.message));
  }, [params.id]);

  if (err) return <div className="p-10 text-center text-red-600">⚠️ {err}</div>;
  if (!p) return <div className="p-10 text-center text-gray-400">Cargando presentación…</div>;

  const i = p.inputs || {}, s = p.sistema || {}, m = p.meta || {}, c = i.cliente || {}, u = i.ubicacion || {};
  const gen: number[] = Array.isArray(m.perfil_mensual_gen) ? m.perfil_mensual_gen.map(n0) : [];
  const maxY = Math.max(...gen, 1);
  const grupos = agruparBom(p.bom || [], s);
  const fecha = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" });
  const invValidado = m.validacion_inversor?.ok === true || m.validacion_inversor?.topologia === "micro";

  return (
    <div className="max-w-[800px] mx-auto bg-white text-gray-800">
      <style>{`@media print { .no-print { display:none !important } body { background:#fff } } @page { size: A4 portrait; margin: 0; } .hero{background:linear-gradient(135deg,#0b3d6b 0%,#155a96 100%)}`}</style>
      <div className="no-print flex justify-end gap-2 p-4">
        <button onClick={() => window.print()} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold">🖨️ Imprimir / Guardar PDF</button>
      </div>

      {/* Portada / hero */}
      <div className="hero text-white px-10 py-10 print:py-14">
        <img src="https://fv.febecos.com/images/febecos-logo.png" alt="FEBECOS" className="h-14 mb-6 brightness-0 invert" />
        <div className="text-[26px] font-black leading-tight">Propuesta de energía solar</div>
        <div className="text-[15px] opacity-90 mt-1">{c.razon_social || c.nombre || ""}</div>
        <div className="text-[12px] opacity-70 mt-3">{[u.localidad, u.provincia].filter(Boolean).join(", ")} · {fecha}</div>
        <div className="flex gap-8 mt-8">
          <div><div className="text-[28px] font-black">{s.kwp ?? "—"} <span className="text-[14px] font-semibold">kWp</span></div><div className="text-[11px] opacity-75 uppercase">Potencia instalada</div></div>
          <div><div className="text-[28px] font-black">{fmt(s.generacion_anual_kwh)} <span className="text-[14px] font-semibold">kWh/año</span></div><div className="text-[11px] opacity-75 uppercase">Generación estimada</div></div>
          <div><div className="text-[28px] font-black">{Math.round((s.cobertura || 0) * 100)}<span className="text-[14px] font-semibold">%</span></div><div className="text-[11px] opacity-75 uppercase">De tu consumo</div></div>
        </div>
      </div>

      <div className="px-10 py-8">
        {/* La propuesta — agrupada, SIN precios */}
        <h2 className="text-[15px] font-black text-[#0b3d6b] uppercase tracking-wide mb-3">Tu sistema incluye</h2>
        <div className="space-y-3 mb-2">
          {grupos.map((g, j) => (
            <div key={j} className="flex gap-3 items-start">
              <div className="w-7 h-7 rounded-full bg-[#f5b301] text-[#0b3d6b] font-black text-[13px] flex items-center justify-center shrink-0">{j + 1}</div>
              <div><div className="font-bold text-[14px] text-[#0b3d6b]">{g.titulo}</div><div className="text-[12px] text-gray-600">{g.detalle}</div></div>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mb-6 text-[11px]">
          {invValidado && <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 font-semibold">✔ Inversor validado técnicamente</span>}
          <span className="rounded-full bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1 font-semibold">Instalación según norma con puesta a tierra</span>
        </div>

        {/* Generación mensual (visual simple) */}
        {gen.length === 12 && (
          <>
            <h2 className="text-[15px] font-black text-[#0b3d6b] uppercase tracking-wide mb-2">Cuánto genera tu sistema, mes a mes</h2>
            <svg viewBox="0 0 720 150" className="w-full mb-6">
              {gen.map((g, j) => {
                const x = 15 + j * 59, bw = 40, h = (g / maxY) * 105;
                return (
                  <g key={j}>
                    <rect x={x} y={125 - h} width={bw} height={h} fill="#f5b301" rx={3} />
                    <text x={x + bw / 2} y={138} textAnchor="middle" fontSize={9.5} fill="#888">{MESES[j]}</text>
                  </g>
                );
              })}
              <text x={15} y={12} fontSize={10} fill="#999">kWh generados por mes (estimado para tu ubicación)</text>
            </svg>
          </>
        )}

        {/* Total — el ÚNICO número de plata */}
        <div className="rounded-xl border-2 border-[#0b3d6b] overflow-hidden mb-6">
          <div className="bg-[#0b3d6b] text-white px-5 py-2 text-[12px] font-bold uppercase tracking-wide">Inversión total</div>
          <div className="px-5 py-4 flex items-baseline justify-between">
            <div className="text-[26px] font-black text-[#0b3d6b]">{total != null ? "USD " + fmt(total, 2) : "A confirmar"}</div>
            <div className="text-[11px] text-gray-500 text-right">+ IVA · llave en mano según alcance{p.presupuesto_numero ? ` · Detalle en presupuesto ${p.presupuesto_numero}` : ""}</div>
          </div>
        </div>

        {/* Por qué Febecos */}
        <h2 className="text-[15px] font-black text-[#0b3d6b] uppercase tracking-wide mb-2">Por qué FEBECOS</h2>
        <div className="grid grid-cols-3 gap-3 text-[11.5px] text-gray-600 mb-8">
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-3"><b className="text-[#0b3d6b]">Ingeniería real.</b> Dimensionado con datos satelitales de tu ubicación y validación eléctrica del equipamiento.</div>
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-3"><b className="text-[#0b3d6b]">Equipos tier-1.</b> Paneles y electrónica de marcas líderes con garantía oficial en Argentina.</div>
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-3"><b className="text-[#0b3d6b]">Acompañamiento.</b> Del cálculo a la puesta en marcha, con soporte local.</div>
        </div>

        <div className="border-t border-gray-200 pt-3 text-[10.5px] text-gray-400 flex justify-between">
          <span>FEBECOS · Energía Solar · febecos.com · ventas@febecos.com</span>
          <span>Propuesta válida 15 días · Proyecto FV #{p.id}</span>
        </div>
      </div>
    </div>
  );
}
