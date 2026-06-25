"use client";
import { useEffect, useState, useCallback } from "react";

type Prov = any;
const lbl = "block text-[10px] uppercase text-gray-400 font-semibold mb-0.5";
const inp = "w-full border border-gray-300 rounded px-2 py-1.5 text-sm";

export default function ProveedoresClient() {
  const [rows, setRows] = useState<Prov[]>([]); const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(""); const [sel, setSel] = useState<Prov | null | "nuevo">(null);
  const load = useCallback(() => { setLoading(true); fetch("/api/proveedores?q=" + encodeURIComponent(q)).then((r) => r.json()).then((d) => { setRows(d.ok ? d.proveedores : []); setLoading(false); }); }, [q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar proveedor (nombre, CUIT, rubro)…" className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-72" />
        <button onClick={() => setSel("nuevo")} className="px-3 py-1.5 rounded-lg bg-febo-azul text-white text-sm font-semibold ml-auto">➕ Nuevo proveedor</button>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr>
            <th className="text-left px-4 py-3">Proveedor</th><th className="text-left px-4 py-3">CUIT</th><th className="text-left px-4 py-3">Rubro</th><th className="text-left px-4 py-3">Contacto</th><th className="text-left px-4 py-3">Localidad</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5} className="text-center py-8 text-gray-400">Cargando…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={5} className="text-center py-8 text-gray-400">Sin proveedores. Agregá uno.</td></tr>
            : rows.map((p) => (
              <tr key={p.id} className={`border-t border-gray-100 hover:bg-blue-50 cursor-pointer ${p.activo ? "" : "opacity-50"}`} onClick={() => setSel(p)}>
                <td className="px-4 py-2 font-semibold">{p.razon_social || p.nombre_fantasia || "—"}{p.nombre_fantasia && p.razon_social && <span className="text-gray-400 font-normal ml-1">({p.nombre_fantasia})</span>}</td>
                <td className="px-4 py-2 font-mono text-gray-600">{p.cuit || "—"}</td>
                <td className="px-4 py-2 text-gray-600">{p.rubro || "—"}</td>
                <td className="px-4 py-2 text-gray-600">{p.contacto || p.email || p.telefono || "—"}</td>
                <td className="px-4 py-2 text-gray-600">{p.localidad || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sel && <ProvModal prov={sel === "nuevo" ? null : sel} onClose={() => setSel(null)} onSaved={load} />}
    </div>
  );
}

function ProvModal({ prov, onClose, onSaved }: { prov: Prov | null; onClose: () => void; onSaved: () => void }) {
  const esNuevo = !prov;
  const [p, setP] = useState<Prov>(prov || { activo: true });
  const [arca, setArca] = useState(""); const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"datos" | "ctacte">("datos");
  const set = (k: string, v: any) => setP((x: Prov) => ({ ...x, [k]: v }));
  const patch = async (campo: string, valor: any) => { if (esNuevo) return; await fetch("/api/proveedores", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id, campo, valor }) }); onSaved(); };

  async function buscarArca() {
    const cuit = String(p.cuit || "").replace(/\D/g, "");
    if (cuit.length !== 11) { setArca("El CUIT debe tener 11 dígitos."); return; }
    setArca("Buscando en ARCA…");
    try {
      const r = await fetch("/api/consultar-cuit?cuit=" + cuit); const d = await r.json();
      if (!d.ok || d.valido === false) throw new Error(d.error || "CUIT sin datos");
      const dom = d.domicilio || {};
      const nom = d.razonSocial || d.denominacion || [d.nombre, d.apellido].filter(Boolean).join(", ");
      const upd: Record<string, string> = { razon_social: nom || "", domicilio: dom.direccion || "", localidad: dom.localidad || "", provincia: dom.provincia || "", cod_postal: dom.codPostal || "", condicion_iva: d.condicionFiscal || "" };
      // Completar solo lo vacío (no pisar lo cargado a mano)
      const aplicar: Record<string, string> = {};
      for (const [k, v] of Object.entries(upd)) if (v && !p[k]) aplicar[k] = v;
      setP((x: Prov) => ({ ...x, ...aplicar }));
      // Si estamos editando, persistir (el "Traer de ARCA" no dispara onBlur → no se guardaría)
      if (!esNuevo) { for (const [k, v] of Object.entries(aplicar)) await patch(k, v); }
      setArca("✓ " + (nom || cuit));
    } catch (e: any) { setArca("✕ " + e.message); }
  }

  async function guardar() {
    setSaving(true);
    try {
      if (esNuevo) {
        const r = await fetch("/api/proveedores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
        const d = await r.json(); if (!d.ok) throw new Error(d.error);
      }
      onSaved(); onClose();
    } catch (e: any) { alert("Error: " + e.message); } finally { setSaving(false); }
  }
  const F = (campo: string, label: string, span = false) => (
    <label key={campo} className={span ? "col-span-2" : ""}><span className={lbl}>{label}</span>
      <input value={p[campo] ?? ""} onChange={(e) => set(campo, e.target.value)} onBlur={(e) => !esNuevo && patch(campo, e.target.value)} className={inp} /></label>
  );

  return (
    <div className="fixed inset-0 z-[120] bg-black/50 flex items-stretch justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-[760px] h-full flex flex-col shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="bg-febo-azul text-white rounded-t-xl px-5 py-3 flex items-center justify-between">
          <div className="text-lg font-bold">🏭 {esNuevo ? "Nuevo proveedor" : (p.razon_social || p.nombre_fantasia || "Proveedor")}</div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-xl leading-none">✕</button>
        </div>
        {!esNuevo && (
          <div className="flex gap-1 px-4 pt-3 bg-white border-b border-gray-200">
            {([["datos", "📋 Datos"], ["ctacte", "💳 Cuenta corriente"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 rounded-t-lg text-sm font-semibold ${tab === k ? "bg-febo-azul text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{l}</button>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-auto p-5 space-y-4">
          {(esNuevo || tab === "datos") && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 flex items-end gap-2">
              <label className="flex-1"><span className={lbl}>CUIT</span><input value={p.cuit ?? ""} onChange={(e) => set("cuit", e.target.value)} onBlur={(e) => !esNuevo && patch("cuit", e.target.value)} className={inp} placeholder="30xxxxxxxxx" /></label>
              <button onClick={buscarArca} className="bg-febo-cyan text-white rounded-lg px-3 h-[34px] text-sm whitespace-nowrap">🔍 Traer de ARCA</button>
            </div>
            {arca && <div className="col-span-2 text-[11px] -mt-2" style={{ color: arca.startsWith("✓") ? "#059669" : "#e53935" }}>{arca}</div>}
            {F("razon_social", "Razón social", true)}
            {F("nombre_fantasia", "Nombre de fantasía", true)}
            {F("rubro", "Rubro / qué provee")}
            {F("condicion_iva", "Condición IVA")}
            {F("alias", "Alias (nombres en listas/pedidos, separá con coma)", true)}
            {F("contacto", "Persona de contacto")}
            <label><span className={lbl}>Teléfono / WhatsApp</span>
              <input value={p.telefono ?? ""} inputMode="numeric"
                onChange={(e) => set("telefono", e.target.value.replace(/\D/g, ""))}
                onBlur={(e) => !esNuevo && patch("telefono", e.target.value.replace(/\D/g, ""))}
                className={inp} placeholder="sin + ni espacios, ej: 5491161351564" /></label>
            {F("email", "Email", true)}
            {F("domicilio", "Domicilio", true)}
            {F("localidad", "Localidad")}
            {F("provincia", "Provincia")}
            {F("cod_postal", "Código postal")}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.activo !== false} onChange={(e) => { set("activo", e.target.checked); !esNuevo && patch("activo", e.target.checked); }} /> Activo</label>
            <label className="col-span-2"><span className={lbl}>Notas</span><textarea value={p.notas ?? ""} onChange={(e) => set("notas", e.target.value)} onBlur={(e) => !esNuevo && patch("notas", e.target.value)} className={inp} rows={2} /></label>

            <div className="col-span-2 mt-2 pt-3 border-t border-gray-200">
              <div className="text-xs font-bold text-febo-azul uppercase tracking-wide">👥 Contactos</div>
              <div className="text-[11px] text-gray-400 mt-0.5">Los pedidos de gsandler van al comercial (Para) con copia (CC) a administración y logística.</div>
            </div>
            {([["comercial", "💼 Comercial"], ["admin", "🧾 Administración"], ["logistica", "🚚 Logística"]] as const).map(([rol, titulo]) => (
              <div key={rol} className="col-span-2 grid grid-cols-3 gap-2 bg-gray-50 rounded-lg p-2.5">
                <div className="col-span-3 text-[11px] font-semibold text-gray-600">{titulo}</div>
                <label><span className={lbl}>Nombre</span><input value={p[`cont_${rol}_nombre`] ?? ""} onChange={(e) => set(`cont_${rol}_nombre`, e.target.value)} onBlur={(e) => !esNuevo && patch(`cont_${rol}_nombre`, e.target.value)} className={inp} /></label>
                <label><span className={lbl}>Email</span><input type="email" value={p[`cont_${rol}_email`] ?? ""} onChange={(e) => set(`cont_${rol}_email`, e.target.value)} onBlur={(e) => !esNuevo && patch(`cont_${rol}_email`, e.target.value)} className={inp} placeholder="nombre@empresa.com" /></label>
                <label><span className={lbl}>Celular</span><input value={p[`cont_${rol}_cel`] ?? ""} inputMode="numeric" onChange={(e) => set(`cont_${rol}_cel`, e.target.value.replace(/\D/g, ""))} onBlur={(e) => !esNuevo && patch(`cont_${rol}_cel`, e.target.value.replace(/\D/g, ""))} className={inp} placeholder="549..." /></label>
              </div>
            ))}
            {!esNuevo && p.id && <CuentasBancarias prov={p} onSave={(arr) => patch("cuentas_bancarias", arr)} />}
          </div>
          )}
          {!esNuevo && p.id && tab === "ctacte" && <CtaCteProv provId={p.id} />}
        </div>
        <div className="border-t border-gray-200 p-3 flex justify-between bg-gray-50">
          {!esNuevo
            ? <button onClick={async () => { if (!confirm("¿Eliminar este proveedor? (usalo para borrar duplicados). Si tiene cuenta corriente, reseteala antes o quedará huérfana.")) return; const r = await fetch("/api/proveedores?id=" + p.id, { method: "DELETE" }); const d = await r.json(); if (d.ok) { onSaved(); onClose(); } else alert("Error: " + d.error); }} className="text-red-500 text-sm hover:underline">🗑 Eliminar</button>
            : <span />}
          {esNuevo
            ? <button disabled={saving} onClick={guardar} className="px-4 py-2 rounded-lg bg-febo-azul text-white text-sm font-semibold">{saving ? "Guardando…" : "💾 Crear proveedor"}</button>
            : <button onClick={onClose} className="px-4 py-2 rounded-lg bg-febo-azul text-white text-sm font-semibold">Listo</button>}
        </div>
      </div>
    </div>
  );
}

function CuentasBancarias({ prov, onSave }: { prov: any; onSave: (arr: any[]) => void }) {
  const [cuentas, setCuentas] = useState<any[]>(Array.isArray(prov.cuentas_bancarias) ? prov.cuentas_bancarias : []);
  const [copied, setCopied] = useState("");
  const save = (arr: any[]) => { setCuentas(arr); onSave(arr); };
  const upd = (i: number, k: string, v: string) => save(cuentas.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  const add = () => save([...cuentas, { banco: "", moneda: "ARS", sucursal: "", cuenta: "", cbu: "", alias: "", titular: prov.razon_social || "", cuit: prov.cuit || "" }]);
  const del = (i: number) => { if (confirm("¿Eliminar esta cuenta bancaria?")) save(cuentas.filter((_, j) => j !== i)); };
  const copy = (txt: string, tag: string) => { navigator.clipboard?.writeText(String(txt || "")).then(() => { setCopied(tag); setTimeout(() => setCopied(""), 1500); }).catch(() => {}); };
  const fi = "border border-gray-300 rounded px-2 py-1 text-sm w-full";
  return (
    <div className="col-span-2 mt-2 pt-3 border-t border-gray-200">
      <div className="flex items-center gap-2">
        <div className="text-xs font-bold text-febo-azul uppercase tracking-wide">🏦 Cuentas bancarias</div>
        <button onClick={add} className="text-xs text-febo-azul hover:underline">+ agregar cuenta</button>
      </div>
      {cuentas.length === 0 && <div className="text-[11px] text-gray-400 mt-1">Sin cuentas cargadas.</div>}
      <div className="space-y-2 mt-2">
        {cuentas.map((c, i) => (
          <div key={i} className="bg-gray-50 rounded-lg p-2.5 grid grid-cols-4 gap-2 relative">
            <label className="col-span-2"><span className={lbl}>Banco</span><input value={c.banco ?? ""} onChange={(e) => upd(i, "banco", e.target.value)} className={fi} /></label>
            <label><span className={lbl}>Moneda</span>
              <select value={c.moneda ?? "ARS"} onChange={(e) => upd(i, "moneda", e.target.value)} className={fi}><option value="ARS">Pesos</option><option value="USD">USD</option></select>
            </label>
            <label><span className={lbl}>Sucursal</span><input value={c.sucursal ?? ""} onChange={(e) => upd(i, "sucursal", e.target.value)} className={fi} /></label>
            <label className="col-span-2"><span className={lbl}>Cuenta</span><input value={c.cuenta ?? ""} onChange={(e) => upd(i, "cuenta", e.target.value)} className={fi} /></label>
            <label className="col-span-2"><span className={lbl}>Alias</span>
              <div className="flex gap-1">
                <input value={c.alias ?? ""} onChange={(e) => upd(i, "alias", e.target.value)} className={fi} />
                {c.alias && <button onClick={() => copy(c.alias, "alias" + i)} title="Copiar alias" className="shrink-0 px-2 rounded bg-white border border-gray-300 text-xs hover:bg-gray-100">{copied === "alias" + i ? "✓" : "📋"}</button>}
              </div>
            </label>
            <label className="col-span-4"><span className={lbl}>CBU</span>
              <div className="flex gap-1">
                <input value={c.cbu ?? ""} onChange={(e) => upd(i, "cbu", e.target.value)} className={fi + " font-mono"} />
                <button onClick={() => copy(c.cbu, "cbu" + i)} title="Copiar CBU" className="shrink-0 px-3 rounded bg-febo-azul text-white text-xs font-semibold hover:bg-febo-azul/90">{copied === "cbu" + i ? "✓ copiado" : "📋 copiar"}</button>
              </div>
            </label>
            <button onClick={() => del(i)} title="Eliminar cuenta" className="absolute top-1.5 right-1.5 text-gray-300 hover:text-red-500 text-xs">🗑</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function CtaCteProv({ provId }: { provId: number }) {
  const [movs, setMovs] = useState<any[]>([]); const [saldo, setSaldo] = useState(0); const [dolar, setDolar] = useState(0); const [loaded, setLoaded] = useState(false);
  useEffect(() => { fetch("/api/ctacte?ambito=proveedor&proveedor_id=" + provId).then((r) => r.json()).then((d) => { if (d.ok) { setMovs(d.movimientos || []); setSaldo(d.saldo || 0); setDolar(d.dolar || 0); } setLoaded(true); }).catch(() => setLoaded(true)); }, [provId]);
  let acum = 0;
  return (
    <div className="rounded-lg border border-gray-200">
      <div className="px-3 py-2 flex items-center justify-between text-sm border-b border-gray-100">
        <span className="font-semibold text-febo-azul">💳 Cuenta corriente</span>
        <b className={saldo > 0.01 ? "text-red-600" : "text-emerald-600"}>USD {saldo.toLocaleString("es-AR", { minimumFractionDigits: 2 })}{dolar > 0 ? " · $ " + Math.round(saldo * dolar).toLocaleString("es-AR") : ""} <span className="font-normal text-gray-400 text-xs">{saldo > 0.01 ? "(le debemos)" : "(al día)"}</span></b>
      </div>
      <div className="px-3 py-2 overflow-x-auto">
        {!loaded ? <div className="text-gray-400 text-xs py-3 text-center">Cargando…</div>
        : movs.length === 0 ? <div className="text-gray-400 text-xs py-3 text-center">Sin movimientos. La cuenta se alimenta al confirmar stock y registrar pagos en los pedidos. El nombre debe coincidir con el del proveedor en los ítems.</div>
        : <table className="w-full text-xs">
          <thead className="text-[10px] uppercase text-gray-400"><tr><th className="text-left py-1">Fecha</th><th className="text-left py-1">Concepto</th><th className="text-right py-1">Debe</th><th className="text-right py-1">Haber</th><th className="text-right py-1">Saldo</th></tr></thead>
          <tbody>
            {movs.map((m, i) => { const d = Number(m.debe) || 0, h = Number(m.haber) || 0; acum += h - d; return (
              <tr key={i} className="border-t border-gray-100">
                <td className="py-1 text-gray-500 whitespace-nowrap">{m.fecha ? new Date(m.fecha).toLocaleDateString("es-AR") : "—"}</td>
                <td className="py-1">{m.concepto}{m.pedido_ref ? " · " + m.pedido_ref : ""}</td>
                <td className="py-1 text-right tabular-nums text-gray-600">{d ? d.toLocaleString("es-AR", { minimumFractionDigits: 2 }) : ""}</td>
                <td className="py-1 text-right tabular-nums text-gray-600">{h ? h.toLocaleString("es-AR", { minimumFractionDigits: 2 }) : ""}</td>
                <td className="py-1 text-right tabular-nums font-semibold">{acum.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</td>
              </tr>
            ); })}
          </tbody>
        </table>}
      </div>
    </div>
  );
}

