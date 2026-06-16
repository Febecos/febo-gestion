"use client";
import { useEffect, useState, useCallback } from "react";

// Pantalla unificada de Pedido a proveedor / Compra.
// Vendedor CARGA (queda pendiente). Solo el OWNER confirma y envía al proveedor.
const norm = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const chip = (txt: string, col: string) => <span style={{ background: col + "22", color: col }} className="rounded px-2 py-0.5 text-[11px] font-semibold">{txt}</span>;
const EST: Record<string, [string, string]> = { pendiente: ["⏳ Pendiente", "#d97706"], enviado: ["📤 Enviado", "#2563eb"], recibido: ["✔ Recibido", "#16a34a"], anulado: ["✕ Anulado", "#e53935"] };

export default function ComprasClient() {
  const [q, setQ] = useState(""); const [cat, setCat] = useState(""); const [stockF, setStockF] = useState<"todos" | "stock" | "confirmar">("todos");
  const [data, setData] = useState<any>({ productos: [], categorias: [] });
  const [provs, setProvs] = useState<any[]>([]); const [owner, setOwner] = useState(false);
  const [cart, setCart] = useState<any[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({}); const [msgs, setMsgs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pend, setPend] = useState<any[]>([]); const [editId, setEditId] = useState<number | null>(null);

  const buscar = useCallback(() => {
    const p = new URLSearchParams({ limit: "200" });
    if (q.trim()) p.set("q", q.trim()); if (cat) p.set("categoria", cat);
    fetch("/api/productos?" + p.toString()).then((r) => r.json()).then((d) => { if (d.ok) setData(d); }).catch(() => {});
  }, [q, cat]);
  useEffect(() => { const t = setTimeout(buscar, 250); return () => clearTimeout(t); }, [buscar]);
  useEffect(() => { fetch("/api/proveedores").then((r) => r.json()).then((d) => { if (d.ok) setProvs(d.proveedores); }); fetch("/api/me").then((r) => r.json()).then((d) => setOwner(!!d.es_owner)); }, []);
  const loadPend = useCallback(() => { fetch("/api/compras").then((r) => r.json()).then((d) => { if (d.ok) setPend(d.compras); }).catch(() => {}); }, []);
  useEffect(() => { loadPend(); }, [loadPend]);

  const productosFiltrados = (data.productos || []).filter((p: any) => stockF === "todos" || (stockF === "stock" ? p.en_stock : p.a_confirmar));
  const add = (p: any) => { const k = (p.emisor || p.proveedor); if (cart.some((it) => it.codigo === p.codigo && (it.emisor || it.proveedor) === k)) return; setCart([...cart, { codigo: p.codigo, descripcion: p.descripcion, costo_usd: p.costo_usd || 0, proveedor: p.proveedor, emisor: p.emisor, cantidad: 1 }]); };
  const setCant = (i: number, v: any) => setCart(cart.map((it, j) => j === i ? { ...it, cantidad: Number(v) || 0 } : it));
  const quitar = (i: number) => setCart(cart.filter((_, j) => j !== i));

  const grupos: Record<string, any[]> = {};
  cart.forEach((it) => { const k = it.emisor || it.proveedor || "Sin proveedor"; (grupos[k] = grupos[k] || []).push(it); });
  const matchProv = (nombre: string) => provs.find((p) => { const nn = norm(nombre); const rs = norm(p.razon_social), nf = norm(p.nombre_fantasia); const al = String(p.alias || "").split(/[,;|]/).map(norm); return rs === nn || nf === nn || al.includes(nn) || (nn.length >= 4 && (rs.includes(nn) || nf.includes(nn))); });

  const cargar = async () => {
    if (!cart.length) return; setBusy(true);
    try {
      if (editId) {
        const nombre = Object.keys(grupos)[0];
        await fetch("/api/compras", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editId, accion: "editar", items: cart, email: emails[nombre] || "", mensaje: msgs[nombre] || "" }) });
        alert("✅ Pedido actualizado (sigue pendiente).");
      } else {
        for (const [nombre, its] of Object.entries(grupos)) {
          const prov = matchProv(nombre);
          await fetch("/api/compras", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proveedor_id: prov?.id || null, proveedor_nombre: prov?.razon_social || nombre, email: emails[nombre] || prov?.email || "", mensaje: msgs[nombre] || "", items: its }) });
        }
        alert("✅ Pedido(s) cargado(s) como PENDIENTE. El administrador los confirma y envía al proveedor.");
      }
      setCart([]); setEmails({}); setMsgs({}); setEditId(null); loadPend();
    } catch (e: any) { alert("Error: " + e.message); } finally { setBusy(false); }
  };
  const editar = (c: any) => {
    if (cart.length && !editId) { alert("Terminá o vaciá el pedido actual antes de editar otro."); return; }
    setCart((c.items || []).map((it: any) => ({ ...it })));
    const k = (c.items?.[0]?.emisor || c.items?.[0]?.proveedor || c.proveedor_nombre);
    setEmails({ [k]: c.email_destinatario || "" }); setMsgs({ [k]: c.mensaje || "" });
    setEditId(c.id);
  };
  const anular = async (c: any) => {
    const email = c.estado === "enviado" ? (prompt("Email para el aviso de ANULACIÓN al proveedor:", c.email_destinatario || "") || c.email_destinatario) : null;
    if (!confirm("¿Anular este pedido?" + (c.estado === "enviado" ? " Se enviará un aviso de anulación al proveedor." : ""))) return;
    const r = await fetch("/api/compras", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, accion: "anular", email }) });
    const d = await r.json(); if (d.ok) { if (d.aviso) alert(d.aviso.ok ? "Anulado. Aviso enviado al proveedor." : "Anulado, pero el aviso falló: " + (d.aviso.error || "")); loadPend(); } else alert("Error: " + d.error);
  };
  const confirmar = async (id: number) => {
    if (!confirm("¿Confirmar y ENVIAR este pedido al proveedor?")) return;
    const r = await fetch("/api/compras", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, accion: "confirmar" }) });
    const d = await r.json(); if (d.ok) { alert(d.envio?.sin_email ? "Confirmado (sin email)." : d.envio?.ok ? "✅ Enviado al proveedor." : "Confirmado, email falló: " + (d.envio?.error || "")); loadPend(); } else alert("Error: " + d.error);
  };
  const recibir = async (id: number) => { if (!confirm("¿Marcar RECIBIDO? Suma al stock.")) return; const r = await fetch("/api/compras", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, accion: "recibir" }) }); const d = await r.json(); if (d.ok) loadPend(); else alert("Error: " + d.error); };

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Buscador */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex gap-2 mb-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código, descripción o fabricante…" className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <select value={cat} onChange={(e) => setCat(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-2 text-sm">
              <option value="">Todas las categorías</option>
              {(data.categorias || []).map((c: any) => <option key={c.categoria} value={c.categoria}>{c.categoria} ({c.n})</option>)}
            </select>
          </div>
          <div className="flex gap-1 mb-2 text-xs">
            {([["todos", "Todos"], ["stock", "✅ En stock"], ["confirmar", "🕓 A confirmar"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setStockF(k)} className={`px-3 py-1 rounded-lg font-semibold ${stockF === k ? "bg-febo-azul text-white" : "bg-gray-100 text-gray-600"}`}>{l}</button>
            ))}
          </div>
          <div className="flex-1 overflow-auto border border-gray-200 rounded-xl bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0"><tr><th className="text-left px-3 py-2">Producto</th><th className="text-left px-3 py-2">Emisor</th><th className="text-right px-3 py-2">Costo USD</th><th></th></tr></thead>
              <tbody>
                {productosFiltrados.length === 0 ? <tr><td colSpan={4} className="text-center py-8 text-gray-400">Buscá productos arriba</td></tr> :
                productosFiltrados.map((p: any) => (
                  <tr key={p.id} className="border-t border-gray-100 hover:bg-blue-50">
                    <td className="px-3 py-1.5"><div className="font-semibold text-febo-azul">{p.codigo} {p.en_stock ? chip("en stock", "#16a34a") : chip("a confirmar", "#d97706")}</div><div className="text-[11px] text-gray-500">{(p.descripcion || "").slice(0, 70)}</div></td>
                    <td className="px-3 py-1.5 text-xs text-gray-600">{p.emisor || p.proveedor || "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{p.costo_usd ? Number(p.costo_usd).toFixed(2) : "—"}</td>
                    <td className="px-3 py-1.5 text-right"><button onClick={() => add(p)} className="px-2 py-1 rounded bg-febo-azul text-white text-xs font-semibold">+ Agregar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Carrito */}
        <div className="w-[420px] shrink-0 flex flex-col border border-gray-200 rounded-xl bg-white">
          <div className="px-3 py-2 border-b border-gray-200 font-semibold text-febo-azul flex items-center justify-between">{editId ? <span>✏️ Editando pedido #{editId}</span> : <span>🛒 Nuevo pedido ({cart.length})</span>}{editId && <button onClick={() => { setCart([]); setEmails({}); setMsgs({}); setEditId(null); }} className="text-xs text-gray-400 hover:underline">cancelar edición</button>}</div>
          <div className="flex-1 overflow-auto p-2 space-y-3">
            {cart.length === 0 ? <div className="text-gray-400 text-sm text-center py-8">Agregá productos. Se arma un pedido por proveedor.</div> :
            Object.entries(grupos).map(([nombre, its]) => {
              const prov = matchProv(nombre);
              const tot = its.reduce((a, it) => a + (Number(it.costo_usd) || 0) * (Number(it.cantidad) || 0), 0);
              return (
                <div key={nombre} className="border border-gray-200 rounded-lg p-2">
                  <div className="flex items-center justify-between mb-1"><span className="font-semibold text-sm">{chip(nombre, "#7c3aed")}{!prov && <span className="text-[10px] text-amber-600 ml-1">sin ficha</span>}</span><span className="text-xs text-gray-500">USD {tot.toFixed(2)}</span></div>
                  {its.map((it) => { const idx = cart.indexOf(it); return (
                    <div key={it.codigo} className="flex items-center gap-1 text-xs py-0.5"><span className="flex-1"><b className="text-febo-azul">{it.codigo}</b></span><input type="number" value={it.cantidad} onChange={(e) => setCant(idx, e.target.value)} className="w-12 border border-gray-300 rounded px-1 text-center" /><button onClick={() => quitar(idx)} className="text-red-400 hover:text-red-600">✕</button></div>
                  ); })}
                  <input value={emails[nombre] ?? (prov?.email || "")} onChange={(e) => setEmails({ ...emails, [nombre]: e.target.value })} placeholder="email del proveedor" className="w-full border border-gray-300 rounded px-2 py-1 text-xs mt-1" />
                  <input value={msgs[nombre] || ""} onChange={(e) => setMsgs({ ...msgs, [nombre]: e.target.value })} placeholder="mensaje (opcional)" className="w-full border border-gray-300 rounded px-2 py-1 text-xs mt-1" />
                </div>
              );
            })}
          </div>
          <div className="p-2 border-t border-gray-200">
            <button disabled={busy || !cart.length} onClick={cargar} className="w-full px-4 py-2 rounded-lg bg-febo-azul text-white text-sm font-semibold disabled:opacity-50">{busy ? "Guardando…" : editId ? "💾 Guardar cambios" : `📝 Cargar pedido (${Object.keys(grupos).length} prov.) — queda pendiente`}</button>
          </div>
        </div>
      </div>

      {/* Pendientes / historial */}
      <div className="border border-gray-200 rounded-xl bg-white" style={{ maxHeight: "38%" }}>
        <div className="px-3 py-2 border-b border-gray-200 font-semibold text-febo-azul flex items-center justify-between">
          <span>Pedidos a proveedor {owner ? "" : "· (el envío lo confirma el administrador)"}</span>
          <button onClick={loadPend} className="text-xs text-febo-azul hover:underline">🔄 Actualizar</button>
        </div>
        <div className="overflow-auto" style={{ maxHeight: "calc(38vh - 40px)" }}>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0"><tr><th className="text-left px-3 py-2">Fecha</th><th className="text-left px-3 py-2">Proveedor</th><th className="text-left px-3 py-2">Ítems</th><th className="text-right px-3 py-2">Costo USD</th><th className="text-left px-3 py-2">Generó</th><th className="text-center px-3 py-2">Estado</th><th></th></tr></thead>
            <tbody>
              {pend.length === 0 ? <tr><td colSpan={7} className="text-center py-6 text-gray-400">Sin pedidos a proveedor</td></tr> :
              pend.map((c) => { const e = EST[c.estado] || [c.estado, "#888"]; return (
                <tr key={c.id} className="border-t border-gray-100">
                  <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{c.created_at ? new Date(c.created_at).toLocaleDateString("es-AR") : "—"}</td>
                  <td className="px-3 py-1.5 font-semibold">{c.proveedor_nombre}</td>
                  <td className="px-3 py-1.5 text-gray-600">{(c.items || []).length} ítem(s){c.gsa_numero ? ` · GSA ${c.gsa_numero}` : ""}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{Number(c.total_costo_usd || 0).toFixed(2)}</td>
                  <td className="px-3 py-1.5 text-gray-600 text-xs">{c.creado_por || "—"}</td>
                  <td className="px-3 py-1.5 text-center">{chip(e[0], e[1])}</td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">
                    {c.estado === "pendiente" && <button onClick={() => editar(c)} className="px-2 py-1 rounded border border-gray-300 text-gray-600 text-xs font-semibold mr-1">✏️ Editar</button>}
                    {c.estado === "pendiente" && owner && <button onClick={() => confirmar(c.id)} className="px-2 py-1 rounded bg-emerald-600 text-white text-xs font-semibold mr-1">✅ Confirmar y enviar</button>}
                    {c.estado === "pendiente" && !owner && <span className="text-[11px] text-amber-600 mr-1">esperando confirmación</span>}
                    {c.estado === "enviado" && <button onClick={() => recibir(c.id)} className="px-2 py-1 rounded border border-febo-azul text-febo-azul text-xs font-semibold mr-1">📥 Recibir</button>}
                    {(c.estado === "pendiente" || c.estado === "enviado") && <button onClick={() => anular(c)} className="text-red-400 hover:text-red-600 text-xs">Anular</button>}
                  </td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
