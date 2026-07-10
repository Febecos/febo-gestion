"use client";
import { useState, useEffect, useRef } from "react";
import ParamsFvClient from "./ParamsFvClient";

// Formulario de proyecto FV self-service (backlog #3). Paso 1: el vendedor carga los datos del
// proyecto (cliente, ubicación, sistema, consumo/factura, fotos) → se guarda en fv_proyectos y queda
// en un LISTADO reabrible/editable. El dimensionado (motor CÁLCULOS FV) + el enganche al cotizador se
// agregan cuando el motor esté. Look&feel febo-gestion (Tailwind), form seccionado en cards.

type FacturaDatos = { distribuidora: string | null; titular: string | null; kwh_mes: number | null; kwh_meses: number[]; meses_detalle?: { mes: string | null; kwh: number }[]; potencia_contratada_kw: number | null; tarifa: string | null; periodo: string | null; importe: number | null };
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

  function aplicarFactura(d: FacturaDatos) {
    setFacturaDatos(d);
    if (d.kwh_mes != null) setKwhMes(String(d.kwh_mes));
    if (d.potencia_contratada_kw != null) setPotencia(String(d.potencia_contratada_kw));
    const partes = [d.distribuidora && `Distribuidora: ${d.distribuidora}`, d.tarifa && `Tarifa: ${d.tarifa}`, d.periodo && `Período: ${d.periodo}`].filter(Boolean);
    setFacturaMsg("✓ Factura leída. " + (partes.join(" · ") || "Datos cargados."));
  }

  async function subirFactura(f?: File) {
    if (!f) return;
    setLeyendo(true); setFacturaMsg("⏳ Leyendo la factura…");
    try {
      const { b64, tipo } = await prepararArchivo(f);
      const up = await safeJson(await fetch("/api/adjunto-upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: f.name, content_type: tipo, data_b64: b64 }) }));
      if (up.ok && up.url) setFacturaRef({ url: up.url, nombre: f.name });
      const r = await safeJson(await fetch("/api/leer-factura-luz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ b64, tipo }) }));
      if (r.ok && r.data) aplicarFactura(r.data);
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
        if (r.archivo?.b64) {
          const up = await safeJson(await fetch("/api/adjunto-upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: "factura-luz", content_type: r.archivo.tipo, data_b64: r.archivo.b64 }) }));
          if (up.ok && up.url) setFacturaRef({ url: up.url, nombre: "factura-luz (del link)" });
        }
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
    setFase("mono"); setConexion("on-grid"); setTecho("chapa");
    setKwhMes(""); setPotencia(""); setFacturaLink(""); setFacturaDatos(null); setFacturaRef(null); setFacturaMsg("");
    setFotos([]); setReferencia(""); setMsg(""); setArcaMsg(""); setVista("form");
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
    setNombre(i.cliente?.nombre || ""); setCuit(i.cliente?.cuit || ""); setRazon(i.cliente?.razon_social || "");
    setProvincia(i.ubicacion?.provincia || ""); setLocalidad(i.ubicacion?.localidad || ""); setLat(i.ubicacion?.lat ?? null); setLng(i.ubicacion?.lng ?? null);
    setFase(i.fase || "mono"); setConexion(i.tipo_conexion || "on-grid"); setTecho(i.tipo_techo || "chapa");
    setKwhMes(i.consumo?.kwh_mes != null ? String(i.consumo.kwh_mes) : ""); setPotencia(i.potencia_contratada_kw != null ? String(i.potencia_contratada_kw) : "");
    setFacturaDatos(p.factura_ref?.datos || null); setFacturaRef(p.factura_ref?.archivo || null); setFacturaLink(p.factura_ref?.link || "");
    setFotos(Array.isArray(i.fotos) ? i.fotos : []);
    setReferencia(p.referencia || "");
    setFacturaMsg(""); setArcaMsg(""); setMsg(""); setVista("form");
  }

  async function guardar() {
    // "Guardar SIEMPRE persiste" (Guille): no bloqueamos por campos faltantes. Si el vendedor tipeó el
    // cliente en el buscador y no lo eligió del dropdown, igual usamos ese texto como nombre.
    const nombreFinal = nombre.trim() || busqCli.trim() || razon.trim() || "Proyecto sin nombre";
    setGuardando(true); setMsg("");
    try {
      const inputs = {
        cliente: { nombre: nombreFinal, cuit: cuit.trim() || null, razon_social: razon.trim() || null },
        ubicacion: { provincia: provincia || null, localidad: localidad.trim() || null, lat, lng },
        fase, tipo_conexion: conexion, tipo_techo: techo,
        consumo: { kwh_mes: kwhMes ? Number(kwhMes) : (facturaDatos?.kwh_mes ?? null), kwh_meses: facturaDatos?.kwh_meses || [], meses_detalle: facturaDatos?.meses_detalle || [] },
        potencia_contratada_kw: potencia ? Number(potencia) : (facturaDatos?.potencia_contratada_kw ?? null),
        fotos,
      };
      const factura_ref = { archivo: facturaRef, datos: facturaDatos, link: facturaLink.trim() || null };
      const body: any = { cliente_id: clienteId, inputs, factura_ref, referencia: referencia.trim() || null, estado: "borrador" };
      if (proyectoId) body.id = proyectoId;
      const r = await safeJson(await fetch("/api/fv-proyectos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
      if (r.ok) {
        setProyectoId(r.id);
        if (!nombre.trim()) setNombre(nombreFinal);
        const ref = referencia.trim() || `PROY-${r.id}`;
        setMsg(`✅ Proyecto guardado (#${r.id}) como "${nombreFinal}". Lo encontrás en "📋 Proyectos guardados" para reabrir y editar. 📁 Carpeta destino: PROYECTOS FV\\${nombreFinal} - ${ref}. El dimensionado automático se habilita cuando esté el motor de cálculo.`);
        cargarLista(); // refrescar la lista para que aparezca ya
      } else setMsg("⚠️ No se pudo guardar: " + (r.error || "error desconocido"));
    } catch (e: any) { setMsg("⚠️ " + e.message); }
    finally { setGuardando(false); }
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
                  <td className="px-4 py-2"><span className="text-[11px] rounded px-2 py-0.5 bg-amber-100 text-amber-700">{p.estado}</span></td>
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

      <div className={card}>
        <div className={cardTit}>Sistema</div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className={lbl}>Fase</label><select value={fase} onChange={(e) => setFase(e.target.value as any)} className={inp}><option value="mono">Monofásica</option><option value="tri">Trifásica</option></select></div>
          <div><label className={lbl}>Conexión</label><select value={conexion} onChange={(e) => setConexion(e.target.value as any)} className={inp}><option value="on-grid">On-grid</option><option value="off-grid">Off-grid</option><option value="hibrido">Híbrido</option></select></div>
          <div><label className={lbl}>Tipo de techo</label><select value={techo} onChange={(e) => setTecho(e.target.value as any)} className={inp}><option value="chapa">Chapa</option><option value="teja">Teja</option><option value="losa">Losa</option><option value="suelo">Suelo</option></select></div>
        </div>
      </div>

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
            const det = facturaDatos.meses_detalle && facturaDatos.meses_detalle.length ? facturaDatos.meses_detalle : facturaDatos.kwh_meses.map((k) => ({ mes: null, kwh: k }));
            const max = Math.max(...det.map((d) => d.kwh), 1);
            const prom = Math.round(det.reduce((a, d) => a + d.kwh, 0) / det.length);
            return (
              <div className="border-t border-gray-100 pt-2">
                <div className="text-[10px] uppercase text-gray-400 font-semibold mb-1">Consumo mensual histórico (de la factura) · promedio {prom} kWh</div>
                <div className="flex items-end gap-1 h-16">
                  {det.map((d, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end" title={`${d.mes || "mes " + (i + 1)}: ${d.kwh} kWh`}>
                      <div className="w-full rounded-t bg-amber-400" style={{ height: `${Math.max(6, (d.kwh / max) * 100)}%` }} />
                      <div className="text-[8px] text-gray-400 mt-0.5 truncate w-full text-center">{d.mes ? d.mes.slice(0, 5) : d.kwh}</div>
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
        <div><label className={lbl}>Referencia (nombre de la carpeta en COTIZADOS)</label>
          <input value={referencia} onChange={(e) => setReferencia(e.target.value)} className={inp} placeholder={`Ej. "FV Escuela" — default PROY-${proyectoId || "…"}`} />
          <div className="text-[10px] text-gray-400 mt-0.5">La carpeta destino será <b>PROYECTOS FV\{(nombre.trim() || busqCli.trim() || "cliente")} - {referencia.trim() || (proyectoId ? "PROY-" + proyectoId : "PROY-…")}</b>. El archivo lo baja el sync automático.</div></div>
      </div>

      {msg && <div className="text-sm px-4 py-2 rounded-lg bg-gray-50 border border-gray-200">{msg}</div>}
      <div className="flex items-center justify-end gap-2">
        <button onClick={guardar} disabled={guardando} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50">{guardando ? "Guardando…" : (proyectoId ? "Actualizar proyecto" : "Guardar proyecto")}</button>
        <button disabled title="Se habilita cuando esté el motor de cálculo (CÁLCULOS FV): dimensiona el sistema, arma la lista de componentes y precarga el cotizador." className="px-4 py-2 rounded-lg bg-febo-azul text-white text-sm font-semibold opacity-40 cursor-not-allowed">⚡ Dimensionar y cotizar (próximamente)</button>
      </div>
    </div>
  );
}
