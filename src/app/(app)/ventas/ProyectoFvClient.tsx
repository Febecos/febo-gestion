"use client";
import { useState } from "react";

// Formulario de proyecto FV self-service (backlog #3). Paso 1: el vendedor carga los datos del
// proyecto (cliente, ubicación, sistema, consumo/factura, fotos) → se guarda en fv_proyectos.
// El dimensionado (motor CÁLCULOS FV) + el enganche al cotizador se agregan cuando el motor esté.
// Look&feel: febo-gestion (Tailwind), patrón form seccionado en cards (molde perfil revendedores).

const PROVINCIAS = ["Buenos Aires", "CABA", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes", "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza", "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis", "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán"];

type FacturaDatos = { distribuidora: string | null; titular: string | null; kwh_mes: number | null; kwh_meses: number[]; potencia_contratada_kw: number | null; tarifa: string | null; periodo: string | null; importe: number | null };

async function safeJson(r: Response) { try { return await r.json(); } catch { return { ok: false, error: "respuesta inválida" }; } }
const lbl = "block text-[10px] uppercase text-gray-400 font-semibold mb-0.5";
const inp = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm";
const card = "bg-white rounded-xl border border-gray-200 p-4 space-y-3";
const cardTit = "text-xs uppercase font-bold text-febo-azul tracking-wide";

export default function ProyectoFvClient() {
  // Cliente
  const [nombre, setNombre] = useState("");
  const [cuit, setCuit] = useState("");
  const [razon, setRazon] = useState("");
  // Ubicación
  const [provincia, setProvincia] = useState("");
  const [localidad, setLocalidad] = useState("");
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
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");
  const [proyectoId, setProyectoId] = useState<number | null>(null);

  const fileToB64 = (f: File): Promise<string> => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });

  // Prepara el archivo para mandar al server. Las IMÁGENES se redimensionan/comprimen con canvas para
  // no exceder el límite de body de Vercel (~4,5MB) — una foto de celular cruda (varios MB) daba 413 y
  // el form "no tomaba" la factura. Los PDF u otros van tal cual (Gemini los lee nativo y suelen ser chicos).
  async function prepararArchivo(f: File): Promise<{ b64: string; tipo: string }> {
    if (!/^image\//.test(f.type)) {
      const durl = await fileToB64(f);
      return { b64: durl.split(",")[1], tipo: f.type || "application/pdf" };
    }
    const durl = await fileToB64(f);
    const img = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = durl; });
    const MAX = 1600;
    let w = img.width, h = img.height;
    if (w > MAX || h > MAX) { const k = MAX / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d"); if (ctx) ctx.drawImage(img, 0, 0, w, h);
    const out = c.toDataURL("image/jpeg", 0.8);
    return { b64: out.split(",")[1], tipo: "image/jpeg" };
  }

  // Aplica los datos leídos de la factura a los campos del formulario.
  function aplicarFactura(d: FacturaDatos) {
    setFacturaDatos(d);
    if (d.kwh_mes != null) setKwhMes(String(d.kwh_mes));
    if (d.potencia_contratada_kw != null) setPotencia(String(d.potencia_contratada_kw));
    const partes = [d.distribuidora && `Distribuidora: ${d.distribuidora}`, d.tarifa && `Tarifa: ${d.tarifa}`, d.periodo && `Período: ${d.periodo}`].filter(Boolean);
    setFacturaMsg("✓ Factura leída. " + (partes.join(" · ") || "Datos cargados."));
  }

  // Factura por UPLOAD: sube (adjunto-upload) para guardar copia + lee con visión.
  async function subirFactura(f?: File) {
    if (!f) return;
    setLeyendo(true); setFacturaMsg("⏳ Leyendo la factura…");
    try {
      const { b64, tipo } = await prepararArchivo(f);
      // Guardar copia propia (por si el vendedor la borra) — mismo /api/adjunto-upload del mail.
      const up = await safeJson(await fetch("/api/adjunto-upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: f.name, content_type: tipo, data_b64: b64 }) }));
      if (up.ok && up.url) setFacturaRef({ url: up.url, nombre: f.name });
      const r = await safeJson(await fetch("/api/leer-factura-luz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ b64, tipo }) }));
      if (r.ok && r.data) aplicarFactura(r.data);
      else if (r.sin_key) setFacturaMsg("⚠️ Lectura automática no disponible (falta GEMINI_API_KEY). Cargá el consumo a mano.");
      else setFacturaMsg("⚠️ No se pudo leer la factura: " + (r.error || "error") + ". Cargá el consumo a mano.");
    } catch (e: any) { setFacturaMsg("⚠️ " + e.message); }
    finally { setLeyendo(false); }
  }

  // Factura por LINK (Dropbox/Drive): el server baja la copia + la lee; devuelve archivo para guardar.
  async function leerFacturaLink() {
    if (!facturaLink.trim()) return;
    setLeyendo(true); setFacturaMsg("⏳ Bajando y leyendo la factura del link…");
    try {
      const r = await safeJson(await fetch("/api/leer-factura-luz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ link: facturaLink.trim() }) }));
      if (r.ok && r.data) {
        aplicarFactura(r.data);
        // Guardar la copia que bajó el server (el link es solo el medio, no el storage).
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

  async function guardar() {
    if (!nombre.trim()) { setMsg("⚠️ Ingresá el nombre del cliente."); return; }
    if (!kwhMes && !facturaDatos) { setMsg("⚠️ Cargá el consumo (kWh/mes) o una factura."); return; }
    setGuardando(true); setMsg("");
    try {
      const inputs = {
        cliente: { nombre: nombre.trim(), cuit: cuit.trim() || null, razon_social: razon.trim() || null },
        ubicacion: { provincia: provincia || null, localidad: localidad.trim() || null },
        fase, tipo_conexion: conexion, tipo_techo: techo,
        consumo: { kwh_mes: kwhMes ? Number(kwhMes) : (facturaDatos?.kwh_mes ?? null), kwh_meses: facturaDatos?.kwh_meses || [] },
        potencia_contratada_kw: potencia ? Number(potencia) : (facturaDatos?.potencia_contratada_kw ?? null),
        fotos,
      };
      const factura_ref = { archivo: facturaRef, datos: facturaDatos, link: facturaLink.trim() || null };
      const body: any = { inputs, factura_ref, estado: "borrador" };
      if (proyectoId) body.id = proyectoId;
      const r = await safeJson(await fetch("/api/fv-proyectos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
      if (r.ok) { setProyectoId(r.id); setMsg(`✅ Proyecto guardado (#${r.id}). El dimensionado automático se habilita cuando esté el motor de cálculo.`); }
      else setMsg("⚠️ " + (r.error || "no se pudo guardar"));
    } catch (e: any) { setMsg("⚠️ " + e.message); }
    finally { setGuardando(false); }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-febo-azul">☀️ Nuevo proyecto fotovoltaico</h2>
        {proyectoId && <span className="text-xs text-gray-400">Proyecto #{proyectoId}</span>}
      </div>

      <div className={card}>
        <div className={cardTit}>Cliente</div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Nombre / Razón social *</label><input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inp} placeholder="Nombre del cliente" /></div>
          <div><label className={lbl}>CUIT / CUIL</label><input value={cuit} onChange={(e) => setCuit(e.target.value)} className={inp} placeholder="30-12345678-9" /></div>
          <div className="col-span-2"><label className={lbl}>Empresa (opcional)</label><input value={razon} onChange={(e) => setRazon(e.target.value)} className={inp} placeholder="Razón social / empresa" /></div>
        </div>
      </div>

      <div className={card}>
        <div className={cardTit}>Ubicación</div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Provincia</label>
            <select value={provincia} onChange={(e) => setProvincia(e.target.value)} className={inp}>
              <option value="">Seleccionar…</option>
              {PROVINCIAS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select></div>
          <div><label className={lbl}>Localidad</label><input value={localidad} onChange={(e) => setLocalidad(e.target.value)} className={inp} placeholder="Localidad" /></div>
        </div>
      </div>

      <div className={card}>
        <div className={cardTit}>Sistema</div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className={lbl}>Fase</label>
            <select value={fase} onChange={(e) => setFase(e.target.value as any)} className={inp}><option value="mono">Monofásica</option><option value="tri">Trifásica</option></select></div>
          <div><label className={lbl}>Conexión</label>
            <select value={conexion} onChange={(e) => setConexion(e.target.value as any)} className={inp}><option value="on-grid">On-grid</option><option value="off-grid">Off-grid</option><option value="hibrido">Híbrido</option></select></div>
          <div><label className={lbl}>Tipo de techo</label>
            <select value={techo} onChange={(e) => setTecho(e.target.value as any)} className={inp}><option value="chapa">Chapa</option><option value="teja">Teja</option><option value="losa">Losa</option><option value="suelo">Suelo</option></select></div>
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
            <div><label className={lbl}>Subir factura (foto/PDF)</label>
              <input type="file" accept="image/*,application/pdf" disabled={leyendo} onChange={(e) => { subirFactura(e.target.files?.[0]); e.currentTarget.value = ""; }} className="w-full text-xs" /></div>
            <div><label className={lbl}>…o pegar link (Dropbox / Drive)</label>
              <div className="flex gap-1">
                <input value={facturaLink} onChange={(e) => setFacturaLink(e.target.value)} className={inp + " flex-1"} placeholder="https://…" />
                <button onClick={leerFacturaLink} disabled={leyendo || !facturaLink.trim()} className="px-3 rounded-lg bg-febo-azul text-white text-xs font-semibold disabled:opacity-40">Leer</button>
              </div></div>
          </div>
          {facturaMsg && <div className="text-[11px] text-gray-600">{facturaMsg}</div>}
          {facturaRef && <div className="text-[11px] text-emerald-600">📎 Copia guardada: {facturaRef.nombre}</div>}
        </div>
      </div>

      <div className={card}>
        <div className={cardTit}>Fotos del sitio (opcional)</div>
        <input type="file" accept="image/*" multiple disabled={subiendoFotos} onChange={(e) => { subirFotos(e.target.files); e.currentTarget.value = ""; }} className="w-full text-xs" />
        {subiendoFotos && <div className="text-[11px] text-gray-500">⏳ Subiendo…</div>}
        {fotos.map((f, i) => <div key={i} className="text-[11px] text-emerald-600 flex items-center gap-1">✓ {f.nombre}<button onClick={() => setFotos((p) => p.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500">✕</button></div>)}
      </div>

      {msg && <div className="text-sm px-4 py-2 rounded-lg bg-gray-50 border border-gray-200">{msg}</div>}
      <div className="flex items-center justify-end gap-2">
        <button onClick={guardar} disabled={guardando} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50">{guardando ? "Guardando…" : (proyectoId ? "Actualizar proyecto" : "Guardar proyecto")}</button>
        <button disabled title="Se habilita cuando esté el motor de cálculo (CÁLCULOS FV): dimensiona el sistema, arma la lista de componentes y precarga el cotizador." className="px-4 py-2 rounded-lg bg-febo-azul text-white text-sm font-semibold opacity-40 cursor-not-allowed">⚡ Dimensionar y cotizar (próximamente)</button>
      </div>
    </div>
  );
}
