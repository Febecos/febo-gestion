"use client";
import { Fragment, useEffect, useState } from "react";

// Lista de precios EXCLUSIVA REVENDEDORES → PDF (imprimir/guardar). Pedido de Guille 07/07.
// ⚠️ NUNCA muestra proveedor ni costo (privacidad comercial). Los filtros llegan por query
// (?proveedor=&categoria=&stock=1) desde el botón en Productos — se usan solo para acotar el
// listado, no se nombran en el documento.

type Row = { codigo: string; descripcion: string; categoria: string; precio_reventa: number; precio_publico: number };

const fmt = (v: number) => (v ? "$ " + Math.round(Number(v)).toLocaleString("es-AR") : "—");

export default function ListaPreciosPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [meta, setMeta] = useState<any>(null);
  const [fecha, setFecha] = useState("");

  useEffect(() => {
    setFecha(new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }));
    const qs = window.location.search || "";
    fetch("/api/lista-precios" + qs)
      .then((r) => r.json())
      .then((d) => { if (d.ok) { setRows(d.productos); setMeta(d.meta); } else setErr(d.error || "Error"); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Agrupar por categoría (encabezado de sección en el PDF).
  const porCat: Record<string, Row[]> = {};
  for (const r of rows) (porCat[r.categoria] = porCat[r.categoria] || []).push(r);
  const cats = Object.keys(porCat);

  if (loading) return <div style={{ padding: 40, fontFamily: "system-ui", color: "#666" }}>Cargando lista…</div>;
  if (err) return <div style={{ padding: 40, fontFamily: "system-ui", color: "#c00" }}>⚠️ {err}</div>;

  return (
    <div className="lp-root">
      <style>{`
        .lp-root { background:#eef1f5; min-height:100vh; padding:16px; font-family:Arial,Helvetica,sans-serif; }
        .lp-toolbar { max-width:800px; margin:0 auto 14px; display:flex; gap:12px; align-items:center; }
        .lp-print { background:#0b3d6b; color:#fff; border:0; border-radius:8px; padding:10px 20px; font-weight:700; font-size:14px; cursor:pointer; }
        .lp-note { font-size:12px; color:#64748b; }
        .lp-sheet { max-width:800px; margin:0 auto; background:#fff; padding:26px 30px; box-shadow:0 2px 12px rgba(0,0,0,.1); border-radius:8px; }
        .lp-head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #0b3d6b; padding-bottom:12px; margin-bottom:6px; }
        .lp-logo { height:64px; }
        .lp-title { text-align:right; }
        .lp-title h1 { margin:0; font-size:19px; color:#0b3d6b; font-weight:900; }
        .lp-title .sub { font-size:12px; color:#b45309; font-weight:700; text-transform:uppercase; letter-spacing:.5px; margin-top:2px; }
        .lp-title .meta { font-size:11px; color:#64748b; margin-top:4px; }
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
        <button className="lp-print" onClick={() => { document.title = `Lista de precios revendedores - ${fecha}`; window.print(); }}>🖨️ Imprimir / Guardar PDF</button>
        <span className="lp-note">{rows.length} productos · precios en pesos con IVA{meta?.dolar ? ` · US$ = $${meta.dolar}` : ""}</span>
      </div>

      <div className="lp-sheet">
        <div className="lp-head">
          <img className="lp-logo" src="https://fv.febecos.com/images/febecos-logo.png" alt="FEBECOS" />
          <div className="lp-title">
            <h1>Lista de Precios</h1>
            <div className="sub">Exclusiva Revendedores</div>
            <div className="meta">Fecha: {fecha} · Precios finales con IVA incluido</div>
          </div>
        </div>

        {rows.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>No hay productos para los filtros elegidos.</div>
        ) : (
          <table className="lp-tabla">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="num">Precio Reventa</th>
                <th className="num">Precio a Público</th>
              </tr>
            </thead>
            <tbody>
              {cats.map((cat) => (
                <Fragment key={cat}>
                  <tr className="lp-cat"><td colSpan={3}>{cat}</td></tr>
                  {porCat[cat].map((p, i) => (
                    <tr key={cat + "-" + i}>
                      <td>
                        <div>{p.descripcion}</div>
                        {p.codigo && <div className="lp-cod">{p.codigo}</div>}
                      </td>
                      <td className="num"><strong>{fmt(p.precio_reventa)}</strong></td>
                      <td className="num">{fmt(p.precio_publico)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}

        <div className="lp-foot">
          FEBECOS · Precios sujetos a modificación sin previo aviso y a disponibilidad de stock. Válido a la fecha indicada.
        </div>
      </div>
    </div>
  );
}
