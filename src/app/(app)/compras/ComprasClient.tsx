"use client";
import { useEffect, useState, useCallback } from "react";

// Pantalla unificada de Pedido a proveedor / Compra: buscador estilo presupuesto,
// agregás productos de varios proveedores y se genera UN pedido por proveedor (Excel + email).
const norm = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const chip = (txt: string, col: string) => <span style={{ background: col + "22", color: col }} className="rounded px-2 py-0.5 text-[11px] font-semibold">{txt}</span>;

export default function ComprasClient() {
  const [q, setQ] = useState(""); const [cat, setCat] = useState(""); const [stockF, setStockF] = useState<"todos" | "stock" | "confirmar">("todos");
  const [data, setData] = useState<any>({ productos: [], categorias: [] });
  const [provs, setProvs] = useState<any[]>([]);
  const [cart, setCart] = useState<any[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [msgs, setMsgs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false); const [result, setResult] = useState<string>("");

  const buscar = useCallback(() => {
    const p = new URLSearchParams({ limit: "200" });
    if (q.trim()) p.set("q", q.trim()); if (cat) p.set("categoria", cat);
    fetch("/api/productos?" + p.toString()).then((r) => r.json()).then((d) => { if (d.ok) setData(d); }).catch(() => {});
  }, [q, cat]);
  useEffect(() => { const t = setTimeout(buscar, 250); return () => clearTimeout(t); }, [buscar]);
  useEffect(() => { fetch("/api/proveedores").then((r) => r.json()).then((d) => { if (d.ok) setProvs(d.proveedores); }).catch(() => {}); }, []);

  const productosFiltrados = (data.productos || []).filter((p: any) => stockF === "todos" || (stockF === "stock" ? p.en_stock : p.a_confirmar));
  const add = (p: any) => { if (cart.some((it) => it.codigo === p.codigo && (it.emisor || it.proveedor) === (p.emisor || p.proveedor))) return; setCart([...cart, { codigo: p.codigo, descripcion: p.descripcion, costo_usd: p.costo_usd || 0, proveedor: p.proveedor, emisor: p.emisor, cantidad: 1 }]); };
  const setCant = (i: number, v: any) => setCart(cart.map((it, j) => j === i ? { ...it, cantidad: Number(v) || 0 } : it));
  const quitar = (i: number) => setCart(cart.filter((_, j) => j !== i));

  // Agrupar carrito por proveedor/emisor
  const grupos: Record<string, any[]> = {};
  cart.forEach((it) => { const k = it.emisor || it.proveedor || "Sin proveedor"; (grupos[k] = grupos[k] || []).push(it); });
  const matchProv = (nombre: string) => provs.find((p) => { const nn = norm(nombre); const rs = norm(p.razon_social), nf = norm(p.nombre_fantasia); const al = String(p.alias || "").split(/[,;|]/).map(norm); return rs === nn || nf === nn || al.includes(nn) || (nn.length >= 4 && (rs.includes(nn) || nf.includes(nn))); });

  const enviarTodo = async () => {
    if (!cart.length) return;
    setBusy(true); setResult("");
    const out: string[] = [];
    for (const [nombre, its] of Object.entries(grupos)) {
      const prov = matchProv(nombre);
      try {
        const r = await fetch("/api/compras", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proveedor_id: prov?.id || null, proveedor_nombre: prov?.razon_social || nombre, email: emails[nombre] || prov?.email || "", mensaje: msgs[nombre] || "", items: its }) });
        const d = await r.json();
        out.push(d.ok ? `✅ ${nombre}: ${d.envio?.sin_email ? "registrado (sin email)" : d.envio?.ok ? "enviado" : "registrado, email falló"}` : `✕ ${nombre}: ${d.error}`);
      } catch (e: any) { out.push(`✕ ${nombre}: ${e.message}`); }
    }
    setResult(out.join("\n")); setCart([]); setBusy(false);
  };

  return (
    <div className="flex gap-4 h-full">
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

      {/* Carrito agrupado por proveedor */}
      <div className="w-[440px] shrink-0 flex flex-col border border-gray-200 rounded-xl bg-white">
        <div className="px-3 py-2 border-b border-gray-200 font-semibold text-febo-azul">🛒 Pedido a proveedor ({cart.length})</div>
        <div className="flex-1 overflow-auto p-2 space-y-3">
          {cart.length === 0 ? <div className="text-gray-400 text-sm text-center py-8">Agregá productos. Se arma un pedido por proveedor.</div> :
          Object.entries(grupos).map(([nombre, its]) => {
            const prov = matchProv(nombre);
            const tot = its.reduce((a, it) => a + (Number(it.costo_usd) || 0) * (Number(it.cantidad) || 0), 0);
            return (
              <div key={nombre} className="border border-gray-200 rounded-lg p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm">{chip(nombre, "#7c3aed")}{!prov && <span className="text-[10px] text-amber-600 ml-1">sin ficha</span>}</span>
                  <span className="text-xs text-gray-500">USD {tot.toFixed(2)}</span>
                </div>
                {its.map((it) => { const idx = cart.indexOf(it); return (
                  <div key={it.codigo} className="flex items-center gap-1 text-xs py-0.5">
                    <span className="flex-1"><b className="text-febo-azul">{it.codigo}</b></span>
                    <input type="number" value={it.cantidad} onChange={(e) => setCant(idx, e.target.value)} className="w-12 border border-gray-300 rounded px-1 text-center" />
                    <button onClick={() => quitar(idx)} className="text-red-400 hover:text-red-600">✕</button>
                  </div>
                ); })}
                <input value={emails[nombre] ?? (prov?.email || "")} onChange={(e) => setEmails({ ...emails, [nombre]: e.target.value })} placeholder="email del proveedor" className="w-full border border-gray-300 rounded px-2 py-1 text-xs mt-1" />
                <input value={msgs[nombre] || ""} onChange={(e) => setMsgs({ ...msgs, [nombre]: e.target.value })} placeholder="mensaje (opcional)" className="w-full border border-gray-300 rounded px-2 py-1 text-xs mt-1" />
              </div>
            );
          })}
        </div>
        {result && <pre className="text-[11px] text-gray-600 px-3 py-2 border-t border-gray-100 whitespace-pre-wrap">{result}</pre>}
        <div className="p-2 border-t border-gray-200">
          <button disabled={busy || !cart.length} onClick={enviarTodo} className="w-full px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50">{busy ? "Enviando…" : `📤 Generar y enviar (${Object.keys(grupos).length} proveedor/es)`}</button>
        </div>
      </div>
    </div>
  );
}
