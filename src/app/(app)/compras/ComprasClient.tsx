"use client";
import { useEffect, useState, useCallback } from "react";
import PedidosProveedorPanel, { PedidoModal } from "./PedidosProveedorPanel";

// Pedido a proveedor — estilo cotizador, con COSTOS. Elegís proveedor, armás el pedido y queda
// PENDIENTE en pedidos_proveedores (NO se envía). El envío (Excel/GSA/email) se hace desde el
// detalle del pedido con "Enviar al proveedor". Historial = los mismos pedidos a proveedor.
const norm = (s: any) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const chip = (txt: string, col: string) => <span style={{ background: col + "22", color: col }} className="rounded px-2 py-0.5 text-[11px] font-semibold">{txt}</span>;
const EST: Record<string, [string, string]> = { pendiente: ["⏳ Pendiente", "#d97706"], enviado: ["📤 Enviado", "#2563eb"], confirmado: ["✅ Confirmado", "#0891b2"], pagado: ["💳 Pagado", "#7c3aed"], recibido_ok: ["✔ Recibido OK", "#16a34a"], recibido_diferencias: ["⚠ Recibido c/dif", "#ea580c"], anulado: ["✕ Anulado", "#e53935"] };

export default function ComprasClient() {
  const [vista, setVista] = useState<"nuevo" | "pedidos">("nuevo");
  const [q, setQ] = useState(""); const [cat, setCat] = useState(""); const [stockF, setStockF] = useState<"todos" | "stock" | "confirmar">("todos");
  const [data, setData] = useState<any>({ productos: [], categorias: [] });
  const [provs, setProvs] = useState<any[]>([]); const [owner, setOwner] = useState(false);
  const [prov, setProv] = useState<any | null>(null);
  const [provQ, setProvQ] = useState(""); const [provIdx, setProvIdx] = useState(0);
  const [filtroProvs, setFiltroProvs] = useState<string[]>([]);
  const [cart, setCart] = useState<any[]>([]);
  const [email, setEmail] = useState(""); const [mensaje, setMensaje] = useState("");
  const [ccSel, setCcSel] = useState<Record<string, boolean>>({}); const [ccExtra, setCcExtra] = useState("");  // CC eventual (off por defecto)
  const [busy, setBusy] = useState(false);
  const [pend, setPend] = useState<any[]>([]); const [det, setDet] = useState<number | null>(null);
  const [sel, setSel] = useState(0);

  const buscar = useCallback(() => {
    const p = new URLSearchParams({ limit: "200" });
    if (q.trim()) p.set("q", q.trim()); if (cat) p.set("categoria", cat);
    fetch("/api/productos?" + p.toString()).then((r) => r.json()).then((d) => { if (d.ok) setData(d); }).catch(() => {});
  }, [q, cat]);
  useEffect(() => { const t = setTimeout(buscar, 250); return () => clearTimeout(t); }, [buscar]);
  useEffect(() => { fetch("/api/proveedores").then((r) => r.json()).then((d) => { if (d.ok) setProvs(d.proveedores); }); fetch("/api/me").then((r) => r.json()).then((d) => setOwner(!!d.es_owner)); }, []);
  const loadPend = useCallback(() => { fetch("/api/pedidos-proveedor").then((r) => r.json()).then((d) => { if (d.ok) setPend((d.pedidos || []).slice(0, 30)); }).catch(() => {}); }, []);
  useEffect(() => { loadPend(); }, [loadPend]);

  const provDe = (p: any) => p.emisor || p.proveedor || "";
  const provsDisponibles = Array.from(new Set((data.productos || []).filter((p: any) => p.proveedor || p.emisor).map(provDe).filter(Boolean))).sort() as string[];
  const toggleFiltroProv = (name: string) => setFiltroProvs((s) => s.includes(name) ? s.filter((x) => x !== name) : [...s, name]);

  const productosFiltrados = (data.productos || [])
    .filter((p: any) => p.proveedor || p.emisor)
    .filter((p: any) => stockF === "todos" || (stockF === "stock" ? p.en_stock : p.a_confirmar))
    .filter((p: any) => filtroProvs.length === 0 || filtroProvs.includes(provDe(p)));
  useEffect(() => { setSel(0); }, [q, cat, stockF, data, filtroProvs]);

  const dispBadge = (p: any) => {
    if (p.en_stock) return chip("en stock", "#16a34a");
    const d = String(p.disponibilidad || "").trim();
    if (d && !/confirm|consult/i.test(d)) return chip(d, "#2563eb");
    return chip("a confirmar", "#d97706");
  };

  const onKeyNav = (e: React.KeyboardEvent) => {
    if (!productosFiltrados.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, productosFiltrados.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const p = productosFiltrados[sel]; if (p) add(p); }
  };
  const foco = (codigo: string) => setTimeout(() => { const el = document.getElementById("cmp-qty-" + codigo) as HTMLInputElement | null; if (el) { el.focus(); el.select(); } }, 30);
  const add = (p: any) => {
    if (cart.some((it) => it.codigo === p.codigo)) { foco(p.codigo); return; }
    setCart([...cart, { codigo: p.codigo, descripcion: p.descripcion, costo_usd: Number(p.costo_usd) || 0, proveedor: p.proveedor, emisor: p.emisor, cantidad: 1 }]);
    foco(p.codigo);
  };
  const setCant = (i: number, v: any) => setCart(cart.map((it, j) => j === i ? { ...it, cantidad: Number(v) || 0 } : it));
  const quitar = (i: number) => setCart(cart.filter((_, j) => j !== i));
  const total = cart.reduce((a, it) => a + (Number(it.costo_usd) || 0) * (Number(it.cantidad) || 0), 0);

  const elegirProv = (p: any) => { setProv(p); setEmail(p.cont_comercial_email || p.email || ""); setProvQ(""); setCcSel({}); setCcExtra(""); };
  // Copias disponibles del CRM (admin/logística/general), distintas del comercial. OFF por defecto.
  const ccDisp: string[] = prov ? Array.from(new Set([prov.cont_admin_email, prov.cont_logistica_email, prov.email].map((x: any) => String(x || "").trim()).filter((x: string) => /\S+@\S+\.\S+/.test(x) && x.toLowerCase() !== (email || "").toLowerCase()))) : [];
  const ccElegido = () => Array.from(new Set([...ccDisp.filter((e) => ccSel[e]), ...ccExtra.split(/[,;]/)].map((e) => e.trim()).filter((e) => /\S+@\S+\.\S+/.test(e))));
  const provFiltrados = provQ.trim().length >= 1
    ? provs.filter((p) => norm(p.razon_social + " " + p.nombre_fantasia + " " + (p.alias || "") + " " + (p.cuit || "")).includes(norm(provQ))).slice(0, 8)
    : [];
  useEffect(() => { setProvIdx(0); }, [provQ]);
  const onProvKey = (e: React.KeyboardEvent) => {
    if (!provFiltrados.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setProvIdx((s) => Math.min(s + 1, provFiltrados.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setProvIdx((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const p = provFiltrados[provIdx]; if (p) elegirProv(p); }
  };

  const cargar = async () => {
    if (!prov) { alert("Elegí el proveedor primero."); return; }
    if (!cart.length) { alert("Agregá al menos un producto."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/pedidos-proveedor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proveedor: prov.razon_social || prov.nombre_fantasia, items: cart, email_destinatario: email || prov.email || "", mensaje, cc: ccElegido(), origen: "compra" }) });
      const d = await r.json(); if (!d.ok) throw new Error(d.error);
      alert("✅ Pedido cargado como PENDIENTE. Abrilo en el historial y tocá “Enviar al proveedor” cuando quieras mandarlo.");
      setCart([]); setMensaje(""); loadPend();
    } catch (e: any) { alert("Error: " + e.message); } finally { setBusy(false); }
  };

  const card = "bg-white rounded-xl border border-gray-200";

  return (
    <div className="p-1">
      <div className="flex gap-1 text-sm mb-3">
        {([["nuevo", "🛒 Nuevo pedido"], ["pedidos", "📋 Pedidos a proveedores"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setVista(k)} className={`px-4 py-1.5 rounded-lg font-semibold ${vista === k ? "bg-febo-azul text-white" : "bg-gray-100 text-gray-600"}`}>{l}</button>
        ))}
      </div>

      {vista === "pedidos" ? <PedidosProveedorPanel /> : (
      <div className="flex gap-4 items-start">
        <div className="flex-1 min-w-0 space-y-4">
          {/* Buscar productos */}
          <div className={card + " p-4"}>
            <div className="font-bold text-febo-azul mb-3">🔍 Buscar productos</div>
            <div className="flex gap-2 mb-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyNav} placeholder="Código, descripción o fabricante… (↑↓ y Enter)" className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <select value={cat} onChange={(e) => setCat(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-2 text-sm">
                <option value="">Todas las categorías</option>
                {(data.categorias || []).map((c: any) => <option key={c.categoria} value={c.categoria}>{c.categoria} ({c.n})</option>)}
              </select>
            </div>
            <div className="flex gap-1 mb-2 text-xs items-center flex-wrap">
              {([["todos", "Todos"], ["stock", "✅ En stock"], ["confirmar", "🕓 A confirmar"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setStockF(k)} className={`px-3 py-1 rounded-lg font-semibold ${stockF === k ? "bg-febo-azul text-white" : "bg-gray-100 text-gray-600"}`}>{l}</button>
              ))}
            </div>
            <div className="flex gap-1 mb-2 text-xs items-center flex-wrap">
              <span className="text-[10px] uppercase text-gray-400 font-semibold mr-1">Proveedor:</span>
              <button onClick={() => setFiltroProvs([])} className={`px-2.5 py-1 rounded-full font-semibold ${filtroProvs.length === 0 ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-600"}`}>Todos</button>
              {provsDisponibles.map((name) => (
                <button key={name} onClick={() => toggleFiltroProv(name)} className={`px-2.5 py-1 rounded-full font-semibold ${filtroProvs.includes(name) ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-600"}`}>{name}</button>
              ))}
            </div>
            <div className="max-h-72 overflow-auto border border-gray-100 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0"><tr><th className="text-left px-3 py-2">Producto</th><th className="text-left px-3 py-2">Proveedor</th><th className="text-right px-3 py-2">Costo USD</th><th></th></tr></thead>
                <tbody>
                  {productosFiltrados.length === 0 ? <tr><td colSpan={4} className="text-center py-6 text-gray-400">{q || cat || filtroProvs.length ? "Sin resultados" : "Escribí para buscar productos"}</td></tr> :
                  productosFiltrados.slice(0, 60).map((p: any, i: number) => (
                    <tr key={p.id} onMouseEnter={() => setSel(i)} onClick={() => add(p)} className={`border-t border-gray-100 cursor-pointer ${i === sel ? "bg-blue-100" : "hover:bg-blue-50"}`}>
                      <td className="px-3 py-1.5"><div className="font-semibold text-febo-azul flex items-center gap-1 flex-wrap">{p.codigo} {dispBadge(p)}</div><div className="text-[11px] text-gray-500">{p.descripcion || ""}</div></td>
                      <td className="px-3 py-1.5 text-[11px] text-gray-600">{p.emisor || p.proveedor || "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{p.costo_usd ? Number(p.costo_usd).toFixed(2) : "—"}</td>
                      <td className="px-3 py-1.5 text-right"><span className="px-2 py-1 rounded bg-febo-azul text-white text-xs font-semibold">+ Agregar</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Ítems del pedido */}
          <div className={card + " p-4"}>
            <div className="font-bold text-febo-azul mb-3">📦 Ítems del pedido</div>
            {cart.length === 0 ? <div className="text-gray-400 text-sm text-center py-8">No hay ítems todavía.<br />Buscá productos arriba.</div> : (
              <table className="w-full text-sm">
                <thead className="text-gray-400 text-xs uppercase"><tr><th className="text-left py-1">Producto</th><th className="text-center py-1 w-16">Cant</th><th className="text-right py-1">Costo U.</th><th className="text-right py-1">Subtotal</th><th></th></tr></thead>
                <tbody>
                  {cart.map((it, i) => (
                    <tr key={it.codigo} className="border-t border-gray-100">
                      <td className="py-1.5"><div className="font-semibold text-febo-azul text-xs">{it.codigo} {(it.emisor || it.proveedor) && <span className="text-[10px] text-violet-600">· {it.emisor || it.proveedor}</span>}</div><div className="text-[11px] text-gray-500">{it.descripcion || ""}</div></td>
                      <td className="text-center"><input id={"cmp-qty-" + it.codigo} type="number" min={1} value={it.cantidad} onChange={(e) => setCant(i, e.target.value)} onFocus={(e) => e.target.select()} className="w-14 border border-gray-300 rounded px-1 py-0.5 text-center" /></td>
                      <td className="text-right tabular-nums">USD {Number(it.costo_usd).toFixed(2)}</td>
                      <td className="text-right tabular-nums font-semibold">USD {(Number(it.costo_usd) * Number(it.cantidad)).toFixed(2)}</td>
                      <td className="text-right"><button onClick={() => quitar(i)} className="text-red-400 hover:text-red-600">✕</button></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t-2 border-gray-200"><td colSpan={3} className="text-right py-2 font-bold text-febo-azul">TOTAL COSTO</td><td className="text-right py-2 font-bold text-febo-azul tabular-nums">USD {total.toFixed(2)}</td><td></td></tr></tfoot>
              </table>
            )}
          </div>

          {/* Pedidos recientes */}
          <div className={card}>
            <div className="px-4 py-2.5 border-b border-gray-200 font-bold text-febo-azul flex items-center justify-between">
              <span>📁 Pedidos recientes</span>
              <button onClick={loadPend} className="text-xs text-febo-azul hover:underline">🔄 Actualizar</button>
            </div>
            <div className="overflow-auto max-h-64">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0"><tr><th className="text-left px-3 py-2">Fecha</th><th className="text-left px-3 py-2">Proveedor</th><th className="text-left px-3 py-2">Ref</th><th className="text-right px-3 py-2">Costo USD</th><th className="text-center px-3 py-2">Estado</th><th></th></tr></thead>
                <tbody>
                  {pend.length === 0 ? <tr><td colSpan={6} className="text-center py-6 text-gray-400">Sin pedidos a proveedor</td></tr> :
                  pend.map((c) => { const e = EST[c.estado] || [c.estado, "#888"]; return (
                    <tr key={c.id} onClick={() => setDet(c.id)} className="border-t border-gray-100 cursor-pointer hover:bg-blue-50">
                      <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{c.created_at ? new Date(c.created_at).toLocaleDateString("es-AR") : "—"}</td>
                      <td className="px-3 py-1.5 font-semibold">{c.proveedor}{c.gsa_numero ? <span className="ml-1 text-[10px] bg-violet-100 text-violet-700 rounded px-1.5 py-0.5">GSA {c.gsa_numero}</span> : null}</td>
                      <td className="px-3 py-1.5 text-gray-500 text-xs">{c.fv_numero || "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{Number(c.total_costo_usd || 0).toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-center">{chip(e[0], e[1])}</td>
                      <td className="px-3 py-1.5 text-right text-febo-azul text-xs">abrir →</td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Proveedor del pedido */}
        <div className="w-[340px] shrink-0">
          <div className={card + " p-4 sticky top-2"}>
            <div className="font-bold text-febo-azul mb-3">🏭 Proveedor del pedido</div>
            {prov ? (
              <div className="border border-emerald-200 bg-emerald-50 rounded-lg p-3">
                <div className="font-semibold text-sm">{prov.razon_social || prov.nombre_fantasia}</div>
                {prov.cuit && <div className="text-xs text-gray-500 font-mono">{prov.cuit}</div>}
                <button onClick={() => { setProv(null); setEmail(""); }} className="text-xs text-febo-azul hover:underline mt-1">cambiar proveedor</button>
              </div>
            ) : (
              <div className="relative">
                <input value={provQ} onChange={(e) => setProvQ(e.target.value)} onKeyDown={onProvKey} autoFocus placeholder="Elegí el proveedor (nombre/CUIT)… ↑↓ y Enter" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                {provFiltrados.length > 0 && <div className="absolute z-10 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-auto mt-1">
                  {provFiltrados.map((p, i) => <button key={p.id} onClick={() => elegirProv(p)} onMouseEnter={() => setProvIdx(i)} className={`block w-full text-left px-3 py-1.5 text-sm border-b border-gray-50 ${i === provIdx ? "bg-blue-100" : "hover:bg-blue-50"}`}><b className="text-febo-azul">{p.razon_social || p.nombre_fantasia}</b>{p.cuit ? <span className="text-gray-400 text-xs ml-1">{p.cuit}</span> : null}</button>)}
                </div>}
                <div className="text-[11px] text-gray-400 mt-1">Elegí el proveedor para filtrar sus productos.</div>
              </div>
            )}

            <div className="mt-4 space-y-2">
              <div><label className="block text-[10px] uppercase text-gray-400 font-semibold mb-0.5">Email del proveedor (comercial)</label><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="proveedor@email.com" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" /></div>
              <div>
                <label className="block text-[10px] uppercase text-gray-400 font-semibold mb-0.5">Copias (CC) — opcional · NO va salvo que tildes</label>
                <div className="flex flex-col gap-1">
                  {ccDisp.map((e) => (<label key={e} className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={!!ccSel[e]} onChange={(ev) => setCcSel((s) => ({ ...s, [e]: ev.target.checked }))} /> {e}</label>))}
                  {prov && !ccDisp.length && <span className="text-[11px] text-gray-400">Sin contactos de copia en el CRM del proveedor.</span>}
                </div>
                <input value={ccExtra} onChange={(e) => setCcExtra(e.target.value)} placeholder="Otra copia (email, separá con coma)…" className="w-full border border-gray-300 rounded-lg px-3 py-1 text-xs mt-1" />
              </div>
              <div><label className="block text-[10px] uppercase text-gray-400 font-semibold mb-0.5">Mensaje (opcional · sale al principio del email)</label><textarea value={mensaje} onChange={(e) => setMensaje(e.target.value)} rows={10} placeholder="Mensaje para el proveedor…" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm resize-y" /></div>
            </div>

            <button disabled={busy || !cart.length || !prov} onClick={cargar} className="w-full mt-4 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50">{busy ? "Guardando…" : "📝 Cargar pedido (queda pendiente)"}</button>
            <div className="text-[11px] text-gray-400 mt-2 text-center">Queda pendiente. El envío al proveedor (Excel/GSA/email) se hace desde el detalle del pedido.</div>
          </div>
        </div>
      </div>
      )}
      {det != null && <PedidoModal id={det} onClose={() => setDet(null)} onChanged={loadPend} />}
    </div>
  );
}
