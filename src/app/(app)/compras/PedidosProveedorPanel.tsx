"use client";
import { useEffect, useState, useCallback } from "react";

const EST: Record<string, [string, string]> = {
  pendiente: ["⏳ Pendiente", "#d97706"], enviado: ["📤 Enviado", "#2563eb"], confirmado: ["✅ Confirmado", "#0891b2"],
  pagado: ["💳 Pagado", "#7c3aed"], recibido_ok: ["✔ Recibido OK", "#16a34a"], recibido_diferencias: ["⚠️ Recibido c/dif.", "#ea580c"],
};
const chip = (e: string) => { const [l, c] = EST[e] || [e, "#888"]; return <span style={{ background: c + "22", color: c }} className="rounded px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap">{l}</span>; };
const fUSD = (n: any) => "USD " + Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtF = (v: any) => v ? new Date(v).toLocaleDateString("es-AR") : "—";

export default function PedidosProveedorPanel() {
  const [rows, setRows] = useState<any[]>([]); const [loading, setLoading] = useState(true);
  const [estado, setEstado] = useState(""); const [q, setQ] = useState(""); const [sel, setSel] = useState<number | null>(null);
  const load = useCallback(() => { setLoading(true); const p = new URLSearchParams(); if (estado) p.set("estado", estado); if (q.trim()) p.set("q", q.trim()); fetch("/api/pedidos-proveedor?" + p).then((r) => r.json()).then((d) => { setRows(d.ok ? d.pedidos : []); setLoading(false); }); }, [estado, q]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  const totUSD = rows.reduce((a, r) => a + Number(r.total_costo_usd || 0), 0);
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-2 text-sm">
        <button onClick={load} className="text-febo-azul hover:underline text-xs">🔄 Recargar</button>
        <select value={estado} onChange={(e) => setEstado(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1 text-sm">
          <option value="">Todos los estados</option>
          {Object.keys(EST).map((k) => <option key={k} value={k}>{EST[k][0]}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ref, proveedor, GSA…" className="border border-gray-300 rounded-lg px-3 py-1 text-sm flex-1" />
        <span className="text-xs text-gray-500 whitespace-nowrap">{rows.length} pedidos · {fUSD(totUSD)}</span>
      </div>
      <div className="flex-1 overflow-auto border border-gray-200 rounded-xl bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0"><tr>
            <th className="text-left px-3 py-2">ID / GSA</th><th className="text-left px-3 py-2">Fecha</th><th className="text-left px-3 py-2">Proveedor</th>
            <th className="text-left px-3 py-2">Ref FV</th><th className="text-center px-3 py-2">Ítems</th><th className="text-right px-3 py-2">Total</th>
            <th className="text-left px-3 py-2">Email</th><th className="text-center px-3 py-2">Estado</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={8} className="text-center py-8 text-gray-400">Cargando…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={8} className="text-center py-8 text-gray-400">Sin pedidos a proveedor</td></tr>
            : rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 hover:bg-blue-50 cursor-pointer" onClick={() => setSel(r.id)}>
                <td className="px-3 py-1.5 font-semibold">#{r.id}{r.gsa_numero ? <span className="ml-1 text-[10px] bg-violet-100 text-violet-700 rounded px-1.5 py-0.5">GSA {r.gsa_numero}</span> : null}</td>
                <td className="px-3 py-1.5 text-gray-500">{fmtF(r.created_at)}</td>
                <td className="px-3 py-1.5 font-semibold">{r.proveedor}</td>
                <td className="px-3 py-1.5 text-gray-600">{r.fv_numero || "—"}</td>
                <td className="px-3 py-1.5 text-center">{(r.items || []).length}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fUSD(r.total_costo_usd)}</td>
                <td className="px-3 py-1.5 text-gray-500 text-xs">{r.email_destinatario || "—"}</td>
                <td className="px-3 py-1.5 text-center">{chip(r.estado)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sel != null && <PedidoModal id={sel} onClose={() => setSel(null)} onChanged={load} />}
    </div>
  );
}

const PASOS = ["pendiente", "confirmado", "pagado", "recibido_ok"];
function PedidoModal({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const [p, setP] = useState<any>(null); const [busy, setBusy] = useState(false);
  const [recep, setRecep] = useState<any[] | null>(null); const [remito, setRemito] = useState(""); const [notas, setNotas] = useState("");
  const load = useCallback(() => fetch("/api/pedidos-proveedor?id=" + id).then((r) => r.json()).then((d) => { if (d.ok) setP(d.pedido); }), [id]);
  useEffect(() => { load(); }, [load]);
  if (!p) return null;
  const items = p.items || [];
  const accion = async (body: any, msg?: string) => { if (msg && !confirm(msg)) return; setBusy(true); try { const r = await fetch("/api/pedidos-proveedor", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) }); const d = await r.json(); if (!d.ok) throw new Error(d.error); await load(); onChanged(); } catch (e: any) { alert("Error: " + e.message); } finally { setBusy(false); } };
  const toB64 = (f: File) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(f); });
  const subirPago = async (files: FileList | null) => { if (!files?.length) return; const f = files[0]; await accion({ accion: "pago", archivo: { nombre: f.name, tipo: f.type, b64: await toB64(f) } }); };
  const iniciarRecep = () => setRecep(items.map((it: any) => ({ codigo: it.codigo, descripcion: it.descripcion, costo_usd: it.costo_usd, cantidad: Number(it.cantidad) || 0, pedida: Number(it.cantidad) || 0 })));
  const guardarRecep = (conDif: boolean) => { accion({ accion: "recibir", items_recibidos: recep, numero_remito: remito, notas, con_diferencias: conDif }); setRecep(null); };

  return (
    <div className="fixed inset-0 z-[130] bg-black/50 flex items-stretch justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-[760px] h-full flex flex-col shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="bg-febo-azul text-white rounded-t-xl px-5 py-3 flex items-center justify-between">
          <div><div className="text-lg font-bold">Pedido #{p.id}{p.gsa_numero ? ` · GSA ${p.gsa_numero}` : ""}</div><div className="mt-0.5">{chip(p.estado)}</div></div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-xl">✕</button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {/* Avanzar estado */}
          <div>
            <div className="text-[11px] font-bold text-gray-400 uppercase mb-1">Avanzar estado</div>
            <div className="flex flex-wrap gap-1">
              {(["pendiente", "confirmado", "pagado", "recibido_ok", "recibido_diferencias"] as const).map((e) => (
                <button key={e} disabled={busy || p.estado === e} onClick={() => accion({ accion: "estado", estado: e }, `¿Marcar como ${EST[e][0]}?`)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${p.estado === e ? "bg-febo-azul text-white border-febo-azul" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>{EST[e][0]}</button>
              ))}
            </div>
          </div>

          {/* Datos */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <Cell l="Fecha" v={fmtF(p.created_at)} /><Cell l="Proveedor" v={p.proveedor} />
            <Cell l="Ref FV" v={p.fv_numero || "—"} /><Cell l="Origen" v={p.origen || "fv"} />
            <Cell l="Email destino" v={p.email_destinatario || "—"} /><Cell l="Total pedido" v={<b className="text-febo-azul">{fUSD(p.total_costo_usd)}</b>} />
            {p.numero_remito && <Cell l="Remito" v={p.numero_remito} />}
            {p.total_recibido_usd != null && <Cell l="Total recibido" v={fUSD(p.total_recibido_usd)} />}
          </div>

          {/* Ticket de pago */}
          <div className="border border-gray-200 rounded-lg p-3">
            <div className="text-[11px] font-bold text-gray-400 uppercase mb-1">💳 Ticket de pago al proveedor</div>
            {p.pagado_archivo ? <a href={`data:${p.pagado_archivo.tipo};base64,${p.pagado_archivo.b64}`} download={p.pagado_archivo.nombre} className="text-xs text-febo-azul underline">⬇ {p.pagado_archivo.nombre}</a> : null}
            <div className="flex items-center gap-2 mt-1"><input type="file" onChange={(e) => subirPago(e.target.files)} className="text-xs" /><span className="text-[11px] text-gray-400">se marca como Pagado al subir</span></div>
          </div>

          {/* Items */}
          <div>
            <div className="text-[11px] font-bold text-gray-400 uppercase mb-1">Detalle</div>
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase text-gray-400"><tr><th className="text-left px-2 py-1">Código</th><th className="text-left px-2 py-1">Descripción</th><th className="text-center px-2 py-1">Cant</th><th className="text-right px-2 py-1">Costo</th><th className="text-right px-2 py-1">Subtotal</th></tr></thead>
              <tbody>
                {items.map((it: any, i: number) => (
                  <tr key={i} className="border-t border-gray-100"><td className="px-2 py-1 font-semibold text-febo-azul">{it.codigo}</td><td className="px-2 py-1 text-gray-600">{(it.descripcion || "").slice(0, 60)}</td><td className="px-2 py-1 text-center">{it.cantidad}</td><td className="px-2 py-1 text-right">{fUSD(it.costo_usd)}</td><td className="px-2 py-1 text-right font-semibold">{fUSD((Number(it.costo_usd) || 0) * (Number(it.cantidad) || 0))}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Recepción */}
          <div className="border border-gray-200 rounded-lg p-3">
            <div className="text-[11px] font-bold text-gray-400 uppercase mb-2">📦 Recepción de mercadería</div>
            {!recep ? <button onClick={iniciarRecep} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold">Registrar recepción</button>
            : <div className="space-y-2">
                {recep.map((it, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs"><span className="flex-1"><b className="text-febo-azul">{it.codigo}</b> · pedida {it.pedida}</span><span>recibida:</span><input type="number" value={it.cantidad} onChange={(e) => setRecep(recep.map((x, j) => j === i ? { ...x, cantidad: Number(e.target.value) || 0 } : x))} className="w-16 border border-gray-300 rounded px-1 text-center" /></div>
                ))}
                <div className="flex gap-2"><input value={remito} onChange={(e) => setRemito(e.target.value)} placeholder="N° remito" className="border border-gray-300 rounded px-2 py-1 text-xs w-32" /><input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="notas" className="border border-gray-300 rounded px-2 py-1 text-xs flex-1" /></div>
                <div className="flex gap-2"><button disabled={busy} onClick={() => guardarRecep(false)} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold">✔ Recibido OK</button><button disabled={busy} onClick={() => guardarRecep(true)} className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-xs font-semibold">⚠️ Recibido c/diferencias</button><button onClick={() => setRecep(null)} className="text-xs text-gray-400">cancelar</button></div>
              </div>}
          </div>
        </div>
      </div>
    </div>
  );
}
function Cell({ l, v }: { l: string; v: any }) { return <div><div className="text-[10px] uppercase text-gray-400">{l}</div><div className="text-gray-800">{v}</div></div>; }
