"use client";
import { useCallback, useEffect, useState } from "react";

const PROVINCIAS = ["Buenos Aires", "Ciudad Autónoma de Buenos Aires", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes", "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza", "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis", "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán"];

type Carrier = { id: number; nombre: string; legal_name?: string; tax_id?: string; activo: boolean; notas?: string; source?: string; contactos?: any[]; provincias?: string[]; zonas_detalle?: any[] };

const norm = (s: any) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const contactoDe = (c: Carrier, tipos: string[]) => (c.contactos || []).find((x) => tipos.includes(String(x.type || "").toLowerCase()))?.value || "";

const COLS: { k: string; label: string; def: boolean }[] = [
  { k: "contacto", label: "Contacto", def: true },
  { k: "zonas", label: "Zonas", def: true },
  { k: "web", label: "Sitio web", def: false },
  { k: "email", label: "Email", def: false },
  { k: "razonsocial", label: "Razón social", def: false },
  { k: "cuit", label: "CUIT", def: false },
  { k: "domicilio", label: "Domicilio", def: false },
  { k: "fuente", label: "Fuente", def: false },
  { k: "activo", label: "Activo", def: true },
];

export default function TransportistasClient() {
  const [rows, setRows] = useState<Carrier[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState<"activos" | "inactivos" | "todos">("activos");
  const [zonaF, setZonaF] = useState("");
  const [zonaSug, setZonaSug] = useState<string[]>([]);
  const [colMenu, setColMenu] = useState(false);
  const [cols, setCols] = useState<Record<string, boolean>>(() => Object.fromEntries(COLS.map((c) => [c.k, c.def])));
  const [edit, setEdit] = useState<Carrier | null>(null);
  const [nuevo, setNuevo] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/transportistas?soloActivos=false").then((r) => r.json()).then((d) => setRows(d.ok ? d.rows : [])).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Autocomplete localidad/provincia (Georef) para el filtro por zona
  useEffect(() => {
    const v = zonaF.trim(); if (v.length < 2) { setZonaSug([]); return; }
    const pr = PROVINCIAS.filter((p) => norm(p).includes(norm(v))).slice(0, 4);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const u = `https://apis.datos.gob.ar/georef/api/localidades?nombre=${encodeURIComponent(v)}&campos=nombre,provincia.nombre&max=6&aplanar=true`;
        const r = await fetch(u, { signal: ctrl.signal }); const j = await r.json();
        const locs = (j.localidades || []).map((x: any) => `${x.nombre}, ${x.provincia_nombre}`);
        setZonaSug([...pr, ...locs]);
      } catch { setZonaSug(pr); }
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [zonaF]);

  const cubreZona = (c: Carrier, filtro: string) => {
    const f = norm(filtro); if (!f) return true;
    const provs = (c.provincias || []).map(norm);
    const zonas = (c.zonas_detalle || []).map((z) => norm([z.locality, z.province].filter(Boolean).join(", ")));
    const provDelFiltro = filtro.includes(",") ? norm(filtro.split(",").pop() || "") : f;
    return provs.some((p) => p.includes(provDelFiltro) || provDelFiltro.includes(p)) || zonas.some((z) => z.includes(f) || f.includes(z));
  };

  const visibles = rows.filter((c) => {
    if (estado === "activos" && !c.activo) return false;
    if (estado === "inactivos" && c.activo) return false;
    if (q.trim()) {
      const t = norm(q);
      const enTexto = norm(c.nombre).includes(t) || norm(contactoDe(c, ["phone", "whatsapp", "tel", "mobile"])).includes(t) || norm(c.legal_name).includes(t) || norm(c.tax_id).includes(t);
      // La búsqueda principal también matchea por provincia/localidad de cobertura.
      const enZona = (c.provincias || []).some((p) => norm(p).includes(t)) || (c.zonas_detalle || []).some((z) => norm([z.locality, z.province].filter(Boolean).join(" ")).includes(t));
      if (!enTexto && !enZona) return false;
    }
    if (zonaF.trim() && !cubreZona(c, zonaF)) return false;
    return true;
  });

  const inp = "border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none";
  return (
    <div onClick={() => colMenu && setColMenu(false)}>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, contacto, localidad o provincia…" className={inp + " w-72"} />
        <div className="relative">
          <input value={zonaF} onChange={(e) => setZonaF(e.target.value)} placeholder="🔍 Ciudad o provincia…" className={inp + " w-52"} autoComplete="off" />
          {zonaSug.length > 0 && (
            <div className="absolute z-30 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-auto">
              {zonaF && <button onClick={() => { setZonaF(""); setZonaSug([]); }} className="block w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-50">✕ limpiar filtro de zona</button>}
              {zonaSug.map((s, i) => <button key={i} onClick={() => { setZonaF(s); setZonaSug([]); }} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50">📍 {s}</button>)}
            </div>
          )}
        </div>
        <select value={estado} onChange={(e) => setEstado(e.target.value as any)} className={inp + " bg-white"}>
          <option value="activos">✅ Activos</option><option value="inactivos">⛔ Inactivos</option><option value="todos">📋 Todos</option>
        </select>
        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => setColMenu(!colMenu)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm hover:bg-gray-50">☰ Columnas</button>
          {colMenu && (
            <div className="absolute right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-30 min-w-[170px]">
              <div className="text-[10px] font-bold text-gray-400 uppercase mb-2">Mostrar columnas</div>
              {COLS.map((c) => <label key={c.k} className="flex items-center gap-2 text-sm text-gray-700 py-0.5"><input type="checkbox" checked={!!cols[c.k]} onChange={(e) => setCols({ ...cols, [c.k]: e.target.checked })} />{c.label}</label>)}
            </div>
          )}
        </div>
        <button onClick={() => setNuevo(true)} className="px-4 py-2 rounded-lg bg-febo-azul text-white text-sm font-semibold ml-auto">＋ Agregar transportista</button>
        <button onClick={load} className="border border-gray-300 rounded-lg px-3 py-2 text-sm hover:bg-gray-50">🔄</button>
      </div>
      <div className="text-xs text-gray-400 mb-2">{visibles.length} transportista(s){zonaF ? ` que cubren "${zonaF}"` : ""}</div>

      {loading ? <div className="text-gray-400 text-sm py-8 text-center">Cargando…</div> : (
        <div className="border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2">Transportista</th>
                {cols.contacto && <th className="text-left px-3 py-2">Contacto</th>}
                {cols.razonsocial && <th className="text-left px-3 py-2">Razón social</th>}
                {cols.cuit && <th className="text-left px-3 py-2">CUIT</th>}
                {cols.zonas && <th className="text-left px-3 py-2">Zonas</th>}
                {cols.domicilio && <th className="text-left px-3 py-2">Domicilio</th>}
                {cols.email && <th className="text-left px-3 py-2">Email</th>}
                {cols.web && <th className="text-left px-3 py-2">Web</th>}
                {cols.fuente && <th className="text-left px-3 py-2">Fuente</th>}
                {cols.activo && <th className="text-left px-3 py-2">Estado</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((c) => {
                const zonas = (c.zonas_detalle || []).map((z) => z.locality ? `${z.locality}` : `${z.province} (toda)`);
                const provs = c.provincias || [];
                const zonaTxt = zonas.length ? zonas.slice(0, 3).join(", ") + (zonas.length > 3 ? ` +${zonas.length - 3}` : "") : (provs.length ? provs.slice(0, 3).join(", ") + (provs.length > 3 ? ` +${provs.length - 3}` : "") : "—");
                const web = contactoDe(c, ["web", "url"]);
                return (
                  <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => setEdit(c)}>
                    <td className="px-3 py-2 font-semibold">{c.nombre}</td>
                    {cols.contacto && <td className="px-3 py-2 text-gray-600">{contactoDe(c, ["phone", "whatsapp", "tel", "mobile"]) || "—"}</td>}
                    {cols.razonsocial && <td className="px-3 py-2 text-gray-600">{c.legal_name || "—"}</td>}
                    {cols.cuit && <td className="px-3 py-2 text-gray-600">{c.tax_id || "—"}</td>}
                    {cols.zonas && <td className="px-3 py-2 text-gray-600 text-xs">{zonaTxt === "—" ? <span className="text-amber-600">sin zonas</span> : zonaTxt}</td>}
                    {cols.domicilio && <td className="px-3 py-2 text-gray-600 text-xs">{contactoDe(c, ["address", "deposito"]) || "—"}</td>}
                    {cols.email && <td className="px-3 py-2 text-gray-600 text-xs">{contactoDe(c, ["email"]) || "—"}</td>}
                    {cols.web && <td className="px-3 py-2 text-xs">{web ? <a href={web} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-febo-azul hover:underline">🔗 abrir</a> : "—"}</td>}
                    {cols.fuente && <td className="px-3 py-2 text-gray-400 text-xs">{c.source || "—"}</td>}
                    {cols.activo && <td className="px-3 py-2">{c.activo ? <span className="text-emerald-600 text-xs font-semibold">● Activo</span> : <span className="text-gray-400 text-xs">○ Inactivo</span>}</td>}
                    <td className="px-3 py-2 text-right text-gray-400">✏️</td>
                  </tr>
                );
              })}
              {!visibles.length && <tr><td colSpan={12} className="text-center py-10 text-gray-400">Sin transportistas.{zonaF ? " Ninguno cubre esa zona." : " Cargá el primero con “Agregar transportista”."}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {(edit || nuevo) && <Modal carrier={edit} onClose={() => { setEdit(null); setNuevo(false); }} onSaved={() => { setEdit(null); setNuevo(false); load(); }} />}
    </div>
  );
}

type Zona = { province: string; locality?: string | null };

function Modal({ carrier, onClose, onSaved }: { carrier: Carrier | null; onClose: () => void; onSaved: () => void }) {
  const nuevo = !carrier;
  const c = carrier || ({} as Carrier);
  const [nombre, setNombre] = useState(c.nombre || "");
  const [legal, setLegal] = useState(c.legal_name || "");
  const [cuit, setCuit] = useState(c.tax_id || "");
  const [tel, setTel] = useState(contactoDe(c, ["phone", "tel"]));
  const [wa, setWa] = useState(contactoDe(c, ["whatsapp", "mobile"]));
  const [domLegal, setDomLegal] = useState(contactoDe(c, ["legal_address", "fiscal"]));
  const [deposito, setDeposito] = useState(contactoDe(c, ["address", "deposito"]));
  const [email, setEmail] = useState(contactoDe(c, ["email"]));
  const [web, setWeb] = useState(contactoDe(c, ["web", "url"]));
  const [notas, setNotas] = useState(c.notas || "");
  const [activo, setActivo] = useState(c.activo ?? true);
  const [zonas, setZonas] = useState<Zona[]>(() => {
    const zd = c.zonas_detalle;
    if (Array.isArray(zd) && zd.length) return zd.map((z: any) => ({ province: z.province, locality: z.locality || null }));
    return (c.provincias || []).map((p) => ({ province: p, locality: null }));
  });
  const [busy, setBusy] = useState(false);
  const [arca, setArca] = useState("");

  // Lee el CUIT en ARCA y completa razón social (dato legal AFIP, pisa) + domicilio/depósito si está vacío.
  async function buscarArca() {
    const c11 = (cuit || "").replace(/\D/g, "");
    if (c11.length !== 11) { setArca("El CUIT debe tener 11 dígitos."); return; }
    setArca("Buscando en ARCA…");
    try {
      const r = await fetch("/api/consultar-cuit?cuit=" + c11); const d = await r.json();
      if (!d.ok || d.valido === false) throw new Error(d.error || "CUIT sin datos");
      const dom = d.domicilio || {};
      const nom = d.razonSocial || d.denominacion || [d.nombre, d.apellido].filter(Boolean).join(" ");
      if (nom) setLegal(nom);
      // El domicilio LEGAL/fiscal lo manda AFIP → completa su propio campo (pisa). El Depósito es manual.
      const partes = [dom.direccion, dom.localidad, dom.provincia, dom.codPostal ? "CP " + dom.codPostal : ""].filter(Boolean);
      if (partes.length) setDomLegal(partes.join(", "));
      setArca("✓ " + (nom || c11));
    } catch (e: any) { setArca("✕ " + e.message); }
  }

  const [zq, setZq] = useState("");
  const [zsug, setZsug] = useState<{ nombre: string; prov: string }[]>([]);
  useEffect(() => {
    const q = zq.trim(); if (q.length < 2) { setZsug([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const u = `https://apis.datos.gob.ar/georef/api/localidades?nombre=${encodeURIComponent(q)}&campos=nombre,provincia.nombre&max=8&aplanar=true`;
        const r = await fetch(u, { signal: ctrl.signal }); const j = await r.json();
        setZsug((j.localidades || []).map((x: any) => ({ nombre: x.nombre, prov: x.provincia_nombre })).filter((x: any) => x.nombre && x.prov));
      } catch { /* ignore */ }
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [zq]);
  const provMatch = PROVINCIAS.find((p) => p.toLowerCase() === zq.trim().toLowerCase());
  const addZona = (z: Zona) => { setZonas((xs) => xs.some((x) => x.province === z.province && (x.locality || "") === (z.locality || "")) ? xs : [...xs, z]); setZq(""); setZsug([]); };
  const delZona = (i: number) => setZonas((xs) => xs.filter((_, k) => k !== i));

  const guardar = async () => {
    if (!nombre.trim()) { alert("Poné el nombre del transportista."); return; }
    const contactos = [
      tel.trim() && { type: "phone", value: tel.trim(), is_primary: true },
      wa.trim() && { type: "whatsapp", value: wa.trim() },
      email.trim() && { type: "email", value: email.trim() },
      web.trim() && { type: "web", value: web.trim() },
      deposito.trim() && { type: "address", value: deposito.trim(), label: "Depósito" },
      domLegal.trim() && { type: "legal_address", value: domLegal.trim(), label: "Domicilio legal" },
    ].filter(Boolean);
    const zonasBody = zonas.map((z) => ({ province: z.province, locality: z.locality || null, coverage_type: z.locality ? "locality_specific" : "province_wide" }));
    const body: any = { nombre: nombre.trim(), legal_name: legal.trim(), tax_id: cuit.trim(), notas: notas.trim(), activo, contactos, zonas: zonasBody };
    setBusy(true);
    try {
      const r = await fetch("/api/transportistas", { method: nuevo ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nuevo ? body : { id: carrier!.id, ...body }) });
      const d = await r.json();
      if (d.ok) onSaved(); else alert("⚠️ " + (d.error || "No se pudo guardar"));
    } catch (e: any) { alert("Error: " + e.message); } finally { setBusy(false); }
  };
  const eliminar = async () => {
    if (!carrier) return;
    if (!confirm(`¿Eliminar el transportista "${carrier.nombre}"?`)) return;
    setBusy(true);
    try { const r = await fetch("/api/transportistas?id=" + carrier.id, { method: "DELETE" }); const d = await r.json(); if (d.ok) onSaved(); else alert("⚠️ " + (d.error || "No se pudo")); }
    catch (e: any) { alert("Error: " + e.message); } finally { setBusy(false); }
  };

  const inp = "border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm w-full";
  const lbl = "text-[11px] font-semibold text-gray-600 flex flex-col gap-1";
  return (
    <div className="fixed inset-0 bg-black/45 z-[120] overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-2xl mx-auto my-8 p-7 relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-5 text-2xl text-gray-400">✕</button>
        <h2 className="text-lg font-bold">{nuevo ? "＋ Agregar transportista" : "✏️ Editar transportista"}</h2>
        {!nuevo && <div className="text-[11px] text-gray-400 mb-3">ID #{carrier!.id}{carrier!.source ? " · " + carrier!.source : ""}</div>}
        <div className="grid grid-cols-2 gap-3 mt-2">
          <label className={lbl + " col-span-2"}>Empresa / Nombre *<input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inp} /></label>
          <label className={lbl}>Razón social (ARCA)<input value={legal} onChange={(e) => setLegal(e.target.value)} placeholder="Ej: Lobruno S.A." className={inp} /></label>
          <label className={lbl}>CUIT<div className="flex gap-1.5"><input value={cuit} onChange={(e) => setCuit(e.target.value)} placeholder="Ej: 30-12345678-9" className={inp} /><button type="button" onClick={buscarArca} title="Leer datos del CUIT en ARCA" className="bg-febo-cyan text-white rounded-lg px-3 text-sm whitespace-nowrap">🔍 ARCA</button></div></label>
          {arca && <div className="col-span-2 text-[11px] -mt-1.5" style={{ color: arca.startsWith("✓") ? "#059669" : "#e53935" }}>{arca}</div>}
          <label className={lbl + " col-span-2"}>🏛 Domicilio legal (ARCA)<input value={domLegal} onChange={(e) => setDomLegal(e.target.value)} placeholder="Se completa con 🔍 ARCA (o cargalo manual)" className={inp} /></label>
          <label className={lbl}>☎ Teléfono<input value={tel} onChange={(e) => setTel(e.target.value)} className={inp} /></label>
          <label className={lbl}>📱 WhatsApp<input value={wa} onChange={(e) => setWa(e.target.value)} className={inp} /></label>
          <label className={lbl + " col-span-2"}>📍 Depósito / Domicilio<input value={deposito} onChange={(e) => setDeposito(e.target.value)} placeholder="Ej: Berón de Astrada 2850, CABA — L-V 8:00-17:00" className={inp} /></label>
          <label className={lbl}>✉ Email<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contacto@empresa.com" className={inp} /></label>
          <label className={lbl}>🌐 Sitio web<div className="flex gap-1.5"><input value={web} onChange={(e) => setWeb(e.target.value)} placeholder="https://…" className={inp} /><button type="button" onClick={() => { const u = web.trim(); if (u) window.open(u, "_blank"); else alert("Ingresá la URL"); }} className="px-2.5 rounded-lg border border-gray-300 bg-gray-50 hover:bg-gray-100" title="Abrir sitio">🔗</button></div></label>
        </div>

        <div className="mt-4">
          <div className="text-[11px] font-bold text-gray-400 uppercase">Zonas de cobertura</div>
          <div className="text-[11px] text-gray-400 mb-1">Escribí una localidad para buscar, o el nombre de una provincia para agregar cobertura completa.</div>
          <input value={zq} onChange={(e) => setZq(e.target.value)} placeholder="Ej: Bahía Blanca, Mendoza, Río Negro…" className={inp} />
          {(zsug.length > 0 || provMatch) && (
            <div className="border border-gray-200 rounded-lg mt-1 bg-white shadow-sm max-h-44 overflow-auto">
              {provMatch && <button onClick={() => addZona({ province: provMatch, locality: null })} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 font-semibold text-febo-azul">➕ {provMatch} — toda la provincia</button>}
              {zsug.map((s, i) => <button key={i} onClick={() => addZona({ province: s.prov, locality: s.nombre })} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50">📍 {s.nombre}, {s.prov}</button>)}
            </div>
          )}
          {zonas.length > 0
            ? <div className="flex flex-wrap gap-1.5 mt-2">{zonas.map((z, i) => <span key={i} className="inline-flex items-center gap-1 bg-blue-50 text-febo-azul rounded-full px-2.5 py-1 text-xs font-semibold">{z.locality ? `${z.locality}, ${z.province}` : `${z.province} (toda)`}<button onClick={() => delZona(i)} className="text-gray-400 hover:text-red-500">✕</button></span>)}</div>
            : <div className="text-xs text-gray-400 mt-2">Sin zonas asignadas</div>}
        </div>

        <label className={lbl + " mt-4"}>Notas / comentarios internos<textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} className={inp} /></label>
        <label className="flex items-center gap-2 mt-3 text-sm text-gray-700"><input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /> Activo</label>

        <div className="flex justify-between items-center mt-5">
          {!nuevo ? <button disabled={busy} onClick={eliminar} className="text-sm text-red-600 font-semibold">🗑 Eliminar</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm">Cancelar</button>
            <button disabled={busy} onClick={guardar} className="px-5 py-2 rounded-lg bg-febo-azul text-white text-sm font-semibold">{busy ? "Guardando…" : "Guardar cambios"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
