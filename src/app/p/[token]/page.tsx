"use client";
import { useEffect, useState } from "react";

const TITULO: Record<string, string> = { presupuesto: "PRESUPUESTO", pedido: "PEDIDO", factura: "FACTURA", remito: "REMITO" };
const COND: Record<string, string> = {
  responsable_inscripto: "Responsable Inscripto", monotributista: "Monotributista",
  consumidor_final: "Consumidor Final", exento: "Exento",
};
// Código de comprobante AFIP según letra (para "Cód. NN")
const CODIGO: Record<string, string> = { A: "01", B: "06", C: "11", E: "19", M: "51" };
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
  return `SON ${mon} ${enLetras(ent)} con ${String(cent).padStart(2, "0")}/100`;
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

  // Subtotal BRUTO (suma de ítems, antes de descuento)
  const subtotalBruto = items.reduce((a: number, it: any) => a + (Number(it.total) || 0), 0) || Number(c.subtotal_bruto) || Number(c.subtotal) || 0;
  // Descuento general (pct + monto)
  const descPct = Number(c.descuento_general_pct ?? c.descuento_pct ?? 0);
  const descMonto = Number(c.descuento_general_monto ?? c.descuento_monto ?? (descPct ? subtotalBruto * descPct / 100 : 0));
  const tieneDesc = descMonto > 0.009;
  // Neto gravado (después de descuento)
  const neto = Number(c.neto ?? c.subtotal ?? (subtotalBruto - descMonto));

  const emisorCond = emp.condicion_iva || "Responsable Inscripto";
  const letra = (c.letra || "").toUpperCase();
  // Solo las Facturas A y M discriminan IVA. B (consumidor final/exento) y C (monotributo) NO: el precio ya lo incluye.
  const discriminaIva = letra === "A" || letra === "M";

  // Detalle de IVA: acepta objeto {"21":monto,"10.5":monto} o array [{pct,monto}]
  let ivaLines: { pct: string; monto: number }[] = [];
  if (discriminaIva) {
    const idet = c.iva_detalle;
    if (Array.isArray(idet)) ivaLines = idet.map((x: any) => ({ pct: String(x.pct ?? x.alicuota ?? ""), monto: Number(x.monto ?? x.importe ?? 0) }));
    else if (idet && typeof idet === "object") ivaLines = Object.entries(idet).map(([pct, monto]) => ({ pct, monto: Number(monto) }));
    ivaLines = ivaLines.filter((l) => l.monto > 0).sort((a, b) => Number(b.pct) - Number(a.pct));
  }
  const ivaTotal = ivaLines.reduce((a, l) => a + l.monto, 0);
  // A/M: total = neto gravado + IVA. B/C: total = bruto - descuento (IVA ya incluido en los precios).
  const totalDoc = Number(c.total) || (discriminaIva ? neto + ivaTotal : subtotalBruto - descMonto);
  const codigo = CODIGO[letra] || "";
  const condReceptor = c.condicion_iva_receptor || (cli?.condicion_fiscal ? (COND[cli.condicion_fiscal] || cli.condicion_fiscal) : "");

  return (
    <div className="doc-wrap">
      <style>{`
        :root { --azul:#0b3d6b; }
        body { background:#e5e7eb; }
        .doc-wrap { max-width: 820px; margin: 0 auto; padding: 24px 16px 60px; }
        .toolbar { display:flex; gap:8px; justify-content:flex-end; margin-bottom:16px; }
        .btn { background:var(--azul); color:#fff; border:0; border-radius:8px; padding:10px 18px; font-size:14px; font-weight:600; cursor:pointer; }
        .btn.sec { background:#fff; color:#334155; border:1px solid #cbd5e1; }
        .sheet { background:#fff; border:1px solid #d1d5db; border-radius:6px; padding:30px 34px; color:#1f2937; font-size:12px; position:relative; }
        .original { position:absolute; top:14px; right:18px; font-size:10px; font-weight:700; letter-spacing:1px; color:#6b7280; }
        .head { display:grid; grid-template-columns: 1fr 64px 1fr; align-items:flex-start; border-bottom:2px solid var(--azul); padding-bottom:14px; }
        .logo img { max-height:62px; max-width:200px; }
        .emisor { font-size:11px; line-height:1.45; }
        .emisor .rs { font-size:15px; font-weight:800; color:var(--azul); }
        .letra { text-align:center; }
        .letra .L { display:inline-block; border:2px solid #111; border-radius:6px; width:46px; height:46px; line-height:44px; font-size:30px; font-weight:800; }
        .letra .cod { font-size:9px; color:#555; margin-top:2px; }
        .doctype { text-align:right; font-size:11px; line-height:1.5; }
        .doctype .t { font-size:18px; font-weight:800; color:#111827; }
        .doctype .n { font-size:14px; font-weight:700; }
        .noval { display:inline-block; font-size:10px; font-weight:700; color:#374151; border:1px solid #9ca3af; border-radius:4px; padding:3px 8px; margin-bottom:6px; }
        .parties { margin:12px 0; border:1px solid #e5e7eb; border-radius:6px; padding:9px 11px; }
        .parties .lbl { font-size:9px; text-transform:uppercase; color:#9ca3af; font-weight:700; margin-bottom:3px; }
        .parties .v { line-height:1.5; }
        .venta { display:grid; grid-template-columns:1fr 1fr; gap:2px 24px; font-size:11px; color:#374151; margin:10px 0; }
        .venta .k { color:#6b7280; }
        table.items { width:100%; border-collapse:collapse; margin-top:6px; }
        table.items th { background:var(--azul); color:#fff; text-align:left; padding:6px 9px; font-size:10px; text-transform:uppercase; }
        table.items td { padding:5px 9px; border-bottom:1px solid #eef2f7; vertical-align:top; }
        table.items td.r, table.items th.r { text-align:right; white-space:nowrap; }
        .letras { margin-top:12px; font-size:11.5px; font-style:italic; color:#374151; }
        table.totband { width:100%; border-collapse:collapse; margin-top:10px; }
        table.totband th { background:#f1f5f9; border:1px solid #cbd5e1; text-align:center; padding:5px 8px; font-size:10px; font-weight:700; color:#334155; text-transform:none; }
        table.totband td { border:1px solid #cbd5e1; text-align:center; padding:6px 8px; font-size:12px; white-space:nowrap; }
        table.totband td.desc { color:#b91c1c; }
        table.totband th.tot, table.totband td.tot { background:var(--azul); color:#fff; font-weight:800; }
        table.totband td.tot { font-size:13.5px; }
        .leyendas { margin-top:14px; font-size:10px; color:#4b5563; border-top:1px solid #e5e7eb; padding-top:8px; line-height:1.5; }
        .cae { margin-top:16px; padding:10px 12px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; font-size:12px; color:#166534; display:flex; align-items:center; gap:14px; }
        .foot { margin-top:24px; text-align:center; font-size:10px; color:#9ca3af; }
        @media print {
          body { background:#fff; }
          .toolbar { display:none !important; }
          .doc-wrap { max-width:none; padding:0; }
          .sheet { border:0; border-radius:0; padding:0; font-size:11px; }
          @page { size: A4; margin: 12mm; }
        }
      `}</style>

      <div className="toolbar">
        {admin && <button className="btn sec" disabled={sending} onClick={enviarEmail}>{sending ? "Enviando…" : "✉️ Enviar por email"}</button>}
        <button className="btn" onClick={() => window.print()}>🖨 Imprimir / Guardar PDF</button>
      </div>

      <div className="sheet">
        <div className="original">{c.copia || "ORIGINAL"}</div>
        <div className="head">
          <div>
            <div className="logo"><img src="/images/febecos-logo-factura.png" alt="FEBECOS" onError={(e) => { (e.target as HTMLImageElement).src = "/images/febecos-logo.png"; }} /></div>
            <div className="emisor" style={{ marginTop: 8 }}>
              <div className="rs">{emp.razon_social || "Sandler Guillermo Javier"}</div>
              <div>{emp.domicilio || "Rojas 441"}</div>
              <div>{[`(${emp.cod_postal || "1405"})`, emp.localidad || "Buenos Aires", emp.provincia || "C.A.B.A.", "Argentina"].filter(Boolean).join(" - ")}</div>
              {(emp.telefono || "549 11 2575 0323") && <div>Tel: {emp.telefono || "549 11 2575 0323"}</div>}
              <div>E-mail: {emp.email || "ventas@febecos.com"}</div>
              <div>CUIT: {cuitFmt(emp.cuit) || "20-21730156-5"}</div>
              <div>Inicio de actividades: {emp.inicio_actividades || "10/2017"}</div>
              <div>Condición Fiscal: {emisorCond}</div>
            </div>
          </div>
          <div className="letra">
            {esFactura && letra ? <><div className="L">{letra}</div>{codigo && <div className="cod">Cód. {codigo}</div>}</> : null}
          </div>
          <div className="doctype">
            {esFactura && !c.afip_cae && <div className="noval">Documento No Válido como Factura</div>}
            <div className="t">{esFactura ? (c.afip_cae ? "FACTURA" : "FACTURA PROFORMA") : titulo}</div>
            <div className="n">Nº: {c.numero || ""}</div>
            <div>Fecha Emisión: {fmtF(c.fecha)}</div>
            <div>Fecha Vencimiento: {fmtF(c.vencimiento || c.fecha)}</div>
            <div>Hoja 1 de {Math.max(1, Math.ceil(items.length / 22))}</div>
          </div>
        </div>

        <div className="parties">
          <div className="lbl">Señor (es)</div>
          <div className="v">
            <strong>{cli?.razon_social || cli?.nombre || c.cliente_nombre || "—"}</strong><br />
            {cli?.domicilio ? <>Domicilio: {cli.domicilio}{[cli?.localidad, cli?.provincia, cli?.cod_postal].some(Boolean) ? " " : ""}{[cli?.cod_postal ? `(${cli.cod_postal})` : "", cli?.localidad, cli?.provincia].filter(Boolean).join(" - ")}<br /></> : null}
            {(cli?.cuit || c.cliente_cuit) ? <>CUIT: {cuitFmt(cli?.cuit || c.cliente_cuit)}</> : null}
            {condReceptor ? <>{(cli?.cuit || c.cliente_cuit) ? " · " : ""}Condición de IVA: {condReceptor}</> : null}
          </div>
        </div>

        {(c.condiciones_venta || c.forma_pago || c.lugar_entrega || c.tipo_transporte) && (
          <div className="venta">
            {c.condiciones_venta && <div><span className="k">Condiciones de Venta: </span>{c.condiciones_venta}</div>}
            {c.forma_pago && <div><span className="k">Forma de Pago: </span>{c.forma_pago}</div>}
            {c.lugar_entrega && <div style={{ gridColumn: "1 / -1" }}><span className="k">Lugar de Entrega: </span>{c.lugar_entrega}</div>}
            {c.tipo_transporte && <div style={{ gridColumn: "1 / -1" }}><span className="k">Tipo de Transporte: </span>{c.tipo_transporte}</div>}
          </div>
        )}

        <table className="items">
          <thead>
            <tr>
              <th className="r">Cantidad</th>
              <th>Descripción</th>
              <th className="r">Precio Unitario</th>
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
            {tieneDesc && (
              <tr>
                <td className="r"></td>
                <td><em>Descuento General {descPct ? descPct.toLocaleString("es-AR") + " %" : ""}</em></td>
                <td className="r"></td>
                <td className="r" style={{ color: "#b91c1c" }}>-{fmt(descMonto)}</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="letras">{importeEnLetras(totalDoc, moneda)}</div>

        <table className="totband">
          <thead>
            <tr>
              <th>SubTotal</th>
              {tieneDesc && <th>Descuento {descPct ? descPct.toLocaleString("es-AR") + " %" : ""}</th>}
              {tieneDesc && discriminaIva && <th>SubTotal</th>}
              {ivaLines.map((l, i) => <th key={i}>IVA {l.pct.replace(".", ",")} %</th>)}
              {ivaLines.length === 0 && totalDoc - neto > 0.01 && <th>IVA</th>}
              <th className="tot">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{fmt(subtotalBruto)}</td>
              {tieneDesc && <td className="desc">-{fmt(descMonto)}</td>}
              {tieneDesc && discriminaIva && <td>{fmt(neto)}</td>}
              {ivaLines.map((l, i) => <td key={i}>{fmt(l.monto)}</td>)}
              {ivaLines.length === 0 && totalDoc - neto > 0.01 && <td>{fmt(totalDoc - neto)}</td>}
              <td className="tot">{fmt(totalDoc)}</td>
            </tr>
          </tbody>
        </table>

        {Array.isArray(c.leyendas) && c.leyendas.length > 0 && (
          <div className="leyendas">{c.leyendas.map((l: string, i: number) => <div key={i}>{l}</div>)}</div>
        )}

        {esFactura && c.afip_cae && (
          <div className="cae">
            {c.afip_qr && <img src={`https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=${encodeURIComponent(c.afip_qr)}`} alt="QR AFIP" style={{ width: 90, height: 90 }} />}
            <div>
              <div style={{ fontWeight: 700 }}>Comprobante autorizado por ARCA (AFIP)</div>
              <div>C.A.E. Nº: <b>{c.afip_cae}</b>{c.afip_cae_vto ? <> · Vto. CAE: {String(c.afip_cae_vto).replace(/^(\d{4})(\d{2})(\d{2})$/, "$3/$2/$1")}</> : ""}</div>
            </div>
          </div>
        )}

        <div className="foot">Documento generado por FEBO-GESTION · febecos.com</div>
      </div>
    </div>
  );
}
