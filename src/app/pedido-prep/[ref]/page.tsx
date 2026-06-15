"use client";
import { useEffect, useState } from "react";

// Documento de PREPARACIÓN de pedido (para depósito). SIN costos ni precios.
// Se abre en pestaña propia (sin el escritorio MDI). ?print=1 imprime solo.
export default function PedidoPrep({ params }: { params: { ref: string } }) {
  const [ped, setPed] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    fetch("/api/pedidos/" + encodeURIComponent(params.ref))
      .then((r) => r.json())
      .then((d) => { if (d.ok) { setPed(d.pedido); if (new URLSearchParams(location.search).get("print") === "1") setTimeout(() => window.print(), 600); } else setErr(d.error || "No encontrado"); })
      .catch((e) => setErr(e.message));
  }, [params.ref]);

  if (err) return <div style={{ padding: 40, color: "#b91c1c", fontFamily: "Arial" }}>✕ {err}</div>;
  if (!ped) return <div style={{ padding: 40, color: "#888", fontFamily: "Arial" }}>Cargando…</div>;

  const pl = ped.payload || {}; const items = pl.items || []; const rev = pl.revendedor || pl.cliente || {};
  const cond = pl.condiciones || {}; const envio = ped.envio_data || {};
  const fecha = ped.fecha ? new Date(ped.fecha).toLocaleDateString("es-AR") : "";
  const nombre = rev.nombre || "—";

  return (
    <div style={{ fontFamily: "Arial, sans-serif", color: "#1c2733", maxWidth: 820, margin: "0 auto", padding: "24px 28px" }}>
      <style>{`@page{size:A4 portrait;margin:14mm}@media print{.noprint{display:none!important}}
        table{border-collapse:collapse;width:100%} `}</style>

      {/* Barra acciones (no imprime) */}
      <div className="noprint" style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 14 }}>
        <button onClick={() => window.print()} style={{ background: "#0b3d6b", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontWeight: 700, cursor: "pointer" }}>🖨 Imprimir / Guardar PDF</button>
        <button onClick={() => window.close()} style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: 8, padding: "9px 18px", cursor: "pointer" }}>Cerrar</button>
      </div>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "3px solid #0b3d6b", paddingBottom: 12, marginBottom: 16 }}>
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="https://fv.febecos.com/images/febecos-logo.png" alt="FEBECOS" style={{ height: 64 }} />
          <div style={{ fontSize: 11, color: "#555", marginTop: 6 }}>Documento interno de preparación · no válido como comprobante</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 13, letterSpacing: 2, color: "#888", textTransform: "uppercase" }}>Pedido</div>
          <div style={{ fontSize: 30, fontWeight: 900, color: "#0b3d6b", lineHeight: 1 }}>{ped.numero}</div>
          <div style={{ fontSize: 12, color: "#555", marginTop: 6 }}>Fecha: {fecha}</div>
          {pl.presupuesto_numero && <div style={{ fontSize: 12, color: "#555" }}>Origen: {pl.presupuesto_numero}</div>}
        </div>
      </div>

      {/* Cliente grande */}
      <div style={{ background: "#f4f6f9", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", fontWeight: 700 }}>Cliente</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#0b3d6b" }}>{nombre}</div>
        <div style={{ fontSize: 13, color: "#374151", marginTop: 4 }}>
          {rev.empresa ? rev.empresa + " · " : ""}{rev.whatsapp || rev.wa || ""}{rev.localidad ? " · " + rev.localidad : ""}
        </div>
        {(envio.transporte || envio.direccion) && (
          <div style={{ fontSize: 13, color: "#374151", marginTop: 6, borderTop: "1px dashed #d1d5db", paddingTop: 6 }}>
            <b>Envío:</b> {[envio.transporte, envio.direccion, envio.localidad, envio.contacto].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>

      {/* Ítems — SIN costos ni precios */}
      <table>
        <thead>
          <tr style={{ background: "#0b3d6b", color: "#fff" }}>
            <th style={{ textAlign: "center", padding: "8px 10px", width: 70, fontSize: 12 }}>Cant.</th>
            <th style={{ textAlign: "left", padding: "8px 10px", width: 180, fontSize: 12 }}>Código</th>
            <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 12 }}>Descripción</th>
            <th style={{ textAlign: "center", padding: "8px 10px", width: 80, fontSize: 12 }}>✔</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it: any, i: number) => (
            <tr key={i} style={{ borderBottom: "1px solid #e1e6ec" }}>
              <td style={{ textAlign: "center", padding: "10px", fontSize: 18, fontWeight: 800 }}>{it.cantidad || 1}</td>
              <td style={{ padding: "10px", fontWeight: 700, color: "#0b3d6b" }}>{it.codigo || ""}</td>
              <td style={{ padding: "10px", fontSize: 13 }}>{it.descripcion || ""}{it.proveedor ? <span style={{ color: "#94a3b8", fontSize: 11 }}> · {it.proveedor}</span> : null}</td>
              <td style={{ textAlign: "center", padding: "10px" }}><span style={{ display: "inline-block", width: 20, height: 20, border: "2px solid #c8d0da", borderRadius: 4 }} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      {pl.notas && <div style={{ marginTop: 14, fontSize: 12, color: "#555", borderLeft: "3px solid #0b3d6b", padding: "6px 10px", background: "#f7f9fc" }}><b>Notas:</b> {pl.notas}</div>}

      <div style={{ marginTop: 30, display: "flex", justifyContent: "space-between", fontSize: 12, color: "#888", borderTop: "1px solid #e1e6ec", paddingTop: 10 }}>
        <div>Preparado por: __________________</div>
        <div>Control: __________________</div>
        <div>Fecha: ____ / ____ / ____</div>
      </div>
    </div>
  );
}
