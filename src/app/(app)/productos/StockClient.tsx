"use client";
import { useEffect, useState, useCallback } from "react";

// Detalle de STOCK (depósito): lista con mínimos, aviso de stock bajo y ajuste manual.
const nf = (n: any) => (n == null ? "—" : Number(n).toLocaleString("es-AR"));
// Lista/origen de donde se toma el producto.
const fuenteLista = (r: any) => r.proveedor || (["pumps", "kit_bomba"].includes(r.origen) ? "Catálogo bombas" : (r.emisor || "—"));

export default function StockClient() {
  const [vista, setVista] = useState<"productos" | "insumos">("productos");
  const [rows, setRows] = useState<any[]>([]); const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(""); const [soloBajo, setSoloBajo] = useState(false);
  const [kit, setKit] = useState(false); const [fv, setFv] = useState(false); const [categoria, setCategoria] = useState(""); const [emisor, setEmisor] = useState("");
  const [cats, setCats] = useState<string[]>([]); const [emisores, setEmisores] = useState<string[]>([]); const [listas, setListas] = useState<string[]>([]); const [lista, setLista] = useState(""); const [stockF, setStockF] = useState("");
  const [edit, setEdit] = useState<any | null>(null); const [toast, setToast] = useState("");

  useEffect(() => { fetch("/api/stock?facets=1").then((r) => r.json()).then((d) => { if (d.ok) { setCats(d.categorias || []); setEmisores(d.emisores || []); setListas(d.listas || []); } }).catch(() => {}); }, []);

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim()); if (soloBajo) p.set("bajo", "1");
    if (kit) p.set("kit", "1"); if (fv) p.set("fv", "1"); if (categoria) p.set("categoria", categoria); if (emisor) p.set("emisor", emisor); if (lista) p.set("lista", lista); if (stockF) p.set("stock", stockF);
    fetch("/api/stock?" + p).then((r) => r.json()).then((d) => { setRows(d.ok ? d.productos : []); setLoading(false); }).catch(() => setLoading(false));
  }, [q, soloBajo, kit, fv, categoria, emisor, lista, stockF]);

  // Toggle de etiqueta (kit_bomba / fv) por producto. Actualiza local sin recargar.
  const toggleTag = async (r: any, tag: string) => {
    const tiene = (r.clasif || []).includes(tag);
    setRows((rs) => rs.map((x) => x.id === r.id ? { ...x, clasif: tiene ? (x.clasif || []).filter((t: string) => t !== tag) : [...(x.clasif || []), tag] } : x));
    await fetch("/api/stock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "clasif", id: r.id, tag, on: !tiene }) }).catch(() => {});
  };
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  const bajo = (r: any) => Number(r.stock_minimo || 0) > 0 && Number(r.stock || 0) < Number(r.stock_minimo);

  // Guardar edición inline de stock / mínimo (sin abrir el modal).
  const saveCell = async (r: any, field: "stock" | "stock_minimo", value: string) => {
    const v = Number(value);
    if (!Number.isFinite(v) || v < 0) return;
    if (v === Number(r[field] || 0)) return;
    setRows((rs) => rs.map((x) => x.id === r.id ? { ...x, [field]: v } : x));
    const body = field === "stock" ? { accion: "set_stock", id: r.id, stock: v } : { accion: "minimo", id: r.id, stock_minimo: v };
    await fetch("/api/stock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
  };

  if (vista === "insumos") return (
    <div className="flex flex-col h-full">
      <VistaTabs vista={vista} setVista={setVista} />
      <InsumosView />
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      <VistaTabs vista={vista} setVista={setVista} />
      <div className="flex items-center gap-2 mb-2 text-sm">
        <span className="font-bold text-febo-azul">📦 Stock</span>
        <button onClick={load} className="text-febo-azul hover:underline text-xs">🔄 Recargar</button>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="código o descripción…" className="border border-gray-300 rounded-lg px-3 py-1 text-sm flex-1" />
        <span className="text-xs text-gray-500">{rows.length}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-2 text-sm">
        <button onClick={() => { setKit((v) => !v); setFv(false); }} title="Elementos individuales que componen un kit de bomba solar (la bomba + panel, estructura, cable, soga, caja, sensor, etc.). En gestión se stockean por separado, no como kit. Ajustable por ítem a la derecha."
          className={"rounded-lg px-2.5 py-1 text-xs font-semibold border " + (kit ? "bg-febo-azul text-white border-febo-azul" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50")}>🔧 Elementos Kit bomba solar</button>
        <button onClick={() => { setFv((v) => !v); setKit(false); }} title="Componentes FV individuales (paneles, inversores, baterías, estructuras, cables, etc.). Los KITs de sistemas FV se arman más adelante; por ahora filtra los componentes etiquetados FV."
          className={"rounded-lg px-2.5 py-1 text-xs font-semibold border " + (fv ? "bg-amber-500 text-white border-amber-500" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50")}>☀️ Componentes FV</button>
        <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1 text-xs">
          <option value="">Todas las categorías</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={lista} onChange={(e) => setLista(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1 text-xs">
          <option value="">Todas las listas</option>
          {listas.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={emisor} onChange={(e) => setEmisor(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1 text-xs">
          <option value="">Todos los emisores</option>
          {emisores.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <select value={stockF} onChange={(e) => setStockF(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1 text-xs">
          <option value="">Stock: todos</option>
          <option value="con">Con stock local</option>
          <option value="sin">Sin stock local</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-gray-600"><input type="checkbox" checked={soloBajo} onChange={(e) => setSoloBajo(e.target.checked)} /> Solo bajo mínimo</label>
        {(kit || fv || categoria || emisor || lista || stockF || soloBajo || q) && <button onClick={() => { setKit(false); setFv(false); setCategoria(""); setEmisor(""); setLista(""); setStockF(""); setSoloBajo(false); setQ(""); }} className="text-xs text-gray-400 hover:underline">limpiar</button>}
      </div>
      {toast && <div className="mb-2 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm px-3 py-2">{toast}</div>}
      <div className="flex-1 overflow-auto border border-gray-200 rounded-xl bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0"><tr>
            <th className="text-left px-3 py-2">Código</th><th className="text-left px-3 py-2">Descripción</th>
            <th className="text-left px-3 py-2">Lista</th><th className="text-center px-3 py-2" title="Disponibilidad que informa la lista del proveedor (la que usa el cotizador FV)">Disp. lista</th><th className="text-right px-3 py-2" title="Stock físico en nuestro depósito">Stock local</th>
            <th className="text-right px-3 py-2">Mínimo</th><th className="text-center px-3 py-2">Etiqueta</th><th className="text-center px-3 py-2">Acción</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={8} className="text-center py-8 text-gray-400">Cargando…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={8} className="text-center py-8 text-gray-400">Sin productos</td></tr>
            : rows.map((r) => (
              <tr key={r.id} className={"border-t border-gray-100 " + (bajo(r) ? "bg-red-50" : "hover:bg-blue-50/40")}>
                <td onClick={() => setEdit(r)} className="px-3 py-1.5 font-mono text-xs cursor-pointer hover:text-febo-azul">
                  {r.codigo}
                  {r.es_bomba && !r.cat_match && <span title="⚠️ Este código NO coincide con ningún SKU del catálogo de bombas. El stock que cargues acá NO se va a reflejar en el catálogo. Verificá que el código sea el SKU exacto del catálogo (ej. SCPM6.6/35-D48/750), no la descripción." className="ml-1 cursor-help">⚠️</span>}
                </td>
                <td onClick={() => setEdit(r)} className="px-3 py-1.5 cursor-pointer hover:text-febo-azul"><div style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }} title="Abrir para ajustar">{r.descripcion}</div></td>
                <td onClick={() => setEdit(r)} className="px-3 py-1.5 text-gray-500 text-xs cursor-pointer" title={r.emisor ? "Emisor: " + r.emisor : ""}>{fuenteLista(r)}</td>
                <td className="px-3 py-1.5 text-center text-[11px]"><span className={/stock/i.test(r.disponibilidad || "") ? "text-green-600 font-semibold" : "text-gray-400"}>{r.disponibilidad || "—"}</span></td>
                <td className={"px-3 py-1.5 text-right " + (bajo(r) ? "bg-red-100" : "")}>
                  <input type="number" defaultValue={r.stock ?? ""} key={"s" + r.id + r.stock} onBlur={(e) => saveCell(r, "stock", e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className={"w-20 text-right tabular-nums border border-gray-200 rounded px-1.5 py-0.5 font-semibold " + (bajo(r) ? "text-red-600" : "")} placeholder="—" />
                  {bajo(r) && <span className="ml-1">⚠️</span>}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <input type="number" defaultValue={r.stock_minimo ?? ""} key={"m" + r.id + r.stock_minimo} onBlur={(e) => saveCell(r, "stock_minimo", e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className="w-16 text-right tabular-nums border border-gray-200 rounded px-1.5 py-0.5 text-gray-600" placeholder="—" />
                </td>
                <td className="px-3 py-1.5 text-center whitespace-nowrap">
                  <button onClick={() => toggleTag(r, "kit_bomba")} title="Marcar/quitar del filtro Kit de bombas" className={"rounded px-1.5 py-0.5 text-[10px] font-bold mr-1 border " + ((r.clasif || []).includes("kit_bomba") ? "bg-febo-azul text-white border-febo-azul" : "bg-white text-gray-400 border-gray-300")}>Kit</button>
                  <button onClick={() => toggleTag(r, "fv")} title="Marcar/quitar del filtro FV" className={"rounded px-1.5 py-0.5 text-[10px] font-bold border " + ((r.clasif || []).includes("fv") ? "bg-amber-500 text-white border-amber-500" : "bg-white text-gray-400 border-gray-300")}>FV</button>
                </td>
                <td className="px-3 py-1.5 text-center"><button onClick={() => setEdit(r)} className="text-xs text-febo-azul hover:underline">Ajustar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <AjusteModal prod={edit} onClose={() => setEdit(null)} onDone={(msg) => { setEdit(null); setToast(msg); setTimeout(() => setToast(""), 3000); load(); }} />}
    </div>
  );
}

function VistaTabs({ vista, setVista }: { vista: string; setVista: (v: "productos" | "insumos") => void }) {
  const tab = (k: "productos" | "insumos", label: string) => (
    <button onClick={() => setVista(k)} className={"px-3 py-1.5 text-sm font-semibold rounded-t-lg " + (vista === k ? "bg-white border border-b-0 border-gray-300 text-febo-azul" : "text-gray-500 hover:text-gray-700")}>{label}</button>
  );
  return <div className="flex gap-1 border-b border-gray-300 mb-2">{tab("productos", "📦 Stock productos")}{tab("insumos", "🧰 Insumos internos")}</div>;
}

// Lista de INSUMOS de registro interno (consumibles que no son productos de venta).
function InsumosView() {
  const [rows, setRows] = useState<any[]>([]); const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(""); const [nuevo, setNuevo] = useState({ nombre: "", unidad: "unidad", cantidad: "", minimo: "", categoria: "" });
  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/insumos?" + new URLSearchParams(q.trim() ? { q: q.trim() } : {})).then((r) => r.json()).then((d) => { setRows(d.ok ? d.insumos : []); setLoading(false); }).catch(() => setLoading(false));
  }, [q]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  const crear = async () => {
    if (!nuevo.nombre.trim()) { alert("Poné un nombre"); return; }
    const r = await fetch("/api/insumos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "crear", ...nuevo }) });
    if ((await r.json()).ok) { setNuevo({ nombre: "", unidad: "unidad", cantidad: "", minimo: "", categoria: "" }); load(); }
  };
  const editar = async (it: any, field: string, value: string) => {
    if (value === String(it[field] ?? "")) return;
    setRows((rs) => rs.map((x) => x.id === it.id ? { ...x, [field]: value } : x));
    await fetch("/api/insumos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "editar", id: it.id, [field]: value }) }).catch(() => {});
  };
  const eliminar = async (it: any) => {
    if (!confirm(`¿Eliminar el insumo "${it.nombre}"?`)) return;
    await fetch("/api/insumos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "eliminar", id: it.id }) });
    load();
  };
  const bajo = (it: any) => Number(it.minimo || 0) > 0 && Number(it.cantidad || 0) < Number(it.minimo);
  const inp = "border border-gray-200 rounded px-1.5 py-0.5 text-sm";

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-2 text-sm">
        <span className="font-bold text-febo-azul">🧰 Insumos internos</span>
        <button onClick={load} className="text-febo-azul hover:underline text-xs">🔄 Recargar</button>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="buscar…" className="border border-gray-300 rounded-lg px-3 py-1 text-sm flex-1" />
        <span className="text-xs text-gray-500">{rows.length}</span>
      </div>
      {/* alta rápida */}
      <div className="flex flex-wrap items-center gap-2 mb-2 bg-gray-50 rounded-lg p-2">
        <input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="Nombre del insumo" className={inp + " flex-1 min-w-[180px]"} />
        <input value={nuevo.categoria} onChange={(e) => setNuevo({ ...nuevo, categoria: e.target.value })} placeholder="Categoría" className={inp + " w-32"} />
        <input value={nuevo.unidad} onChange={(e) => setNuevo({ ...nuevo, unidad: e.target.value })} placeholder="unidad" className={inp + " w-24"} />
        <input value={nuevo.cantidad} onChange={(e) => setNuevo({ ...nuevo, cantidad: e.target.value })} type="number" placeholder="cant" className={inp + " w-20 text-right"} />
        <input value={nuevo.minimo} onChange={(e) => setNuevo({ ...nuevo, minimo: e.target.value })} type="number" placeholder="mín" className={inp + " w-20 text-right"} />
        <button onClick={crear} className="bg-febo-azul text-white rounded-lg px-3 py-1 text-xs font-semibold hover:bg-febo-azul/90">+ Agregar</button>
      </div>
      <div className="flex-1 overflow-auto border border-gray-200 rounded-xl bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0"><tr>
            <th className="text-left px-3 py-2">Insumo</th><th className="text-left px-3 py-2">Categoría</th>
            <th className="text-left px-3 py-2">Unidad</th><th className="text-right px-3 py-2">Cantidad</th>
            <th className="text-right px-3 py-2">Mínimo</th><th className="text-left px-3 py-2">Notas</th><th className="text-center px-3 py-2"></th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={8} className="text-center py-8 text-gray-400">Cargando…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={8} className="text-center py-8 text-gray-400">Sin insumos. Agregá el primero arriba.</td></tr>
            : rows.map((it) => (
              <tr key={it.id} className={"border-t border-gray-100 " + (bajo(it) ? "bg-red-50" : "")}>
                <td className="px-2 py-1"><input defaultValue={it.nombre} key={"n" + it.id} onBlur={(e) => editar(it, "nombre", e.target.value)} className={inp + " w-full font-semibold"} /></td>
                <td className="px-2 py-1"><input defaultValue={it.categoria || ""} key={"c" + it.id} onBlur={(e) => editar(it, "categoria", e.target.value)} className={inp + " w-28"} /></td>
                <td className="px-2 py-1"><input defaultValue={it.unidad || ""} key={"u" + it.id} onBlur={(e) => editar(it, "unidad", e.target.value)} className={inp + " w-20"} /></td>
                <td className="px-2 py-1 text-right"><input type="number" defaultValue={it.cantidad ?? ""} key={"q" + it.id + it.cantidad} onBlur={(e) => editar(it, "cantidad", e.target.value)} className={inp + " w-20 text-right " + (bajo(it) ? "text-red-600 font-semibold" : "")} /></td>
                <td className="px-2 py-1 text-right"><input type="number" defaultValue={it.minimo ?? ""} key={"mn" + it.id + it.minimo} onBlur={(e) => editar(it, "minimo", e.target.value)} className={inp + " w-16 text-right"} /></td>
                <td className="px-2 py-1"><input defaultValue={it.notas || ""} key={"nt" + it.id} onBlur={(e) => editar(it, "notas", e.target.value)} className={inp + " w-full"} placeholder="—" /></td>
                <td className="px-2 py-1 text-center"><button onClick={() => eliminar(it)} title="Eliminar" className="text-gray-300 hover:text-red-500">🗑</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AjusteModal({ prod, onClose, onDone }: { prod: any; onClose: () => void; onDone: (m: string) => void }) {
  const [delta, setDelta] = useState(""); const [motivo, setMotivo] = useState(""); const [minimo, setMinimo] = useState(String(prod.stock_minimo ?? "")); const [emisor, setEmisor] = useState(prod.emisor || ""); const [busy, setBusy] = useState(false);
  const guardarEmisor = async () => {
    setBusy(true);
    const r = await fetch("/api/stock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "emisor", id: prod.id, emisor }) });
    const j = await r.json(); setBusy(false);
    if (j.ok) onDone(`Emisor de ${prod.codigo}: ${emisor || "—"}`); else alert("⚠️ " + (j.error || "error"));
  };
  const ajustar = async () => {
    const d = Number(delta);
    if (!Number.isFinite(d) || d === 0) { alert("Ingresá una cantidad (+ suma, − resta)"); return; }
    setBusy(true);
    const r = await fetch("/api/stock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "ajustar", id: prod.id, delta: d, motivo }) });
    const j = await r.json(); setBusy(false);
    if (j.ok) onDone(`Stock de ${prod.codigo}: ${nf(j.stock)}`); else alert("⚠️ " + (j.error || "error"));
  };
  const guardarMin = async () => {
    const m = Number(minimo);
    if (!Number.isFinite(m) || m < 0) { alert("Mínimo inválido"); return; }
    setBusy(true);
    const r = await fetch("/api/stock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "minimo", id: prod.id, stock_minimo: m }) });
    const j = await r.json(); setBusy(false);
    if (j.ok) onDone(`Mínimo de ${prod.codigo}: ${nf(m)}`); else alert("⚠️ " + (j.error || "error"));
  };
  return (
    <div className="fixed inset-0 z-[130] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="bg-febo-azul text-white rounded-t-xl px-5 py-3 flex items-center justify-between">
          <div className="font-bold text-sm">Ajustar stock — {prod.codigo}</div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-xl leading-none">✕</button>
        </div>
        <div className="p-4 space-y-4 text-sm">
          <div className="text-gray-600">{prod.descripcion}</div>
          <div className="bg-gray-50 rounded-lg p-3">Stock actual: <b>{nf(prod.stock)}</b></div>
          <div>
            <div className="font-semibold text-gray-700 mb-1">Ajuste manual (+ suma / − resta)</div>
            <div className="flex gap-2">
              <input value={delta} onChange={(e) => setDelta(e.target.value)} type="number" placeholder="ej: 5 o -2" className="border border-gray-300 rounded-lg px-3 py-1.5 w-28" />
              <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="motivo (rotura, recuento, etc.)" className="border border-gray-300 rounded-lg px-3 py-1.5 flex-1" />
            </div>
            <button disabled={busy} onClick={ajustar} className="mt-2 bg-febo-azul disabled:opacity-40 text-white rounded-lg px-3 py-1.5 text-xs font-semibold">Aplicar ajuste</button>
          </div>
          <div className="border-t pt-3">
            <div className="font-semibold text-gray-700 mb-1">Emisor / proveedor (para agrupar el pedido a proveedor)</div>
            <div className="flex gap-2">
              <select value={emisor} onChange={(e) => setEmisor(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 flex-1">
                <option value="">— sin emisor —</option>
                <option value="Multiradio">Multiradio</option>
                <option value="Multisolar">Multisolar</option>
                <option value="Multipoint">Multipoint</option>
              </select>
              <button disabled={busy} onClick={guardarEmisor} className="bg-gray-100 text-gray-700 rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-gray-200">Guardar emisor</button>
            </div>
          </div>
          <div className="border-t pt-3">
            <div className="font-semibold text-gray-700 mb-1">Mínimo para aviso de stock bajo</div>
            <div className="flex gap-2">
              <input value={minimo} onChange={(e) => setMinimo(e.target.value)} type="number" placeholder="ej: 3" className="border border-gray-300 rounded-lg px-3 py-1.5 w-28" />
              <button disabled={busy} onClick={guardarMin} className="bg-gray-100 text-gray-700 rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-gray-200">Guardar mínimo</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
