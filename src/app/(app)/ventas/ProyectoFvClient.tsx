"use client";
import { useState, useEffect, useRef } from "react";
import ParamsFvClient from "./ParamsFvClient";

// Formulario de proyecto FV self-service (backlog #3). Paso 1: el vendedor carga los datos del
// proyecto (cliente, ubicación, sistema, consumo/factura, fotos) → se guarda en fv_proyectos y queda
// en un LISTADO reabrible/editable. El dimensionado (motor CÁLCULOS FV) + el enganche al cotizador se
// agregan cuando el motor esté. Look&feel febo-gestion (Tailwind), form seccionado en cards.

type FacturaDatos = { distribuidora: string | null; titular: string | null; kwh_mes: number | null; kwh_meses: number[]; meses_detalle?: { mes: string | null; kwh: number }[]; potencia_contratada_kw: number | null; tarifa: string | null; periodo: string | null; importe: number | null; cargos_fijos_ars?: number | null };
type ProyRow = { id: number; cliente_id: number | null; vendedor: string | null; estado: string; presupuesto_numero: string | null; created_at: string; updated_at: string; sistema: any; cliente_nombre: string | null; cliente_razon_social: string | null };

async function safeJson(r: Response) { try { return await r.json(); } catch { return { ok: false, error: "respuesta inválida" }; } }
const lbl = "block text-[10px] uppercase text-gray-400 font-semibold mb-0.5";
const inp = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm";
const card = "bg-white rounded-xl border border-gray-200 p-4 space-y-3";
const cardTit = "text-xs uppercase font-bold text-febo-azul tracking-wide";

export default function ProyectoFvClient() {
  const [vista, setVista] = useState<"form" | "lista" | "params">("form");
  const [lista, setLista] = useState<ProyRow[]>([]);
  const [cargandoLista, setCargandoLista] = useState(false);

  // Cliente
  const [clienteId, setClienteId] = useState<number | null>(null);
  const [nombre, setNombre] = useState("");
  const [cuit, setCuit] = useState("");
  const [razon, setRazon] = useState("");
  const [busqCli, setBusqCli] = useState("");
  const [matchesCli, setMatchesCli] = useState<any[]>([]);
  const [cliIdx, setCliIdx] = useState(-1);
  const [arcaMsg, setArcaMsg] = useState("");
  // Ubicación (Georef, igual que Transportistas)
  const [provincia, setProvincia] = useState("");
  const [localidad, setLocalidad] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [busqLoc, setBusqLoc] = useState("");
  const [matchesLoc, setMatchesLoc] = useState<{ nombre: string; prov: string; lat: number; lng: number }[]>([]);
  const [locIdx, setLocIdx] = useState(-1);
  // Navegación por teclado (↑/↓/Enter/Esc) para cualquier dropdown de lista del form (pedido de Guille).
  function navKey<T>(e: React.KeyboardEvent, items: T[], idx: number, setIdx: (n: number) => void, elegir: (it: T) => void) {
    if (!items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx(Math.min(idx + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx(Math.max(idx - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); elegir(items[idx >= 0 ? idx : 0]); }
    else if (e.key === "Escape") { setIdx(-1); }
  }
  // Sistema
  const [fase, setFase] = useState<"mono" | "tri">("mono");
  const [conexion, setConexion] = useState<"on-grid" | "off-grid" | "hibrido">("on-grid");
  const [techo, setTecho] = useState<"chapa" | "teja" | "losa" | "suelo">("chapa");
  const [inyeccion, setInyeccion] = useState<"cero" | "futuro" | "con-inyeccion">("cero"); // LA decisión clave: gobierna tamaño+topología+limitador
  const [fraccionDiurna, setFraccionDiurna] = useState(""); // % del consumo que es de día (default config 0.5)
  const [inclinacion, setInclinacion] = useState(""); // ° del plano real (vacío = default config: 30 inclinada / 10 coplanar)
  const [azimut, setAzimut] = useState(""); // ° desvío del norte (0=norte, +Este, −Oeste)
  const [generandoPresup, setGenerandoPresup] = useState(false);
  const [presupNumero, setPresupNumero] = useState<string | null>(null);
  const [presupToken, setPresupToken] = useState<string | null>(null);
  const [sitioSinTierra, setSitioSinTierra] = useState(true); // sin puesta a tierra → agrega jabalina
  const [metrosCable, setMetrosCable] = useState(""); // metros de cable solar (default config 20)
  const [metrosTierra, setMetrosTierra] = useState(""); // metros de cable de tierra (default config 20)
  // Consumo / factura
  const [kwhMes, setKwhMes] = useState("");
  const [potencia, setPotencia] = useState("");
  const [facturaLink, setFacturaLink] = useState("");
  const [facturaDatos, setFacturaDatos] = useState<FacturaDatos | null>(null);
  const [facturaRef, setFacturaRef] = useState<{ url?: string; nombre?: string } | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [facturaMsg, setFacturaMsg] = useState("");
  // Fotos
  const [fotos, setFotos] = useState<{ nombre: string; url: string }[]>([]);
  const [subiendoFotos, setSubiendoFotos] = useState(false);
  // Estado
  const [referencia, setReferencia] = useState(""); // nombre de la carpeta destino en COTIZADOS
  const [guardando, setGuardando] = useState(false);
  const [dimensionando, setDimensionando] = useState(false);
  const [resultado, setResultado] = useState<{ sistema: any; bom: any[]; meta: any } | null>(null);
  const [comparando, setComparando] = useState(false);
  const [comparacion, setComparacion] = useState<{ opciones: any[]; recomendacion: any } | null>(null);
  const [generandoTres, setGenerandoTres] = useState(false);
  const [opcionesGeneradas, setOpcionesGeneradas] = useState<{ opciones: any[]; recomendacion: any } | null>(null);
  // WIZARD doble modo: 🗣️ criollo (preguntas simples → traducción MAPEO-CRIOLLO-TECNICO.md de CÁLCULOS)
  // o 🔧 técnico (el form directo). Ambos alimentan el MISMO motor. Uso interno (Guille) — sin roles.
  const [modoCalc, setModoCalc] = useState<"criollo" | "tecnico">("tecnico");
  const [wiz, setWiz] = useState<Record<string, string>>({});
  const [wizAplicado, setWizAplicado] = useState(false);
  // Extras del wizard que el form técnico no tiene como campo: respaldo (P3) y off_grid (P4)
  const [respaldoExtra, setRespaldoExtra] = useState<any>(null);
  const [offgridExtra, setOffgridExtra] = useState<any>(null);
  // Intención off-grid (define sizing Y ahorro): backup = mantiene red, canasto crítico, ahorro variable ·
  // desconexión = se independiza, lista completa de equipos, ahorro = factura completa.
  const [intencionOG, setIntencionOG] = useState<"backup" | "desconexion">("backup");
  // Editor de cargas: null = usar canasto default del motor (sin mandar cargas). Al abrirlo se precarga.
  const [cargasList, setCargasList] = useState<{ nombre: string; potencia_w: number; horas_dia: number; cantidad: number }[] | null>(null);
  const [msg, setMsg] = useState("");
  const [proyectoId, setProyectoId] = useState<number | null>(null);

  const fileToB64 = (f: File): Promise<string> => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });

  // Imágenes: redimensionar/comprimir con canvas (máx 1600px, JPEG 0.8) para no exceder el límite de
  // body de Vercel (~4,5MB) — una foto de celular cruda daba 413. PDF va tal cual (Gemini lo lee nativo).
  async function prepararArchivo(f: File): Promise<{ b64: string; tipo: string }> {
    if (!/^image\//.test(f.type)) { const durl = await fileToB64(f); return { b64: durl.split(",")[1], tipo: f.type || "application/pdf" }; }
    const durl = await fileToB64(f);
    const img = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = durl; });
    const MAX = 1600; let w = img.width, h = img.height;
    if (w > MAX || h > MAX) { const k = MAX / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d"); if (ctx) ctx.drawImage(img, 0, 0, w, h);
    return { b64: c.toDataURL("image/jpeg", 0.8).split(",")[1], tipo: "image/jpeg" };
  }

  // ── Búsqueda de cliente en el CRM (debounce) ──
  const cliT = useRef<any>(null);
  useEffect(() => {
    if (!busqCli.trim() || clienteId) { setMatchesCli([]); return; }
    clearTimeout(cliT.current);
    cliT.current = setTimeout(() => {
      fetch("/api/clientes?limit=8&q=" + encodeURIComponent(busqCli.trim())).then((r) => r.json()).then((d) => { setMatchesCli(d.clientes || []); setCliIdx(-1); }).catch(() => {});
    }, 250);
    return () => clearTimeout(cliT.current);
  }, [busqCli, clienteId]);
  function elegirCliente(c: any) {
    setClienteId(c.id); setNombre(c.razon_social || c.nombre || ""); setCuit(c.cuit || ""); setRazon(c.razon_social || "");
    if (c.provincia) setProvincia(c.provincia); if (c.localidad) setLocalidad(c.localidad);
    setBusqCli(""); setMatchesCli([]);
  }
  async function buscarArca() {
    const c = (cuit || "").replace(/\D/g, "");
    if (c.length !== 11) { setArcaMsg("El CUIT debe tener 11 dígitos."); return; }
    setArcaMsg("Buscando en ARCA…");
    try {
      const r = await fetch("/api/consultar-cuit?cuit=" + c); const d = await r.json();
      if (!d.ok || d.valido === false) throw new Error(d.error || "CUIT sin datos");
      const dom = d.domicilio || {};
      const nom = d.razonSocial || d.denominacion || [d.nombre, d.apellido].filter(Boolean).join(" ");
      if (nom) { setRazon(d.razonSocial || d.denominacion || razon); if (!nombre) setNombre(nom); }
      if (dom.localidad && !localidad) setLocalidad(dom.localidad);
      if (dom.provincia && !provincia) setProvincia(dom.provincia);
      setArcaMsg("✓ " + (nom || c));
    } catch (e: any) { setArcaMsg("✕ " + e.message); }
  }

  // ── Autocomplete de localidad (Georef, mismo sistema que Transportistas) ──
  const locT = useRef<any>(null);
  useEffect(() => {
    if (!busqLoc.trim() || busqLoc.length < 3) { setMatchesLoc([]); return; }
    clearTimeout(locT.current);
    locT.current = setTimeout(async () => {
      try {
        const u = `https://apis.datos.gob.ar/georef/api/localidades?nombre=${encodeURIComponent(busqLoc.trim())}&campos=nombre,provincia.nombre,centroide.lat,centroide.lon&max=6&aplanar=true`;
        const j = await (await fetch(u)).json();
        setMatchesLoc((j.localidades || []).map((x: any) => ({ nombre: x.nombre, prov: x.provincia_nombre, lat: x.centroide_lat, lng: x.centroide_lon }))); setLocIdx(-1);
      } catch { setMatchesLoc([]); }
    }, 300);
    return () => clearTimeout(locT.current);
  }, [busqLoc]);
  function elegirLoc(l: { nombre: string; prov: string; lat: number; lng: number }) {
    setLocalidad(l.nombre); setProvincia(l.prov); setLat(l.lat); setLng(l.lng);
    setBusqLoc(""); setMatchesLoc([]);
  }

  // CONSUMO representativo = promedio de los últimos 12 MESES CERRADOS (regla de Guille): se excluye
  // el período en curso de la factura (parcial/último del historial) y se promedian los 12 previos.
  // Bouvier: 13 barras, (3460−196)/12 = 272 = lo que dice la factura. NO usar el mes actual ni ÷13.
  function promedio12(meses: { kwh: number }[] | number[] | undefined): number | null {
    if (!Array.isArray(meses) || !meses.length) return null;
    const vals = meses.map((x: any) => Number(typeof x === "object" ? x.kwh : x)).filter((v) => !isNaN(v) && v > 0);
    if (!vals.length) return null;
    const cerrados = vals.length >= 2 ? vals.slice(0, -1) : vals;  // excluir el período en curso (último)
    const ult12 = cerrados.slice(-12);                              // hasta 12 meses cerrados más recientes
    return Math.round(ult12.reduce((a, b) => a + b, 0) / ult12.length);
  }

  function aplicarFactura(d: FacturaDatos) {
    setFacturaDatos(d);
    // Consumo para dimensionar: promedio 12 meses cerrados del historial; el kwh_mes del período
    // (mes en curso, ej. 196) solo si no hay historial.
    const prom12 = promedio12(d.meses_detalle?.length ? d.meses_detalle : d.kwh_meses);
    if (prom12 != null) setKwhMes(String(prom12));
    else if (d.kwh_mes != null) setKwhMes(String(d.kwh_mes));
    if (d.potencia_contratada_kw != null) setPotencia(String(d.potencia_contratada_kw));
    const partes = [d.distribuidora && `Distribuidora: ${d.distribuidora}`, d.tarifa && `Tarifa: ${d.tarifa}`, d.periodo && `Período: ${d.periodo}`].filter(Boolean);
    setFacturaMsg("✓ Factura leída. " + (partes.join(" · ") || "Datos cargados."));
  }

  // AUTO-PERSISTIR la lectura al proyecto apenas llega (bug: si el vendedor no re-guardaba, la lectura
  // se perdía — factura_ref.datos quedaba null en la DB y el informe no tenía el consumo mensual).
  // Usa los VALORES locales (datos/archivo recién obtenidos), no el state (stale en este tick).
  async function persistirFactura(datos: FacturaDatos | null, archivo: { url?: string; nombre?: string } | null, link: string | null) {
    if (!proyectoId) return; // sin proyecto todavía: el próximo Guardar/Dimensionar la lleva
    try {
      const inputsConFactura = {
        ...construirInputs(),
        consumo: { kwh_mes: datos?.kwh_mes ?? (kwhMes ? Number(kwhMes) : null), kwh_meses: datos?.kwh_meses || [], meses_detalle: datos?.meses_detalle || [] },
        potencia_contratada_kw: datos?.potencia_contratada_kw ?? (potencia ? Number(potencia) : null),
      };
      await fetch("/api/fv-proyectos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: proyectoId, inputs: inputsConFactura, factura_ref: { archivo, datos, link } }) });
    } catch { /* best-effort: el Guardar explícito la lleva igual */ }
  }

  async function subirFactura(f?: File) {
    if (!f) return;
    setLeyendo(true); setFacturaMsg("⏳ Leyendo la factura…");
    try {
      const { b64, tipo } = await prepararArchivo(f);
      const up = await safeJson(await fetch("/api/adjunto-upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: f.name, content_type: tipo, data_b64: b64 }) }));
      const archivo = up.ok && up.url ? { url: up.url, nombre: f.name } : null;
      if (archivo) setFacturaRef(archivo);
      const r = await safeJson(await fetch("/api/leer-factura-luz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ b64, tipo }) }));
      if (r.ok && r.data) { aplicarFactura(r.data); await persistirFactura(r.data, archivo, null); }
      else if (r.sin_key) setFacturaMsg("⚠️ Lectura automática no disponible (falta GEMINI_API_KEY). Cargá el consumo a mano.");
      else setFacturaMsg("⚠️ No se pudo leer la factura: " + (r.error || "error") + ". Cargá el consumo a mano.");
    } catch (e: any) { setFacturaMsg("⚠️ " + e.message); }
    finally { setLeyendo(false); }
  }
  async function leerFacturaLink() {
    if (!facturaLink.trim()) return;
    setLeyendo(true); setFacturaMsg("⏳ Bajando y leyendo la factura del link…");
    try {
      const r = await safeJson(await fetch("/api/leer-factura-luz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ link: facturaLink.trim() }) }));
      if (r.ok && r.data) {
        aplicarFactura(r.data);
        let archivo: { url?: string; nombre?: string } | null = null;
        if (r.archivo?.b64) {
          const up = await safeJson(await fetch("/api/adjunto-upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: "factura-luz", content_type: r.archivo.tipo, data_b64: r.archivo.b64 }) }));
          if (up.ok && up.url) { archivo = { url: up.url, nombre: "factura-luz (del link)" }; setFacturaRef(archivo); }
        }
        await persistirFactura(r.data, archivo, facturaLink.trim() || null);
      } else if (r.link_inaccesible) setFacturaMsg("⚠️ " + (r.error || "El link no es accesible.") + " Subí el archivo en su lugar.");
      else setFacturaMsg("⚠️ " + (r.error || "No se pudo leer.") + " Subí el archivo en su lugar.");
    } catch (e: any) { setFacturaMsg("⚠️ " + e.message); }
    finally { setLeyendo(false); }
  }

  async function subirFotos(files?: FileList | null) {
    if (!files || !files.length) return;
    setSubiendoFotos(true);
    try {
      for (const f of Array.from(files)) {
        const { b64, tipo } = await prepararArchivo(f);
        const up = await safeJson(await fetch("/api/adjunto-upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: f.name, content_type: tipo, data_b64: b64 }) }));
        if (up.ok && up.url) setFotos((prev) => [...prev, { nombre: f.name, url: up.url }]);
      }
    } finally { setSubiendoFotos(false); }
  }

  function nuevo() {
    setProyectoId(null); setClienteId(null); setNombre(""); setCuit(""); setRazon("");
    setProvincia(""); setLocalidad(""); setLat(null); setLng(null);
    setFase("mono"); setConexion("on-grid"); setTecho("chapa"); setInyeccion("cero"); setFraccionDiurna(""); setInclinacion(""); setAzimut(""); setSitioSinTierra(true); setMetrosCable(""); setMetrosTierra("");
    setKwhMes(""); setPotencia(""); setFacturaLink(""); setFacturaDatos(null); setFacturaRef(null); setFacturaMsg("");
    setFotos([]); setReferencia(""); setResultado(null); setMsg(""); setArcaMsg(""); setPresupNumero(null); setPresupToken(null); setComparacion(null); setOpcionesGeneradas(null); setVista("form");
  }

  async function cargarLista() {
    setCargandoLista(true);
    try { const d = await safeJson(await fetch("/api/fv-proyectos")); if (d.ok) setLista(d.proyectos || []); }
    finally { setCargandoLista(false); }
  }
  async function borrarProyecto(id: number, nom: string) {
    if (!confirm(`¿Eliminar el proyecto #${id}${nom ? ` (${nom})` : ""}? No se puede deshacer.`)) return;
    const d = await safeJson(await fetch("/api/fv-proyectos?id=" + id, { method: "DELETE" }));
    if (d.ok) { setLista((prev) => prev.filter((p) => p.id !== id)); if (proyectoId === id) nuevo(); }
    else alert("No se pudo eliminar: " + (d.error || "error"));
  }
  useEffect(() => { if (vista === "lista") cargarLista(); }, [vista]);

  async function abrirProyecto(id: number) {
    const d = await safeJson(await fetch("/api/fv-proyectos?id=" + id));
    if (!d.ok) { setMsg("⚠️ No se pudo abrir el proyecto."); return; }
    const p = d.proyecto; const i = p.inputs || {};
    setProyectoId(p.id); setClienteId(p.cliente_id ?? null);
    setPresupNumero(p.presupuesto_numero || null); setPresupToken(null); // el link se rearma al regenerar
    setNombre(i.cliente?.nombre || ""); setCuit(i.cliente?.cuit || ""); setRazon(i.cliente?.razon_social || "");
    setProvincia(i.ubicacion?.provincia || ""); setLocalidad(i.ubicacion?.localidad || ""); setLat(i.ubicacion?.lat ?? null); setLng(i.ubicacion?.lng ?? null);
    setFase(i.fase || "mono"); setConexion(i.tipo_conexion || "on-grid"); setTecho(i.tipo_techo || "chapa");
    setInyeccion(i.inyeccion === "futuro" ? "futuro" : i.inyeccion === "con-inyeccion" ? "con-inyeccion" : "cero");
    setFraccionDiurna(i.fraccion_diurna != null ? String(i.fraccion_diurna) : ""); setSitioSinTierra(i.sitio_sin_tierra !== false);
    setInclinacion(i.inclinacion_grados != null ? String(i.inclinacion_grados) : ""); setAzimut(i.azimut_grados != null ? String(i.azimut_grados) : "");
    setMetrosCable(i.metros_cable != null ? String(i.metros_cable) : ""); setMetrosTierra(i.metros_tierra != null ? String(i.metros_tierra) : "");
    setKwhMes(i.consumo?.kwh_mes != null ? String(i.consumo.kwh_mes) : ""); setPotencia(i.potencia_contratada_kw != null ? String(i.potencia_contratada_kw) : "");
    setFacturaDatos(p.factura_ref?.datos || null); setFacturaRef(p.factura_ref?.archivo || null); setFacturaLink(p.factura_ref?.link || "");
    setFotos(Array.isArray(i.fotos) ? i.fotos : []);
    setIntencionOG(i.off_grid?.intencion === "desconexion" ? "desconexion" : "backup");
    setOffgridExtra(i.off_grid ? { ...(i.off_grid.factor_autonomia != null ? { factor_autonomia: i.off_grid.factor_autonomia } : {}), ...(i.off_grid.autonomia_dias != null ? { autonomia_dias: i.off_grid.autonomia_dias } : {}) } : null);
    setRespaldoExtra(i.respaldo || null);
    setCargasList(Array.isArray(i.cargas) && i.cargas.length ? i.cargas : null);
    setReferencia(p.referencia || "");
    setResultado(p.sistema ? { sistema: p.sistema, bom: Array.isArray(p.bom) ? p.bom : [], meta: {} } : null);
    setComparacion(null);
    setOpcionesGeneradas(Array.isArray(p.opciones) && p.opciones.length ? { opciones: p.opciones, recomendacion: p.recomendacion || null } : null);
    setFacturaMsg(""); setArcaMsg(""); setMsg(""); setVista("form");
  }

  const nombreFinal = () => nombre.trim() || busqCli.trim() || razon.trim() || "Proyecto sin nombre";
  // Norma de título autogenerado (Guille): "CLIENTE — kWp N×Wp + kW tipo — localidad"
  // ej "BOUVIER EDGARDO — 3,48 kWp 6×580 + 3kW on-grid — Las Carabelas". Se usa como referencia (=nombre
  // de carpeta), editable. Requiere el sistema dimensionado (kWp/paneles/inversor).
  function tituloNormado(sistema: any): string {
    const cli = (razon.trim() || nombre.trim() || busqCli.trim() || "Proyecto").toUpperCase();
    const kwp = sistema?.kwp != null ? `${String(sistema.kwp).replace(".", ",")} kWp` : "";
    const wp = String(sistema?.panel_codigo || "").match(/(\d{3})\s*W/i)?.[1] || "";
    const paneles = sistema?.n_paneles ? `${sistema.n_paneles}×${wp || "?"}` : "";
    const inv = sistema?.inversor_kw ? `${sistema.inversor_kw}kW` : "";
    const tipo = sistema?.tipo || conexion;
    const loc = localidad.trim();
    const medio = [kwp, paneles].filter(Boolean).join(" ") + (inv ? ` + ${inv} ${tipo}` : ` ${tipo}`);
    return [cli, medio.trim(), loc].filter(Boolean).join(" — ").replace(/\s{2,}/g, " ").trim().slice(0, 90);
  }
  function construirInputs() {
    return {
      cliente: { nombre: nombreFinal(), cuit: cuit.trim() || null, razon_social: razon.trim() || null },
      ubicacion: { provincia: provincia || null, localidad: localidad.trim() || null, lat, lng },
      fase, tipo_conexion: conexion, tipo_techo: techo,
      inyeccion, // 'cero' (default) | 'futuro' | 'con-inyeccion' — gobierna tamaño+topología+limitador
      fraccion_diurna: fraccionDiurna ? Number(fraccionDiurna) : null,
      sitio_sin_tierra: sitioSinTierra,
      metros_cable: metrosCable ? Number(metrosCable) : null,
      metros_tierra: metrosTierra ? Number(metrosTierra) : null,
      consumo: { kwh_mes: kwhMes ? Number(kwhMes) : (facturaDatos?.kwh_mes ?? null), kwh_meses: facturaDatos?.kwh_meses || [], meses_detalle: facturaDatos?.meses_detalle || [], factura_mensual_ars: facturaDatos?.importe ?? null, cargos_fijos_ars: facturaDatos?.cargos_fijos_ars ?? null },
      inclinacion_grados: inclinacion ? Number(inclinacion) : null,
      azimut_grados: azimut !== "" ? Number(azimut) : null,
      potencia_contratada_kw: potencia ? Number(potencia) : (facturaDatos?.potencia_contratada_kw ?? null),
      // Extras del wizard criollo (P3 respaldo / P4 autonomía) — passthrough al motor; null si no aplican.
      ...(respaldoExtra ? { respaldo: respaldoExtra } : {}),
      // Off-grid: la INTENCIÓN define sizing y ahorro (backup=canasto+ahorro variable ·
      // desconexión=lista completa+ahorro factura completa) + overrides del wizard (P4).
      ...(conexion === "off-grid" ? { off_grid: { intencion: intencionOG, ...(offgridExtra || {}) } } : offgridExtra ? { off_grid: offgridExtra } : {}),
      // Cargas editadas (canasto ajustado o lista completa). null = el motor usa su canasto default.
      ...(cargasList && cargasList.length ? { cargas: cargasList } : {}),
      fotos,
    };
  }

  // Canasto crítico default (espejo de config.canasto_critico del motor) — precarga del editor.
  const CANASTO_DEFAULT = [
    { nombre: "Heladera con freezer", potencia_w: 150, horas_dia: 8, cantidad: 1 },
    { nombre: "Iluminación LED (8-10 luces)", potencia_w: 80, horas_dia: 6, cantidad: 1 },
    { nombre: "Router/comunicación", potencia_w: 30, horas_dia: 24, cantidad: 1 },
    { nombre: "TV + tomas esenciales", potencia_w: 150, horas_dia: 5, cantidad: 1 },
    { nombre: "Bomba de agua", potencia_w: 750, horas_dia: 0.5, cantidad: 1 },
  ];

  // 🗣️→🔧 Traducción criollo→técnico (tabla de CÁLCULOS — MAPEO-CRIOLLO-TECNICO.md; no inventar acá).
  function aplicarWizard() {
    const w = wiz;
    // P1 · dónde se usa la luz → fracción diurna
    const P1: Record<string, string> = { casa: "0.5", campo: "0.6", comercio: "0.7", industria: "0.8" };
    if (w.p1) setFraccionDiurna(P1[w.p1] || "");
    // P2 · qué hacer con la red → tipo + inyección
    if (w.p2 === "bajar") { setConexion("on-grid"); setInyeccion("cero"); }
    else if (w.p2 === "vender-futuro") { setConexion("on-grid"); setInyeccion("futuro"); }
    else if (w.p2 === "permiso") { setConexion("on-grid"); setInyeccion("con-inyeccion"); }
    else if (w.p2 === "respaldo") { setConexion("hibrido"); setInyeccion("cero"); }
    else if (w.p2 === "independizarme") { setConexion("off-grid"); }
    // P3 (solo respaldo 🔋) · qué sigue andando → cargas (canasto) + días de respaldo
    if (w.p2 === "respaldo" && w.p3) {
      if (w.p3 === "basico") { setCargasList(null); setRespaldoExtra(null); }          // canasto default del motor, 1 día
      else if (w.p3 === "basico-mas") { setCargasList(CANASTO_DEFAULT.map((c) => ({ ...c }))); setRespaldoExtra(null); } // abre editor precargado
      else if (w.p3 === "corte-largo") { setCargasList(null); setRespaldoExtra({ dias: 2 }); }
    } else if (w.p2 !== "respaldo") setRespaldoExtra(null);
    // P4 (solo off-grid 🏝️) · días nublados → autonomia_dias (override por proyecto) + factor
    if (w.p2 === "independizarme") {
      setIntencionOG("backup");
      if (w.p4 === "con-respaldo") setOffgridExtra({ factor_autonomia: 0.75, autonomia_dias: 2 });
      else if (w.p4 === "brava") setOffgridExtra({ factor_autonomia: 1.0, autonomia_dias: 3 });
      else if (w.p4) setOffgridExtra({ factor_autonomia: 1.0, autonomia_dias: 2 });
    } else setOffgridExtra(null);
    // P5 · techo → estructura + inclinación
    if (w.p5 === "chapa-inclinada") { setTecho("chapa"); setInclinacion("30"); }
    else if (w.p5 === "chapa-plana") { setTecho("chapa"); setInclinacion("10"); }
    else if (w.p5 === "losa") { setTecho("losa"); setInclinacion("30"); }
    else if (w.p5 === "teja") { setTecho("teja"); setInclinacion("30"); }
    else if (w.p5 === "suelo") { setTecho("suelo"); setInclinacion("30"); }
    // P6 · orientación → azimut (0=norte, +Este, −Oeste)
    const P6: Record<string, string> = { norte: "0", este: "90", oeste: "-90", sur: "180", "ni-idea": "0" };
    if (w.p6) setAzimut(P6[w.p6] ?? "");
    // P7 · jabalina → sitio_sin_tierra
    if (w.p7) setSitioSinTierra(w.p7 !== "si");
    // P8 · metros al tablero
    if (w.p8 === "cerca") { setMetrosCable("10"); setMetrosTierra("10"); }
    else if (w.p8 === "normal") { setMetrosCable("20"); setMetrosTierra("20"); }
    else if (w.p8 === "lejos") { setMetrosCable("50"); setMetrosTierra("30"); }
    setWizAplicado(true);
    setMsg("✅ Respuestas traducidas a la configuración técnica (la ves abajo, editable). Ahora: ⚡ Dimensionar o ⚡ Calcular las 3 opciones.");
  }
  // Guarda y devuelve el id (para encadenar dimensionar). No muestra mensaje si silencioso=true.
  async function guardarProyecto(silencioso = false): Promise<number | null> {
    const body: any = { cliente_id: clienteId, inputs: construirInputs(), factura_ref: { archivo: facturaRef, datos: facturaDatos, link: facturaLink.trim() || null }, referencia: referencia.trim() || null, estado: "borrador" };
    if (proyectoId) body.id = proyectoId;
    const r = await safeJson(await fetch("/api/fv-proyectos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    if (!r.ok) { if (!silencioso) setMsg("⚠️ No se pudo guardar: " + (r.error || "error desconocido")); return null; }
    setProyectoId(r.id); if (!nombre.trim()) setNombre(nombreFinal());
    return r.id;
  }
  async function guardar() {
    setGuardando(true); setMsg("");
    try {
      const id = await guardarProyecto();
      if (id) {
        const carpeta = referencia.trim() || `${nombreFinal()} - PROY-${id}`;
        setMsg(`✅ Proyecto guardado (#${id}) como "${nombreFinal()}". Lo encontrás en "📋 Proyectos guardados" para reabrir y editar. 📁 Carpeta destino: PROYECTOS FV\\${carpeta}.`);
        cargarLista();
      }
    } catch (e: any) { setMsg("⚠️ " + e.message); }
    finally { setGuardando(false); }
  }
  // ⚡ Dimensionar: guarda → llama al motor (CÁLCULOS via /api/dimensionar) → guarda sistema+BOM → muestra.
  async function dimensionar() {
    if (lat == null || lng == null) { setMsg("⚠️ Elegí la localidad (necesito lat/long para el cálculo de radiación)."); return; }
    if (!kwhMes && !facturaDatos) { setMsg("⚠️ Cargá el consumo (kWh/mes) o una factura."); return; }
    setDimensionando(true); setMsg(""); setResultado(null);
    try {
      const id = await guardarProyecto(true);
      const r = await safeJson(await fetch("/api/dimensionar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inputs: construirInputs() }) }));
      if (!r.ok) { setMsg("⚠️ No se pudo dimensionar: " + (r.error || "error del motor")); return; }
      setResultado({ sistema: r.sistema, bom: r.bom || [], meta: r.meta || {} });
      // Autopoblar la referencia (=nombre de carpeta) con el título normado si el vendedor no puso una.
      let refFinal = referencia.trim();
      if (!refFinal) { refFinal = tituloNormado(r.sistema); setReferencia(refFinal); }
      if (id) await fetch("/api/fv-proyectos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, sistema: r.sistema, bom: r.bom, meta: r.meta || null, referencia: refFinal || null, estado: "dimensionado" }) });
      setMsg(`✅ Dimensionado listo: ${r.sistema?.kwp} kWp, ${r.sistema?.n_paneles} paneles, cobertura ${Math.round((r.sistema?.cobertura || 0) * 100)}%. Revisá el sistema + la lista de componentes abajo.`);
    } catch (e: any) { setMsg("⚠️ " + e.message); }
    finally { setDimensionando(false); }
  }

  // ⚡⚡ COMPARADOR 3 OPCIONES (Fase 1): motor 3× (on-grid/off-grid/híbrido) con la MISMA factura,
  // cada BOM valorizada por el cotizador → tabla + recomendación por MENOR repago. No crea PREV:
  // el vendedor elige el modo (selector Conexión), re-dimensiona y genera el presupuesto de esa opción.
  async function compararOpciones() {
    if (lat == null || lng == null) { setMsg("⚠️ Elegí la localidad (necesito lat/long para el cálculo de radiación)."); return; }
    if (!kwhMes && !facturaDatos) { setMsg("⚠️ Cargá el consumo (kWh/mes) o una factura."); return; }
    setComparando(true); setMsg(""); setComparacion(null);
    try {
      await guardarProyecto(true);
      const r = await safeJson(await fetch("/api/proyecto-comparar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ form_inputs: construirInputs() }) }));
      if (!r.ok) { setMsg("⚠️ No se pudo comparar: " + (r.error || "error del comparador")); return; }
      setComparacion({ opciones: r.opciones || [], recomendacion: r.recomendacion || null });
      const rec = r.recomendacion;
      setMsg(rec ? `✅ Comparación lista. Sugerida: ${rec.label} (repago ${rec.repago_anios} años). Elegí el modo en "Conexión" y dimensioná esa opción para generar su presupuesto.` : "✅ Comparación lista (sin repago calculable — revisá factura $ y cargos fijos).");
    } catch (e: any) { setMsg("⚠️ " + e.message); }
    finally { setComparando(false); }
  }

  // 🎁 GENERAR LAS 3 OPCIONES: corre el orquestador (motor 3× + PREV real por modo), persiste las
  // opciones en el proyecto y deja los links (presupuesto/informe/presentación por opción + comparativo).
  async function generarTresOpciones() {
    if (lat == null || lng == null) { setMsg("⚠️ Elegí la localidad (necesito lat/long para el cálculo de radiación)."); return; }
    if (!kwhMes && !facturaDatos) { setMsg("⚠️ Cargá el consumo (kWh/mes) o una factura."); return; }
    setGenerandoTres(true); setMsg("");
    try {
      const id = await guardarProyecto(true);
      if (!id) { setMsg("⚠️ No se pudo guardar el proyecto antes de generar las opciones."); return; }
      const body = { form_inputs: construirInputs(), cliente: { nombre: nombreFinal(), cuit: cuit.trim() || "", razon_social: razon.trim() || "", localidad: localidad.trim() || "", provincia: provincia || "" }, cliente_id: clienteId, proyecto_id: id, tipo_cliente: "cf" };
      const r = await safeJson(await fetch("/api/proyecto-generar-opciones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
      if (!r.ok) { setMsg("⚠️ No se pudieron generar las 3 opciones: " + (r.error || "error")); return; }
      setOpcionesGeneradas({ opciones: r.opciones || [], recomendacion: r.recomendacion || null });
      // Persistir en el proyecto (para el comparativo + informe/presentación por opción vía ?opcion=).
      await fetch("/api/fv-proyectos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, opciones: r.opciones, recomendacion: r.recomendacion, estado: "cotizado" }) });
      const oks = (r.opciones || []).filter((o: any) => o.ok).length;
      const rec = r.recomendacion;
      setMsg(`✅ ${oks}/3 opciones generadas con su presupuesto.${rec ? ` Sugerida: ${rec.label} (repago ${rec.repago_anios} años).` : ""} Mirá el comparativo y las salidas por opción abajo.`);
      cargarLista();
    } catch (e: any) { setMsg("⚠️ " + e.message); }
    finally { setGenerandoTres(false); }
  }

  // 📄 Presupuesto AUTOMÁTICO: la BOM del dimensionado se valoriza con el cotizador (server-side) y se
  // crea el PREV real (numeración/token/CRM). NO manda mail (regla dura: solo botón explícito de envío).
  async function generarPresupuesto() {
    if (!resultado?.bom?.length) { setMsg("⚠️ Dimensioná primero — el presupuesto sale de la lista de componentes."); return; }
    setGenerandoPresup(true); setMsg("");
    try {
      const body = {
        bom: resultado.bom,
        sistema: resultado.sistema,
        proyecto_id: proyectoId,
        cliente_id: clienteId,
        tipo_cliente: "cf",
        cliente: { nombre: nombreFinal(), cuit: cuit.trim() || "", razon_social: razon.trim() || "", localidad: localidad.trim() || "", provincia: provincia || "" },
        form_inputs: construirInputs(), // para el re-run del motor con inversion_usd (repago/ahorro completos)
      };
      const r = await safeJson(await fetch("/api/proyecto-presupuesto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
      if (!r.ok) { setMsg("⚠️ No se pudo generar el presupuesto: " + (r.error || "error")); return; }
      setPresupNumero(r.numero); setPresupToken(r.public_token || null);
      if (r.meta) setResultado((prev) => (prev ? { ...prev, meta: r.meta } : prev));
      if (proyectoId) await fetch("/api/fv-proyectos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: proyectoId, presupuesto_numero: r.numero, estado: "cotizado", ...(r.meta ? { meta: r.meta } : {}) }) });
      const falt = Array.isArray(r.faltantes) && r.faltantes.length ? ` ⚠️ Ítems sin precio que quedaron afuera: ${r.faltantes.join(", ")}.` : "";
      setMsg(`✅ Presupuesto ${r.numero} generado (total ${r.totales?.total != null ? "USD " + Number(r.totales.total).toLocaleString("es-AR", { minimumFractionDigits: 2 }) : "—"}, markup ${r.markup_pct ?? "—"}%).${falt} Lo ves en Ventas → Presupuestos o con "Ver presupuesto".`);
      cargarLista();
    } catch (e: any) { setMsg("⚠️ " + e.message); }
    finally { setGenerandoPresup(false); }
  }

  if (vista === "params") return <ParamsFvClient onClose={() => setVista("form")} />;

  if (vista === "lista") {
    return (
      <div className="max-w-3xl mx-auto space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-febo-azul">📋 Proyectos fotovoltaicos guardados</h2>
          <button onClick={nuevo} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold">➕ Nuevo proyecto</button>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr><th className="text-left px-4 py-2">#</th><th className="text-left px-4 py-2">Cliente</th><th className="text-left px-4 py-2">Sistema</th><th className="text-left px-4 py-2">Estado</th><th className="text-left px-4 py-2">Actualizado</th><th></th></tr></thead>
            <tbody>
              {cargandoLista ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">Cargando…</td></tr>
              : lista.length === 0 ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">Sin proyectos todavía.</td></tr>
              : lista.map((p) => (
                <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2 font-semibold">{p.id}</td>
                  <td className="px-4 py-2">{p.cliente_razon_social || p.cliente_nombre || "—"}</td>
                  <td className="px-4 py-2 text-gray-500">{p.sistema?.kwp ? `${p.sistema.kwp} kWp` : "—"}</td>
                  <td className="px-4 py-2">
                    <span className={"text-[11px] rounded px-2 py-0.5 " + (p.estado === "cotizado" ? "bg-emerald-100 text-emerald-700" : p.estado === "dimensionado" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700")}>{p.estado}</span>
                    {p.presupuesto_numero && <span className="ml-1 text-[10px] font-semibold text-emerald-700">{p.presupuesto_numero}</span>}
                  </td>
                  <td className="px-4 py-2 text-gray-500">{new Date(p.updated_at).toLocaleDateString("es-AR")}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap"><button onClick={() => abrirProyecto(p.id)} className="text-febo-azul hover:underline text-sm mr-3">✏️ Editar</button><button onClick={() => borrarProyecto(p.id, p.cliente_razon_social || p.cliente_nombre || "")} className="text-red-400 hover:text-red-600 text-sm" title="Eliminar proyecto">🗑</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-febo-azul">☀️ {proyectoId ? `Proyecto FV #${proyectoId}` : "Nuevo proyecto fotovoltaico"}</h2>
        <div className="flex gap-2">
          {proyectoId && <button onClick={nuevo} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm">➕ Nuevo</button>}
          <button onClick={() => setVista("lista")} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm">📋 Proyectos guardados</button>
          <button onClick={() => setVista("params")} title="Parámetros de cálculo (matriz viva) — CÁLCULOS/Guille" className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm">⚙️ Parámetros</button>
        </div>
      </div>

      <div className={card}>
        <div className={cardTit}>Cliente</div>
        <div className="relative">
          <label className={lbl}>Buscar cliente en el CRM</label>
          <input value={busqCli} onChange={(e) => { setBusqCli(e.target.value); if (clienteId) setClienteId(null); }} onKeyDown={(e) => navKey(e, matchesCli, cliIdx, setCliIdx, elegirCliente)} className={inp} placeholder="Nombre / razón social / CUIT…" />
          {matchesCli.length > 0 && (
            <div className="absolute z-20 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-52 overflow-auto">
              {matchesCli.map((c, i) => <button key={c.id} onMouseEnter={() => setCliIdx(i)} onClick={() => elegirCliente(c)} className={"block w-full text-left px-3 py-2 text-sm " + (i === cliIdx ? "bg-febo-azul/10" : "hover:bg-gray-50")}>{c.razon_social || c.nombre}{c.cuit ? <span className="text-gray-400"> · {c.cuit}</span> : null}</button>)}
            </div>
          )}
          {clienteId && <div className="text-[11px] text-emerald-600 mt-0.5">✓ Cliente del CRM #{clienteId} vinculado</div>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Nombre / Razón social *</label><input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inp} placeholder="Nombre del cliente" /></div>
          <div><label className={lbl}>CUIT / CUIL</label>
            <div className="flex gap-1"><input value={cuit} onChange={(e) => setCuit(e.target.value)} className={inp + " flex-1"} placeholder="30-12345678-9" /><button onClick={buscarArca} className="px-3 rounded-lg bg-febo-azul text-white text-xs font-semibold" title="Buscar datos en ARCA">ARCA</button></div></div>
          <div className="col-span-2"><label className={lbl}>Empresa (opcional)</label><input value={razon} onChange={(e) => setRazon(e.target.value)} className={inp} placeholder="Razón social / empresa" /></div>
          {arcaMsg && <div className="col-span-2 text-[11px]" style={{ color: arcaMsg.startsWith("✓") ? "#059669" : "#e53935" }}>{arcaMsg}</div>}
        </div>
      </div>

      <div className={card}>
        <div className={cardTit}>Ubicación</div>
        <div className="relative">
          <label className={lbl}>Ciudad / localidad (buscá y elegí)</label>
          <input value={busqLoc} onChange={(e) => setBusqLoc(e.target.value)} onKeyDown={(e) => navKey(e, matchesLoc, locIdx, setLocIdx, elegirLoc)} className={inp} placeholder="🔍 Escribí la localidad…" autoComplete="off" />
          {matchesLoc.length > 0 && (
            <div className="absolute z-20 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-52 overflow-auto">
              {matchesLoc.map((l, i) => <button key={i} onMouseEnter={() => setLocIdx(i)} onClick={() => elegirLoc(l)} className={"block w-full text-left px-3 py-2 text-sm " + (i === locIdx ? "bg-febo-azul/10" : "hover:bg-gray-50")}>{l.nombre}<span className="text-gray-400"> · {l.prov}</span></button>)}
            </div>
          )}
        </div>
        {(localidad || provincia) && <div className="text-[12px] text-gray-600">📍 {[localidad, provincia].filter(Boolean).join(", ")}{lat != null && lng != null ? <span className="text-gray-400"> · {lat.toFixed(2)}, {lng.toFixed(2)}</span> : null}</div>}
      </div>

      {/* WIZARD doble modo — "¿Cómo querés calcularlo?" (mapeo criollo→técnico de CÁLCULOS) */}
      <div className={card}>
        <div className="flex items-center justify-between">
          <div className={cardTit}>¿Cómo querés calcularlo?</div>
          <div className="flex gap-1">
            <button onClick={() => setModoCalc("criollo")} className={"px-3 py-1.5 rounded-lg text-sm font-semibold border " + (modoCalc === "criollo" ? "bg-febo-azul text-white border-febo-azul" : "border-gray-300 text-gray-600")}>🗣️ Criollo</button>
            <button onClick={() => setModoCalc("tecnico")} className={"px-3 py-1.5 rounded-lg text-sm font-semibold border " + (modoCalc === "tecnico" ? "bg-febo-azul text-white border-febo-azul" : "border-gray-300 text-gray-600")}>🔧 Técnico</button>
          </div>
        </div>
        {modoCalc === "criollo" && (
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div><label className={lbl}>1 · ¿Dónde se usa la luz?</label>
              <select value={wiz.p1 || ""} onChange={(e) => setWiz({ ...wiz, p1: e.target.value })} className={inp}>
                <option value="">—</option><option value="casa">🏠 Casa (de día poco)</option><option value="campo">🌾 Campo / casa quinta (uso parejo)</option><option value="comercio">🏪 Comercio / oficina (abre de día)</option><option value="industria">🏭 Industria / consumo fuerte de día</option>
              </select>
              <div className="text-[10px] text-gray-500 mt-0.5">Los paneles generan de día. Si la luz se usa sobre todo de día, aprovechás casi todo lo que generan y el sistema te rinde más. Si se usa más de noche, el sistema se arma más chico para no regalar energía.</div></div>
            <div><label className={lbl}>2 · ¿Qué querés hacer con la red?</label>
              <select value={wiz.p2 || ""} onChange={(e) => setWiz({ ...wiz, p2: e.target.value })} className={inp}>
                <option value="">—</option><option value="bajar">💡 Bajar la factura, sin vueltas</option><option value="vender-futuro">🔄 Bajar y más adelante vender excedente</option><option value="permiso">📜 Ya tengo/hago el permiso de inyección</option><option value="respaldo">🔋 Que no se me corte nunca (respaldo)</option><option value="independizarme">🏝️ Independizarme / no llega la red</option>
              </select>
              <div className="text-[10px] text-gray-500 mt-0.5">¿Buscás pagar menos luz, tener luz cuando se corta, o directamente arreglarte solo sin la compañía? Cada camino lleva un equipo distinto.</div></div>
            {wiz.p2 === "respaldo" && (
              <div><label className={lbl}>3 · ¿Qué querés que siga andando y cuánto?</label>
                <select value={wiz.p3 || ""} onChange={(e) => setWiz({ ...wiz, p3: e.target.value })} className={inp}>
                  <option value="">—</option><option value="basico">Lo básico: heladera, luces, wifi</option><option value="basico-mas">Lo básico + algo más (elegís del editor)</option><option value="corte-largo">Que aguante un corte largo (2 días)</option>
                </select>
                <div className="text-[10px] text-gray-500 mt-0.5">Cuando se corta la luz, la batería no banca toda la casa: banca lo que elijas. Lo típico: heladera, luces y enchufes básicos. Cuanto más quieras que siga andando (y por más horas), más batería hace falta.</div></div>
            )}
            {wiz.p2 === "independizarme" && (
              <div><label className={lbl}>4 · ¿Cuántos días nublados aguanta?</label>
                <select value={wiz.p4 || ""} onChange={(e) => setWiz({ ...wiz, p4: e.target.value })} className={inp}>
                  <option value="">—</option><option value="normal">Uno-dos días está bien</option><option value="con-respaldo">Tengo grupo/red como respaldo</option><option value="brava">Zona brava, que aguante (3 días)</option>
                </select>
                <div className="text-[10px] text-gray-500 mt-0.5">Los días muy nublados los paneles generan poco y se vive de la batería. Acá se define cuántos días seguidos así aguanta el banco. Si tenés grupo electrógeno o llega la red, puede ser más chico (más barato).</div></div>
            )}
            <div><label className={lbl}>5 · ¿Cómo es el techo?</label>
              <select value={wiz.p5 || ""} onChange={(e) => setWiz({ ...wiz, p5: e.target.value })} className={inp}>
                <option value="">—</option><option value="chapa-inclinada">🏠 Chapa con pendiente</option><option value="chapa-plana">▬ Chapa casi plana (coplanar)</option><option value="losa">🧱 Losa / terraza plana</option><option value="teja">🟫 Tejas</option><option value="suelo">🌱 Va al piso / en el campo</option>
              </select>
              <div className="text-[10px] text-gray-500 mt-0.5">El tipo de techo define el soporte de los paneles y su inclinación. Un panel bien inclinado genera más; pegado a un techo plano genera un poco menos — lo tenemos en cuenta en el cálculo.</div></div>
            <div><label className={lbl}>6 · ¿Para dónde mira el techo?</label>
              <select value={wiz.p6 || ""} onChange={(e) => setWiz({ ...wiz, p6: e.target.value })} className={inp}>
                <option value="">—</option><option value="norte">🧭 Al norte (o más o menos)</option><option value="este">Al este (sol de mañana)</option><option value="oeste">Al oeste (sol de tarde)</option><option value="sur">Al sur</option><option value="ni-idea">Ni idea (verificar en visita)</option>
              </select>
              {wiz.p6 === "sur" && <div className="text-[11px] text-amber-700 mt-0.5">⚠️ Mirando al sur rinde ~40% menos — ¿seguro? Conviene suelo u otra agua del techo.</div>}
              {wiz.p6 === "ni-idea" && <div className="text-[10px] text-gray-400 mt-0.5">Se asume norte + nota "verificar en visita".</div>}
              <div className="text-[10px] text-gray-500 mt-0.5">En Argentina el sol pega desde el norte: un techo al norte es el ideal. Al este rinde más de mañana, al oeste más de tarde.</div></div>
            <div><label className={lbl}>7 · ¿La casa tiene jabalina (tierra)?</label>
              <select value={wiz.p7 || ""} onChange={(e) => setWiz({ ...wiz, p7: e.target.value })} className={inp}>
                <option value="">—</option><option value="si">Sí</option><option value="no">No / ni idea (se agrega jabalina)</option>
              </select>
              <div className="text-[10px] text-gray-500 mt-0.5">La jabalina descarga al piso cualquier falla eléctrica y protege a las personas y los equipos. Si no tenés o no sabés, la incluimos — es barata y va siempre.</div></div>
            <div><label className={lbl}>8 · ¿Metros del techo al tablero?</label>
              <select value={wiz.p8 || ""} onChange={(e) => setWiz({ ...wiz, p8: e.target.value })} className={inp}>
                <option value="">—</option><option value="cerca">Cerquita (~10 m)</option><option value="normal">Normal (~20 m)</option><option value="lejos">Lejos (~50 m)</option>
              </select>
              <div className="text-[10px] text-gray-500 mt-0.5">No hace falta exacto: cerquita, normal o lejos alcanza — el cable se cotiza por metro, así no pagás de más.</div></div>
            <div className="col-span-2 flex items-center gap-3">
              <button onClick={aplicarWizard} className="px-4 py-2 rounded-lg bg-febo-azul text-white text-sm font-semibold">Traducir a configuración técnica ↓</button>
              <div className="text-[11px] text-gray-500">El panel, inversor, protecciones y radiación salen solos (catálogo + Atlas). {wizAplicado ? "✔ Aplicado — revisá abajo." : ""}</div>
            </div>
          </div>
        )}
      </div>

      <div className={card}>
        <div className={cardTit}>Sistema</div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className={lbl}>Fase</label><select value={fase} onChange={(e) => setFase(e.target.value as any)} className={inp}><option value="mono">Monofásica</option><option value="tri">Trifásica</option></select></div>
          <div><label className={lbl}>Conexión</label><select value={conexion} onChange={(e) => setConexion(e.target.value as any)} className={inp}><option value="on-grid">On-grid</option><option value="off-grid">Off-grid</option><option value="hibrido">Híbrido</option></select></div>
          <div><label className={lbl}>Tipo de techo</label><select value={techo} onChange={(e) => setTecho(e.target.value as any)} className={inp}><option value="chapa">Chapa</option><option value="teja">Teja</option><option value="losa">Losa</option><option value="suelo">Suelo</option></select></div>
        </div>
        <div className="grid grid-cols-3 gap-3 border-t border-gray-100 pt-3">
          <div><label className={lbl}>Inyección a la red</label>
            <select value={inyeccion} onChange={(e) => setInyeccion(e.target.value as any)} className={inp}>
              <option value="cero">Cero (con limitador) — default</option>
              <option value="futuro">A futuro (100% + limitador)</option>
              <option value="con-inyeccion">Con inyección (100%, sin limitador)</option>
            </select>
            <div className="text-[10px] text-gray-400 mt-0.5">Determina el tamaño del sistema y si lleva limitador.</div></div>
          <div><label className={lbl}>Uso / fracción diurna</label>
            <select value={["0.5", "0.6", "0.75"].includes(fraccionDiurna) ? fraccionDiurna : (fraccionDiurna ? "custom" : "")} onChange={(e) => { const v = e.target.value; if (v === "custom") return; setFraccionDiurna(v); }} className={inp}>
              <option value="">Default (residencial 0.5)</option>
              <option value="0.5">Residencial — 0.5</option>
              <option value="0.6">Comercio — 0.6</option>
              <option value="0.75">Industria — 0.75</option>
              {fraccionDiurna && !["0.5", "0.6", "0.75"].includes(fraccionDiurna) ? <option value="custom">Otro: {fraccionDiurna}</option> : null}
            </select>
            <input value={fraccionDiurna} onChange={(e) => setFraccionDiurna(e.target.value)} type="number" min={0.2} max={1} step={0.05} className={inp + " mt-1"} placeholder="o tipeá un valor (0.2–1)" />
            <div className="text-[10px] text-gray-400 mt-0.5">¿Qué parte del consumo es de día? Gobierna el tamaño en inyección cero.</div></div>
          <div><label className={lbl}>Puesta a tierra del sitio</label>
            <label className="flex items-center gap-1.5 text-sm pt-2 cursor-pointer"><input type="checkbox" checked={sitioSinTierra} onChange={(e) => setSitioSinTierra(e.target.checked)} /> El sitio NO tiene tierra (agregar jabalina)</label></div>
          {conexion === "off-grid" && (
            <div><label className={lbl}>¿Para qué querés el off-grid?</label>
              <select value={intencionOG} onChange={(e) => { const v = e.target.value as any; setIntencionOG(v); if (v === "desconexion" && !cargasList) setCargasList(CANASTO_DEFAULT.map((c) => ({ ...c }))); }} className={inp}>
                <option value="backup">🔋 Backup (mantiene la red, cargas críticas)</option>
                <option value="desconexion">🔌 Desconectarme de la red (lista completa)</option>
              </select>
              <div className="text-[10px] text-gray-400 mt-0.5">Backup: ahorro = parte variable. Desconexión: ahorro = factura completa (si se da de baja el suministro).</div></div>
          )}
          {conexion === "off-grid" && (
            <div><label className={lbl}>Días de autonomía</label>
              <input type="number" min={1} max={5} value={offgridExtra?.autonomia_dias ?? 2} onChange={(e) => setOffgridExtra({ ...(offgridExtra || {}), autonomia_dias: Number(e.target.value) || 2 })} className={inp} />
              <div className="text-[10px] text-gray-400 mt-0.5">Días nublados seguidos que aguanta el banco (default 2; zona brava 3).</div></div>
          )}
          <div><label className={lbl}>Cable solar (metros)</label><input value={metrosCable} onChange={(e) => setMetrosCable(e.target.value)} type="number" className={inp} placeholder="default 20" /></div>
          <div><label className={lbl}>Cable de tierra (metros)</label><input value={metrosTierra} onChange={(e) => setMetrosTierra(e.target.value)} type="number" className={inp} placeholder="default 20" /></div>
          <div><label className={lbl}>Inclinación del plano (°)</label><input value={inclinacion} onChange={(e) => setInclinacion(e.target.value)} type="number" min={0} max={60} className={inp} placeholder="default: 30 inclinada / 10 coplanar" />
            <div className="text-[10px] text-gray-400 mt-0.5">Tilt real del array; vacío = default según estructura.</div></div>
          <div><label className={lbl}>Orientación / azimut (°)</label><input value={azimut} onChange={(e) => setAzimut(e.target.value)} type="number" min={-180} max={180} className={inp} placeholder="0 = norte" />
            <div className="text-[10px] text-gray-400 mt-0.5">Desvío del norte: + hacia el Este, − hacia el Oeste (ej. Bouvier 13°).</div></div>
        </div>
      </div>

      {/* Editor de cargas (off-grid / híbrido): canasto crítico ajustable o lista completa (desconexión) */}
      {(conexion === "off-grid" || conexion === "hibrido") && (
        <div className={card}>
          <div className="flex items-center justify-between">
            <div className={cardTit}>{conexion === "off-grid" && intencionOG === "desconexion" ? "🔌 Lista completa de equipos (desconexión)" : "🔋 Cargas de respaldo (canasto crítico)"}</div>
            {cargasList === null ? (
              <button onClick={() => setCargasList(CANASTO_DEFAULT.map((c) => ({ ...c })))} className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-semibold text-gray-600">✏️ Ajustar cargas</button>
            ) : (
              <button onClick={() => setCargasList(null)} className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs text-gray-500">↩ Volver al canasto default</button>
            )}
          </div>
          {cargasList === null ? (
            <div className="text-[11px] text-gray-500 mt-1">Se usa el canasto crítico default: {CANASTO_DEFAULT.map((c) => c.nombre.split(" ")[0]).join(", ")} (≈3,5 kWh/día · ~1.160 W). El respaldo cubre ESTAS cargas básicas, no toda la casa.</div>
          ) : (
            <div className="mt-2 space-y-1">
              <div className="grid grid-cols-[1fr_90px_90px_70px_30px] gap-2 text-[10px] uppercase text-gray-400 font-semibold"><div>Equipo</div><div>Potencia (W)</div><div>Horas/día</div><div>Cant.</div><div /></div>
              {cargasList.map((c, i) => (
                <div key={i} className="grid grid-cols-[1fr_90px_90px_70px_30px] gap-2">
                  <input value={c.nombre} onChange={(e) => setCargasList(cargasList.map((x, j) => j === i ? { ...x, nombre: e.target.value } : x))} className={inp} />
                  <input type="number" value={c.potencia_w} onChange={(e) => setCargasList(cargasList.map((x, j) => j === i ? { ...x, potencia_w: Number(e.target.value) } : x))} className={inp} />
                  <input type="number" step={0.5} value={c.horas_dia} onChange={(e) => setCargasList(cargasList.map((x, j) => j === i ? { ...x, horas_dia: Number(e.target.value) } : x))} className={inp} />
                  <input type="number" min={1} value={c.cantidad} onChange={(e) => setCargasList(cargasList.map((x, j) => j === i ? { ...x, cantidad: Number(e.target.value) } : x))} className={inp} />
                  <button onClick={() => setCargasList(cargasList.filter((_, j) => j !== i))} className="text-red-500 text-sm" title="Quitar">✕</button>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1">
                <button onClick={() => setCargasList([...cargasList, { nombre: "", potencia_w: 0, horas_dia: 1, cantidad: 1 }])} className="px-3 py-1 rounded-lg border border-gray-300 text-xs font-semibold text-gray-600">+ Agregar equipo</button>
                <div className="text-[11px] text-gray-500">Total: <b>{cargasList.reduce((s, c) => s + (c.potencia_w || 0) * (c.cantidad || 1), 0).toLocaleString("es-AR")} W</b> · <b>{(cargasList.reduce((s, c) => s + (c.potencia_w || 0) * (c.cantidad || 1) * (c.horas_dia || 0), 0) / 1000).toFixed(1)} kWh/día</b></div>
              </div>
              {conexion === "off-grid" && intencionOG === "desconexion" && <div className="text-[10px] text-gray-400">Desconexión: cargá TODO lo que funciona en la casa — el sistema se dimensiona a esta lista y el ahorro es la factura completa (si se da de baja el suministro).</div>}
            </div>
          )}
        </div>
      )}

      <div className={card}>
        <div className={cardTit}>Consumo / factura de luz</div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Consumo (kWh / mes)</label><input value={kwhMes} onChange={(e) => setKwhMes(e.target.value)} type="number" className={inp} placeholder="ej. 850" /></div>
          <div><label className={lbl}>Potencia contratada (kW)</label><input value={potencia} onChange={(e) => setPotencia(e.target.value)} type="number" className={inp} placeholder="opcional" /></div>
        </div>
        <div className="border-t border-gray-100 pt-3 space-y-2">
          <div className="text-[11px] text-gray-500">Cargá la factura y la leemos automáticamente (kWh, potencia, tarifa, distribuidora):</div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Subir factura (foto/PDF)</label><input type="file" accept="image/*,application/pdf" disabled={leyendo} onChange={(e) => { subirFactura(e.target.files?.[0]); e.currentTarget.value = ""; }} className="w-full text-xs" /></div>
            <div><label className={lbl}>…o pegar link (Dropbox / Drive)</label><div className="flex gap-1"><input value={facturaLink} onChange={(e) => setFacturaLink(e.target.value)} className={inp + " flex-1"} placeholder="https://…" /><button onClick={leerFacturaLink} disabled={leyendo || !facturaLink.trim()} className="px-3 rounded-lg bg-febo-azul text-white text-xs font-semibold disabled:opacity-40">Leer</button></div></div>
          </div>
          {facturaMsg && <div className="text-[11px] text-gray-600">{facturaMsg}</div>}
          {facturaRef && <div className="text-[11px] text-emerald-600">📎 Copia guardada: {facturaRef.nombre}</div>}
          {facturaDatos && facturaDatos.kwh_meses.length > 0 && (() => {
            const crudos = facturaDatos.meses_detalle && facturaDatos.meses_detalle.length ? facturaDatos.meses_detalle : facturaDatos.kwh_meses.map((k) => ({ mes: null, kwh: k }));
            // El gráfico muestra EXACTAMENTE los 12 meses cerrados del promedio (misma regla que el
            // motor: excluir el período en curso — la factura trae 13 barras y la última es parcial).
            const validos = crudos.filter((d: any) => Number(d.kwh) > 0);
            const det = (validos.length >= 2 ? validos.slice(0, -1) : validos).slice(-12);
            const max = Math.max(...det.map((d) => d.kwh), 1);
            const prom = promedio12(crudos); // últimos 12 meses CERRADOS (excluye el período en curso) = el promedio de la factura
            return (
              <div className="border-t border-gray-100 pt-2">
                <div className="text-[10px] uppercase text-gray-400 font-semibold mb-1">Consumo mensual histórico (de la factura) · promedio últimos 12 meses cerrados: {prom} kWh</div>
                <div className="flex items-end gap-1" style={{ height: 72 }}>
                  {det.map((d, i) => (
                    <div key={i} className="flex-1 h-full flex flex-col items-center justify-end" title={`${d.mes || "mes " + (i + 1)}: ${d.kwh} kWh`}>
                      <div className="text-[8px] text-gray-500 leading-none mb-0.5">{d.kwh}</div>
                      {/* h-full en el wrapper: sin altura definida, la barra con height % colapsaba a 0 (bug del gráfico vacío) */}
                      <div className="w-full rounded-t bg-amber-400" style={{ height: `${Math.max(4, (d.kwh / max) * 78)}%` }} />
                      <div className="text-[8px] text-gray-400 mt-0.5 truncate w-full text-center">{d.mes ? d.mes.slice(0, 5) : i + 1}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      <div className={card}>
        <div className={cardTit}>Fotos del sitio (opcional)</div>
        <input type="file" accept="image/*" multiple disabled={subiendoFotos} onChange={(e) => { subirFotos(e.target.files); e.currentTarget.value = ""; }} className="w-full text-xs" />
        {subiendoFotos && <div className="text-[11px] text-gray-500">⏳ Subiendo…</div>}
        {fotos.map((f, i) => <div key={i} className="text-[11px] text-emerald-600 flex items-center gap-1">✓ {f.nombre}<button onClick={() => setFotos((p) => p.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500">✕</button></div>)}
      </div>

      <div className={card}>
        <div className={cardTit}>Guardado</div>
        <div><label className={lbl}>Referencia = nombre de la carpeta (se autogenera al dimensionar; editable)</label>
          <input value={referencia} onChange={(e) => setReferencia(e.target.value)} className={inp} placeholder="Se completa al Dimensionar (ej. BOUVIER EDGARDO — 3,48 kWp 6×580 + 3kW on-grid — Las Carabelas)" />
          <div className="text-[10px] text-gray-400 mt-0.5">La carpeta destino será <b>PROYECTOS FV\{referencia.trim() || `${(nombre.trim() || busqCli.trim() || "cliente")} - ${proyectoId ? "PROY-" + proyectoId : "PROY-…"}`}</b>. Editá la referencia para que coincida con una carpeta ya existente y se guarda ahí. El archivo lo baja el sync automático.</div></div>
      </div>

      {comparacion && (
        <div className="bg-white rounded-xl border-2 border-febo-azul p-4 space-y-3">
          <div className="text-xs uppercase font-bold text-febo-azul tracking-wide">⚡ Comparación de las 3 opciones — mismo consumo (factura real)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead><tr className="text-[10px] uppercase text-gray-400 text-left">
                <th className="py-1 pr-2">Opción</th><th className="py-1 pr-2">Potencia</th><th className="py-1 pr-2">Generación</th><th className="py-1 pr-2">Cobertura</th><th className="py-1 pr-2">Inversión</th><th className="py-1 pr-2">Ahorro/mes</th><th className="py-1 pr-2">Repago</th><th className="py-1">Autonomía</th>
              </tr></thead>
              <tbody>
                {comparacion.opciones.map((o: any) => {
                  const esRec = comparacion.recomendacion?.tipo === o.tipo;
                  if (!o.ok) return <tr key={o.tipo} className="border-t border-gray-100 text-gray-400"><td className="py-1.5 pr-2">{o.label}</td><td colSpan={7} className="py-1.5 text-[11px]">⚠️ {o.error}</td></tr>;
                  return (
                    <tr key={o.tipo} className={"border-t border-gray-100 " + (esRec ? "bg-emerald-50 font-semibold" : "")}>
                      <td className="py-1.5 pr-2">{esRec ? "⭐ " : ""}{o.label}</td>
                      <td className="py-1.5 pr-2">{o.sistema?.kwp} kWp ({o.sistema?.n_paneles} pan.)</td>
                      <td className="py-1.5 pr-2">{o.sistema?.generacion_anual_kwh?.toLocaleString("es-AR")} kWh/año</td>
                      <td className="py-1.5 pr-2">{Math.round((o.sistema?.cobertura || 0) * 100)}%</td>
                      <td className="py-1.5 pr-2">{o.inversion_usd != null ? "USD " + Number(o.inversion_usd).toLocaleString("es-AR", { maximumFractionDigits: 0 }) : "—"}</td>
                      <td className="py-1.5 pr-2">{o.ahorro_mensual_ars != null ? "$ " + Number(o.ahorro_mensual_ars).toLocaleString("es-AR") : "—"}</td>
                      <td className="py-1.5 pr-2">{o.repago_anios != null ? o.repago_anios + " años" : "—"}</td>
                      <td className="py-1.5">{o.autonomia?.horas != null ? `${o.autonomia.horas} h (${o.autonomia.dias} d)` : o.autonomia?.dias != null ? `${o.autonomia.dias} días` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {comparacion.recomendacion && (
            <div className="text-[12px] bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2"><b>Sugerencia:</b> {comparacion.recomendacion.motivo}</div>
          )}
          {comparacion.opciones.some((o: any) => o.ok && o.faltantes?.length) && (
            <div className="text-[11px] text-amber-700">⚠️ Ítems sin precio en catálogo: {Array.from(new Set(comparacion.opciones.flatMap((o: any) => o.faltantes || []))).join(", ")} — cargarles costo para que la inversión sea completa.</div>
          )}
          <div className="text-[11px] text-gray-500">Para avanzar con una opción: elegila en «Conexión», tocá ⚡ Dimensionar y generá su presupuesto (cada opción tiene su PREV propio).</div>
        </div>
      )}

      {opcionesGeneradas && (
        <div className="bg-white rounded-xl border-2 border-emerald-700 p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs uppercase font-bold text-emerald-700 tracking-wide">🎁 3 opciones generadas — con presupuesto, informe y presentación por opción</div>
            {proyectoId && <a href={`/comparativo-fv/${proyectoId}`} target="_blank" rel="noreferrer" className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-semibold">📊 Ver comparativo (para el cliente)</a>}
          </div>
          {opcionesGeneradas.recomendacion && (
            <div className="text-[12px] bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2"><b>⭐ Sugerida:</b> {opcionesGeneradas.recomendacion.motivo}</div>
          )}
          <div className="grid gap-2">
            {opcionesGeneradas.opciones.map((o: any) => {
              const esRec = opcionesGeneradas.recomendacion?.modo === o.modo;
              if (!o.ok) return <div key={o.modo} className="border border-gray-100 rounded-lg px-3 py-2 text-[12px] text-gray-400">{o.label}: ⚠️ {o.error}</div>;
              return (
                <div key={o.modo} className={"rounded-lg border px-3 py-2 " + (esRec ? "border-emerald-400 bg-emerald-50/50" : "border-gray-200")}>
                  <div className="flex items-center justify-between flex-wrap gap-x-4 gap-y-1">
                    <div className="text-[13px] font-semibold text-febo-azul">{esRec ? "⭐ " : ""}{o.label}</div>
                    <div className="text-[12px] text-gray-600">{o.sistema?.kwp} kWp · {o.inversion_usd != null ? "US$ " + Number(o.inversion_usd).toLocaleString("es-AR", { maximumFractionDigits: 0 }) : "—"} · repago {o.repago_anios != null ? o.repago_anios + " años" : "—"}</div>
                    <div className="flex gap-1.5 text-[12px]">
                      {o.public_token && <a href={`https://fv.febecos.com/ver-presupuesto?token=${o.public_token}`} target="_blank" rel="noreferrer" className="px-2 py-1 rounded border border-emerald-600 text-emerald-700 font-semibold">👁 {o.presupuesto_numero || "PREV"}</a>}
                      {proyectoId && <a href={`/informe-fv/${proyectoId}?opcion=${o.modo}`} target="_blank" rel="noreferrer" className="px-2 py-1 rounded border border-febo-azul text-febo-azul font-semibold">📋 Informe</a>}
                      {proyectoId && <a href={`/api/presentacion-fv-html/${proyectoId}?opcion=${o.modo}`} target="_blank" rel="noreferrer" className="px-2 py-1 rounded border border-amber-500 text-amber-600 font-semibold">🎨 Presentación</a>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {opcionesGeneradas.opciones.some((o: any) => o.ok && o.faltantes?.length) && (
            <div className="text-[11px] text-amber-700">⚠️ Ítems sin precio: {Array.from(new Set(opcionesGeneradas.opciones.flatMap((o: any) => o.faltantes || []))).join(", ")}.</div>
          )}
        </div>
      )}

      {resultado && (
        <div className="bg-white rounded-xl border-2 border-emerald-300 p-4 space-y-3">
          <div className="text-xs uppercase font-bold text-emerald-700 tracking-wide">Dimensionado — {resultado.sistema?.tipo} {resultado.sistema?.fase === "tri" ? "trifásico" : "monofásico"}</div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div><div className="text-[10px] uppercase text-gray-400">Potencia</div><div className="font-bold text-febo-azul">{resultado.sistema?.kwp} kWp</div></div>
            <div><div className="text-[10px] uppercase text-gray-400">Paneles</div><div className="font-semibold">{resultado.sistema?.n_paneles} × {resultado.sistema?.panel_codigo}</div></div>
            <div><div className="text-[10px] uppercase text-gray-400">Inversor</div><div className="font-semibold">{resultado.sistema?.inversor_codigo} ({resultado.sistema?.inversor_kw} kW)</div></div>
            <div><div className="text-[10px] uppercase text-gray-400">Generación anual</div><div className="font-semibold">{resultado.sistema?.generacion_anual_kwh?.toLocaleString("es-AR")} kWh</div></div>
            <div><div className="text-[10px] uppercase text-gray-400">Cobertura</div><div className="font-semibold">{Math.round((resultado.sistema?.cobertura || 0) * 100)}%</div></div>
            {resultado.sistema?.banco_kwh ? <div><div className="text-[10px] uppercase text-gray-400">Banco</div><div className="font-semibold">{resultado.sistema.banco_kwh} kWh</div></div> : null}
            <div><div className="text-[10px] uppercase text-gray-400">Inversor validado</div><div className="font-semibold">{resultado.meta?.validacion_inversor?.ok ? "✔ Sí" : "⚠️ revisar"}</div></div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-gray-400 font-semibold mb-1">Lista de componentes (BOM) — {resultado.bom.length} ítems (sin precio; el cotizador los valoriza)</div>
            <div className="max-h-52 overflow-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
              {resultado.bom.map((b, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-[12px]">
                  <span className="text-gray-500 w-8 shrink-0">×{b.cantidad}</span>
                  <span className="flex-1 text-gray-700">{b.descripcion_corta || b.descripcion || <span className="text-gray-400">—</span>}</span>
                  <span className="font-mono text-[10px] text-gray-400 shrink-0">{b.codigo}{b.origen === "manual" ? <span className="ml-1 text-amber-600">manual</span> : null}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button onClick={generarPresupuesto} disabled={generandoPresup} title="Valoriza esta lista con el cotizador (precios/markup reales) y crea el presupuesto PREV. No manda mail." className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50">{generandoPresup ? "Generando…" : "📄 Generar presupuesto"}</button>
            {presupNumero && presupToken && <a href={`https://fv.febecos.com/ver-presupuesto?token=${presupToken}`} target="_blank" rel="noreferrer" className="px-4 py-2 rounded-lg border border-emerald-600 text-emerald-700 text-sm font-semibold">👁 Ver {presupNumero}</a>}
            {proyectoId && <a href={`/informe-fv/${proyectoId}`} target="_blank" rel="noreferrer" title="Propuesta de Cálculos: informe técnico con consumo vs generación mensual, validación del inversor y componentes. Imprimir/Guardar PDF en la carpeta del proyecto." className="px-4 py-2 rounded-lg border border-febo-azul text-febo-azul text-sm font-semibold">📋 Informe técnico</a>}
            {proyectoId && <a href={`/api/presentacion-fv-html/${proyectoId}`} target="_blank" rel="noreferrer" title="Presentación comercial para el cliente (PLANTILLA OFICIAL poblada con los datos del proyecto): propuesta agrupada SIN precios unitarios, solo el total. Imprimir/Guardar PDF." className="px-4 py-2 rounded-lg border border-amber-500 text-amber-600 text-sm font-semibold">🎨 Presentación</a>}
            <span className="text-[11px] text-gray-500">El presupuesto usa los precios/markup del cotizador. El informe técnico y la presentación vienen después.</span>
          </div>
        </div>
      )}
      {msg && <div className="text-sm px-4 py-2 rounded-lg bg-gray-50 border border-gray-200">{msg}</div>}
      <div className="flex items-center justify-end gap-2">
        <button onClick={guardar} disabled={guardando || dimensionando} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50">{guardando ? "Guardando…" : (proyectoId ? "Actualizar proyecto" : "Guardar proyecto")}</button>
        <button onClick={dimensionar} disabled={dimensionando || guardando || comparando} title="Guarda el proyecto y dimensiona el sistema con el motor de cálculo: potencia, paneles, inversor validado y lista de componentes." className="px-4 py-2 rounded-lg bg-febo-azul text-white text-sm font-semibold disabled:opacity-50">{dimensionando ? "Dimensionando…" : "⚡ Dimensionar"}</button>
        <button onClick={compararOpciones} disabled={comparando || dimensionando || guardando || generandoTres} title="Corre el motor 3 veces con la misma factura (on-grid / off-grid / híbrido), valoriza cada opción y sugiere la de menor repago. No crea presupuestos." className="px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-semibold disabled:opacity-50">{comparando ? "Comparando…" : "⚡ Calcular las 3 opciones"}</button>
        <button onClick={generarTresOpciones} disabled={generandoTres || comparando || dimensionando || guardando} title="Genera las 3 opciones COMPLETAS: presupuesto (PREV) + informe técnico + presentación por cada modo, y un comparativo imprimible para el cliente. Guarda todo en el proyecto." className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50">{generandoTres ? "Generando las 3…" : "🎁 Generar las 3 opciones"}</button>
      </div>
    </div>
  );
}
