"use client";
import { useEffect, useState } from "react";

// PRESENTACIÓN COMERCIAL del proyecto FV (salida C) — el documento para el CLIENTE.
// ESTILO = el de las propuestas hechas a mano (referencia: "Edgardo Bouvier - Propuesta Solar FV.html"):
// paleta VERDE (#15694a/#0d4a33) + ámbar solar, títulos serif Georgia, cards REDONDEADAS, hero
// degradado, KPI strip. REGLA DURA (propuesta vs presupuesto): agrupado SIN precios unitarios,
// el TOTAL es el único número de plata. No recalcula: estiliza motor + total del cotizador.

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const n0 = (v: any) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
const fmt = (v: any, d = 0) => n0(v).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });

function agruparBom(bom: any[], sistema: any): { titulo: string; detalle: string }[] {
  const grupos: { titulo: string; detalle: string }[] = [];
  const kwp = sistema?.kwp ? `${String(sistema.kwp).replace(".", ",")} kWp` : "";
  const wp = String(sistema?.panel_codigo || "").match(/(\d{3})\s*W/i)?.[1];
  const esMicro = /NEO|micro/i.test(sistema?.inversor_codigo || "");
  grupos.push({ titulo: `Sistema fotovoltaico ${kwp}`, detalle: `${sistema?.n_paneles || "?"} paneles solares${wp ? ` de ${wp}W` : ""} + ${esMicro ? "microinversor" : "inversor"} ${sistema?.inversor_codigo || ""} (${sistema?.inversor_kw || "?"} kW)${sistema?.banco_kwh ? ` + banco de baterías ${sistema.banco_kwh} kWh` : ""}` });
  if ((bom || []).some((b: any) => /estructura|chiko|coplanar|triang/i.test((b.descripcion_corta || "") + (b.codigo || "")))) grupos.push({ titulo: "Estructura de montaje", detalle: "Soportería de aluminio apta intemperie, para el techo del proyecto" });
  grupos.push({ titulo: "Instalación eléctrica y protecciones", detalle: "Protecciones CC y CA, descargadores de sobretensión, cableado solar, conectores y puesta a tierra según norma" });
  if ((bom || []).some((b: any) => /medidor|eastron|SPM-E|TPM-E|limitador/i.test((b.descripcion_corta || "") + (b.codigo || "")))) grupos.push({ titulo: "Medición y control de inyección", detalle: "Medidor inteligente para operar en modo inyección cero (sin volcar excedentes a la red)" });
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

  if (err) return <div style={{ padding: 60, textAlign: "center", color: "#b00" }}>⚠️ {err}</div>;
  if (!p) return <div style={{ padding: 60, textAlign: "center", color: "#999" }}>Cargando presentación…</div>;

  const i = p.inputs || {}, s = p.sistema || {}, m = p.meta || {}, c = i.cliente || {}, u = i.ubicacion || {};
  const gen: number[] = Array.isArray(m.perfil_mensual_gen) ? m.perfil_mensual_gen.map(n0) : [];
  const cons: number[] = Array.isArray(m.perfil_mensual_consumo) ? m.perfil_mensual_consumo.map(n0) : [];
  const maxY = Math.max(...gen, ...cons, 1);
  const grupos = agruparBom(p.bom || [], s);
  const fecha = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" });
  const invValidado = m.validacion_inversor?.ok === true || m.validacion_inversor?.topologia === "micro";
  const esCero = (m.supuestos?.inyeccion || i.inyeccion || "cero") === "cero";

  const B = "#15694a", B2 = "#0d4a33", SOFT = "#e7f1ec", SOLAR = "#e0980f", INK = "#18231e", INK2 = "#3b4a43", MUT = "#6f7c74", LINE = "#e4e6e0";
  const serif = 'Georgia,"Iowan Old Style","Times New Roman",serif';
  const sec: React.CSSProperties = { fontSize: 12, letterSpacing: ".16em", textTransform: "uppercase", color: B, margin: "0 0 4px", fontWeight: 700 };
  const big: React.CSSProperties = { fontFamily: serif, fontWeight: 400, fontSize: 26, lineHeight: 1.15, letterSpacing: "-.01em", margin: "0 0 16px", color: INK };

  return (
    <div style={{ background: "#eceae3", minHeight: "100vh", fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif', color: INK }}>
      <style>{`@media print { .no-print { display:none !important } body{background:#fff} .sheet{box-shadow:none !important} } @page { size: A4 portrait; margin: 0; }`}</style>
      <div className="no-print" style={{ maxWidth: 840, margin: "0 auto", padding: "14px 0", display: "flex", justifyContent: "flex-end" }}>
        <button onClick={() => window.print()} style={{ background: B, color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>🖨️ Imprimir / Guardar PDF</button>
      </div>
      <div className="sheet" style={{ maxWidth: 840, margin: "0 auto 40px", background: "#fff", borderRadius: 6, overflow: "hidden", boxShadow: "0 6px 30px #0b2a1e1a" }}>

        {/* Topbar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 46px", borderBottom: `1px solid ${LINE}` }}>
          <img src="https://fv.febecos.com/images/febecos-logo.png" alt="FEBECOS" style={{ height: 42 }} />
          <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: MUT, fontWeight: 700 }}>Propuesta · {fecha}</div>
        </div>

        {/* Hero */}
        <div style={{ background: `linear-gradient(150deg,${B2},${B} 70%)`, color: "#eaf3ee", padding: "42px 46px" }}>
          <div style={{ fontSize: 11.5, letterSpacing: ".2em", textTransform: "uppercase", color: SOLAR, fontWeight: 700, marginBottom: 12 }}>Propuesta de Energía Solar</div>
          <h1 style={{ fontFamily: serif, fontWeight: 400, fontSize: 34, lineHeight: 1.1, letterSpacing: "-.015em", margin: "0 0 14px", maxWidth: "18ch" }}>
            Un sistema solar de {String(s.kwp ?? "—").replace(".", ",")} kWp{esCero ? " con inyección cero" : ""}
          </h1>
          <div style={{ fontSize: 14, color: "#cfe1d8", borderTop: "1px solid #ffffff26", paddingTop: 16, marginTop: 22 }}>
            Preparada para <b style={{ color: "#fff" }}>{c.razon_social || c.nombre || ""}</b>{u.localidad ? <> · {[u.localidad, u.provincia].filter(Boolean).join(", ")}</> : null}
          </div>
        </div>

        {/* KPI strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 1, background: LINE, borderBottom: `1px solid ${LINE}` }}>
          {[
            { n: String(s.kwp ?? "—").replace(".", ","), u: "kWp", l: "Potencia instalada" },
            { n: fmt(s.generacion_anual_kwh), u: "kWh/año", l: "Generación estimada" },
            { n: String(Math.round((s.cobertura || 0) * 100)), u: "%", l: "De tu consumo cubierto" },
            { n: String(s.n_paneles ?? "—"), u: "paneles", l: "Módulos de alta eficiencia" },
          ].map((k, j) => (
            <div key={j} style={{ background: "#fff", padding: "20px 16px", textAlign: "center" }}>
              <div style={{ fontFamily: serif, fontSize: 28, lineHeight: 1, color: B, marginBottom: 5 }}>{k.n} <small style={{ fontSize: 14, color: MUT }}>{k.u}</small></div>
              <div style={{ fontSize: 11, color: INK2 }}>{k.l}</div>
            </div>
          ))}
        </div>

        <div style={{ padding: "34px 46px" }}>
          {/* La solución — agrupada, SIN precios */}
          <h2 style={sec}>La solución</h2>
          <h3 style={big}>Tu sistema incluye</h3>
          <div style={{ display: "grid", gap: 12, marginBottom: 14 }}>
            {grupos.map((g, j) => (
              <div key={j} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: j === 0 ? SOFT : "#fff", border: `1px solid ${j === 0 ? "#cfe3d8" : LINE}`, borderRadius: 12, padding: "14px 18px" }}>
                <div style={{ width: 30, height: 30, borderRadius: "50%", background: SOLAR, color: "#fff", fontWeight: 800, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{j + 1}</div>
                <div><div style={{ fontWeight: 700, fontSize: 14.5, color: B2 }}>{g.titulo}</div><div style={{ fontSize: 12.5, color: INK2, marginTop: 2 }}>{g.detalle}</div></div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 30 }}>
            {invValidado && <span style={{ fontSize: 11, borderRadius: 999, background: "#e4f3ec", color: "#1c8a5b", border: "1px solid #bfe0cf", padding: "5px 12px", fontWeight: 600 }}>✔ Inversor validado técnicamente</span>}
            <span style={{ fontSize: 11, borderRadius: 999, background: SOFT, color: B2, border: "1px solid #cfe3d8", padding: "5px 12px", fontWeight: 600 }}>Instalación según norma con puesta a tierra</span>
            {esCero && <span style={{ fontSize: 11, borderRadius: 999, background: "#fbf0d5", color: "#8a6205", border: "1px solid #edd9a3", padding: "5px 12px", fontWeight: 600 }}>Inyección cero — sin trámite de generación</span>}
          </div>

          {/* Generación */}
          {gen.length === 12 && (
            <>
              <h2 style={sec}>Generación y consumo</h2>
              <h3 style={big}>Genera ~{fmt(s.generacion_anual_kwh)} kWh por año</h3>
              <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 12, padding: "18px 16px 8px", marginBottom: 8 }}>
                <svg viewBox="0 0 748 170" style={{ width: "100%" }}>
                  {gen.map((g, j) => {
                    const x = 16 + j * 61, bw = 42, h = (g / maxY) * 118;
                    return (
                      <g key={j}>
                        <rect x={x} y={140 - h} width={bw} height={h} fill={SOLAR} rx={4} opacity={0.9} />
                        <text x={x + bw / 2} y={134 - h} textAnchor="middle" fontSize={9} fill={MUT}>{fmt(g)}</text>
                        <text x={x + bw / 2} y={154} textAnchor="middle" fontSize={9.5} fill={MUT}>{MESES[j]}</text>
                      </g>
                    );
                  })}
                  {cons.length === 12 && <polyline fill="none" stroke={B} strokeWidth={2.2} points={cons.map((cx, j) => `${16 + j * 61 + 21},${140 - (cx / maxY) * 118}`).join(" ")} />}
                  <rect x={560} y={4} width={10} height={10} fill={SOLAR} rx={2} /><text x={575} y={13} fontSize={10} fill={INK2}>Generación</text>
                  {cons.length === 12 && <><line x1={648} y1={9} x2={668} y2={9} stroke={B} strokeWidth={2.2} /><text x={673} y={13} fontSize={10} fill={INK2}>Tu consumo</text></>}
                </svg>
              </div>
              <div style={{ fontSize: 12, color: MUT, marginBottom: 30 }}>kWh por mes, estimados con datos satelitales de tu ubicación (Global Solar Atlas).</div>
            </>
          )}

          {/* Retorno (solo si el motor lo calculó) */}
          {m.ahorro && (
            <>
              <h2 style={sec}>Retorno de la inversión</h2>
              <h3 style={big}>Ahorrás ~$ {fmt(m.ahorro.mensual)} por mes{m.repago_anios ? ` — se paga en ~${m.repago_anios} años` : ""}</h3>
              <div style={{ fontSize: 13, color: INK2, marginBottom: 30 }}>$ {fmt(m.ahorro.anual)} al año a valores de tu tarifa actual. Después del repago, la energía es prácticamente gratis por el resto de la vida útil del sistema (25+ años).</div>
            </>
          )}

          {/* Tu inversión — el ÚNICO número */}
          <h2 style={sec}>Tu inversión</h2>
          <div style={{ border: `2px solid ${B}`, borderRadius: 14, overflow: "hidden", marginBottom: 30 }}>
            <div style={{ background: B, color: "#fff", padding: "10px 22px", fontSize: 12, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase" }}>Inversión total llave en mano</div>
            <div style={{ padding: "18px 22px", display: "flex", justifyContent: "space-between", alignItems: "baseline", background: SOFT }}>
              <div style={{ fontFamily: serif, fontSize: 32, color: B2 }}>{total != null ? "USD " + fmt(total, 2) : "A confirmar"}</div>
              <div style={{ fontSize: 11.5, color: MUT, textAlign: "right" }}>+ IVA · equipos, materiales e instalación según alcance{p.presupuesto_numero ? <><br />Detalle completo en presupuesto {p.presupuesto_numero}</> : null}</div>
            </div>
          </div>

          {/* Por qué Febecos */}
          <h2 style={sec}>Por qué FEBECOS</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 30 }}>
            {[
              ["Ingeniería real", "Dimensionado con datos satelitales de tu ubicación y validación eléctrica de cada equipo."],
              ["Equipos tier-1", "Paneles y electrónica de marcas líderes con garantía oficial en Argentina."],
              ["Acompañamiento", "Del cálculo a la puesta en marcha, con soporte local y repuestos."],
            ].map(([t, d], j) => (
              <div key={j} style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 12, padding: "14px 16px", fontSize: 12, color: INK2 }}>
                <b style={{ color: B2, display: "block", marginBottom: 4 }}>{t}</b>{d}
              </div>
            ))}
          </div>

          {/* Próximos pasos */}
          <h2 style={sec}>Próximos pasos</h2>
          <div style={{ fontSize: 13, color: INK2, marginBottom: 8 }}>1. Confirmás la propuesta · 2. Coordinamos visita técnica y fecha · 3. Instalación y puesta en marcha.</div>
          <div style={{ borderTop: `1px solid ${LINE}`, marginTop: 24, paddingTop: 12, fontSize: 10.5, color: MUT, display: "flex", justifyContent: "space-between" }}>
            <span>FEBECOS · Energía Solar · febecos.com · ventas@febecos.com</span>
            <span>Propuesta válida 48 horas · Proyecto FV #{p.id}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
