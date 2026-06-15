"use client";
import { useEffect, useState, useCallback } from "react";

type Prod = { id: number; codigo: string; descripcion: string; descripcion_alt: string; categoria: string; origen: string; marca: string; fabricante: string; proveedor: string; precio: number; costo_usd: number; costo_ars: number; precio_venta: number; iva_pct: number; disponibilidad: string; sin_precio: boolean; en_stock: boolean; a_confirmar: boolean; stock: number };

const fmt = (v: number) => (v ? "$ " + Math.round(Number(v)).toLocaleString("es-AR") : "—");
const fmtU = (v: number) => (v ? "US$ " + Number(v).toLocaleString("es-AR") : "—");

export default function ProductosClient() {
  const [rows, setRows] = useState<Prod[]>([]);
  const [cats, setCats] = useState<{ categoria: string; n: number }[]>([]);
  const [provs, setProvs] = useState<{ proveedor: string; n: number }[]>([]);
  const [dolar, setDolar] = useState(0);
  const [q, setQ] = useState(""); const [cat, setCat] = useState(""); const [prov, setProv] = useState(""); const [soloStock, setSoloStock] = useState(false);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<Prod | null>(null);
  const [nuevo, setNuevo] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ q, categoria: cat, proveedor: prov, stock: soloStock ? "1" : "", limit: "200" });
      const r = await fetch("/api/productos?" + p); const d = await r.json();
      if (d.ok) { setRows(d.productos); setCats(d.categorias); setProvs(d.proveedores || []); setDolar(d.dolar || 0); }
    } finally { setLoading(false); }
  }, [q, cat, prov, soloStock]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar código / descripción / fabricante…" className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[240px]" />
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">Todas las categorías</option>
          {cats.map((c) => <option key={c.categoria} value={c.categoria}>{c.categoria} ({c.n})</option>)}
        </select>
        <select value={prov} onChange={(e) => setProv(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">Todos los proveedores</option>
          {provs.map((p) => <option key={p.proveedor} value={p.proveedor}>{p.proveedor} ({p.n})</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer"><input type="checkbox" checked={soloStock} onChange={(e) => setSoloStock(e.target.checked)} /> Solo en stock</label>
        <span className="text-sm text-gray-500">{rows.length} prod.{dolar ? ` · US$ = $${dolar}` : ""}</span>
        <button onClick={() => setNuevo(true)} className="ml-auto bg-febo-verde text-white rounded-lg px-3 py-2 text-sm font-semibold">＋ Nuevo producto</button>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr>
            <th className="text-left px-3 py-3">Código</th><th className="text-left px-3 py-3">Descripción</th><th className="text-left px-3 py-3">Categoría</th><th className="text-left px-3 py-3">Fabricante</th><th className="text-left px-3 py-3">Proveedor</th><th className="text-center px-3 py-3">Stock</th><th className="text-right px-3 py-3">Costo USD</th><th className="text-right px-3 py-3">Costo ARS</th><th className="text-right px-3 py-3">Precio venta</th><th></th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={10} className="text-center py-8 text-gray-400">Cargando…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={10} className="text-center py-8 text-gray-400">Sin resultados</td></tr>
            : rows.map((p) => {
              const propio = p.origen === "manual";
              return (
                <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono text-[11px]">{p.codigo || "—"}</td>
                  <td className="px-3 py-2 max-w-[280px]">
                    <div className="truncate" title={p.descripcion}>{p.descripcion}{propio && <span className="ml-1.5 text-[9px] bg-emerald-100 text-emerald-700 rounded px-1.5 py-0.5 font-bold">PROPIO</span>}</div>
                    {p.descripcion_alt && <div className="text-[11px] text-febo-cyan">↳ {p.descripcion_alt}</div>}
                  </td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{p.categoria}</td>
                  <td className="px-3 py-2 text-gray-600 text-xs">{p.fabricante || p.marca || "—"}</td>
                  <td className="px-3 py-2 text-gray-600 text-xs">{p.proveedor || "—"}</td>
                  <td className="px-3 py-2 text-center">{
                    p.a_confirmar
                      ? <span className="text-amber-500 text-[11px] font-semibold" title="Stock a confirmar">a confirmar</span>
                      : p.en_stock ? <span className="text-emerald-600" title={p.disponibilidad}>●</span>
                      : <span className="text-gray-300" title={p.disponibilidad || "sin stock"}>○</span>
                  }</td>
                  <td className="px-3 py-2 text-right text-gray-500 text-xs">{p.origen === "fv" ? fmtU(p.costo_usd) : "—"}</td>
                  <td className="px-3 py-2 text-right text-gray-500 text-xs">{p.costo_ars ? fmt(p.costo_ars) : "—"}</td>
                  <td className="px-3 py-2 text-right font-semibold">{p.sin_precio ? <span className="text-amber-500 text-xs">s/precio</span> : fmt(p.precio_venta)}</td>
                  <td className="px-3 py-2 text-right"><button onClick={() => setEdit(p)} className="text-gray-400" title={propio ? "Editar" : "Editar nombre corto"}>✏️</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(edit || nuevo) && <ProductoModal prod={edit} cats={cats.map((c) => c.categoria)} onClose={() => { setEdit(null); setNuevo(false); }} onSaved={() => { setEdit(null); setNuevo(false); load(); }} />}
    </div>
  );
}

function ProductoModal({ prod, cats, onClose, onSaved }: { prod: Prod | null; cats: string[]; onClose: () => void; onSaved: () => void }) {
  const esNuevo = !prod;
  const propio = esNuevo || prod?.origen === "manual";
  const [f, setF] = useState<any>(() => ({
    codigo: prod?.codigo || "", descripcion: prod?.descripcion || "", descripcion_alt: prod?.descripcion_alt || "", categoria: prod?.categoria || "OTROS",
    marca: prod?.marca || "", proveedor: prod?.proveedor || "", precio: prod?.precio ?? "", iva_pct: prod?.iva_pct ?? 21, stock: prod?.stock ?? "",
  }));
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const CAMPOS = ["codigo", "descripcion", "descripcion_alt", "categoria", "marca", "proveedor", "precio", "iva_pct", "stock"];

  async function guardar() {
    if (!f.descripcion.trim()) { alert("Poné una descripción"); return; }
    setSaving(true);
    try {
      if (esNuevo) {
        const r = await fetch("/api/productos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
        const d = await r.json(); if (!d.ok) throw new Error(d.error);
      } else {
        // importados: solo se manda descripcion_alt; propios: todos los campos
        const campos = propio ? CAMPOS : ["descripcion_alt"];
        for (const k of campos) {
          const nv = (f[k] ?? "").toString().trim();
          const ov = ((prod as any)[k] ?? "").toString();
          if (nv !== ov) { const r = await fetch(`/api/productos/${prod!.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field: k, value: ["precio", "iva_pct", "stock"].includes(k) ? (Number(f[k]) || null) : (f[k] || null) }) }); const d = await r.json(); if (!d.ok) throw new Error(d.error); }
        }
      }
      onSaved();
    } catch (e: any) { alert("Error: " + e.message); } finally { setSaving(false); }
  }
  async function eliminar() {
    if (!prod || !confirm("¿Eliminar este producto propio?")) return;
    const r = await fetch(`/api/productos/${prod.id}`, { method: "DELETE" }); const d = await r.json();
    if (d.ok) onSaved(); else alert("Error: " + d.error);
  }

  const lbl = "flex flex-col gap-1 text-[11px] font-semibold text-gray-600";
  const inp = "border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm";
  return (
    <div className="fixed inset-0 bg-black/45 z-50 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-xl mx-auto my-10 p-7" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-1">{esNuevo ? "＋ Nuevo producto propio" : propio ? "✏️ Editar producto" : "✏️ Nombre corto del producto"}</h2>
        {!propio && <p className="text-xs text-gray-400 mb-4">Producto del listado (bombas/FV): la descripción original no se modifica (va al pedido al proveedor). Solo podés definir un nombre corto para presupuesto/factura.</p>}
        <div className="grid grid-cols-2 gap-3">
          <label className={lbl}>CÓDIGO<input value={f.codigo} onChange={(e) => set("codigo", e.target.value)} className={inp} placeholder="opcional" disabled={!propio} /></label>
          <label className={lbl}>CATEGORÍA<input value={f.categoria} onChange={(e) => set("categoria", e.target.value)} className={inp} list="cats" disabled={!propio} /><datalist id="cats">{cats.map((c) => <option key={c} value={c} />)}</datalist></label>
          <label className={lbl + " col-span-2"}>DESCRIPCIÓN ORIGINAL{!propio && " (va al pedido al proveedor)"}<input value={f.descripcion} onChange={(e) => set("descripcion", e.target.value)} className={inp + (propio ? "" : " bg-gray-100 text-gray-500")} disabled={!propio} /></label>
          <label className={lbl + " col-span-2"}>DESCRIPCIÓN ALTERNATIVA <span className="font-normal text-febo-cyan">(corta, sale en presupuesto/factura)</span><input value={f.descripcion_alt} onChange={(e) => set("descripcion_alt", e.target.value)} className={inp} placeholder="ej: Panel 550W Jinko" /></label>
          <label className={lbl}>MARCA<input value={f.marca} onChange={(e) => set("marca", e.target.value)} className={inp} disabled={!propio} /></label>
          <label className={lbl}>PROVEEDOR<input value={f.proveedor} onChange={(e) => set("proveedor", e.target.value)} className={inp} placeholder="ej: Mercado Libre - X" disabled={!propio} /></label>
          <label className={lbl}>PRECIO (ARS)<input type="number" value={f.precio} onChange={(e) => set("precio", e.target.value)} className={inp} disabled={!propio} /></label>
          <label className={lbl}>IVA %<select value={f.iva_pct} onChange={(e) => set("iva_pct", e.target.value)} className={inp} disabled={!propio}><option value="21">21%</option><option value="10.5">10,5%</option><option value="0">0%</option></select></label>
          <label className={lbl}>STOCK<input type="number" value={f.stock} onChange={(e) => set("stock", e.target.value)} className={inp} disabled={!propio} /></label>
        </div>
        <div className="flex justify-between items-center mt-6">
          {!esNuevo && propio ? <button onClick={eliminar} className="bg-red-50 text-red-700 border border-red-200 rounded-lg px-4 py-2 text-sm font-semibold">🗑 Eliminar</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="border border-gray-300 rounded-lg px-5 py-2 text-sm">Cancelar</button>
            <button onClick={guardar} disabled={saving} className="bg-febo-verde text-white rounded-lg px-6 py-2 text-sm font-semibold disabled:opacity-50">{saving ? "Guardando…" : esNuevo ? "Crear" : "Guardar"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
