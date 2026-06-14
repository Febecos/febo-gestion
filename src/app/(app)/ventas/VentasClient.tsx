"use client";
import { useEffect, useState, useCallback } from "react";

type Comp = { id: number; tipo: string; estado: string; numero: string; cliente_nombre: string; cliente_cuit: string; fecha: string; total: number; ref_id: number | null };
type Item = { descripcion: string; cantidad: number; precio_unitario: number; descuento_pct: number; total: number };

const fmt = (v: number) => "$ " + Math.round(Number(v) || 0).toLocaleString("es-AR");
const fmtF = (v: string) => (v ? new Date(v).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");
const TIPO_COL: Record<string, string> = { presupuesto: "#2563eb", pedido: "#7c3aed", factura: "#059669", remito: "#ea580c" };
const EST_COL: Record<string, string> = { emitido: "#64748b", confirmado: "#7c3aed", facturado: "#059669", anulado: "#e53935" };

export default function VentasClient() {
  const [rows, setRows] = useState<Comp[]>([]);
  const [tipo, setTipo] = useState(""); const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [nuevo, setNuevo] = useState(false);
  const [ver, setVer] = useState<number | null>(null);
  const [cotiz, setCotiz] = useState<{ url: string; titulo: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ tipo, q });
      const r = await fetch("/api/ventas?" + p); const d = await r.json();
      if (d.ok) setRows(d.comprobantes);
    } finally { setLoading(false); }
  }, [tipo, q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const chip = (txt: string, col: string) => <span style={{ background: col + "22", color: col }} className="rounded px-2 py-0.5 text-[11px] font-semibold">{txt}</span>;

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente / número…" className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[240px]" />
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">Todos</option><option value="presupuesto">Presupuestos</option><option value="pedido">Pedidos</option><option value="factura">Facturas</option><option value="remito">Remitos</option>
        </select>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setCotiz({ url: "https://revendedores.febecos.com/portal", titulo: "🔧 Cotizador de bombas (revendedores)" })} className="bg-febo-violeta text-white rounded-lg px-3 py-2 text-sm font-semibold">🔧 Cotizar bomba</button>
          <button onClick={() => setCotiz({ url: "https://fv.febecos.com", titulo: "☀️ Cotizador fotovoltaico" })} className="bg-amber-500 text-white rounded-lg px-3 py-2 text-sm font-semibold">☀️ Cotizar FV</button>
          <button onClick={() => setNuevo(true)} className="bg-febo-verde text-white rounded-lg px-3 py-2 text-sm font-semibold">＋ Nuevo presupuesto</button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr>
            <th className="text-left px-4 py-3">Número</th><th className="text-left px-4 py-3">Tipo</th><th className="text-left px-4 py-3">Cliente</th><th className="text-left px-4 py-3">Estado</th><th className="text-left px-4 py-3">Fecha</th><th className="text-right px-4 py-3">Total</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">Cargando…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">Sin comprobantes — creá un presupuesto</td></tr>
            : rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => setVer(r.id)}>
                <td className="px-4 py-2 font-semibold">{r.numero}</td>
                <td className="px-4 py-2">{chip(r.tipo, TIPO_COL[r.tipo] || "#888")}</td>
                <td className="px-4 py-2">{r.cliente_nombre || "—"}</td>
                <td className="px-4 py-2">{chip(r.estado, EST_COL[r.estado] || "#888")}</td>
                <td className="px-4 py-2 text-gray-600">{fmtF(r.fecha)}</td>
                <td className="px-4 py-2 text-right font-semibold">{fmt(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {nuevo && <NuevoPresupuesto onClose={() => setNuevo(false)} onSaved={() => { setNuevo(false); load(); }} />}
      {ver && <VerComprobante id={ver} onClose={() => setVer(null)} onChanged={() => { load(); }} />}
      {cotiz && (
        <div className="fixed inset-0 bg-black/50 z-50 flex flex-col p-3" onClick={() => setCotiz(null)}>
          <div className="bg-white rounded-xl flex flex-col flex-1 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200">
              <span className="font-semibold text-sm">{cotiz.titulo}</span>
              <a href={cotiz.url} target="_blank" rel="noreferrer" className="text-xs text-febo-azul">abrir en pestaña ↗</a>
              <button onClick={() => setCotiz(null)} className="ml-auto text-2xl text-gray-400">✕</button>
            </div>
            <iframe src={cotiz.url} className="flex-1 w-full" title={cotiz.titulo} />
            <div className="px-4 py-1.5 text-[11px] text-gray-400 border-t border-gray-100">Si la página queda en blanco, usá «abrir en pestaña». El presupuesto que generes ahí queda guardado y lo ves en esta lista.</div>
          </div>
        </div>
      )}
    </div>
  );
}

function NuevoPresupuesto({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [cli, setCli] = useState<any>(null);
  const [busq, setBusq] = useState(""); const [sug, setSug] = useState<any[]>([]);
  const [items, setItems] = useState<Item[]>([{ descripcion: "", cantidad: 1, precio_unitario: 0, descuento_pct: 0, total: 0 }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (cli || busq.length < 2) { setSug([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch("/api/clientes?limit=6&q=" + encodeURIComponent(busq)); const d = await r.json();
      if (d.ok) setSug(d.clientes);
    }, 250); return () => clearTimeout(t);
  }, [busq, cli]);

  const setItem = (i: number, k: keyof Item, v: any) => setItems((p) => p.map((it, idx) => idx === i ? { ...it, [k]: v } : it));
  const subtotal = items.reduce((a, it) => a + (Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0) * (1 - (Number(it.descuento_pct) || 0) / 100), 0);

  async function guardar() {
    if (!cli && !busq) { alert("Elegí un cliente"); return; }
    const its = items.filter((it) => it.descripcion.trim());
    if (!its.length) { alert("Agregá al menos un ítem"); return; }
    setSaving(true);
    try {
      const r = await fetch("/api/ventas", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: "presupuesto", cliente_id: cli?.id || null, cliente_nombre: cli?.nombre || busq, cliente_cuit: cli?.cuit || null, items: its }) });
      const d = await r.json(); if (!d.ok) throw new Error(d.error);
      onSaved();
    } catch (e: any) { alert("Error: " + e.message); } finally { setSaving(false); }
  }

  const inp = "border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm";
  return (
    <div className="fixed inset-0 bg-black/45 z-50 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-3xl mx-auto my-8 p-7" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4">＋ Nuevo presupuesto</h2>
        <div className="mb-4 relative">
          <label className="text-[11px] font-semibold text-gray-600">CLIENTE</label>
          {cli ? (
            <div className="flex items-center gap-2 mt-1"><span className="font-semibold text-sm">{cli.nombre}</span><span className="text-xs text-gray-400">{cli.cuit || cli.whatsapp || ""}</span><button onClick={() => { setCli(null); setBusq(""); }} className="text-xs text-red-500">cambiar</button></div>
          ) : (
            <>
              <input value={busq} onChange={(e) => setBusq(e.target.value)} placeholder="Buscar cliente por nombre / CUIT / WhatsApp…" className={inp + " w-full mt-1"} />
              {sug.length > 0 && (
                <div className="absolute z-10 bg-white border border-gray-200 rounded-lg mt-1 w-full shadow-sm max-h-48 overflow-auto">
                  {sug.map((s) => <div key={s.id} onClick={() => { setCli(s); setSug([]); }} className="px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer">{s.nombre} <span className="text-xs text-gray-400">{s.cuit || s.whatsapp || ""}</span></div>)}
                </div>
              )}
            </>
          )}
        </div>

        <div className="text-[11px] font-semibold text-gray-600 mb-1">ÍTEMS</div>
        <table className="w-full text-sm mb-2">
          <thead className="text-[10px] text-gray-400 uppercase"><tr><th className="text-left">Descripción</th><th className="w-16">Cant</th><th className="w-28">P. unit</th><th className="w-16">Desc%</th><th className="w-24 text-right">Total</th><th className="w-6"></th></tr></thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td className="pr-1 py-0.5"><input value={it.descripcion} onChange={(e) => setItem(i, "descripcion", e.target.value)} className={inp + " w-full"} placeholder="Producto / servicio" /></td>
                <td className="px-0.5"><input type="number" value={it.cantidad} onChange={(e) => setItem(i, "cantidad", e.target.value)} className={inp + " w-full"} /></td>
                <td className="px-0.5"><input type="number" value={it.precio_unitario} onChange={(e) => setItem(i, "precio_unitario", e.target.value)} className={inp + " w-full"} /></td>
                <td className="px-0.5"><input type="number" value={it.descuento_pct} onChange={(e) => setItem(i, "descuento_pct", e.target.value)} className={inp + " w-full"} /></td>
                <td className="text-right pr-1 text-gray-600">{fmt((Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0) * (1 - (Number(it.descuento_pct) || 0) / 100))}</td>
                <td><button onClick={() => setItems((p) => p.filter((_, idx) => idx !== i))} className="text-red-400">✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => setItems((p) => [...p, { descripcion: "", cantidad: 1, precio_unitario: 0, descuento_pct: 0, total: 0 }])} className="text-sm text-febo-azul font-semibold mb-4">＋ Agregar ítem</button>

        <div className="flex justify-between items-center border-t border-gray-100 pt-4">
          <div className="text-lg font-bold">Total: {fmt(subtotal)}</div>
          <div className="flex gap-2">
            <button onClick={onClose} className="border border-gray-300 rounded-lg px-5 py-2 text-sm">Cancelar</button>
            <button onClick={guardar} disabled={saving} className="bg-febo-verde text-white rounded-lg px-6 py-2 text-sm font-semibold disabled:opacity-50">{saving ? "Guardando…" : "Crear presupuesto"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function VerComprobante({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await fetch("/api/ventas/" + id); const d = await r.json(); if (d.ok) setData(d); }, [id]);
  useEffect(() => { load(); }, [load]);

  async function confirmar() {
    if (!confirm("¿Confirmar el presupuesto y generar el pedido?")) return;
    setBusy(true);
    try { const r = await fetch("/api/ventas/" + id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "confirmar" }) });
      const d = await r.json(); if (!d.ok) throw new Error(d.error);
      alert("Pedido generado: " + d.numero); onChanged(); load();
    } catch (e: any) { alert("Error: " + e.message); } finally { setBusy(false); }
  }

  if (!data) return null;
  const c = data.comprobante;
  return (
    <div className="fixed inset-0 bg-black/45 z-50 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-2xl mx-auto my-8 p-7" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <div><div className="text-lg font-bold">{c.tipo.toUpperCase()} {c.numero}</div><div className="text-sm text-gray-500">{c.cliente_nombre} · {fmtF(c.fecha)} · estado: {c.estado}</div></div>
          <button onClick={onClose} className="text-2xl text-gray-400">✕</button>
        </div>
        <table className="w-full text-sm mb-4">
          <thead className="text-[10px] text-gray-400 uppercase border-b"><tr><th className="text-left py-1">Descripción</th><th className="text-right">Cant</th><th className="text-right">P.unit</th><th className="text-right">Total</th></tr></thead>
          <tbody>{data.items.map((it: any) => <tr key={it.id} className="border-b border-gray-50"><td className="py-1">{it.descripcion}</td><td className="text-right">{it.cantidad}</td><td className="text-right">{fmt(it.precio_unitario)}</td><td className="text-right font-semibold">{fmt(it.total)}</td></tr>)}</tbody>
        </table>
        <div className="text-right text-lg font-bold mb-4">Total: {fmt(c.total)}</div>
        <div className="flex justify-end gap-2">
          {c.tipo === "presupuesto" && c.estado !== "confirmado" && <button onClick={confirmar} disabled={busy} className="bg-febo-violeta text-white rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-50">✓ Confirmar → generar pedido</button>}
          <button onClick={onClose} className="border border-gray-300 rounded-lg px-5 py-2 text-sm">Cerrar</button>
        </div>
      </div>
    </div>
  );
}
