"use client";
import { useEffect, useMemo, useState } from "react";

// VISOR de la LISTA DE PRECIOS EXCLUSIVA PARA REVENDEDORES (link para compartir — Guille 07/07,
// reencuadre). Sin auth (ruta whitelisteada en el middleware; abierto por ahora, se gatea por token
// de revendedor en fase 2). Muestra el PRECIO DE REVENTA en USD (facturado al CUIT del revendedor) +
// los umbrales de volumen. ⚠️ NO se muestran proveedores ni costo. Pega a /api/public/lista-precios.

type Prod = { codigo: string; descripcion: string; categoria: string; iva_pct: number; precio_reventa: number };
type Cat = { categoria: string; n: number };
type Nivel = { desde_usd: number; hasta_usd: number | null; descuento_pct: number };

const usd = (v: number) => (v ? "US$ " + Number(v).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export default function VisorPreciosPage() {
  const [prods, setProds] = useState<Prod[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [niveles, setNiveles] = useState<Nivel[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [selCats, setSelCats] = useState<string[]>([]);
  const [tipKey, setTipKey] = useState<string | null>(null); // "?" tocado (celu) → tooltip abierto
  const toggleTip = (k: string) => setTipKey((cur) => (cur === k ? null : k));

  useEffect(() => {
    fetch("/api/public/lista-precios")
      .then((r) => r.json())
      .then((d) => { if (d.ok) { setProds(d.productos); setCats(d.categorias || []); setNiveles(d.niveles_volumen || []); } else setErr(d.error || "Error"); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtrados = useMemo(() => {
    const nq = norm(q.trim());
    return prods.filter((p) =>
      (selCats.length === 0 || selCats.includes(p.categoria)) &&
      (nq === "" || norm(p.descripcion + " " + p.codigo + " " + p.categoria).includes(nq))
    );
  }, [prods, q, selCats]);

  const porCat: Record<string, Prod[]> = {};
  for (const p of filtrados) (porCat[p.categoria] = porCat[p.categoria] || []).push(p);
  const catKeys = Object.keys(porCat);
  const toggleCat = (c: string) => setSelCats((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));

  return (
    <div className="vp-root">
      <style>{`
        .vp-root { background:#eef1f5; min-height:100vh; font-family:Arial,Helvetica,sans-serif; color:#0f172a; }
        .vp-head { background:#0b3d6b; color:#fff; padding:18px 16px; }
        .vp-head-in { max-width:900px; margin:0 auto; display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
        .vp-logo { height:68px; }
        .vp-head h1 { margin:0; font-size:19px; font-weight:900; }
        .vp-head .sub { font-size:12px; opacity:.9; margin-top:3px; }
        .vp-wrap { max-width:900px; margin:0 auto; padding:16px; }
        .vp-search { width:100%; box-sizing:border-box; border:1px solid #cbd5e1; border-radius:10px; padding:12px 14px; font-size:15px; }
        .vp-chips { display:flex; gap:6px; flex-wrap:wrap; margin:12px 0; }
        .vp-chip { border:1px solid #cbd5e1; background:#fff; border-radius:999px; padding:5px 12px; font-size:12px; cursor:pointer; white-space:nowrap; }
        .vp-chip.on { background:#0b3d6b; color:#fff; border-color:#0b3d6b; }
        .vp-card { background:#fff; border-radius:12px; box-shadow:0 1px 4px rgba(0,0,0,.06); margin-top:12px; }
        .vp-cat { background:#f1f5f9; color:#0b3d6b; font-weight:800; font-size:12px; text-transform:uppercase; letter-spacing:.5px; padding:8px 14px; border-radius:12px 12px 0 0; }
        .vp-item { display:flex; align-items:center; gap:10px; padding:10px 14px; border-top:1px solid #f1f5f9; }
        .vp-item .desc { flex:1; min-width:0; font-size:14px; }   /* min-width:0 permite truncar en flex */
        .vp-item .desc-1 { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }  /* un renglon */
        .vp-item .cod { font-size:11px; color:#94a3b8; font-family:monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        /* "?" indicador → muestra la descripcion completa (hover en compu / tap en celu). */
        .vp-q { position:relative; flex:0 0 auto; width:20px; height:20px; border-radius:50%; background:#0b3d6b; color:#fff; font-size:12px; font-weight:800; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; user-select:none; }
        .vp-tip { display:none; position:absolute; bottom:calc(100% + 10px); right:-6px; width:min(300px,72vw); background:#0b3d6b; color:#fff; padding:9px 11px; border-radius:8px; font-size:12.5px; font-weight:400; line-height:1.45; text-align:left; white-space:normal; box-shadow:0 8px 24px rgba(0,0,0,.28); z-index:30; }
        .vp-tip::after { content:""; position:absolute; top:100%; right:12px; border:6px solid transparent; border-top-color:#0b3d6b; }  /* flechita hacia el "?" */
        .vp-q:hover .vp-tip, .vp-tip.open { display:block; }
        .vp-item .iva { font-size:11px; color:#64748b; white-space:nowrap; }
        .vp-item .px { font-size:15px; font-weight:800; color:#0b3d6b; white-space:nowrap; }
        .vp-note { font-size:11px; color:#64748b; margin-top:14px; text-align:center; line-height:1.6; }
        .vp-cond { background:#f1f5f9; border-left:3px solid #0b3d6b; border-radius:0 8px 8px 0; padding:10px 14px; font-size:12.5px; color:#334155; margin-bottom:10px; }
        .vp-cond strong { color:#0b3d6b; }
        .vp-vol { background:#ecfdf5; border-left:3px solid #10b981; border-radius:0 8px 8px 0; padding:10px 14px; font-size:12.5px; color:#334155; margin-bottom:12px; }
        .vp-vol strong { color:#065f46; }
      `}</style>

      <div className="vp-head">
        <div className="vp-head-in">
          <img className="vp-logo" src="https://fv.febecos.com/images/febecos-logo.png" alt="FEBECOS" />
          <div>
            <h1>Lista de Precios — Exclusiva Revendedores</h1>
            <div className="sub">Precios en <strong>dólares (USD)</strong> · + IVA · facturación al CUIT del revendedor · sujetos a modificación y disponibilidad de stock</div>
          </div>
        </div>
      </div>

      <div className="vp-wrap">
        {/* Condiciones comerciales (mismas que el PDF) + nota de mejor precio por volumen, arriba de todo. */}
        <div className="vp-cond">
          <strong>Pedido mínimo USD 1.200</strong> · Entrega SIN CARGO en CABA. Pedidos menores a USD 1.200: costo adicional de USD 35 (entrega/retiro en depósito CABA).
        </div>
        <div className="vp-vol">
          <strong>📈 A mayor volumen de compra, mejor precio.</strong>{" "}
          {(() => {
            // Umbrales (montos netos USD del admin) donde MEJORA el precio — blindaje monótono
            // (solo los que realmente bajan el precio; sin % ni markup).
            const umbrales: number[] = [];
            let maxDesc = 0;
            for (const n of niveles) {
              if (n.desde_usd > 0 && n.descuento_pct > maxDesc + 0.01) umbrales.push(n.desde_usd);
              if (n.descuento_pct > maxDesc) maxDesc = n.descuento_pct;
            }
            return umbrales.length
              ? <>El precio mejora al superar los <strong>{umbrales.map((u) => "US$ " + Math.round(u).toLocaleString("es-AR")).join(" · ")}</strong> (neto) de compra.</>
              : <>Consultanos tu precio por volumen al pedir tu cotización.</>;
          })()}
        </div>
        {!loading && !err && catKeys.includes("TERMOTANQUES SOLARES") && (
          <div className="vp-cond" style={{ background: "#fff7ed", borderLeftColor: "#f59e0b" }}>
            Los accesorios (código <strong>AC-</strong>) se venden <strong>exclusivamente</strong> junto con un termotanque, no por separado.
          </div>
        )}
        <input className="vp-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscá tu producto (ej. cable, batería, bomba, panel)…" />
        {cats.length > 0 && (
          <div className="vp-chips">
            {selCats.length > 0 && <span className="vp-chip on" onClick={() => setSelCats([])}>✕ Limpiar</span>}
            {cats.map((c) => (
              <span key={c.categoria} className={"vp-chip" + (selCats.includes(c.categoria) ? " on" : "")} onClick={() => toggleCat(c.categoria)}>
                {c.categoria} ({c.n})
              </span>
            ))}
          </div>
        )}

        {err ? (
          <div style={{ padding: 30, textAlign: "center", color: "#c00" }}>⚠️ {err}</div>
        ) : loading ? (
          <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>Cargando precios…</div>
        ) : filtrados.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>No encontramos productos para tu búsqueda.</div>
        ) : (
          catKeys.map((c) => (
            <div className="vp-card" key={c}>
              <div className="vp-cat">{c}</div>
              {porCat[c].map((p, i) => {
                const key = c + "-" + i;
                // Un renglón (truncado). El "?" muestra la descripción completa: hover en compu,
                // tap en celu (tooltip arriba, fondo azul, letras blancas).
                return (
                  <div className="vp-item" key={key}>
                    <div className="desc">
                      <div className="desc-1">{p.descripcion}</div>
                      {p.codigo && <div className="cod">{p.codigo}</div>}
                    </div>
                    <span className="vp-q" onClick={(e) => { e.stopPropagation(); toggleTip(key); }} title="Ver descripción completa">
                      ?
                      <span className={"vp-tip" + (tipKey === key ? " open" : "")}>{p.descripcion}{p.codigo ? " · " + p.codigo : ""}</span>
                    </span>
                    <div className="iva">IVA {(Number(p.iva_pct) || 21).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%</div>
                    <div className="px">{usd(p.precio_reventa)}</div>
                  </div>
                );
              })}
            </div>
          ))
        )}

        {!loading && !err && catKeys.includes("TERMOTANQUES SOLARES") && (
          <div className="vp-cond" style={{ background: "#fff7ed", borderLeftColor: "#f59e0b", marginTop: 12, marginBottom: 0 }}>
            Los accesorios (código <strong>AC-</strong>) se venden <strong>exclusivamente</strong> junto con un termotanque, no por separado.
          </div>
        )}

        <div className="vp-note">
          {loading ? "" : `${filtrados.length} productos`} · Tocá el <strong>?</strong> (o pasá el mouse) para ver la descripción completa.<br />
          Precios exclusivos para revendedores, en USD sin IVA (se adiciona IVA según cada producto) · facturación al CUIT del revendedor.<br />
          FEBECOS · bombas solares y energía fotovoltaica · febecos.com
        </div>
      </div>
    </div>
  );
}
