"use client";
import { useEffect, useState } from "react";

const TIPOS = ["", "Puerta a puerta", "A sucursal de transporte", "Retira en depósito", "Flete propio"];

export default function EnvioCliente({ params }: { params: { token: string } }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);
  const [f, setF] = useState<any>({ nombre: "", dni: "", telefono: "", email: "", direccion: "", localidad: "", provincia: "", cp: "", empresa: "", tipo_envio: "", domicilio_transporte: "", telefono_transporte: "", valor_declarado: "" });

  useEffect(() => {
    fetch("/api/public/envio/" + params.token).then((r) => r.json()).then((j) => {
      if (!j.ok) { setErr(j.error || "No encontrado"); return; }
      setD(j);
      const e = j.envio || {};
      setF((prev: any) => ({ ...prev, ...e, nombre: e.nombre || j.cliente_nombre || "" }));
    }).catch((e) => setErr(e.message));
  }, [params.token]);

  const [sug, setSug] = useState<any[] | null>(null);
  const set = (k: string) => (ev: any) => setF({ ...f, [k]: ev.target.value });

  // Al elegir/escribir una empresa que está en el maestro, autocompleta su teléfono.
  const setEmpresa = (ev: any) => {
    const val = ev.target.value;
    const m = (d?.transportistas || []).find((t: any) => t.nombre.toLowerCase() === val.toLowerCase());
    setF((prev: any) => ({ ...prev, empresa: val, telefono_transporte: m?.telefono && !prev.telefono_transporte ? m.telefono : prev.telefono_transporte }));
  };
  // Sugerir transportes que cubran la provincia del cliente (validado contra el maestro).
  const buscarPorProvincia = () => {
    const prov = String(f.provincia || "").trim().toLowerCase();
    if (!prov) { alert("Completá tu provincia primero."); return; }
    const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const list = (d?.transportistas || []).filter((t: any) => (t.provincias || []).some((p: string) => norm(p).includes(norm(prov)) || norm(prov).includes(norm(p))));
    setSug(list);
  };
  const elegirSug = (t: any) => { setF((prev: any) => ({ ...prev, empresa: t.nombre, telefono_transporte: t.telefono || prev.telefono_transporte })); setSug(null); };
  const guardar = async () => {
    for (const [k, lbl] of [["nombre", "Nombre"], ["direccion", "Dirección"], ["localidad", "Localidad"], ["provincia", "Provincia"]] as const) {
      if (!String(f[k] || "").trim()) { alert("Completá: " + lbl); return; }
    }
    setSaving(true);
    try {
      const r = await fetch("/api/public/envio/" + params.token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ envio: f }) });
      const j = await r.json();
      if (j.ok) setOk(true); else alert("No se pudo guardar: " + (j.error || "error"));
    } catch (e: any) { alert("Error: " + e.message); } finally { setSaving(false); }
  };

  if (err) return <div style={{ padding: 40, textAlign: "center", color: "#6b7280" }}>⚠️ {err}</div>;
  if (!d) return <div style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>Cargando…</div>;

  if (ok) return (
    <div className="wrap"><style>{CSS}</style>
      <div className="card" style={{ textAlign: "center" }}>
        <img src="/images/febecos-logo-factura.png" alt="FEBECOS" style={{ height: 46, margin: "0 auto 16px" }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        <div style={{ fontSize: 44 }}>✅</div>
        <h1 style={{ color: "#0b3d6b", margin: "8px 0" }}>¡Datos enviados!</h1>
        <p style={{ color: "#475569" }}>Recibimos tus datos de envío para el pedido <b>{d.numero}</b>. Coordinaremos el despacho y te avisaremos. ¡Gracias!</p>
      </div>
    </div>
  );

  return (
    <div className="wrap"><style>{CSS}</style>
      <div className="card">
        <div className="head">
          <img src="/images/febecos-logo-factura.png" alt="FEBECOS" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          <div>
            <div className="t">Datos de envío</div>
            <div className="s">Pedido {d.numero}{d.completado ? " · ya cargado (podés actualizarlo)" : ""}</div>
          </div>
        </div>
        <p className="intro">Completá los datos para que podamos despacharte el pedido. Los campos con * son obligatorios.</p>

        <div className="sec">📦 Destinatario</div>
        <div className="grid">
          <L l="Nombre y apellido / Razón social *"><input value={f.nombre} onChange={set("nombre")} /></L>
          <L l="DNI / CUIT"><input value={f.dni} onChange={set("dni")} /></L>
          <L l="Dirección de entrega *" full><input value={f.direccion} onChange={set("direccion")} placeholder="Calle, número, piso/depto" /></L>
          <L l="Localidad *"><input value={f.localidad} onChange={set("localidad")} /></L>
          <L l="Provincia *"><input value={f.provincia} onChange={set("provincia")} /></L>
          <L l="Código Postal"><input value={f.cp} onChange={set("cp")} /></L>
          <L l="Teléfono de contacto"><input value={f.telefono} onChange={set("telefono")} placeholder="WhatsApp o celular" /></L>
          <L l="Email" full><input value={f.email} onChange={set("email")} type="email" /></L>
        </div>

        <div className="sec">🚚 Transporte (opcional)</div>
        <div className="grid">
          <L l="Empresa de transporte" full>
            <input value={f.empresa} onChange={setEmpresa} list="transportes" placeholder="Elegí de la lista o escribí uno nuevo" autoComplete="off" />
            <datalist id="transportes">{(d.transportistas || []).map((t: any) => <option key={t.id} value={t.nombre} />)}</datalist>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <button type="button" onClick={buscarPorProvincia} style={{ background: "#eef2ff", color: "#0b3d6b", border: "1px solid #c7d2fe", borderRadius: 8, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>🔎 Buscar transporte que llegue a mi provincia</button>
              <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 400 }}>Si no está, escribilo: lo agregamos a nuestra base.</span>
            </div>
            {sug !== null && (
              <div style={{ marginTop: 6, border: "1px solid #e2e8f0", borderRadius: 8, padding: 8, background: "#f8fafc" }}>
                {sug.length === 0
                  ? <span style={{ fontSize: 12, color: "#b45309" }}>No tenemos transportes registrados que cubran "{f.provincia}". Podés escribir uno y lo damos de alta.</span>
                  : <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {sug.map((t: any) => <button key={t.id} type="button" onClick={() => elegirSug(t)} style={{ background: "#fff", border: "1px solid #cbd5e1", borderRadius: 999, padding: "5px 12px", fontSize: 12, cursor: "pointer" }}>🚚 {t.nombre}{t.telefono ? ` · ${t.telefono}` : ""}</button>)}
                    </div>}
              </div>
            )}
          </L>
          <L l="Tipo de envío"><select value={f.tipo_envio} onChange={set("tipo_envio")}>{TIPOS.map((t) => <option key={t} value={t}>{t || "Seleccioná…"}</option>)}</select></L>
          <L l="Domicilio de la sucursal" full><input value={f.domicilio_transporte} onChange={set("domicilio_transporte")} placeholder="Si es a sucursal de transporte" /></L>
          <L l="Teléfono del transporte"><input value={f.telefono_transporte} onChange={set("telefono_transporte")} /></L>
          <L l="Valor declarado ($)"><input value={f.valor_declarado} onChange={set("valor_declarado")} /></L>
        </div>

        <button className="btn" disabled={saving} onClick={guardar}>{saving ? "Enviando…" : "Enviar mis datos de envío"}</button>
        <div className="foot">FEBECOS · Tus datos se usan solo para coordinar el envío de tu pedido.</div>
      </div>
    </div>
  );
}

function L({ l, full, children }: { l: string; full?: boolean; children: React.ReactNode }) {
  return <label className={full ? "full" : ""}><span>{l}</span>{children}</label>;
}

const CSS = `
  body { background:#eef2f6; }
  .wrap { max-width:680px; margin:0 auto; padding:24px 14px 60px; font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif; }
  .card { background:#fff; border:1px solid #e2e8f0; border-radius:16px; padding:26px 28px; box-shadow:0 2px 14px rgba(15,61,107,.08); }
  .head { display:flex; align-items:center; gap:14px; border-bottom:2px solid #0b3d6b; padding-bottom:14px; }
  .head img { height:46px; }
  .head .t { font-size:20px; font-weight:800; color:#0b3d6b; }
  .head .s { font-size:13px; color:#64748b; }
  .intro { font-size:14px; color:#475569; line-height:1.6; }
  .sec { margin:18px 0 8px; font-size:13px; font-weight:800; color:#0b3d6b; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  label { display:flex; flex-direction:column; gap:4px; font-size:12px; font-weight:600; color:#475569; }
  label.full { grid-column:1 / -1; }
  input, select { border:1px solid #cbd5e1; border-radius:9px; padding:10px 12px; font-size:14px; color:#1f2937; background:#fff; }
  input:focus, select:focus { outline:none; border-color:#0b3d6b; }
  .btn { width:100%; margin-top:22px; background:#0b3d6b; color:#fff; border:0; border-radius:10px; padding:14px; font-size:16px; font-weight:700; cursor:pointer; }
  .btn:disabled { opacity:.6; }
  .foot { margin-top:16px; text-align:center; font-size:11px; color:#94a3b8; }
  @media (max-width:560px){ .grid { grid-template-columns:1fr; } }
`;
