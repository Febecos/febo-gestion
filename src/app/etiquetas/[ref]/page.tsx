"use client";
import { useEffect, useState } from "react";

// Etiquetas de envío imprimibles — 4 por hoja A4 (2×2). Remitente fijo (FEBECOS) +
// destinatario tomado del envío del cliente. Cada campo es EDITABLE antes de imprimir.
// Se abre en ventana nueva desde el pedido: /etiquetas/PED-XXXX

const REMITENTE = {
  nombre: "FEBECOS — Energía Solar",
  direccion: "Rojas 441",
  localidad: "C.A.B.A.",
  cp: "1405",
  tel: "11 2575 0323",
};

type Etiqueta = {
  dest_nombre: string;
  dest_direccion: string;
  dest_localidad: string;
  dest_provincia: string;
  dest_cp: string;
  dest_tel: string;
  dest_doc: string;
  transporte: string;
  obs: string;
};

function Campo({ value, onChange, ph, bold, big }: { value: string; onChange: (v: string) => void; ph: string; bold?: boolean; big?: boolean }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={ph}
      className="et-input"
      style={{ fontWeight: bold ? 700 : 400, fontSize: big ? "13pt" : "10.5pt" }}
    />
  );
}

export default function EtiquetasPage({ params }: { params: { ref: string } }) {
  const ref = decodeURIComponent(params.ref);
  const [labels, setLabels] = useState<Etiqueta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/pedidos/" + encodeURIComponent(ref), { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const p = d?.pedido || {};
        const env = p.cliente_envio || p.payload?.envio || {};
        const cli = p.cliente || {};
        const base: Etiqueta = {
          dest_nombre: env.nombre || cli.razon_social || cli.nombre || "",
          dest_direccion: env.direccion || cli.domicilio || "",
          dest_localidad: env.localidad || cli.localidad || "",
          dest_provincia: env.provincia || cli.provincia || "",
          dest_cp: env.cp || cli.cod_postal || "",
          dest_tel: env.telefono || cli.whatsapp || "",
          dest_doc: env.dni || cli.cuit || "",
          transporte: [env.empresa, env.tipo_envio].filter(Boolean).join(" · "),
          obs: "Pedido " + ref,
        };
        // 4 copias por defecto (una hoja A4 completa); cada una editable por separado.
        setLabels([base, { ...base }, { ...base }, { ...base }]);
        setLoading(false);
      })
      .catch(() => { setLoading(false); });
  }, [ref]);

  const upd = (i: number, k: keyof Etiqueta, v: string) => setLabels((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const agregar = () => setLabels((ls) => [...ls, { ...(ls[ls.length - 1] || {} as Etiqueta) }]);
  const quitar = (i: number) => setLabels((ls) => ls.filter((_, j) => j !== i));

  if (loading) return <div style={{ padding: 40, fontFamily: "system-ui" }}>Cargando etiquetas…</div>;

  return (
    <div className="et-root">
      <style>{`
        @page { size: A4 portrait; margin: 8mm; }
        .et-root { font-family: 'Trebuchet MS','Segoe UI',Verdana,sans-serif; color:#111; background:#eef2f6; min-height:100vh; }
        .et-toolbar { position:sticky; top:0; background:#0b3d6b; color:#fff; padding:12px 20px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; z-index:10; }
        .et-toolbar button { border:0; border-radius:8px; padding:9px 16px; font-weight:700; font-size:13px; cursor:pointer; }
        .et-print { background:#22c55e; color:#fff; }
        .et-add { background:#ffffff; color:#0b3d6b; }
        .et-sheet { max-width:210mm; margin:16px auto; background:#fff; padding:8mm; box-shadow:0 2px 14px rgba(0,0,0,.1); }
        .et-grid { display:grid; grid-template-columns:1fr 1fr; grid-auto-rows:130mm; gap:4mm; }
        .et-label { border:1.5px dashed #94a3b8; border-radius:6px; padding:6mm; display:flex; flex-direction:column; gap:2mm; position:relative; overflow:hidden; }
        .et-rem { font-size:9pt; color:#475569; border-bottom:1px solid #e2e8f0; padding-bottom:2mm; }
        .et-rem b { color:#0b3d6b; }
        .et-dest-lbl { font-size:8pt; letter-spacing:.5px; color:#64748b; text-transform:uppercase; margin-top:1mm; }
        .et-input { width:100%; border:0; border-bottom:1px solid #e2e8f0; padding:1.5mm 0; outline:none; background:transparent; }
        .et-input:focus { border-bottom-color:#0b3d6b; background:#f8fafc; }
        .et-row { display:flex; gap:2mm; }
        .et-del { position:absolute; top:3mm; right:3mm; border:0; background:#fee2e2; color:#dc2626; border-radius:6px; width:22px; height:22px; cursor:pointer; font-weight:700; }
        @media print {
          .et-toolbar, .et-del { display:none !important; }
          .et-root { background:#fff; }
          .et-sheet { box-shadow:none; margin:0; padding:0; max-width:none; }
          .et-grid { gap:3mm; grid-auto-rows:138mm; }
          .et-label { border:1px dashed #999; page-break-inside:avoid; }
          .et-input { border-bottom-color:transparent; }
        }
      `}</style>

      <div className="et-toolbar">
        <button className="et-print" onClick={() => window.print()}>🖨️ Imprimir / Guardar PDF</button>
        <button className="et-add" onClick={agregar}>＋ Agregar etiqueta</button>
        <span style={{ fontSize: 13, opacity: .9 }}>Etiquetas de {ref} · {labels.length} etiqueta(s) · 4 por hoja A4 · editá cualquier campo antes de imprimir</span>
      </div>

      <div className="et-sheet">
        <div className="et-grid">
          {labels.map((l, i) => (
            <div key={i} className="et-label">
              <button className="et-del" title="Quitar esta etiqueta" onClick={() => quitar(i)}>✕</button>
              <div className="et-rem">
                <b>REMITE:</b> {REMITENTE.nombre} · {REMITENTE.direccion}, {REMITENTE.localidad} ({REMITENTE.cp}) · Tel {REMITENTE.tel}
              </div>
              <div className="et-dest-lbl">Destinatario</div>
              <Campo value={l.dest_nombre} onChange={(v) => upd(i, "dest_nombre", v)} ph="Nombre / Razón social" bold big />
              <Campo value={l.dest_direccion} onChange={(v) => upd(i, "dest_direccion", v)} ph="Dirección" />
              <div className="et-row">
                <Campo value={l.dest_localidad} onChange={(v) => upd(i, "dest_localidad", v)} ph="Localidad" />
                <Campo value={l.dest_provincia} onChange={(v) => upd(i, "dest_provincia", v)} ph="Provincia" />
                <Campo value={l.dest_cp} onChange={(v) => upd(i, "dest_cp", v)} ph="CP" />
              </div>
              <div className="et-row">
                <Campo value={l.dest_tel} onChange={(v) => upd(i, "dest_tel", v)} ph="Teléfono" />
                <Campo value={l.dest_doc} onChange={(v) => upd(i, "dest_doc", v)} ph="CUIT / DNI" />
              </div>
              <Campo value={l.transporte} onChange={(v) => upd(i, "transporte", v)} ph="Transporte / tipo de envío" />
              <Campo value={l.obs} onChange={(v) => upd(i, "obs", v)} ph="Observaciones" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
