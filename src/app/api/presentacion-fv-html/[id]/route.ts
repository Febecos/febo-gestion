import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { PLANTILLA_PROPUESTA_FV } from "@/lib/plantilla-propuesta-fv";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";
export const revalidate = 0;
const BUILD_MARK = "opcion-fix-v2";

// GET /api/presentacion-fv-html/[id] — SALIDA C: la PLANTILLA OFICIAL de propuesta comercial poblada
// con los datos del proyecto (esquema IDÉNTICO a la plantilla de CÁLCULOS; solo cambian los datos).
// Regla propuesta-vs-presupuesto: equipos agrupados SIN precios; el único $ es el TOTAL.
// Interna (middleware auth de gestión). Imprimir → PDF con nombre normado (title).

const MESES_CAL = ["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const n0 = (v: any) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
const fmt = (v: any, d = 0) => n0(v).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = (s: any) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

// Reemplaza UN bloque delimitado por un comentario ancla y su cierre — falla visible si no matchea.
function replaceBlock(html: string, startRe: RegExp, endStr: string, nuevo: string, nombre: string): string {
  const m = html.match(startRe);
  if (!m || m.index == null) { console.error(`[presentacion] ancla no encontrada: ${nombre}`); return html; }
  const start = m.index;
  const end = html.indexOf(endStr, start + m[0].length);
  if (end < 0) { console.error(`[presentacion] cierre no encontrado: ${nombre}`); return html; }
  return html.slice(0, start) + nuevo + html.slice(end + endStr.length);
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT p.*, c.nombre AS crm_nombre, c.razon_social AS crm_razon
      FROM fv_proyectos p LEFT JOIN clientes c ON c.id = p.cliente_id WHERE p.id = ${Number(params.id)} LIMIT 1`;
    if (!rows.length) return new NextResponse("Proyecto no encontrado", { status: 404 });
    const p: any = rows[0];
    // ?opcion=on-grid|off-grid|hibrido → superpone la variante generada, reusando esta misma plantilla.
    // Si el proyecto TIENE opciones y NO se pidió una explícita, se usa la RECOMENDADA (o la primera):
    // así la presentación NUNCA sale con el número BASE del proyecto cuando hay opciones (bug: cada
    // propuesta se pisaba en el nº base). Cada opción → su propio nº de presupuesto.
    const tieneOpciones = Array.isArray(p.opciones) && p.opciones.length > 0;
    const modoSel = _req.nextUrl.searchParams.get("opcion")
      || (tieneOpciones ? (p.recomendacion?.modo || p.opciones[0]?.modo) : null);
    if (modoSel && tieneOpciones) {
      const op = p.opciones.find((o: any) => o.modo === modoSel);
      if (op) Object.assign(p, { sistema: op.sistema, meta: op.meta, bom: op.bom, presupuesto_numero: op.presupuesto_numero || p.presupuesto_numero });
    }
    if (_req.nextUrl.searchParams.get("debug") === "1") {
      return NextResponse.json({
        build: BUILD_MARK, id: Number(params.id), base_db: rows[0].presupuesto_numero,
        tieneOpciones, modoSel, opciones_modos: (rows[0].opciones || []).map((o: any) => `${o.modo}:${o.presupuesto_numero}`),
        numRef_resuelto: p.presupuesto_numero, repago: p.meta?.repago_anios,
      }, { headers: { "Cache-Control": "no-store" } });
    }
    const i = p.inputs || {}, s = p.sistema || {}, m = p.meta || {}, cli = i.cliente || {}, u = i.ubicacion || {};
    const fac = p.factura_ref?.datos || {};
    const sup = m.supuestos || {};

    // Total del presupuesto (único $ de la propuesta) + dólar del cotizador (para retorno en ARS)
    let totalUsd: number | null = null;
    if (p.presupuesto_numero) {
      try {
        const pr = await sql`SELECT precio_ofrecido FROM presupuestos WHERE numero = ${p.presupuesto_numero} LIMIT 1`;
        if (pr.length && pr[0].precio_ofrecido != null) totalUsd = Number(pr[0].precio_ofrecido);
      } catch {}
    }
    let dolar = 0;
    try { const cfg = await sql`SELECT data->>'dolar' AS d FROM fv_config WHERE id = 1 LIMIT 1`; dolar = Number(cfg[0]?.d) || 0; } catch {}

    // Datos derivados
    const nombre = cli.razon_social || cli.nombre || p.crm_razon || p.crm_nombre || "Cliente";
    const ubic = [u.localidad, u.provincia].filter(Boolean).join(", ");
    const kwpTxt = s.kwp != null ? String(s.kwp).replace(".", ",") : "—";
    const fase = (s.fase || i.fase) === "tri" ? "trifásico" : "monofásico";
    const faseConex = (s.fase || i.fase) === "tri" ? "Trifásica 380 V" : "Monofásica 220 V";
    const inyeccion = sup.inyeccion || i.inyeccion || "cero";
    const esCero = inyeccion === "cero";
    const fecha = new Date().toLocaleDateString("es-AR");
    const numRef = p.presupuesto_numero || `PROY-${p.id}`;
    const genArr: number[] = Array.isArray(m.perfil_mensual_gen) ? m.perfil_mensual_gen.map(n0) : [];
    const consArr: number[] = Array.isArray(m.perfil_mensual_consumo) ? m.perfil_mensual_consumo.map(n0) : [];
    const consAnual = consArr.length === 12 ? Math.round(consArr.reduce((a, b) => a + b, 0)) : (i.consumo?.kwh_mes ? Math.round(i.consumo.kwh_mes * 12) : 0);
    const consProm = consAnual ? Math.round(consAnual / 12) : n0(i.consumo?.kwh_mes);
    const consMin = consArr.length ? Math.min(...consArr) : null;
    const consMax = consArr.length ? Math.max(...consArr) : null;
    const cobertura = Math.round((s.cobertura || 0) * 100);
    const genAnual = n0(s.generacion_anual_kwh);
    const ahorroMes = m.ahorro?.mensual != null ? n0(m.ahorro.mensual) : null;
    const ahorroAnio = m.ahorro?.anual != null ? n0(m.ahorro.anual) : null;
    const repago = m.repago_anios != null ? n0(m.repago_anios) : null;
    const facturaMes = fac.importe != null ? n0(fac.importe) : null;
    const wp = String(s.panel_codigo || "").match(/(\d{3})\s*W/i)?.[1] || "";
    const esMicro = m.validacion_inversor?.topologia === "micro" || /NEO/i.test(s.inversor_codigo || "");

    let html = PLANTILLA_PROPUESTA_FV.replace(/\r\n/g, "\n"); // la fuente viene con CRLF → normalizar para que las anclas con \n matcheen

    // ── HERO ──
    html = html.replace(/Sistema solar fotovoltaico <b style="color:#fff">[^<]*<\/b>/,
      `Sistema solar fotovoltaico <b style="color:#fff">${esc(kwpTxt)} kWp ${esc(fase)}</b>`);
    html = html.replace(/<p class="who">[\s\S]*?<\/p>/,
      `<p class="who">Preparado para <b>${esc(nombre)}</b>${ubic ? " — " + esc(ubic) : ""} &nbsp;·&nbsp; Ref. presupuesto <b>${esc(numRef)}</b> &nbsp;·&nbsp; ${fecha}</p>`);
    if (!esCero) html = html.replace(/con inyección cero, dimensionado/, "dimensionado");

    // ── KPIs (4 comerciales) ──
    const kpis = `<div class="kpis">
      <div class="kpi"><p class="n">~${cobertura}<small>%</small></p><p class="l">de tu consumo<br>cubierto por el sol</p></div>
      <div class="kpi"><p class="n">${ahorroMes != null ? "~$" + fmt(ahorroMes / 1000, 0) + "<small>k</small>" : "—"}</p><p class="l">de ahorro por mes<br>(al valor de hoy)</p></div>
      <div class="kpi"><p class="n">${repago != null ? "~" + String(repago).replace(".", ",") + "<small> años</small>" : "—"}</p><p class="l">y se paga solo<br>con el ahorro</p></div>
      <div class="kpi"><p class="n">25<small> años</small></p><p class="l">de vida útil<br>de los paneles</p></div>
    </div>`;
    html = replaceBlock(html, /<div class="kpis">/, "</div>\n\n    <!-- SITUACIÓN -->", kpis + "\n\n    <!-- SITUACIÓN -->", "kpis");

    // ── FACTBOX (Tu situación hoy) ──
    const factbox = `<div class="factbox">
          <div class="factrow hl"><span class="k">Factura mensual</span><span class="v">${facturaMes != null ? "$" + fmt(facturaMes) : "según factura"}</span></div>
          <div class="factrow"><span class="k">Consumo promedio</span><span class="v">${fmt(consProm)} kWh/mes</span></div>${consAnual ? `<div class="factrow"><span class="k">Consumo anual · rango</span><span class="v">${fmt(consAnual)} kWh${consMin != null ? " · " + fmt(consMin) + "–" + fmt(consMax) : ""}</span></div>` : ""}
          ${fac.tarifa ? `<div class="factrow"><span class="k">Tarifa</span><span class="v">${esc(fac.tarifa)}</span></div>` : ""}
          <div class="factrow"><span class="k">Conexión</span><span class="v">${faseConex}</span></div>
          ${fac.distribuidora ? `<div class="factrow"><span class="k">Distribuidora</span><span class="v">${esc(fac.distribuidora)}</span></div>` : ""}
        </div>`;
    html = replaceBlock(html, /<div class="factbox">/, "</div>\n      </div>\n    </div>", factbox + "\n      </div>\n    </div>", "factbox");

    // ── SOLUCIÓN: h3 + equip + chips ──
    html = html.replace(/<h3 class="big">Un sistema solar de [^<]*<\/h3>/,
      `<h3 class="big">Un sistema solar de ${esc(kwpTxt)} kWp${esCero ? " con inyección cero" : inyeccion === "futuro" ? " (inyección a futuro)" : " con inyección a red"}</h3>`);
    const equipos: string[] = [];
    equipos.push(`<li><span class="q">${s.n_paneles}×</span><span class="d"><b>Paneles ${esc(String(s.panel_codigo || "").includes("AS-") ? "Amerisolar" : "")} ${wp}&nbsp;Wp</b><span>${esc(kwpTxt)} kWp — monocristalinos, alta eficiencia</span></span></li>`);
    equipos.push(`<li><span class="q">${esMicro ? (m.validacion_inversor?.n_micros || 1) : 1}×</span><span class="d"><b>${esMicro ? "Microinversor" : "Inversor"} ${esc(s.inversor_codigo || "")} (${s.inversor_kw} kW)</b><span>${esMicro ? "MPPT por panel · monitoreo por app" : "monitoreo por app"} · garantía oficial</span></span></li>`);
    equipos.push(`<li><span class="q">1×</span><span class="d"><b>Estructura + protecciones + puesta a tierra${esCero ? " + inyección cero" : ""}</b><span>montaje para ${esc(i.tipo_techo || "techo")}, protecciones CC/CA, puesta a tierra${esCero ? " y limitador de inyección" : ""}</span></span></li>`);
    html = replaceBlock(html, /<ul class="equip">/, "</ul>", `<ul class="equip">\n        ${equipos.join("\n        ")}\n      </ul>`, "equip");
    const chips: string[] = [];
    if (m.validacion_inversor?.ok || esMicro) chips.push(`<span class="chip">✔ ${esMicro ? "Microinversor" : "Inversor"} validado técnicamente</span>`);
    if (esCero) chips.push(`<span class="chip">✔ Inyección cero — sin trámite de GD</span>`);
    chips.push(`<span class="chip">✔ Conexión ${faseConex.toLowerCase()}</span>`);
    chips.push(`<span class="chip">✔ Monitoreo por app (WiFi)</span>`);
    html = replaceBlock(html, /<div class="tech">/, "</div>", `<div class="tech">\n        ${chips.join("\n        ")}\n      </div>`, "chips");

    // ── CÓMO SE CONECTA: adaptar textos (el esquema/diagrama queda) ──
    if (!esMicro) {
      html = html.replace(/<h3 class="big">Dos paneles, un microinversor[^<]*<\/h3>/,
        `<h3 class="big">${s.n_paneles} paneles, un inversor${esCero ? ", inyección cero" : ""}</h3>`);
      html = html.replace(/Microinversor<\/text>/, "Inversor</text>").replace(/Growatt NEO1000M-X/g, esc(s.inversor_codigo || "inversor"));
      html = html.replace(/1 microinversor = 2 paneles[^<]*/, `${s.n_paneles} paneles en serie/strings al inversor`);
    } else {
      html = html.replace(/Growatt NEO1000M-X/g, esc(s.inversor_codigo || "NEO1000M-X"));
      html = html.replace(/<h3 class="big">Dos paneles, un microinversor[^<]*<\/h3>/,
        `<h3 class="big">${s.n_paneles} paneles, ${m.validacion_inversor?.n_micros > 1 ? m.validacion_inversor.n_micros + " microinversores" : "un microinversor"}${esCero ? ", inyección cero" : ""}</h3>`);
    }

    // ── GENERACIÓN: h3 + caption + arrays del script ──
    html = html.replace(/<h3 class="big">Genera ~[^<]*<\/h3>/,
      `<h3 class="big">Genera ~${fmt(genAnual)} kWh por año — para consumir de día</h3>`);
    const planoTxt = sup.inclinacion_grados != null
      ? ` Plano: ${sup.inclinacion_grados}° hacia el norte${sup.azimut_grados ? ` (desvío ${sup.azimut_grados}°)` : ""}${sup.factor_transposicion != null ? ` · rinde ${Math.round(sup.factor_transposicion * 100)}% del óptimo` : ""}.`
      : "";
    html = html.replace(/<p class="caption">Barras verdes[\s\S]*?<\/p>/,
      `<p class="caption">Barras verdes = <b>generación solar estimada</b> (Global Solar Atlas${u.localidad ? ", " + esc(u.localidad) : ""}${u.lat != null ? " · lat " + Number(u.lat).toFixed(2).replace(".", ",") : ""}) · línea roja = <b>tu consumo real</b> (histórico de tu factura). Generación ~${fmt(genAnual)} kWh/año · consumo ~${fmt(consAnual)} kWh/año → el sol cubre ~${cobertura}%.${planoTxt}</p>`);
    if (genArr.length === 12) {
      const gmax = Math.max(...genArr, ...consArr, 1);
      html = html.replace(/var gen=\[[^\]]*\];/, `var gen=[${genArr.join(",")}];`);
      html = html.replace(/var consumo=\[[^\]]*\];[^\n]*/, `var consumo=[${consArr.length === 12 ? consArr.join(",") : Array(12).fill(Math.round(consAnual / 12)).join(",")}];`);
      html = html.replace(/gmax=\d+/, `gmax=${Math.ceil(gmax * 1.15)}`);
    }

    // ── CMP factura hoy vs con solar ──
    const facturaHoy = m.ahorro?.factura_mensual ?? facturaMes;
    if (facturaHoy != null && ahorroMes != null) {
      const conSolar = m.ahorro?.factura_con_solar ?? Math.max(0, facturaHoy - ahorroMes);
      const pct = facturaHoy > 0 ? Math.round((conSolar / facturaHoy) * 100) : 100;
      const fijos = m.ahorro?.cargos_fijos;
      const cmp = `<div class="cmp">
        <div class="barrow"><div class="barlbl"><span>Factura hoy</span><b>$${fmt(facturaHoy)}</b></div><div class="bar now"><i></i></div></div>
        <div class="barrow"><div class="barlbl"><span>Factura estimada con solar</span><b>~$${fmt(conSolar)}</b></div><div class="bar sol"><i style="width:${pct}%"></i></div>
          <div class="saved">▼ Ahorrás ~$${fmt(ahorroMes)} por mes  ·  ~$${fmt(ahorroAnio)} por año</div></div>
      </div>`;
      html = replaceBlock(html, /<div class="cmp">/, "</div>\n      <p style=\"font-size:12.5px", cmp + "\n      <p style=\"font-size:12.5px", "cmp");
      const notaFijos = fijos != null
        ? `de tu factura de <b>$${fmt(facturaHoy)}</b>, <b>~$${fmt(fijos)} son cargos fijos</b> (cuota fija, alumbrado, tasas) que el sol <b>no</b> baja. El ahorro corresponde al consumo diurno que el sistema cubre${esCero ? " en modo inyección cero" : ""}.`
        : `el ahorro corresponde al consumo diurno que el sistema cubre${esCero ? " en modo inyección cero" : ""}; los cargos fijos de la factura (alumbrado, tasas) no bajan con el sol.`;
      html = html.replace(/<p style="font-size:12\.5px;color:var\(--muted\);margin-top:10px"><b>Nota honesta:<\/b>[\s\S]*?<\/p>/,
        `<p style="font-size:12.5px;color:var(--muted);margin-top:10px"><b>Nota honesta:</b> ${notaFijos} Valores a tarifa de hoy.</p>`);
    } else {
      // sin tarifa/ahorro: dejar estructura con aviso (los criterios finales los define CÁLCULOS)
      html = replaceBlock(html, /<div class="cmp">/, "</div>\n      <p style=\"font-size:12.5px",
        `<div class="cmp"><p class="caption">El ahorro en $ se calcula con la tarifa de tu factura — se completa al cargarla.</p></div>\n      <p style="font-size:12.5px`, "cmp");
      html = html.replace(/<p style="font-size:12\.5px;color:var\(--muted\);margin-top:10px"><b>Nota honesta:<\/b>[\s\S]*?<\/p>/, "");
    }

    // ── RETORNO ──
    if (ahorroAnio != null && totalUsd != null && dolar > 0) {
      const invArs = totalUsd * dolar;
      const acc: number[] = [];
      for (let y = 1; y <= 10; y++) acc.push(+((ahorroAnio * y) / 1e6).toFixed(2));
      const maxM = Math.max(acc[9], invArs / 1e6) * 1.05;
      const bottomPct = Math.min(97, Math.round(((invArs / 1e6) / maxM) * 100));
      html = html.replace(/<h3 class="big">Se paga en ~[^<]*<\/h3>/,
        `<h3 class="big">Se paga en ~${repago != null ? String(repago).replace(".", ",") : "—"} años. Después, casi gratis</h3>`);
      html = html.replace(/var acc=\[[^\]]*\];/, `var acc=[${acc.join(",")}];`);
      html = html.replace(/var max=[^;]+;/, `var max=${maxM.toFixed(2)};`);
      html = html.replace(/<div class="invline" style="bottom:[^"]*">[\s\S]*?<\/div>/,
        `<div class="invline" style="bottom:${bottomPct}%"><span class="invtag">Inversión ~$${(invArs / 1e6).toFixed(1).replace(".", ",")} M</span></div>`);
      html = html.replace(/<p class="caption">Ahorro acumulado[\s\S]*?<\/p>/,
        `<p class="caption">Ahorro acumulado en pesos de hoy (conservador, sin ajustar por aumentos de tarifa). La inversión se recupera cerca del <b>año ${repago != null ? Math.round(repago) : "—"}</b>; con los aumentos de tarifa, antes.</p>`);
    } else {
      html = html.replace(/<h3 class="big">Se paga en ~[^<]*<\/h3>/, `<h3 class="big">El retorno se calcula con la tarifa de tu factura</h3>`);
      html = html.replace(/<p class="caption">Ahorro acumulado[\s\S]*?<\/p>/, `<p class="caption">Se completa con la tarifa de la factura y el total del presupuesto.</p>`);
    }

    // ── INVERSIÓN ──
    html = html.replace(/<span class="big">USD [^<]*<\/span>/, `<span class="big">${totalUsd != null ? "USD " + fmt(totalUsd, 0) : "A confirmar"}</span>`);
    const incl: string[] = [];
    const check = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>`;
    incl.push(`<li>${check} ${s.n_paneles}× Paneles ${wp}W (${esc(kwpTxt)} kWp)</li>`);
    incl.push(`<li>${check} ${esMicro ? "Microinversor" : "Inversor"} ${esc(s.inversor_codigo || "")} (${s.inversor_kw} kW)</li>`);
    incl.push(`<li>${check} Estructura para ${esc(i.tipo_techo || "techo")} (con clamps)</li>`);
    incl.push(`<li>${check} Protecciones CC/CA + cable solar + puesta a tierra${esCero ? " + limitador de inyección" : ""} + MC4</li>`);
    html = replaceBlock(html, /<ul class="incl">/, "</ul>", `<ul class="incl">\n          ${incl.join("\n          ")}\n        </ul>`, "incl");
    html = html.replace(/ni flete a Salto\./, ubic ? `ni flete a ${esc(u.localidad || ubic)}.` : "ni flete.");

    // Título del documento = NORMA de nombre de PDF
    const title = `${numRef} - ${nombre} - Propuesta`.replace(/[/\\:*?"<>|]/g, " ").replace(/\s{2,}/g, " ").trim();
    const page = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${esc(title)}</title></head><body style="margin:0">${html}</body></html>`;
    return new NextResponse(page, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (e: any) {
    return new NextResponse("Error generando la propuesta: " + e.message, { status: 500 });
  }
}
