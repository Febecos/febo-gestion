"use client";
import { useCallback, useEffect, useState } from "react";

const PROVINCIAS = ["Buenos Aires", "Ciudad Autónoma de Buenos Aires", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes", "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza", "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis", "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán"];

type Carrier = { id: number; nombre: string; activo: boolean; notas?: string; contactos?: any[]; provincias?: string[] };

const contactoDe = (c: Carrier, tipos: string[]) => (c.contactos || []).find((x) => tipos.includes(String(x.type || "").toLowerCase()))?.value || "";

export default function TransportistasClient() {
  const [rows, setRows] = useState<Carrier[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Carrier | null>(null);
  const [nuevo, setNuevo] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/transportistas?soloActivos=false" + (q ? "&q=" + encodeURIComponent(q) : ""))
      .then((r) => r.json()).then((d) => { setRows(d.ok ? d.rows : []); }).finally(() => setLoading(false));
  }, [q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar transportista…" className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        <button onClick={() => setNuevo(true)} className="px-4 py-2 rounded-lg bg-febo-azul text-white text-sm font-semibold">＋ Nuevo transportista</button>
      </div>
      {loading ? <div className="text-gray-400 text-sm py-8 text-center">Cargando…</div> : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr><th className="text-left px-3 py-2">Transportista</th><th className="text-left px-3 py-2">Teléfono</th><th className="text-left px-3 py-2">Provincias que cubre</th><th className="text-left px-3 py-2">Estado</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => setEdit(c)}>
                  <td className="px-3 py-2 font-semibold">{c.nombre}</td>
                  <td className="px-3 py-2 text-gray-600">{contactoDe(c, ["phone", "whatsapp", "mobile", "tel"]) || "—"}</td>
                  <td className="px-3 py-2 text-gray-600 text-xs">{(c.provincias || []).length ? (c.provincias || []).slice(0, 4).join(", ") + ((c.provincias || []).length > 4 ? ` +${(c.provincias || []).length - 4}` : "") : <span className="text-amber-600">sin zonas</span>}</td>
                  <td className="px-3 py-2">{c.activo ? <span className="text-emerald-600 text-xs font-semibold">● Activo</span> : <span className="text-gray-400 text-xs">○ Inactivo</span>}</td>
                  <td className="px-3 py-2 text-right text-gray-400">✏️</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={5} className="text-center py-10 text-gray-400">Sin transportistas. Cargá el primero con “Nuevo transportista”.</td></tr>}
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
  const [legal, setLegal] = useState((c as any).legal_name || "");
  const [cuit, setCuit] = useState((c as any).tax_id || "");
  const [tel, setTel] = useState(contactoDe(c, ["phone", "tel"]));
  const [wa, setWa] = useState(contactoDe(c, ["whatsapp", "mobile"]));
  const [deposito, setDeposito] = useState(contactoDe(c, ["address", "deposito"]));
  const [email, setEmail] = useState(contactoDe(c, ["email"]));
  const [web, setWeb] = useState(contactoDe(c, ["web", "url"]));
  const [notas, setNotas] = useState(c.notas || "");
  const [activo, setActivo] = useState(c.activo ?? true);
  const [zonas, setZonas] = useState<Zona[]>(() => {
    const zd = (c as any).zonas_detalle;
    if (Array.isArray(zd) && zd.length) return zd.map((z: any) => ({ province: z.province, locality: z.locality || null }));
    return (c.provincias || []).map((p) => ({ province: p, locality: null }));
  });
  const [busy, setBusy] = useState(false);

  // Buscador de zonas: localidades (Georef) + opción de provincia completa.
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
        <h2 className="text-lg font-bold">{nuevo ? "＋ Nuevo transportista" : "✏️ Editar transportista"}</h2>
        {!nuevo && <div className="text-[11px] text-gray-400 mb-3">ID #{carrier!.id}</div>}
        <div className="grid grid-cols-2 gap-3 mt-2">
          <label className={lbl + " col-span-2"}>Empresa / Nombre *<input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inp} /></label>
          <label className={lbl}>Razón social<input value={legal} onChange={(e) => setLegal(e.target.value)} placeholder="Ej: Lobruno S.A." className={inp} /></label>
          <label className={lbl}>CUIT<input value={cuit} onChange={(e) => setCuit(e.target.value)} placeholder="Ej: 30-12345678-9" className={inp} /></label>
          <label className={lbl}>☎ Teléfono<input value={tel} onChange={(e) => setTel(e.target.value)} className={inp} /></label>
          <label className={lbl}>📱 WhatsApp<input value={wa} onChange={(e) => setWa(e.target.value)} className={inp} /></label>
          <label className={lbl + " col-span-2"}>📍 Depósito / Domicilio<input value={deposito} onChange={(e) => setDeposito(e.target.value)} placeholder="Ej: Berón de Astrada 2850, CABA — L-V 8:00-17:00" className={inp} /></label>
          <label className={lbl}>✉ Email<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contacto@empresa.com" className={inp} /></label>
          <label className={lbl}>🌐 Sitio web<input value={web} onChange={(e) => setWeb(e.target.value)} placeholder="https://…" className={inp} /></label>
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
          {zonas.length > 0 && <div className="flex flex-wrap gap-1.5 mt-2">
            {zonas.map((z, i) => <span key={i} className="inline-flex items-center gap-1 bg-blue-50 text-febo-azul rounded-full px-2.5 py-1 text-xs font-semibold">{z.locality ? `${z.locality}, ${z.province}` : `${z.province} (toda)`}<button onClick={() => delZona(i)} className="text-gray-400 hover:text-red-500">✕</button></span>)}
          </div>}
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
