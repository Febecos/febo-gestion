"use client";
import { useEffect, useState, useCallback } from "react";

// Bandeja de PEDIDOS ONLINE (catálogo público: MercadoPago / Transferencia / NAVE).
// Lee /api/pedidos-online. "Confirmar" (manual) registra el cliente en CRM y crea el
// pedido en gestión (PED-####), enganchándolo a la cadena de Ventas. v1: ingreso + cliente.

const MET: Record<string, [string, string]> = {
  mercadopago: ["💳 MercadoPago", "#009ee3"],
  transferencia: ["🏦 Transferencia", "#d4870a"],
  nave: ["📅 NAVE", "#1a6b3c"],
};
const EST: Record<string, [string, string]> = {
  pendiente_aprobacion: ["⏳ Pendiente", "#d97706"],
  aprobado: ["✅ Aprobado", "#2563eb"],
  pagado: ["💰 Pagado", "#16a34a"],
  revisar_pago: ["⚠️ Revisar pago", "#dc2626"],
};
const fARS = (n: any) => "$ " + Math.round(Number(n) || 0).toLocaleString("es-AR");
const fF = (v: any) => v ? new Date(v).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const chip = (map: Record<string, [string, string]>, k: string) => {
  const [l, c] = map[k] || [k || "—", "#888"];
  return <span style={{ background: c + "22", color: c }} className="rounded px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap">{l}</span>;
};

export default function PedidosOnlineClient() {
  const [rows, setRows] = useState<any[]>([]); const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null); const [toast, setToast] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/pedidos-online").then((r) => r.json()).then((d) => { setRows(d.ok ? d.pedidos : []); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const confirmar = async (p: any) => {
    if (!confirm(`Confirmar el pedido online #${p.id} de ${p.cliente_nombre || "—"}?\n\nSe registra el cliente en el CRM y se crea el pedido en Gestión para seguir la operación. (No manda email.)`)) return;
    setBusy(p.id);
    const r = await fetch("/api/pedidos-online", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id, accion: "confirmar" }) });
    const d = await r.json(); setBusy(null);
    if (d.ok) { setToast(`✅ Pedido ${d.pedido_numero} creado en Gestión`); setTimeout(() => setToast(""), 4000); load(); }
    else { alert("⚠️ " + (d.error || "No se pudo confirmar")); }
  };
  const ignorar = async (p: any) => {
    if (!confirm(`Ocultar el pedido online #${p.id} de la bandeja? (No crea nada en Gestión.)`)) return;
    setBusy(p.id);
    await fetch("/api/pedidos-online", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id, accion: "ignorar" }) });
    setBusy(null); load();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-2 text-sm">
        <span className="font-bold text-febo-azul">🛒 Pedidos online</span>
        <button onClick={load} className="text-febo-azul hover:underline text-xs">🔄 Recargar</button>
        <span className="text-xs text-gray-500 ml-auto">{rows.length} sin tomar</span>
      </div>
      {toast && <div className="mb-2 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm px-3 py-2">{toast}</div>}
      <div className="flex-1 overflow-auto border border-gray-200 rounded-xl bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0"><tr>
            <th className="text-left px-3 py-2">#</th><th className="text-left px-3 py-2">Fecha</th>
            <th className="text-left px-3 py-2">Cliente</th><th className="text-left px-3 py-2">Producto</th>
            <th className="text-right px-3 py-2">Monto</th><th className="text-center px-3 py-2">Pago</th>
            <th className="text-center px-3 py-2">Estado</th><th className="text-center px-3 py-2">Acción</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={8} className="text-center py-8 text-gray-400">Cargando…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={8} className="text-center py-8 text-gray-400">No hay pedidos online sin tomar 🎉</td></tr>
            : rows.map((p) => (
              <tr key={p.id} className="border-t border-gray-100 hover:bg-blue-50/40">
                <td className="px-3 py-1.5 font-semibold font-mono text-xs" title={String(p.id)}>#{String(p.id).slice(0, 8)}</td>
                <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{fF(p.created_at)}</td>
                <td className="px-3 py-1.5">
                  <div className="font-semibold">{p.cliente_nombre || "—"}</div>
                  <div className="text-[11px] text-gray-500">{p.cliente_email || ""}{p.whatsapp ? ` · ${p.whatsapp}` : ""}</div>
                </td>
                <td className="px-3 py-1.5">
                  <div style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }} title={p.bomba_descripcion || p.bomba_codigo}>{p.bomba_descripcion || p.bomba_codigo || "—"}</div>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fARS(p.precio_final)}</td>
                <td className="px-3 py-1.5 text-center">{chip(MET, p.metodo_pago)}</td>
                <td className="px-3 py-1.5 text-center">{chip(EST, p.estado)}</td>
                <td className="px-3 py-1.5 text-center whitespace-nowrap">
                  <button disabled={busy === p.id} onClick={() => confirmar(p)} title="Registra el cliente en el CRM y crea el pedido en Gestión (PED-####) para seguir la operación. No manda email." className="bg-febo-azul disabled:opacity-40 text-white rounded-lg px-2.5 py-1 text-xs font-semibold hover:bg-febo-azul/90">{busy === p.id ? "…" : "Confirmar"}</button>
                  <button disabled={busy === p.id} onClick={() => ignorar(p)} title="Oculta este pedido de la bandeja sin crear nada en Gestión." className="ml-1 text-gray-400 hover:text-gray-700 text-xs">ocultar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[11px] text-gray-400">El cobro de MercadoPago/NAVE se confirma solo (webhook). La transferencia la confirma una persona. Próximo (v2): conciliar pago, facturar y despachar desde acá.</div>
    </div>
  );
}
