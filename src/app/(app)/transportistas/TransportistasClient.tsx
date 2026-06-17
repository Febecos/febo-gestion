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

function Modal({ carrier, onClose, onSaved }: { carrier: Carrier | null; onClose: () => void; onSaved: () => void }) {
  const nuevo = !carrier;
  const [nombre, setNombre] = useState(carrier?.nombre || "");
  const [tel, setTel] = useState(contactoDe(carrier || ({} as Carrier), ["phone", "whatsapp", "mobile", "tel"]));
  const [email, setEmail] = useState(contactoDe(carrier || ({} as Carrier), ["email"]));
  const [web, setWeb] = useState(contactoDe(carrier || ({} as Carrier), ["web", "url"]));
  const [activo, setActivo] = useState(carrier?.activo ?? true);
  const [provs, setProvs] = useState<string[]>(carrier?.provincias || []);
  const [busy, setBusy] = useState(false);
  const toggle = (p: string) => setProvs((xs) => xs.includes(p) ? xs.filter((x) => x !== p) : [...xs, p]);

  const guardar = async () => {
    if (!nombre.trim()) { alert("Poné el nombre del transportista."); return; }
    const contactos = [
      tel.trim() && { type: "phone", value: tel.trim(), is_primary: true },
      email.trim() && { type: "email", value: email.trim() },
      web.trim() && { type: "web", value: web.trim() },
    ].filter(Boolean);
    const body: any = { nombre: nombre.trim(), activo, contactos, provincias: provs };
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
  return (
    <div className="fixed inset-0 bg-black/45 z-[120] overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-2xl mx-auto my-8 p-7 relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-5 text-2xl text-gray-400">✕</button>
        <h2 className="text-lg font-bold mb-4">{nuevo ? "＋ Nuevo transportista" : "✏️ " + (carrier!.nombre || "Transportista")}</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 text-[11px] font-semibold text-gray-600">Nombre / Empresa *<input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inp} /></label>
          <label className="text-[11px] font-semibold text-gray-600">Teléfono / WhatsApp<input value={tel} onChange={(e) => setTel(e.target.value)} className={inp} /></label>
          <label className="text-[11px] font-semibold text-gray-600">Email<input value={email} onChange={(e) => setEmail(e.target.value)} className={inp} /></label>
          <label className="col-span-2 text-[11px] font-semibold text-gray-600">Web (opcional)<input value={web} onChange={(e) => setWeb(e.target.value)} className={inp} /></label>
        </div>
        <div className="mt-4">
          <div className="text-[11px] font-bold text-gray-400 uppercase mb-1">Provincias que cubre <span className="text-gray-400 font-normal">(alimenta el “buscar transporte por provincia” del cliente)</span></div>
          <div className="grid grid-cols-3 gap-x-3 gap-y-1 max-h-44 overflow-auto border border-gray-200 rounded-lg p-2">
            {PROVINCIAS.map((p) => (
              <label key={p} className="flex items-center gap-1.5 text-xs text-gray-700"><input type="checkbox" checked={provs.includes(p)} onChange={() => toggle(p)} />{p}</label>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 mt-3 text-sm text-gray-700"><input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /> Activo</label>
        <div className="flex justify-between items-center mt-5">
          {!nuevo ? <button disabled={busy} onClick={eliminar} className="text-sm text-red-600 font-semibold">🗑 Eliminar</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm">Cancelar</button>
            <button disabled={busy} onClick={guardar} className="px-5 py-2 rounded-lg bg-febo-azul text-white text-sm font-semibold">{busy ? "Guardando…" : "Guardar"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
