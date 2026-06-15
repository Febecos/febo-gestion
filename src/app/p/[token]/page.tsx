"use client";
import { useEffect, useState } from "react";

const fmt = (v: any) => "$ " + Math.round(Number(v) || 0).toLocaleString("es-AR");
const fmtF = (v: string) => (v ? new Date(v).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");
const TITULO: Record<string, string> = { presupuesto: "PRESUPUESTO", pedido: "PEDIDO", factura: "FACTURA", remito: "REMITO" };
const COND: Record<string, string> = {
  responsable_inscripto: "Responsable Inscripto", monotributista: "Monotributista",
  consumidor_final: "Consumidor Final", exento: "Exento",
};

export default function ComprobantePublico({ params }: { params: { token: string } }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/public/" + params.token).then((r) => r.json()).then((j) => {
      if (!j.ok) { setErr(j.error || "No encontrado"); return; }
      setD(j);
      // ?print=1 → imprime automáticamente al cargar
      if (new URLSearchParams(window.location.search).get("print") === "1") setTimeout(() => window.print(), 600);
    }).catch((e) => setErr(e.message));
  }, [params.token]);

  if (err) return <div className="p-10 text-center text-gray-500">⚠️ {err}</div>;
  if (!d) return <div className="p-10 text-center text-gray-400">Cargando…</div>;

  const c = d.comprobante, cli = d.cliente, items = d.items || [];
  const titulo = TITULO[c.tipo] || c.tipo.toUpperCase();
  const subtotal = items.reduce((a: number, it: any) => a + (Number(it.total) || 0), 0);

  return (
    <div className="doc-wrap">
      <style>{`
        :root { --azul:#1e3a8a; }
        body { background:#e5e7eb; }
        .doc-wrap { max-width: 820px; margin: 0 auto; padding: 24px 16px 60px; }
        .toolbar { display:flex; gap:8px; justify-content:flex-end; margin-bottom:16px; }
        .btn { background:var(--azul); color:#fff; border:0; border-radius:8px; padding:10px 18px; font-size:14px; font-weight:600; cursor:pointer; }
        .btn.sec { background:#fff; color:#334155; border:1px solid #cbd5e1; }
        .sheet { background:#fff; border:1px solid #d1d5db; border-radius:6px; padding:40px; color:#1f2937; font-size:13px; }
        .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid var(--azul); padding-bottom:16px; }
        .brand { font-size:26px; font-weight:800; color:var(--azul); letter-spacing:1px; }
        .brand small { display:block; font-size:11px; font-weight:500; color:#64748b; letter-spacing:0; margin-top:2px; }
        .doctype { text-align:right; }
        .doctype .t { font-size:22px; font-weight:800; color:#111827; }
        .doctype .n { font-size:14px; color:#374151; margin-top:2px; }
        .doctype .f { font-size:12px; color:#6b7280; }
        .parties { display:flex; justify-content:space-between; gap:24px; margin:22px 0; }
        .parties .box { flex:1; }
        .parties .lbl { font-size:10px; text-transform:uppercase; color:#9ca3af; font-weight:700; margin-bottom:4px; }
        .parties .v { line-height:1.5; }
        table.items { width:100%; border-collapse:collapse; margin-top:8px; }
        table.items th { background:#f1f5f9; text-align:left; padding:8px 10px; font-size:10px; text-transform:uppercase; color:#475569; border-bottom:1px solid #cbd5e1; }
        table.items td { padding:8px 10px; border-bottom:1px solid #eef2f7; }
        table.items td.r, table.items th.r { text-align:right; }
        .totales { display:flex; justify-content:flex-end; margin-top:16px; }
        .totales .t { width:280px; }
        .totales .row { display:flex; justify-content:space-between; padding:4px 0; }
        .totales .grand { border-top:2px solid var(--azul); margin-top:6px; padding-top:8px; font-size:18px; font-weight:800; color:var(--azul); }
        .cae { margin-top:18px; padding:10px 12px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; font-size:12px; color:#166534; }
        .proforma { margin-top:18px; padding:8px 12px; background:#fff7ed; border:1px solid #fed7aa; border-radius:6px; font-size:12px; color:#9a3412; }
        .foot { margin-top:28px; text-align:center; font-size:11px; color:#9ca3af; }
        @media print {
          body { background:#fff; }
          .toolbar { display:none !important; }
          .doc-wrap { max-width:none; padding:0; }
          .sheet { border:0; border-radius:0; padding:0; }
          @page { margin: 16mm; }
        }
      `}</style>

      <div className="toolbar">
        <button className="btn" onClick={() => window.print()}>🖨 Imprimir / Guardar PDF</button>
      </div>

      <div className="sheet">
        <div className="head">
          <div>
            <div className="brand">FEBECOS<small>Energía solar · Bombas · Fotovoltaico</small></div>
          </div>
          <div className="doctype">
            <div className="t">{titulo}{c.letra ? <span style={{ display: "inline-block", marginLeft: 8, border: "2px solid #0b3d6b", borderRadius: 6, padding: "0 10px", fontWeight: 800 }}>{c.letra}</span> : null}</div>
            <div className="n">{c.numero || ""}</div>
            <div className="f">Fecha: {fmtF(c.fecha)}</div>
            {c.estado && <div className="f">Estado: {c.estado}</div>}
          </div>
        </div>

        <div className="parties">
          <div className="box">
            <div className="lbl">Cliente</div>
            <div className="v">
              <strong>{cli?.razon_social || cli?.nombre || c.cliente_nombre || "—"}</strong><br />
              {cli?.cuit || c.cliente_cuit ? <>CUIT: {cli?.cuit || c.cliente_cuit}<br /></> : null}
              {c.condicion_iva_receptor ? <>Condición IVA: {c.condicion_iva_receptor}<br /></> : (cli?.condicion_fiscal ? <>{COND[cli.condicion_fiscal] || cli.condicion_fiscal}<br /></> : null)}
              {cli?.domicilio ? <>{cli.domicilio}<br /></> : null}
              {[cli?.localidad, cli?.provincia, cli?.cod_postal].filter(Boolean).join(", ")}
            </div>
          </div>
          <div className="box" style={{ textAlign: "right" }}>
            <div className="lbl">Emisor</div>
            <div className="v">
              <strong>FEBECOS</strong><br />
              {cli?.email && <>{cli.email}<br /></>}
            </div>
          </div>
        </div>

        <table className="items">
          <thead>
            <tr>
              <th>Descripción</th>
              <th className="r">Cant.</th>
              <th className="r">P. unit.</th>
              {items.some((it: any) => Number(it.descuento_pct)) ? <th className="r">Desc.</th> : null}
              <th className="r">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it: any, i: number) => (
              <tr key={i}>
                <td>{it.descripcion}</td>
                <td className="r">{it.cantidad}</td>
                <td className="r">{fmt(it.precio_unitario)}</td>
                {items.some((x: any) => Number(x.descuento_pct)) ? <td className="r">{Number(it.descuento_pct) ? it.descuento_pct + "%" : "—"}</td> : null}
                <td className="r">{fmt(it.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="totales">
          <div className="t">
            <div className="row"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
            <div className="row grand"><span>TOTAL</span><span>{fmt(c.total)}</span></div>
          </div>
        </div>

        {c.tipo === "factura" && (
          c.afip_cae
            ? <div className="cae">CAE: {c.afip_cae}{c.afip_validada ? " · Comprobante autorizado por AFIP" : ""}</div>
            : <div className="proforma">FACTURA PROFORMA — sin validez fiscal hasta su autorización en AFIP.</div>
        )}

        {Array.isArray(c.leyendas) && c.leyendas.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 12, color: "#374151", borderTop: "1px solid #e5e7eb", paddingTop: 8 }}>
            {c.leyendas.map((l: string, i: number) => <div key={i}>• {l}</div>)}
          </div>
        )}

        {c.condiciones_pago && <div style={{ marginTop: 16, fontSize: 12, color: "#6b7280" }}>Condiciones: {c.condiciones_pago}</div>}

        <div className="foot">Documento generado por FEBO-GESTION · febecos.com</div>
      </div>
    </div>
  );
}
