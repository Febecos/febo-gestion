"use client";
import { useEffect, useState } from "react";

const TITULO: Record<string, string> = { presupuesto: "PRESUPUESTO", pedido: "PEDIDO", factura: "FACTURA", remito: "REMITO" };
const COND: Record<string, string> = {
  responsable_inscripto: "Responsable Inscripto", monotributista: "Monotributista",
  consumidor_final: "Consumidor Final", exento: "Exento",
};
const fmtF = (v: string) => (v ? new Date(v).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");
const cuitFmt = (c: any) => { const d = String(c || "").replace(/\D/g, ""); return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : (c || ""); };

// ── Número a letras (es-AR), para el "SON ..." ──
function enLetras(n: number): string {
  const U = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte"];
  const D = ["", "", "veinti", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
  const C = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];
  function hasta999(x: number): string {
    if (x === 0) return "";
    if (x === 100) return "cien";
    let s = "";
    const c = Math.floor(x / 100), r = x % 100;
    if (c) s += C[c] + " ";
    if (r <= 20) s += U[r];
    else { const d = Math.floor(r / 10), u = r % 10; s += (d === 2 ? "veinti" + U[u] : D[d] + (u ? " y " + U[u] : "")); }
    return s.trim();
  }
  if (n === 0) return "cero";
  const millones = Math.floor(n / 1e6), miles = Math.floor((n % 1e6) / 1000), resto = n % 1000;
  let s = "";
  if (millones) s += (millones === 1 ? "un millón " : hasta999(millones) + " millones ");
  if (miles) s += (miles === 1 ? "mil " : hasta999(miles) + " mil ");
  if (resto) s += hasta999(resto);
  return s.trim();
}
function importeEnLetras(total: number, moneda: string): string {
  const ent = Math.floor(total), cent = Math.round((total - ent) * 100);
  const mon = moneda === "USD" ? "Dólares" : "Pesos";
  return `SON ${mon} ${enLetras(ent)} con ${String(cent).padStart(2, "0")}/100`.toUpperCase();
}

export default function ComprobantePublico({ params }: { params: { token: string } }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");
  const [admin, setAdmin] = useState(false);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    setAdmin(new URLSearchParams(window.location.search).get("admin") === "1");
    fetch("/api/public/" + params.token).then((r) => r.json()).then((j) => {
      if (!j.ok) { setErr(j.error || "No encontrado"); return; }
      setD(j);
      if (new URLSearchParams(window.location.search).get("print") === "1") setTimeout(() => window.print(), 700);
    }).catch((e) => setErr(e.message));
  }, [params.token]);
  const enviarEmail = async () => {
    setSending(true);
    try {
      const r = await fetch("/api/comprobante-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: params.token }) });
      const j = await r.json();
      alert(j.ok ? "✅ Enviado a " + (j.email || "el cliente") : "No se pudo enviar: " + (j.error || "error"));
    } catch (e: any) { alert("Error: " + e.message); } finally { setSending(false); }
  };

  if (err) return <div style={{ padding: 40, textAlign: "center", color: "#6b7280" }}>⚠️ {err}</div>;
  if (!d) return <div style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>Cargando…</div>;

  const c = d.comprobante, cli = d.cliente, emp = d.empresa || {}, items = d.items || [];
  const titulo = TITULO[c.tipo] || String(c.tipo).toUpperCase();
  const esFactura = c.tipo === "factura";
  const moneda = c.moneda || "USD";
  const sym = moneda === "USD" ? "USD" : "$";
  const fmt = (v: any) => `${sym} ${Number(v || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const subtotal = items.reduce((a: number, it: any) => a + (Number(it.total) || 0), 0) || Number(c.subtotal) || 0;
  // Detalle de IVA: acepta objeto {"21":monto,"10.5":monto} o array [{pct,monto}]
  let ivaLines: { pct: string; monto: number }[] = [];
  const idet = c.iva_detalle;
  if (Array.isArray(idet)) ivaLines = idet.map((x: any) => ({ pct: String(x.pct ?? x.alicuota ?? ""), monto: Number(x.monto ?? x.importe ?? 0) }));
  else if (idet && typeof idet === "object") ivaLines = Object.entries(idet).map(([pct, monto]) => ({ pct, monto: Number(monto) }));
  ivaLines = ivaLines.filter((l) => l.monto > 0);
  const ivaTotal = ivaLines.reduce((a, l) => a + l.monto, 0);
  const totalDoc = Number(c.total) || (subtotal + ivaTotal);

  const emisorCond = emp.condicion_iva || "Responsable Inscripto";

  return (
    <div className="doc-wrap">
      <style>{`
        :root { --azul:#0b3d6b; }
        body { background:#e5e7eb; }
        .doc-wrap { max-width: 820px; margin: 0 auto; padding: 24px 16px 60px; }
        .toolbar { display:flex; gap:8px; justify-content:flex-end; margin-bottom:16px; }
        .btn { background:var(--azul); color:#fff; border:0; border-radius:8px; padding:10px 18px; font-size:14px; font-weight:600; cursor:pointer; }
        .btn.sec { background:#fff; color:#334155; border:1px solid #cbd5e1; }
        .sheet { background:#fff; border:1px solid #d1d5db; border-radius:6px; padding:34px 38px; color:#1f2937; font-size:12.5px; position:relative; }
        .head { display:grid; grid-template-columns: 1fr 64px 1fr; align-items:flex-start; border-bottom:2px solid var(--azul); padding-bottom:14px; }
        .logo img { max-height:64px; max-width:200px; }
        .emisor { font-size:11.5px; line-height:1.45; }
        .emisor .rs { font-size:15px; font-weight:800; color:var(--azul); }
        .letra { text-align:center; }
        .letra .L { display:inline-block; border:2px solid #111; border-radius:6px; width:46px; height:46px; line-height:44px; font-size:30px; font-weight:800; }
        .letra .cod { font-size:9px; color:#555; margin-top:2px; }
        .doctype { text-align:right; font-size:11.5px; line-height:1.5; }
        .doctype .t { font-size:18px; font-weight:800; color:#111827; }
        .doctype .n { font-size:14px; font-weight:700; }
        .noval { display:inline-block; font-size:10px; font-weight:700; color:#374151; border:1px solid #9ca3af; border-radius:4px; padding:3px 8px; margin-bottom:6px; }
        .parties { display:flex; gap:24px; margin:14px 0; }
        .parties .box { flex:1; border:1px solid #e5e7eb; border-radius:6px; padding:8px 10px; }
        .parties .lbl { font-size:9px; text-transform:uppercase; color:#9ca3af; font-weight:700; margin-bottom:3px; }
        .parties .v { line-height:1.5; }
        .cond { display:flex; gap:24px; font-size:11px; color:#374151; margin-bottom:10px; flex-wrap:wrap; }
        table.items { width:100%; border-collapse:collapse; margin-top:6px; }
        table.items th { background:var(--azul); color:#fff; text-align:left; padding:7px 9px; font-size:10px; text-transform:uppercase; }
        table.items td { padding:6px 9px; border-bottom:1px solid #eef2f7; vertical-align:top; }
        table.items td.r, table.items th.r { text-align:right; white-space:nowrap; }
        .letras { margin-top:12px; font-size:11.5px; font-style:italic; color:#374151; }
        .totales { display:flex; justify-content:flex-end; margin-top:8px; }
        .totales .t { width:300px; }
        .totales .row { display:flex; justify-content:space-between; padding:3px 0; font-size:12.5px; }
        .totales .grand { border-top:2px solid var(--azul); margin-top:6px; padding-top:8px; font-size:17px; font-weight:800; color:var(--azul); }
        .leyendas { margin-top:14px; font-size:10.5px; color:#4b5563; border-top:1px solid #e5e7eb; padding-top:8px; line-height:1.5; }
        .cae { margin-top:16px; padding:10px 12px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; font-size:12px; color:#166534; }
        .foot { margin-top:24px; text-align:center; font-size:10.5px; color:#9ca3af; }
        @media print { body{background:#fff;} .toolbar{display:none !important;} .doc-wrap{max-width:none;padding:0;} .sheet{border:0;border-radius:0;padding:0;} @page{margin:14mm;} }
      `}</style>

      <div className="toolbar">
        {admin && <button className="btn sec" disabled={sending} onClick={enviarEmail}>{sending ? "Enviando…" : "✉️ Enviar por email"}</button>}
        <button className="btn" onClick={() => window.print()}>🖨 Imprimir / Guardar PDF</button>
      </div>

      <div className="sheet">
        <div className="head">
          <div>
            <div className="logo"><img src="/images/febecos-logo.png" alt="FEBECOS" /></div>
            <div className="emisor" style={{ marginTop: 8 }}>
              <div className="rs">{emp.razon_social || "Sandler Guillermo Javier"}</div>
              {(emp.domicilio || emp.localidad) && <div>{[emp.domicilio, emp.localidad, emp.provincia, emp.cod_postal].filter(Boolean).join(" - ")}</div>}
              <div>CUIT: {cuitFmt(emp.cuit) || "20-21730156-5"} · {emisorCond}</div>
              {emp.iibb && cuitFmt(emp.iibb) !== cuitFmt(emp.cuit) && <div>IIBB: {emp.iibb}</div>}
              {emp.inicio_actividades && <div>Inicio de actividades: {emp.inicio_actividades}</div>}
              <div>ventas@febecos.com</div>
            </div>
          </div>
          <div className="letra">
            {esFactura && c.letra ? <div className="L">{c.letra}</div> : null}
          </div>
          <div className="doctype">
            {esFactura && !c.afip_cae && <div className="noval">Documento No Válido como Factura</div>}
            <div className="t">{esFactura ? (c.afip_cae ? "Factura" : "Factura Proforma") : titulo}</div>
            <div className="n">Nº: {c.numero || ""}</div>
            <div>Fecha Emisión: {fmtF(c.fecha)}</div>
            <div>Fecha Vencimiento: {fmtF(c.vencimiento || c.fecha)}</div>
            <div>Hoja 1 de 1</div>
          </div>
        </div>

        <div className="parties">
          <div className="box">
            <div className="lbl">Cliente</div>
            <div className="v">
              <strong>{cli?.razon_social || cli?.nombre || c.cliente_nombre || "—"}</strong><br />
              {(cli?.cuit || c.cliente_cuit) ? <>CUIT: {cuitFmt(cli?.cuit || c.cliente_cuit)}<br /></> : null}
              {c.condicion_iva_receptor ? <>Condición de IVA: {c.condicion_iva_receptor}<br /></> : (cli?.condicion_fiscal ? <>Condición de IVA: {COND[cli.condicion_fiscal] || cli.condicion_fiscal}<br /></> : null)}
              {cli?.domicilio ? <>{cli.domicilio}<br /></> : null}
              {[cli?.localidad, cli?.provincia, cli?.cod_postal].filter(Boolean).join(", ")}
            </div>
          </div>
        </div>

        <table className="items">
          <thead>
            <tr>
              <th className="r">Cant.</th>
              <th>Descripción</th>
              <th className="r">Precio Unit.</th>
              <th className="r">Precio Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it: any, i: number) => (
              <tr key={i}>
                <td className="r">{it.cantidad}</td>
                <td>{it.descripcion}</td>
                <td className="r">{fmt(it.precio_unitario)}</td>
                <td className="r">{fmt(it.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="letras">{importeEnLetras(totalDoc, moneda)}</div>

        <div className="totales">
          <div className="t">
            <div className="row"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
            {ivaLines.map((l, i) => <div className="row" key={i}><span>IVA {l.pct.replace(".", ",")}%</span><span>{fmt(l.monto)}</span></div>)}
            {ivaLines.length === 0 && totalDoc - subtotal > 0.01 && <div className="row"><span>IVA</span><span>{fmt(totalDoc - subtotal)}</span></div>}
            <div className="row grand"><span>TOTAL</span><span>{fmt(totalDoc)}</span></div>
          </div>
        </div>

        {Array.isArray(c.leyendas) && c.leyendas.length > 0 && (
          <div className="leyendas">{c.leyendas.map((l: string, i: number) => <div key={i}>{l}</div>)}</div>
        )}

        {esFactura && c.afip_cae && (
          <div className="cae">C.A.E. Nº: {c.afip_cae}{c.afip_cae_vto ? " · Vto. CAE: " + fmtF(c.afip_cae_vto) : ""}{c.afip_validada ? " · Autorizado por AFIP" : ""}</div>
        )}

        <div className="foot">Documento generado por FEBO-GESTION · febecos.com</div>
      </div>
    </div>
  );
}
