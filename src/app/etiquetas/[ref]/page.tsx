"use client";
import { useEffect, useRef, useState } from "react";

// Etiquetas de envío imprimibles — 4 por hoja A4 (2×2). Remitente fijo (FEBECOS) +
// destinatario tomado del envío del cliente. Los datos son ÚNICOS y compartidos:
// editar un campo (con su ✎) lo cambia en TODAS las etiquetas a la vez.

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

// CUIT/CUIL a formato con guiones: 20-21730156-5
function fmtDoc(v: string): string {
  const d = String(v || "").replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
  return v || "";
}

// Texto que se autoajusta al ancho del contenedor (baja la tipografía hasta entrar).
function FitText({ text, className, max = 16 }: { text: string; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let fs = max; el.style.fontSize = fs + "pt";
    let guard = 0;
    while (el.scrollWidth > el.clientWidth && fs > 7 && guard < 60) { fs -= 0.5; el.style.fontSize = fs + "pt"; guard++; }
  }, [text, max]);
  return <div ref={ref} className={className} style={{ whiteSpace: "nowrap", overflow: "hidden", width: "100%" }}>{text || " "}</div>;
}

export default function EtiquetasPage({ params }: { params: { ref: string } }) {
  const ref = decodeURIComponent(params.ref);
  const [data, setData] = useState<Etiqueta | null>(null);
  const [count, setCount] = useState(4);
  const [editKey, setEditKey] = useState<keyof Etiqueta | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/pedidos/" + encodeURIComponent(ref), { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const p = d?.pedido || {};
        const env = p.cliente_envio || p.payload?.envio || {};
        const cli = p.cliente || {};
        setData({
          dest_nombre: env.nombre || cli.razon_social || cli.nombre || "",
          dest_direccion: env.direccion || cli.domicilio || "",
          dest_localidad: env.localidad || cli.localidad || "",
          dest_provincia: env.provincia || cli.provincia || "",
          dest_cp: env.cp || cli.cod_postal || "",
          dest_tel: env.telefono || cli.whatsapp || "",
          dest_doc: env.dni || cli.cuit || "",
          transporte: [env.empresa, env.tipo_envio].filter(Boolean).join(" · "),
          obs: "Pedido " + ref,
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [ref]);

  const upd = (k: keyof Etiqueta, v: string) => setData((d) => (d ? { ...d, [k]: v } : d));

  if (loading || !data) return <div style={{ padding: 40, fontFamily: "system-ui" }}>Cargando etiquetas…</div>;

  // Campo editable compartido: por defecto muestra el valor; el ✎ lo pasa a input (y al editarlo cambia en todas).
  const Campo = ({ k, ph, fmt }: { k: keyof Etiqueta; ph: string; fmt?: (v: string) => string }) => {
    const editing = editKey === k;
    const val = data[k];
    return (
      <div className="et-field">
        {editing
          ? <input autoFocus value={val} placeholder={ph} onChange={(e) => upd(k, e.target.value)} onBlur={() => setEditKey(null)} onKeyDown={(e) => { if (e.key === "Enter") setEditKey(null); }} className="et-input" />
          : <span className="et-val" onClick={() => setEditKey(k)}>{val ? (fmt ? fmt(val) : val) : <span className="et-ph">{ph}</span>}</span>}
        <button className="et-edit" title="Editar este campo (se aplica a todas las etiquetas)" onClick={() => setEditKey(editing ? null : k)}>✎</button>
      </div>
    );
  };

  return (
    <div className="et-root">
      <style>{`
        @page { size: A4 portrait; margin: 8mm; }
        .et-root { font-family: 'Trebuchet MS','Segoe UI',Verdana,sans-serif; color:#111; background:#eef2f6; min-height:100vh; }
        .et-toolbar { position:sticky; top:0; background:#0b3d6b; color:#fff; padding:12px 20px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; z-index:10; }
        .et-toolbar button { border:0; border-radius:8px; padding:9px 16px; font-weight:700; font-size:13px; cursor:pointer; }
        .et-print { background:#22c55e; color:#fff; }
        .et-cnt { background:#ffffff; color:#0b3d6b; width:34px; padding:9px 0; }
        .et-sheet { max-width:210mm; margin:16px auto; background:#fff; padding:8mm; box-shadow:0 2px 14px rgba(0,0,0,.1); }
        .et-grid { display:grid; grid-template-columns:1fr 1fr; grid-auto-rows:130mm; gap:4mm; }
        .et-label { border:1.5px dashed #94a3b8; border-radius:6px; padding:6mm; display:flex; flex-direction:column; gap:2mm; overflow:hidden; }
        .et-rem { font-size:9pt; color:#475569; border-bottom:1px solid #e2e8f0; padding-bottom:2mm; }
        .et-rem b { color:#0b3d6b; }
        .et-dest-lbl { font-size:8pt; letter-spacing:.5px; color:#64748b; text-transform:uppercase; margin-top:1mm; }
        .et-name { font-weight:800; text-transform:uppercase; color:#0b1220; letter-spacing:.3px; }
        .et-field { display:flex; align-items:center; gap:1mm; border-bottom:1px solid #eef2f6; }
        .et-val { flex:1; padding:1.5mm 0; font-size:10.5pt; cursor:text; min-height:6mm; }
        .et-ph { color:#cbd5e1; }
        .et-input { flex:1; border:0; border-bottom:1.5px solid #0b3d6b; padding:1.5mm 0; outline:none; background:#f8fafc; font-size:10.5pt; font-family:inherit; }
        .et-edit { border:0; background:transparent; color:#94a3b8; cursor:pointer; font-size:12px; padding:2px 4px; border-radius:4px; }
        .et-edit:hover { color:#0b3d6b; background:#eef2f6; }
        .et-row { display:flex; gap:2mm; }
        .et-row > * { flex:1; }
        @media print {
          .et-toolbar, .et-edit { display:none !important; }
          .et-root { background:#fff; }
          .et-sheet { box-shadow:none; margin:0; padding:0; max-width:none; }
          .et-grid { gap:3mm; grid-auto-rows:138mm; }
          .et-label { border:1px dashed #999; page-break-inside:avoid; }
          .et-field { border-bottom-color:transparent; }
        }
      `}</style>

      <div className="et-toolbar">
        <button className="et-print" onClick={() => window.print()}>🖨️ Imprimir / Guardar PDF</button>
        <span style={{ fontSize: 13 }}>Etiquetas:</span>
        <button className="et-cnt" onClick={() => setCount((c) => Math.max(1, c - 1))}>－</button>
        <span style={{ fontWeight: 700, minWidth: 18, textAlign: "center" }}>{count}</span>
        <button className="et-cnt" onClick={() => setCount((c) => Math.min(40, c + 1))}>＋</button>
        <span style={{ fontSize: 13, opacity: .9 }}>{ref} · 4 por hoja A4 · tocá un campo o su ✎ para editar — se aplica a todas</span>
      </div>

      <div className="et-sheet">
        <div className="et-grid">
          {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="et-label">
              <div className="et-rem">
                <b>REMITE:</b> {REMITENTE.nombre} · {REMITENTE.direccion}, {REMITENTE.localidad} ({REMITENTE.cp}) · Tel {REMITENTE.tel}
              </div>
              <div className="et-dest-lbl">Destinatario</div>
              {/* Nombre: mayúsculas, todo el ancho, autoajuste. Edita con ✎ (se replica a todas). */}
              <div className="et-field">
                {editKey === "dest_nombre"
                  ? <input autoFocus value={data.dest_nombre} placeholder="Nombre / Razón social" onChange={(e) => upd("dest_nombre", e.target.value)} onBlur={() => setEditKey(null)} onKeyDown={(e) => { if (e.key === "Enter") setEditKey(null); }} className="et-input et-name" />
                  : <div className="et-val" style={{ cursor: "text" }} onClick={() => setEditKey("dest_nombre")}>{data.dest_nombre ? <FitText text={data.dest_nombre.toUpperCase()} className="et-name" max={16} /> : <span className="et-ph">NOMBRE / RAZÓN SOCIAL</span>}</div>}
                <button className="et-edit" title="Editar este campo (se aplica a todas las etiquetas)" onClick={() => setEditKey(editKey === "dest_nombre" ? null : "dest_nombre")}>✎</button>
              </div>
              <Campo k="dest_direccion" ph="Dirección" />
              <div className="et-row">
                <Campo k="dest_localidad" ph="Localidad" />
                <Campo k="dest_provincia" ph="Provincia" />
                <Campo k="dest_cp" ph="CP" />
              </div>
              <div className="et-row">
                <Campo k="dest_tel" ph="Teléfono" />
                <Campo k="dest_doc" ph="CUIT / DNI" fmt={fmtDoc} />
              </div>
              <Campo k="transporte" ph="Transporte / tipo de envío" />
              <Campo k="obs" ph="Observaciones" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
