"use client";
import { useEffect, useState, useCallback } from "react";
import { useWindows } from "../WindowManager";

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
  const [detalle, setDetalle] = useState<any | null>(null);

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
    if (d.ok) { setToast(`✅ Pedido ${d.pedido_numero} creado en Gestión`); setTimeout(() => setToast(""), 4000); load(); return d; }
    else { alert("⚠️ " + (d.error || "No se pudo confirmar")); return d; }
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
              <tr key={p.id} className="border-t border-gray-100 hover:bg-blue-50/40 cursor-pointer" onClick={() => setDetalle(p)}>
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
                <td className="px-3 py-1.5 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  <button disabled={busy === p.id} onClick={() => confirmar(p)} title="Registra el cliente en el CRM y crea el pedido en Gestión (PED-####) para seguir la operación. No manda email." className="bg-febo-azul disabled:opacity-40 text-white rounded-lg px-2.5 py-1 text-xs font-semibold hover:bg-febo-azul/90">{busy === p.id ? "…" : "Confirmar"}</button>
                  <button disabled={busy === p.id} onClick={() => ignorar(p)} title="Oculta este pedido de la bandeja sin crear nada en Gestión." className="ml-1 text-gray-400 hover:text-gray-700 text-xs">ocultar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[11px] text-gray-400">El cobro de MercadoPago/NAVE se confirma solo (webhook). La transferencia la confirma una persona. Tocá una fila para ver el detalle completo antes de confirmar.</div>
      {detalle && <DetalleModal p={detalle} onClose={() => setDetalle(null)} confirmar={confirmar} ignorar={ignorar} busy={busy} />}
    </div>
  );
}

// ---------- MODAL DE DETALLE (ver todo antes de confirmar → facturar) ----------
function DetalleModal({ p, onClose, confirmar, ignorar, busy }: { p: any; onClose: () => void; confirmar: (p: any) => Promise<any>; ignorar: (p: any) => void; busy: number | null }) {
  const { open } = useWindows();
  const [full, setFull] = useState<any | null>(null);
  const [cliente, setCliente] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [pedidoCreado, setPedidoCreado] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/pedidos-online?id=${encodeURIComponent(p.id)}`).then((r) => r.json())
      .then((d) => { if (d.ok) { setFull(d.pedido); setCliente(d.cliente); } setLoading(false); })
      .catch(() => setLoading(false));
  }, [p.id]);

  const row = full || p;
  const publico = Number(row.precio_publico) || Number(row.precio_original) || null;
  const final = Number(row.precio_final) || 0;
  const descArs = Number(row.descuento_ars) || (publico ? publico - final : null);

  const onConfirmar = async () => {
    const d = await confirmar(p);
    if (d?.ok) setPedidoCreado(d.pedido_numero);
  };

  return (
    <div className="fixed inset-0 z-[150] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-[640px] max-h-[88vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="bg-febo-azul text-white rounded-t-xl px-5 py-3 flex items-center justify-between shrink-0">
          <div className="font-bold">🛒 Pedido online #{String(p.id).slice(0, 8)}</div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-xl leading-none">✕</button>
        </div>
        <div className="flex-1 overflow-auto p-5 space-y-4 text-sm">
          {loading ? <div className="text-gray-400 text-center py-8">Cargando…</div> : (
          <>
            <div>
              <div className="text-[11px] uppercase text-gray-400 font-semibold mb-1">Cliente</div>
              <div className="font-semibold">{row.cliente_nombre || row.revendedor_nombre || "—"}</div>
              <div className="text-gray-600 text-xs">{row.cliente_email || row.revendedor_email || "—"}{row.whatsapp ? ` · ${row.whatsapp}` : ""}</div>
              {cliente ? (
                <div className="mt-1 text-xs text-gray-600 bg-gray-50 rounded px-2 py-1.5 space-y-0.5">
                  <div className="text-emerald-700 font-semibold text-[11px]">✓ Ya existe en el CRM (cliente #{cliente.id})</div>
                  {cliente.cuit && <div>CUIT/DNI: {cliente.cuit}</div>}
                  {cliente.condicion_fiscal && <div>Condición fiscal: {cliente.condicion_fiscal}</div>}
                  {(cliente.domicilio || cliente.localidad || cliente.provincia) && <div>{[cliente.domicilio, cliente.localidad, cliente.provincia].filter(Boolean).join(", ")}</div>}
                </div>
              ) : (
                <div className="mt-1 text-xs text-gray-400">Sin match en el CRM todavía — se crea al Confirmar. No hay CUIT/domicilio en el checkout online; se completa después en la ficha del cliente.</div>
              )}
            </div>
            <div>
              <div className="text-[11px] uppercase text-gray-400 font-semibold mb-1">Producto</div>
              <div>{row.bomba_descripcion || row.bomba_codigo || "—"}</div>
              {row.bomba_codigo && row.bomba_descripcion && <div className="text-xs text-gray-500">Código: {row.bomba_codigo}</div>}
              <div className="text-xs text-gray-500">Cantidad: 1</div>
            </div>
            <div>
              <div className="text-[11px] uppercase text-gray-400 font-semibold mb-1">Montos</div>
              <div className="space-y-0.5">
                {publico != null && publico !== final && <div className="flex justify-between text-gray-500"><span>Precio lista</span><span>{fARS(publico)}</span></div>}
                {row.cupon_codigo && <div className="flex justify-between text-gray-500"><span>Cupón {row.cupon_codigo}{row.descuento_pct ? ` (${row.descuento_pct}%)` : ""}</span><span>− {fARS(descArs)}</span></div>}
                {!row.cupon_codigo && descArs ? <div className="flex justify-between text-gray-500"><span>Descuento{row.descuento_pct ? ` (${row.descuento_pct}%)` : ""}</span><span>− {fARS(descArs)}</span></div> : null}
                <div className="flex justify-between font-bold text-base pt-1 border-t border-gray-100"><span>Total</span><span>{fARS(final)}</span></div>
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase text-gray-400 font-semibold mb-1">Pago</div>
              <div className="flex items-center gap-2">{chip(MET, row.metodo_pago)}{chip(EST, row.estado)}</div>
              {row.mp_payment_id && <div className="text-xs text-gray-500 mt-1">N° operación MP: {row.mp_payment_id}</div>}
              {row.mp_checkout_url && <a href={row.mp_checkout_url} target="_blank" rel="noreferrer" className="text-xs text-febo-azul hover:underline">Ver checkout →</a>}
            </div>
            <div>
              <div className="text-[11px] uppercase text-gray-400 font-semibold mb-1">Fecha</div>
              <div>{fF(row.created_at)}</div>
            </div>
          </>
          )}
        </div>
        <div className="border-t border-gray-100 px-5 py-3 flex items-center gap-2 shrink-0">
          {pedidoCreado ? (
            <>
              <div className="text-emerald-700 text-sm font-semibold flex-1">✅ Pedido {pedidoCreado} creado en Gestión</div>
              <button onClick={() => { open("ventas", { abrirRef: pedidoCreado }); onClose(); }} className="bg-emerald-600 text-white rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-emerald-700">Ir a Facturar →</button>
            </>
          ) : (
            <>
              <button disabled={busy === p.id} onClick={onConfirmar} className="bg-febo-azul disabled:opacity-40 text-white rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-febo-azul/90">{busy === p.id ? "…" : "Confirmar"}</button>
              <button disabled={busy === p.id} onClick={() => { ignorar(p); onClose(); }} className="text-gray-400 hover:text-gray-700 text-xs">ocultar</button>
              <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-700 text-xs">Cerrar</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
