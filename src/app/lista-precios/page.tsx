"use client";
import { Fragment, useCallback, useEffect, useState } from "react";

// Lista de precios EXCLUSIVA REVENDEDORES → PDF (imprimir/guardar). Pedido de Guille 07/07.
// Acceso: botón top-level en la barra de gestión (autoservicio) + botón dentro de Productos.
// ⚠️ NUNCA muestra proveedor ni costo (privacidad comercial). Los filtros (proveedor/categoría/
// stock) llegan por query (desde Productos) o se eligen acá mismo (acceso directo); se usan solo
// para acotar el listado, nunca se nombran en el documento.

type Row = { codigo: string; descripcion: string; categoria: string; iva_pct: number; precio_reventa: number; precio_publico: number };
type Opt = { proveedor?: string; categoria?: string; n: number };
type Nivel = { desde_usd: number; hasta_usd: number | null; descuento_pct: number };

// IVA por producto ("21%" / "10,5%").
const fmtIva = (v: number) => (Number(v) || 21).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "%";
const fmtUsd0 = (v: number) => "US$ " + Math.round(Number(v)).toLocaleString("es-AR");

// Formato según moneda: USD con 2 decimales ("US$ 1.234,56"); ARS entero ("$ 1.234").
const fmtMoneda = (v: number, moneda: string) => {
  if (!v) return "—";
  return moneda === "USD"
    ? "US$ " + Number(v).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "$ " + Math.round(Number(v)).toLocaleString("es-AR");
};

export default function ListaPreciosPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [niveles, setNiveles] = useState<Nivel[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [meta, setMeta] = useState<any>(null);
  const [fecha, setFecha] = useState("");
  // filtros (inicializados desde la query si vino de Productos)
  const [prov, setProv] = useState("");
  const [selCats, setSelCats] = useState<string[]>([]); // multi-rubro
  const [soloStock, setSoloStock] = useState(false);
  const [moneda, setMoneda] = useState<"USD" | "ARS">("USD"); // USD = la lista que va a revendedores
  const [provs, setProvs] = useState<Opt[]>([]);
  const [cats, setCats] = useState<Opt[]>([]);

  // Opciones de filtro + init desde query, una sola vez.
  useEffect(() => {
    setFecha(new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }));
    const sp = new URLSearchParams(window.location.search);
    setProv(sp.get("proveedor") || "");
    const catsIni = [
      ...(sp.get("categorias") || "").split(",").map((s) => s.trim()).filter(Boolean),
      ...(sp.get("categoria") ? [String(sp.get("categoria")).trim()] : []),
    ];
    if (catsIni.length) setSelCats(catsIni);
    setSoloStock(sp.get("stock") === "1");
    if (sp.get("moneda") === "ARS") setMoneda("ARS");
    fetch("/api/productos?limit=1").then((r) => r.json()).then((d) => {
      if (d.ok) { setProvs(d.proveedores || []); setCats(d.categorias || []); }
    }).catch(() => {});
  }, []);

  const cargar = useCallback(() => {
    setLoading(true); setErr("");
    const p = new URLSearchParams();
    if (prov) p.set("proveedor", prov);
    if (selCats.length) p.set("categorias", selCats.join(","));
    if (soloStock) p.set("stock", "1");
    p.set("moneda", moneda);
    fetch("/api/lista-precios?" + p.toString())
      .then((r) => r.json())
      .then((d) => { if (d.ok) { setRows(d.productos); setNiveles(d.niveles_volumen || []); setMeta(d.meta); } else setErr(d.error || "Error"); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [prov, selCats, soloStock, moneda]);
  useEffect(() => { const t = setTimeout(cargar, 200); return () => clearTimeout(t); }, [cargar]);

  // Agrupar por categoría (encabezado de sección en el PDF).
  const porCat: Record<string, Row[]> = {};
  for (const r of rows) (porCat[r.categoria] = porCat[r.categoria] || []).push(r);
  const catKeys = Object.keys(porCat);

  return (
    <div className="lp-root">
      <style>{`
        .lp-root { background:#eef1f5; min-height:100vh; padding:16px; font-family:Arial,Helvetica,sans-serif; }
        .lp-toolbar { max-width:800px; margin:0 auto 14px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
        .lp-print { background:#0b3d6b; color:#fff; border:0; border-radius:8px; padding:10px 20px; font-weight:700; font-size:14px; cursor:pointer; }
        .lp-print:disabled { opacity:.4; cursor:default; }
        .lp-sel { border:1px solid #cbd5e1; border-radius:8px; padding:8px 10px; font-size:13px; background:#fff; }
        .lp-note { font-size:12px; color:#64748b; }
        .lp-sheet { max-width:800px; margin:0 auto; background:#fff; padding:26px 30px; box-shadow:0 2px 12px rgba(0,0,0,.1); border-radius:8px; }
        .lp-head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #0b3d6b; padding-bottom:12px; margin-bottom:6px; }
        .lp-logo { height:64px; }
        .lp-title { text-align:right; }
        .lp-title h1 { margin:0; font-size:19px; color:#0b3d6b; font-weight:900; }
        .lp-title .sub { font-size:12px; color:#b45309; font-weight:700; text-transform:uppercase; letter-spacing:.5px; margin-top:2px; }
        .lp-title .meta { font-size:11px; color:#64748b; margin-top:4px; }
        .lp-cond { margin-top:10px; background:#f1f5f9; border-left:3px solid #0b3d6b; border-radius:0 6px 6px 0; padding:8px 12px; font-size:11px; color:#334155; }
        .lp-cond strong { color:#0b3d6b; }
        .lp-vol { margin-top:18px; }
        .lp-vol-tit { font-size:12px; font-weight:800; color:#0b3d6b; text-transform:uppercase; letter-spacing:.5px; margin-bottom:4px; }
        .lp-vol-txt { font-size:12px; color:#334155; background:#ecfdf5; border-left:3px solid #10b981; border-radius:0 6px 6px 0; padding:8px 12px; }
        .lp-vol-txt strong { color:#065f46; }
        .lp-tabla { width:100%; border-collapse:collapse; font-size:12px; margin-top:8px; }
        .lp-tabla th { background:#0b3d6b; color:#fff; text-align:left; padding:6px 8px; font-size:10.5px; text-transform:uppercase; }
        .lp-tabla th.num, .lp-tabla td.num { text-align:right; white-space:nowrap; }
        .lp-tabla td { padding:5px 8px; border-bottom:1px solid #eef2f6; vertical-align:top; }
        .lp-cat { background:#f1f5f9; font-weight:800; color:#0b3d6b; font-size:11px; text-transform:uppercase; letter-spacing:.5px; }
        .lp-cod { font-family:monospace; font-size:10px; color:#94a3b8; }
        .lp-foot { margin-top:16px; border-top:1px solid #e5e7eb; padding-top:10px; font-size:10px; color:#94a3b8; text-align:center; }
        @media print {
          .lp-root { background:#fff; padding:0; }
          .lp-toolbar { display:none !important; }
          .lp-sheet { box-shadow:none; margin:0; max-width:none; border-radius:0; padding:0; }
          .lp-tabla th { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
          .lp-cat td { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
          thead { display:table-header-group; }
          tr { break-inside:avoid; }
        }
      `}</style>

      <div className="lp-toolbar">
        <select className="lp-sel" value={prov} onChange={(e) => setProv(e.target.value)}>
          <option value="">Todas las listas</option>
          {provs.map((p) => <option key={p.proveedor} value={p.proveedor}>{p.proveedor} ({p.n})</option>)}
        </select>
        <MultiRubro cats={cats} sel={selCats} setSel={setSelCats} />
        <select className="lp-sel" value={moneda} onChange={(e) => setMoneda(e.target.value as "USD" | "ARS")} title="Moneda de la lista">
          <option value="USD">En dólares (USD)</option>
          <option value="ARS">En pesos (ARS)</option>
        </select>
        <label className="lp-note" style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
          <input type="checkbox" checked={soloStock} onChange={(e) => setSoloStock(e.target.checked)} /> Solo en stock
        </label>
        <button className="lp-print" disabled={loading || !rows.length}
          onClick={() => { document.title = `Lista de precios revendedores - ${fecha}`; window.print(); }}>
          🖨️ Imprimir / Guardar PDF
        </button>
        <button type="button" className="lp-sel" style={{ cursor: "pointer" }} title="Link público del VISOR (dominio propio visor.febecos.com — no revela gestión) para compartir. Solo precios sugeridos a público, USD, sin proveedores ni reventa."
          onClick={() => {
            // Dominio propio del visor (no gestión) — aporte de seguridad. La raíz del visor se reserva
            // para otros usos; el listado vive en la subcarpeta /lista-precios-revendedores.
            const url = (process.env.NEXT_PUBLIC_VISOR_URL || "https://visor.febecos.com") + "/lista-precios-revendedores";
            navigator.clipboard?.writeText(url).then(() => alert("Link público para compartir:\n" + url + "\n\nMuestra solo precios sugeridos a público (USD), sin proveedores ni precio de reventa. No revela el dominio de gestión.")).catch(() => window.open(url, "_blank"));
          }}>🔗 Link público</button>
        <span className="lp-note">{loading ? "cargando…" : `${rows.length} productos`}{(meta?.moneda === "ARS" && meta?.dolar) ? ` · US$ = $${meta.dolar}` : ""}</span>
      </div>

      <div className="lp-sheet">
        <div className="lp-head">
          <img className="lp-logo" src="https://fv.febecos.com/images/febecos-logo.png" alt="FEBECOS" />
          <div className="lp-title">
            <h1>Lista de Precios</h1>
            <div className="sub">Exclusiva Revendedores</div>
            <div className="meta">Fecha: {fecha} · {
              (meta?.moneda || moneda) === "USD"
                ? (meta?.con_iva ? "Precios en dólares (USD) · IVA incluido" : "Precios en dólares (USD) netos · + IVA de cada producto (ver columna)")
                : "Precios en pesos · IVA incluido"
            }</div>
          </div>
        </div>

        {/* Condición comercial (siempre en términos USD, es la política de entrega). */}
        <div className="lp-cond">
          <strong>Pedido mínimo USD 1.200</strong> · Entrega SIN CARGO en CABA. Pedidos menores a USD 1.200: costo adicional de USD 35 (entrega/retiro en depósito CABA).
        </div>

        {/* Niveles por volumen: indicación de los montos donde mejora el precio (sin % ni markup —
            pedido de Guille 07/07). VA ARRIBA, antes de la tabla (pedido de Guille: "al principio").
            BLINDAJE: solo se listan los umbrales donde el precio REALMENTE mejora (descuento
            estrictamente mayor que el máximo alcanzado) → un error de config de niveles no se
            muestra como punto de mejora. */}
        {(() => {
          const umbrales: number[] = [];
          let maxDesc = 0;
          for (const n of niveles) {
            if (n.desde_usd > 0 && n.descuento_pct > maxDesc + 0.01) umbrales.push(n.desde_usd);
            if (n.descuento_pct > maxDesc) maxDesc = n.descuento_pct;
          }
          if (loading || err || umbrales.length === 0) return null;
          return (
            <div className="lp-vol" style={{ marginTop: 10, marginBottom: 4 }}>
              <div className="lp-vol-tit">📈 Mejor precio por volumen de compra</div>
              <div className="lp-vol-txt">
                A mayor volumen de compra, mejor precio. El precio mejora al superar los{" "}
                <strong>{umbrales.map((u) => fmtUsd0(u)).join(" · ")}</strong> (neto) de compra.
                Consultanos tu precio por volumen.
              </div>
            </div>
          );
        })()}

        {err ? (
          <div style={{ padding: 30, textAlign: "center", color: "#c00" }}>⚠️ {err}</div>
        ) : loading ? (
          <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>Cargando lista…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>No hay productos para los filtros elegidos.</div>
        ) : (
          <table className="lp-tabla">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="num">IVA</th>
                <th className="num">Precio Reventa</th>
                <th className="num">Precio sugerido a público</th>
              </tr>
            </thead>
            <tbody>
              {catKeys.map((c) => (
                <Fragment key={c}>
                  <tr className="lp-cat"><td colSpan={4}>{c}</td></tr>
                  {porCat[c].map((p, i) => (
                    <tr key={c + "-" + i}>
                      <td>
                        <div>{p.descripcion}</div>
                        {p.codigo && <div className="lp-cod">{p.codigo}</div>}
                      </td>
                      <td className="num" style={{ color: "#64748b" }}>{fmtIva(p.iva_pct)}</td>
                      <td className="num"><strong>{fmtMoneda(p.precio_reventa, meta?.moneda || moneda)}</strong></td>
                      <td className="num">{fmtMoneda(p.precio_publico, meta?.moneda || moneda)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}

        {/* Aclaración de accesorios: solo cuando la lista incluye termotanques (los AC-* van con el equipo). */}
        {!loading && !err && catKeys.includes("TERMOTANQUES SOLARES") && (
          <div className="lp-vol-txt" style={{ marginTop: 10, background: "#fff7ed", borderLeftColor: "#f59e0b" }}>
            Los accesorios (código <strong>AC-</strong>) se venden <strong>exclusivamente</strong> junto con un termotanque, no por separado.
          </div>
        )}

        <div className="lp-foot">
          FEBECOS · Precios sujetos a modificación sin previo aviso y a disponibilidad de stock. Válido a la fecha indicada.
        </div>
      </div>
    </div>
  );
}

// Selector de rubros MULTIPLE con buscador (pedido de Guille: "busco 'cables' y elijo CABLE +
// CABLE SOLAR + CABLES; o bombas → BOMBAS DE CALOR + ELECTRICAS + SOLARES"). Botón que abre un
// panel con búsqueda + checkboxes. Se puede usar tanto en la lista interna como en el visor público.
function MultiRubro({ cats, sel, setSel }: { cats: { categoria?: string; n: number }[]; sel: string[]; setSel: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const filtrados = cats.filter((c) => norm(c.categoria || "").includes(norm(q)));
  const toggle = (c: string) => setSel(sel.includes(c) ? sel.filter((x) => x !== c) : [...sel, c]);
  const label = sel.length === 0 ? "Todos los rubros" : sel.length === 1 ? sel[0] : `${sel.length} rubros`;
  return (
    <div style={{ position: "relative" }} className="no-print">
      <button type="button" className="lp-sel" onClick={() => setOpen((o) => !o)} style={{ cursor: "pointer", minWidth: 160, textAlign: "left" }}>
        {label} <span style={{ float: "right", color: "#94a3b8" }}>▾</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 41, background: "#fff", border: "1px solid #cbd5e1", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.15)", width: 300, maxHeight: 340, display: "flex", flexDirection: "column", padding: 8 }}>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar rubro (ej. cable, bomba)…" style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "6px 8px", fontSize: 12, marginBottom: 6 }} />
            <div style={{ display: "flex", gap: 8, marginBottom: 6, fontSize: 11 }}>
              <button type="button" onClick={() => setSel(Array.from(new Set([...sel, ...filtrados.map((c) => c.categoria || "")])))} style={{ color: "#0b3d6b", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Elegir todos los del filtro</button>
              {sel.length > 0 && <button type="button" onClick={() => setSel([])} style={{ color: "#dc2626", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Limpiar</button>}
            </div>
            <div style={{ overflowY: "auto" }}>
              {filtrados.length === 0 ? <div style={{ fontSize: 12, color: "#94a3b8", padding: 6 }}>Sin rubros</div> : filtrados.map((c) => (
                <label key={c.categoria} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "4px 6px", cursor: "pointer", borderRadius: 5, background: sel.includes(c.categoria || "") ? "#eff6ff" : "transparent" }}>
                  <input type="checkbox" checked={sel.includes(c.categoria || "")} onChange={() => toggle(c.categoria || "")} />
                  <span style={{ flex: 1 }}>{c.categoria}</span>
                  <span style={{ color: "#94a3b8" }}>{c.n}</span>
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
