"use client";
import { useEffect, useState, useCallback } from "react";

const EST: Record<string, [string, string]> = {
  pendiente: ["⏳ Pendiente", "#d97706"], enviado: ["📤 Enviado", "#2563eb"], confirmado: ["✅ Confirmado", "#0891b2"],
  pagado: ["💳 Pagado", "#7c3aed"], recibido_ok: ["✔ Recibido OK", "#16a34a"], recibido_diferencias: ["⚠️ Recibido c/dif.", "#ea580c"],
  stock_propio: ["🏬 Stock propio", "#16a34a"], anulado: ["❌ Anulado", "#6b7280"],
};
const chip = (e: string) => { const [l, c] = EST[e] || [e, "#888"]; return <span style={{ background: c + "22", color: c }} className="rounded px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap">{l}</span>; };
// Semáforo de pasos del pedido a proveedor (acumulativo).
const PASOS_PROV: [string, string][] = [["📤", "Enviado al proveedor"], ["✅", "Proveedor confirmó"], ["💳", "Pagado"], ["📦", "Recibido"]];
const rankProv = (e: string) => (({ pendiente: 0, enviado: 1, confirmado: 2, pagado: 3, recibido_ok: 4, recibido_diferencias: 4 } as Record<string, number>)[e] ?? 0);
const PasosProv = ({ e }: { e: string }) => (e === "anulado" || e === "stock_propio") ? null : (
  <span className="ml-2 inline-flex gap-0.5 align-middle">
    {PASOS_PROV.map(([ic, t], i) => <span key={i} title={t} className="text-xs" style={{ opacity: rankProv(e) >= i + 1 ? 1 : 0.22, filter: rankProv(e) >= i + 1 ? "none" : "grayscale(1)" }}>{ic}</span>)}
  </span>
);
const fUSD = (n: any) => "USD " + Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtF = (v: any) => v ? new Date(v).toLocaleDateString("es-AR") : "—";

export default function PedidosProveedorPanel() {
  const [rows, setRows] = useState<any[]>([]); const [loading, setLoading] = useState(true);
  const [estado, setEstado] = useState(""); const [q, setQ] = useState(""); const [sel, setSel] = useState<number | null>(null); const [resp, setResp] = useState<number | null>(null);
  const [chequear, setChequear] = useState(false);
  const load = useCallback(() => { setLoading(true); const p = new URLSearchParams(); if (estado) p.set("estado", estado); if (q.trim()) p.set("q", q.trim()); fetch("/api/pedidos-proveedor?" + p).then((r) => r.json()).then((d) => { setRows(d.ok ? d.pedidos : []); setLoading(false); }); }, [estado, q]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  const totUSD = rows.reduce((a, r) => a + Number(r.total_costo_usd || 0), 0);
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-2 text-sm">
        <button onClick={load} className="text-febo-azul hover:underline text-xs">🔄 Recargar</button>
        <button onClick={() => setChequear(true)} title="Busca respuestas SIN LEER de proveedores (proformas), las matchea por N° GSA, lee el PDF y valida proveedor/ítems/monto. Sin mandar mail." className="bg-febo-azul text-white rounded-lg px-2.5 py-1 text-xs font-semibold hover:bg-febo-azul/90">📬 Chequear respuestas</button>
        <select value={estado} onChange={(e) => setEstado(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1 text-sm">
          <option value="">Todos los estados</option>
          {Object.keys(EST).map((k) => <option key={k} value={k}>{EST[k][0]}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ref, proveedor, GSA…" className="border border-gray-300 rounded-lg px-3 py-1 text-sm flex-1" />
        <span className="text-xs text-gray-500 whitespace-nowrap">{rows.length} pedidos · {fUSD(totUSD)}</span>
      </div>
      <div className="flex-1 overflow-auto border border-gray-200 rounded-xl bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0"><tr>
            <th className="text-left px-3 py-2">ID / GSA</th><th className="text-left px-3 py-2">Fecha</th><th className="text-left px-3 py-2">Proveedor</th>
            <th className="text-left px-3 py-2">Cliente / Ref</th><th className="text-center px-3 py-2">Ítems</th><th className="text-right px-3 py-2">Total</th>
            <th className="text-left px-3 py-2">Email</th><th className="text-center px-3 py-2">Estado</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={8} className="text-center py-8 text-gray-400">Cargando…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={8} className="text-center py-8 text-gray-400">Sin pedidos a proveedor</td></tr>
            : rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 hover:bg-blue-50 cursor-pointer" onClick={() => setSel(r.id)}>
                <td className="px-3 py-1.5 font-semibold">#{r.id}{r.gsa_numero ? <span className="ml-1 text-[10px] bg-violet-100 text-violet-700 rounded px-1.5 py-0.5">GSA {r.gsa_numero}</span> : null}</td>
                <td className="px-3 py-1.5 text-gray-500">{fmtF(r.created_at)}</td>
                <td className="px-3 py-1.5 font-semibold">{r.proveedor}</td>
                <td className="px-3 py-1.5 text-gray-600">{r.cliente_ref ? <span className="inline-flex flex-col leading-tight"><span className="inline-flex items-center gap-1">👤 <b className="text-gray-700">{r.cliente_ref}</b></span>{r.fv_numero && <span className="text-[10px] text-gray-400">{r.fv_numero}</span>}</span> : r.para_stock ? <span className="inline-flex flex-col leading-tight"><span className="text-[11px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 font-semibold w-fit">📦 Para stock</span>{r.fv_numero && <span className="text-[10px] text-gray-400">{r.fv_numero}</span>}</span> : (r.fv_numero || "—")}</td>
                <td className="px-3 py-1.5 text-center">{(r.items || []).length}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fUSD(r.total_costo_usd)}</td>
                <td className="px-3 py-1.5 text-gray-500 text-xs">{r.email_destinatario || "—"}</td>
                <td className="px-3 py-1.5 text-center whitespace-nowrap">{chip(r.estado)}<PasosProv e={r.estado} />{r.respondio && <button onClick={(ev) => { ev.stopPropagation(); setResp(r.id); }} className={"ml-1 text-xs rounded px-1 hover:scale-110 " + (r.resp_no_leido ? "bg-red-100 text-red-700 font-bold ring-1 ring-red-300" : "opacity-40 grayscale")} title={r.resp_no_leido ? "Respuesta SIN LEER del proveedor — clic para verla" : "El proveedor respondió (ya leído)"}>📨</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sel != null && <PedidoModal id={sel} onClose={() => setSel(null)} onChanged={load} />}
      {resp != null && <RespuestaProvModal id={resp} onClose={() => setResp(null)} />}
      {chequear && <CheckRespuestasModal onClose={() => setChequear(false)} onChanged={load} />}
    </div>
  );
}

// Modal NATIVO "Chequear respuestas" — detecta proformas sin leer, matchea por GSA, valida y confirma.
function CheckRespuestasModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [loading, setLoading] = useState(true); const [alerts, setAlerts] = useState<any[]>([]); const [err, setErr] = useState("");
  const [busy, setBusy] = useState<number | null>(null); const [toast, setToast] = useState("");
  const cargar = useCallback(() => { setLoading(true); setErr(""); fetch("/api/proveedor-respuestas-check").then((r) => r.json()).then((d) => { if (d.ok) setAlerts(d.alerts || []); else setErr(d.error || "Error"); setLoading(false); }).catch((e) => { setErr(e.message); setLoading(false); }); }, []);
  useEffect(() => { cargar(); }, [cargar]);
  const accion = async (a: any, accion?: string) => {
    setBusy(a.email_id);
    await fetch("/api/proveedor-respuestas-check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pedido_id: a.pedido_match?.id, email_id: a.email_id, accion }) });
    setBusy(null); setToast(accion === "ignorar" ? "Marcado como leído" : `✅ GSA ${a.pedido_match?.gsa_numero} confirmado`); setTimeout(() => setToast(""), 3000); onChanged(); cargar();
  };
  const VER: Record<string, [string, string]> = { corresponde: ["✅ Corresponde — podés confirmar", "#16a34a"], probable: ["✅ Muy probable", "#16a34a"], dudosa: ["⚠️ Dudosa — revisá el adjunto", "#d97706"], no_corresponde: ["❌ No corresponde — no confirmar", "#dc2626"] };
  const conMatch = alerts.filter((a) => a.pedido_match); const sinMatch = alerts.filter((a) => !a.pedido_match);
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[88vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b sticky top-0 bg-white">
          <h3 className="font-bold text-febo-azul">📬 Respuestas de proveedores sin revisar</h3>
          <div className="flex items-center gap-4"><button onClick={cargar} className="text-xs text-febo-azul hover:underline whitespace-nowrap">🔄 Re-chequear</button><button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none pl-1">✕</button></div>
        </div>
        {toast && <div className="mx-5 mt-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm px-3 py-2">{toast}</div>}
        <div className="p-5 space-y-3">
          {loading ? <div className="text-center text-gray-400 py-8">Leyendo bandeja y proformas…</div>
          : err ? <div className="text-red-600 text-sm">✕ {err}</div>
          : alerts.length === 0 ? <div className="text-center text-gray-400 py-8">No hay respuestas sin leer de proveedores.</div>
          : <>
            {conMatch.map((a) => {
              const v = a.validacion || {}; const [vt, vc] = VER[v.veredicto] || ["—", "#888"]; const canConfirm = (v.score ?? 0) >= 2;
              return (
                <div key={a.email_id} className="border rounded-xl p-3" style={{ borderColor: vc + "55" }}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold">{a.from_name || a.from_addr} <span className="text-gray-400 font-normal">· {a.subject}</span></div>
                    <span className="text-[10px] bg-violet-100 text-violet-700 rounded px-1.5 py-0.5 whitespace-nowrap">GSA {a.pedido_match.gsa_numero}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">Pedido #{a.pedido_match.id} · {a.pedido_match.proveedor} · {a.pedido_match.fv_numero || "—"} · {fUSD(a.pedido_match.total_costo_usd)}</div>
                  <div className="flex flex-wrap gap-3 mt-2 text-xs">
                    <span className={v.proveedor_ok ? "text-green-700" : "text-red-600"}>{v.proveedor_ok ? "✅" : "❌"} Proveedor</span>
                    <span className={v.encontrados === v.total_items ? "text-green-700" : v.encontrados > 0 ? "text-amber-600" : "text-red-600"}>{v.encontrados === v.total_items ? "✅" : v.encontrados > 0 ? "⚠️" : "❌"} Ítems {v.encontrados}/{v.total_items}</span>
                    <span className={v.monto_ok ? "text-green-700" : "text-red-600"}>{v.monto_ok ? "✅" : "❌"} Monto equipos {fUSD(v.total_equipos)}{v.con_iva ? ` · c/IVA ${fUSD(v.con_iva)}` : ""}</span>
                    <span className="text-gray-400">{v.leyo_pdf ? "📄 leyó PDF" : "✉️ s/PDF, leyó cuerpo"}</span>
                  </div>
                  <div className="mt-2 text-xs font-semibold" style={{ color: vc }}>{vt} <span className="text-gray-400 font-normal">(score {v.score}/5)</span></div>
                  {Array.isArray(v.items_detalle) && (
                    <details className="mt-1"><summary className="text-[11px] text-gray-500 cursor-pointer">Ver ítems</summary>
                      <ul className="mt-1 text-[11px] text-gray-600 space-y-0.5">{v.items_detalle.map((it: any, i: number) => <li key={i}>{it.encontrado ? "✅" : "❌"} {it.codigo} · {it.descripcion} {it.metodo ? `(${it.metodo})` : ""}</li>)}</ul>
                    </details>
                  )}
                  <div className="flex gap-2 mt-3">
                    <button disabled={!canConfirm || busy === a.email_id} onClick={() => accion(a)} className="bg-green-600 disabled:opacity-40 text-white rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-green-700" title="Marca el pedido a proveedor como CONFIRMADO (estado=confirmado) y marca el email como leído. No manda mail.">{busy === a.email_id ? "…" : `✅ Confirmar pedido GSA ${a.pedido_match.gsa_numero}`}</button>
                    <button disabled={busy === a.email_id} onClick={() => accion(a, "ignorar")} className="bg-gray-100 text-gray-600 rounded-lg px-3 py-1.5 text-xs hover:bg-gray-200" title="Marca el email como leído sin confirmar el pedido.">Dejar leído / ignorar</button>
                  </div>
                </div>
              );
            })}
            {sinMatch.length > 0 && <div className="pt-2 border-t">
              <div className="text-xs text-gray-400 mb-1">Sin pedido detectado (no se encontró N° GSA en el asunto):</div>
              {sinMatch.map((a) => <div key={a.email_id} className="flex items-center justify-between text-xs text-gray-500 py-1"><span>{a.from_name || a.from_addr} · {a.subject}</span><button disabled={busy === a.email_id} onClick={() => accion(a, "ignorar")} className="text-gray-400 hover:underline">ignorar</button></div>)}
            </div>}
          </>}
        </div>
      </div>
    </div>
  );
}

const toB64 = (f: File) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(f); });

// Paso a nivel de módulo (NO definir dentro del componente: remontaría y los inputs perderían foco).
function Paso({ n, t, on, children }: any) {
  return (
    <div className={`rounded-lg border p-3 ${on ? "border-febo-azul/40 bg-blue-50/40" : "border-gray-200 opacity-60"}`}>
      <div className="text-[11px] font-bold uppercase mb-2" style={{ color: on ? "#0b3d6b" : "#9ca3af" }}>{n} {t}</div>
      {on && children}
    </div>
  );
}

export function PedidoModal({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const [p, setP] = useState<any>(null); const [busy, setBusy] = useState(false);
  const [noEmail, setNoEmail] = useState(false);   // 🧪 prueba: no enviar email (default OFF para no marcar "enviado" sin querer)
  const [verTodo, setVerTodo] = useState(false);  // 🧪 prueba: mostrar todos los pasos
  const [solapa, setSolapa] = useState("envio");  // solapa activa
  // confirmación del proveedor
  const [moneda, setMoneda] = useState("USD"); const [montoSolic, setMontoSolic] = useState(""); const [tc, setTc] = useState(""); const [proforma, setProforma] = useState<any | null>(null); const [conf, setConf] = useState<Record<string, boolean>>({}); const [numProf, setNumProf] = useState("");
  // recepción
  const [recep, setRecep] = useState<any[] | null>(null); const [remito, setRemito] = useState(""); const [notas, setNotas] = useState("");
  // pago
  const [pgMonto, setPgMonto] = useState(""); const [pgMoneda, setPgMoneda] = useState("USD"); const [pgTc, setPgTc] = useState(""); const [pgMedio, setPgMedio] = useState("transferencia"); const [pgFecha, setPgFecha] = useState(""); const [pgNota, setPgNota] = useState("");
  // selector de unificación (elegir qué pendientes del mismo proveedor enviar juntos)
  const [unif, setUnif] = useState<{ cands: any[]; sel: Record<number, boolean> } | null>(null);
  const [contactos, setContactos] = useState<{ to: string; cc: string[] } | null>(null);  // CRM: Para + copias disponibles
  const [ccSel, setCcSel] = useState<Record<string, boolean>>({});  // copias marcadas (OFF por defecto — nunca manda solo)
  const [ccExtra, setCcExtra] = useState("");                        // copia manual adicional
  const [msgEnvio, setMsgEnvio] = useState("");                      // mensaje al proveedor (sale al principio del email)
  // CC final = copias del CRM marcadas + lo escrito a mano (emails válidos)
  const ccElegido = () => {
    const arr = [...Object.keys(ccSel).filter((e) => ccSel[e]), ...ccExtra.split(/[,;]/)]
      .map((e) => e.trim()).filter((e) => /\S+@\S+\.\S+/.test(e));
    return Array.from(new Set(arr));
  };
  const load = useCallback(() => fetch("/api/pedidos-proveedor?id=" + id).then((r) => r.json()).then((d) => { if (d.ok) { setP(d.pedido); setContactos(d.contactos || null); setMsgEnvio(d.pedido.mensaje || ""); const pre: Record<string, boolean> = {}; String(d.pedido.cc_emails || "").split(/[,;]/).map((s: string) => s.trim()).filter(Boolean).forEach((e: string) => { pre[e] = true; }); setCcSel(pre); if (d.pedido.moneda_prov) setMoneda(d.pedido.moneda_prov); if (d.pedido.tc_prov) setTc(String(d.pedido.tc_prov)); } }), [id]);
  useEffect(() => { load(); }, [load]);
  if (!p) return null;
  const items = p.items || [];
  const e = p.estado;
  const post = async (body: any) => { setBusy(true); try { const r = await fetch("/api/pedidos-proveedor", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) }); const d = await r.json(); if (!d.ok) throw new Error(d.error); await load(); onChanged(); return d; } catch (err: any) { alert("Error: " + err.message); return null; } finally { setBusy(false); } };

  const enviar = async () => {
    if (noEmail) { const d = await post({ accion: "enviar", no_email: true }); if (d) { alert("🧪 Avanzado a ENVIADO sin mandar email (modo prueba)."); setSolapa("confirmar"); } return; }
    // ¿Hay otros pedidos PENDIENTES del mismo proveedor (otros clientes/presupuestos)? → ofrecer unificar.
    let otros: any[] = [];
    try {
      const r = await fetch(`/api/pedidos-proveedor?proveedor=${encodeURIComponent(p.proveedor || "")}&estado=pendiente`);
      const d = await r.json();
      otros = (d.ok ? (d.pedidos || []) : []).filter((x: any) => x.id !== id);
    } catch { /* si falla, sigue envío individual */ }
    // SIEMPRE abrir la ventana de revisión antes de mandar (para verlo primero). Si hay otros
    // pendientes del mismo proveedor, se pueden tildar para unificar; si no, se revisa y envía ese solo.
    const cands = [p, ...otros];
    const sel: Record<number, boolean> = {}; cands.forEach((c: any) => { sel[c.id] = (c.id === id); }); // solo el actual pre-tildado
    setUnif({ cands, sel });
  };
  // Confirma el envío con los pendientes elegidos en la ventana de unificación.
  const confirmarUnif = async () => {
    if (!unif) return;
    const ids = Object.entries(unif.sel).filter(([, v]) => v).map(([k]) => Number(k));
    if (!ids.length) { alert("Elegí al menos un pedido."); return; }
    setUnif(null);
    if (ids.length === 1) {
      const d = await post({ accion: "enviar" });
      if (d) { alert("✅ Enviado al proveedor" + (d.gsa_numero ? ` · GSA ${d.gsa_numero}` : "")); onClose(); }
      return;
    }
    const d = await post({ accion: "enviar_unificado", ids, cc: ccElegido(), mensaje: msgEnvio });
    if (d) { alert(`✅ ${d.unificados} pedidos unificados y enviados al proveedor${d.gsa_numero ? ` · GSA ${d.gsa_numero}` : ""}`); onClose(); }
  };
  const anular = async () => {
    const yaSalio = ["enviado", "confirmado", "pagado", "recibido_ok", "recibido_diferencias"].includes(e);
    let email = "";
    // Si "No enviar email" (prueba) está tildado → anula y NO avisa a nadie, aunque ya estuviera enviado.
    if (yaSalio && !noEmail) {
      const r = prompt("Este pedido YA fue enviado al proveedor.\nEmail para AVISARLE la anulación (dejá vacío = anular sin avisar):", p.email_destinatario || "");
      if (r === null) return; // canceló
      email = r.trim();
    } else if (!confirm(noEmail ? "¿Anular este pedido? (modo prueba: NO se avisa al proveedor)" : "¿Anular este pedido a proveedor?")) return;
    const d = await post({ accion: "anular", email, no_email: noEmail });
    if (d) { alert(d.avisado ? (d.aviso?.ok ? "Anulado. Aviso de anulación enviado al proveedor." : "Anulado, pero el aviso al proveedor falló: " + (d.aviso?.error || "revisar")) : "Anulado. (No se envió email a nadie.)"); onClose(); }
  };
  const iniciarRecep = () => setRecep(items.map((it: any) => ({ codigo: it.codigo, descripcion: it.descripcion, costo_usd: it.costo_usd, cantidad: Number(it.cantidad) || 0, pedida: Number(it.cantidad) || 0 })));
  const guardarRecep = (conDif: boolean) => { post({ accion: "recibir", items_recibidos: recep, numero_remito: remito, notas, con_diferencias: conDif }); setRecep(null); setSolapa("detalle"); };
  const agregarPago = async () => {
    if (!Number(pgMonto)) { alert("Ingresá el monto del pago."); return; }
    if (pgMoneda === "ARS" && !Number(pgTc)) { alert("Ingresá el TC del momento (pago en $)."); return; }
    const d = await post({ accion: "pago", pago: { monto: Number(pgMonto), moneda: pgMoneda, tc: Number(pgTc) || 0, medio: pgMedio, fecha: pgFecha || null, nota: pgNota } });
    if (d) { setPgMonto(""); setPgTc(""); setPgNota(""); if (d.saldado) setSolapa("recepcion"); }
  };
  const subirFactura = async (files: FileList | null) => { if (!files?.length) return; const f = files[0]; const d = await post({ accion: "factura", archivo: { nombre: f.name, tipo: f.type, b64: await toB64(f) } }); if (d?.datos?.nro_factura) alert("📄 Factura leída · N° " + d.datos.nro_factura + (d.datos.total ? ` · total USD/$ ${d.datos.total}` : "")); else if (d) alert("Factura cargada. No pude leer el N° automáticamente (cargá imagen JPG/PNG si es PDF)."); };
  const subirProforma = async (files: FileList | null) => {
    if (!files?.length) return; const f = files[0]; const b64 = await toB64(f);
    setProforma({ nombre: f.name, tipo: f.type, b64 });
    // Lee el PDF y sugiere N° de proforma + monto (editable, no pisa lo ya cargado)
    try {
      const d = await (await fetch("/api/parse-proforma", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ b64, tipo: f.type }) })).json();
      if (d?.ok) {
        // Lee "Proforma Nº:" del PDF. Editable: si el formato del proveedor no matchea, se corrige a mano.
        if (d.numero) setNumProf((prev) => prev.trim() || d.numero);
        if (d.monto?.monto) { setMontoSolic((prev) => prev || String(d.monto.monto)); if (d.monto.moneda) setMoneda((m) => m || d.monto.moneda); }
      }
    } catch { /* parseo best-effort */ }
  };
  // Confirmación POR PROFORMA (varias por pedido). Ítems pendientes = los que no están en ninguna proforma.
  const proformas: any[] = Array.isArray(p.proformas) ? p.proformas : [];
  const confirmadosSet = new Set(proformas.flatMap((pf: any) => (pf.items || []).map(String)));
  const pendientes = items.filter((it: any) => !confirmadosSet.has(String(it.codigo)));
  const esSinProveedor = /sin proveedor/i.test(p.proveedor || "");
  const agregarProforma = async () => {
    const sel = pendientes.filter((it: any) => conf[it.codigo] !== false).map((it: any) => it.codigo);
    if (!sel.length) { alert("Marcá al menos un ítem para esta proforma."); return; }
    // "Sin proveedor" (stock propio): no exige N° ni monto → proforma interna.
    if (!esSinProveedor) {
      if (!numProf.trim()) { alert("Ingresá el N° de proforma."); return; }
      if (!montoSolic) { alert("Ingresá el monto de la proforma."); return; }
      if (moneda === "ARS" && !Number(tc)) { alert("Ingresá el TC (cotización en $)."); return; }
    }
    const d = await post({ accion: "agregar_proforma", numero: numProf.trim() || (esSinProveedor ? "INTERNA" : ""), moneda, monto: Number(montoSolic) || 0, tc: Number(tc) || 0, proforma, items: sel });
    if (d) { setNumProf(""); setMontoSolic(""); setTc(""); setProforma(null); setConf({}); }
  };
  const cubrirStockPropio = async () => {
    if (!confirm("¿Cubrir este pedido con STOCK PROPIO?\n\nConfirma TODOS los ítems como proforma interna y CIERRA la operación (no se compra a ningún proveedor, no descuenta stock acá). Saltea Pago / Factura / Recepción.")) return;
    const d = await post({ accion: "cubrir_stock_propio" });
    if (d) { setSolapa("detalle"); }
  };
  const eliminarProforma = async (idx: number) => {
    if (!confirm("¿Eliminar esta proforma? Se recalculan los ítems confirmados y la cuenta corriente.")) return;
    await post({ accion: "eliminar_proforma", index: idx });
  };

  // Lo que debemos = suma de TODAS las proformas confirmadas (cada una con su monto/moneda → USD).
  // Si todavía no hay proformas cargadas, cae al monto solicitado o al costo del pedido.
  const owedProformasUsd = proformas.reduce((a: number, pf: any) => a + (Number(pf.monto_usd) || (pf.moneda === "ARS" && Number(pf.tc) ? Number(pf.monto) / Number(pf.tc) : Number(pf.monto)) || 0), 0);
  const owedUsd = owedProformasUsd > 0 ? owedProformasUsd : (Number(p.monto_solicitado_usd) || Number(p.total_costo_usd) || 0);
  const pagos = Array.isArray(p.pagos) ? p.pagos : [];
  const pagadoUsd = pagos.reduce((a: number, x: any) => a + (Number(x.monto_usd) || 0), 0);
  const saldoUsd = owedUsd - pagadoUsd;
  const yaConfirmado = ["confirmado", "pagado", "recibido_ok", "recibido_diferencias"].includes(e);
  const yaRecibido = ["recibido_ok", "recibido_diferencias"].includes(e);

  return (
    <div className="fixed inset-0 z-[130] bg-black/50 flex items-stretch justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-[780px] h-full flex flex-col shadow-2xl overflow-hidden" onClick={(ev) => ev.stopPropagation()}>
        {/* Ventana: elegir qué pedidos pendientes del mismo proveedor unificar */}
        {unif && (
          <div className="absolute inset-0 z-[140] bg-black/50 flex items-center justify-center p-4" onClick={() => setUnif(null)}>
            <div className="bg-white rounded-xl w-full max-w-[560px] max-h-[80vh] flex flex-col shadow-2xl" onClick={(ev) => ev.stopPropagation()}>
              <div className="bg-febo-azul text-white rounded-t-xl px-5 py-3 font-bold">{unif.cands.length > 1 ? "📦 Unificar y enviar a " : "📤 Revisar y enviar a "}{p.proveedor}</div>
              <div className="p-4 overflow-auto">
                <div className="text-xs text-gray-500 mb-2">{unif.cands.length > 1
                  ? "Revisá los ítems. Tildá los pedidos PENDIENTES que quieras enviar JUNTOS en un solo pedido al proveedor (cada ítem queda identificado con su pedido de cliente). Destildá los que no."
                  : "Revisá los ítems antes de enviar el pedido al proveedor."}</div>
                <div className="border border-gray-200 rounded-lg divide-y">
                  {unif.cands.map((c: any) => (
                    <div key={c.id} className="px-3 py-2 hover:bg-blue-50/40">
                      <label className="flex items-center gap-3 text-sm cursor-pointer">
                        <input type="checkbox" checked={!!unif.sel[c.id]} onChange={(ev) => setUnif((u) => u ? { ...u, sel: { ...u.sel, [c.id]: ev.target.checked } } : u)} />
                        <span className="flex-1"><b className="text-febo-azul">#{c.id}</b>{c.fv_numero ? <span className="text-gray-500"> · {c.fv_numero}</span> : ""}{c.id === id ? <span className="ml-1 text-[10px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">este</span> : ""} <span className="text-gray-400">· {(c.items || []).length} ítem(s)</span></span>
                        <span className="tabular-nums text-gray-600 font-semibold">{fUSD(c.total_costo_usd)}</span>
                      </label>
                      <div className="pl-7 mt-1 space-y-0.5">
                        {(c.items || []).map((it: any, i: number) => (
                          <div key={i} className="text-[11px] text-gray-500 flex justify-between gap-2">
                            <span className="truncate"><b className="text-gray-700">{it.cantidad}×</b> {it.codigo} <span className="text-gray-400">{(it.descripcion || "").slice(0, 44)}</span></span>
                            <span className="tabular-nums whitespace-nowrap">{fUSD((Number(it.costo_usd) || 0) * (Number(it.cantidad) || 1))}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-gray-500 mt-2">Seleccionados: <b>{Object.values(unif.sel).filter(Boolean).length}</b> · Si dejás 1, se envía solo ese.</div>
              </div>
              <div className="border-t border-gray-200 p-3 flex justify-end gap-2">
                <button onClick={() => setUnif(null)} title="Cerrar sin enviar" className="px-3 py-1.5 rounded-lg text-sm text-gray-500">Cancelar</button>
                <button disabled={busy} onClick={confirmarUnif} title="Genera el pedido al proveedor (Excel/GSA) y envía el email a las casillas indicadas. Si tildaste varios, los combina en uno." className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50">📤 Enviar al proveedor</button>
              </div>
            </div>
          </div>
        )}
        <div className="bg-febo-azul text-white rounded-t-xl px-5 py-3 flex items-center justify-between">
          <div><div className="text-lg font-bold">Pedido #{p.id}{p.gsa_numero ? ` · GSA ${p.gsa_numero}` : ""} · {p.proveedor}</div><div className="mt-0.5">{chip(p.estado)}{p.fv_numero ? <span className="ml-2 text-xs text-white/70">ref {p.fv_numero}</span> : null}</div></div>
          <div className="flex items-center gap-3">
            {p.estado !== "anulado" && <button disabled={busy} onClick={anular} title="Anula este pedido a proveedor. Si ya se había enviado, te pide el email para avisarle al proveedor la anulación." className="text-white/80 hover:text-white text-xs underline">Anular</button>}
            <button onClick={onClose} className="text-white/80 hover:text-white text-xl">✕</button>
          </div>
        </div>

        {/* 🧪 Barra de prueba (desactivar en producción) */}
        <div className="flex flex-wrap items-center gap-4 px-5 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-800">
          <span className="font-semibold">🧪 Prueba:</span>
          <label className="flex items-center gap-1 cursor-pointer" title="Modo prueba: avanza el estado del pedido SIN mandar el email al proveedor (para probar el circuito sin molestar al proveedor)."><input type="checkbox" checked={noEmail} onChange={(ev) => setNoEmail(ev.target.checked)} /> No enviar email (avanza sin mandar)</label>
          <label className="flex items-center gap-1 cursor-pointer" title="Muestra TODAS las solapas (Confirmación/Pago/Recepción) aunque el pedido todavía esté en pasos previos, para ver el circuito completo."><input type="checkbox" checked={verTodo} onChange={(ev) => setVerTodo(ev.target.checked)} /> Mostrar todos los pasos</label>
        </div>

        {/* Solapas de pasos */}
        {(() => {
          const tabs: [string, string, boolean][] = [
            ["envio", "① Envío", true],
            ["confirmar", "② Confirmación", verTodo || e === "enviado" || yaConfirmado],
            ["pago", "③ Pago / Factura", verTodo || yaConfirmado],
            ["recepcion", "④ Recepción", verTodo || yaConfirmado],
            ["detalle", "📋 Detalle", true],
          ];
          return (
            <div className="flex gap-1 px-4 pt-2 bg-white border-b border-gray-200 overflow-x-auto">
              {tabs.map(([k, l, ok]) => {
                const TT: Record<string, string> = {
                  envio: "Paso 1: revisás los ítems, las copias (CC) y el mensaje, y enviás el pedido al proveedor.",
                  confirmar: "Paso 2: cuando el proveedor confirma, cargás la proforma y el monto que solicita. Habilita aprobar/pagar.",
                  pago: "Paso 3: registrás el pago al proveedor (TC del momento) y adjuntás la factura del proveedor.",
                  recepcion: "Paso 4: registrás la recepción de la mercadería (cantidad pedida vs recibida) y el remito del proveedor.",
                  detalle: "Detalle de los ítems del pedido (códigos, cantidades y costos).",
                };
                return <button key={k} disabled={!ok} onClick={() => setSolapa(k)} title={(TT[k] || "") + (!ok ? " (disponible en su momento)" : "")} className={`px-3 py-2 rounded-t-lg text-xs font-semibold whitespace-nowrap ${solapa === k ? "bg-febo-azul text-white" : ok ? "bg-gray-100 text-gray-600 hover:bg-gray-200" : "bg-gray-50 text-gray-300 cursor-not-allowed"}`}>{l}</button>;
              })}
            </div>
          );
        })()}

        <div className="flex-1 overflow-auto p-5 space-y-3">
          {/* Datos (siempre) */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <Cell l="Fecha" v={fmtF(p.created_at)} /><Cell l="Proveedor" v={p.proveedor} />
            <Cell l="Email destino" v={(contactos?.to || p.email_destinatario) || "—"} />
            <Cell l="Total pedido (costo)" v={<b className="text-febo-azul">{fUSD(p.total_costo_usd)}</b>} />
          </div>

          {/* ① ENVÍO */}
          {solapa === "envio" && (e === "pendiente" ? (
            <div className="space-y-3">
              {/* Para / CC / Mensaje — SOLO al enviar (pendiente) */}
              <div className="rounded-lg border border-gray-200 p-3 space-y-2">
                <div className="text-sm"><span className="text-[10px] uppercase text-gray-400 font-semibold">Para (comercial): </span>{contactos?.to || p.email_destinatario || "— (cargá el contacto comercial en el CRM)"}</div>
                <div>
                  <span className="block text-[10px] uppercase text-gray-400 font-semibold mb-1">Copias (CC) — opcional · NO se manda salvo que marques</span>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {Array.from(new Set([...(contactos?.cc || []), ...Object.keys(ccSel)])).map((email) => (
                      <label key={email} className="flex items-center gap-1.5 text-sm cursor-pointer">
                        <input type="checkbox" checked={!!ccSel[email]} onChange={(ev) => setCcSel((s) => ({ ...s, [email]: ev.target.checked }))} /> {email}
                      </label>
                    ))}
                    {!(contactos?.cc || []).length && !Object.keys(ccSel).length && <span className="text-xs text-gray-400">No hay contactos de copia cargados en el CRM del proveedor.</span>}
                  </div>
                  <input value={ccExtra} onChange={(ev) => setCcExtra(ev.target.value)} placeholder="Otra copia (email, separá con coma)…" className="mt-1.5 w-full border border-gray-300 rounded px-2 py-1 text-xs" />
                </div>
                <div>
                  <span className="block text-[10px] uppercase text-gray-400 font-semibold mb-1">Mensaje al proveedor — sale al principio del email (opcional)</span>
                  <textarea value={msgEnvio} onChange={(ev) => setMsgEnvio(ev.target.value)} rows={8} placeholder="Escribí acá lo que quieras que el proveedor lea arriba de todo (entrega, condiciones, aclaraciones…)" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
                </div>
              </div>
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 flex items-center justify-between">
              <div className="text-sm text-amber-800">Pedido <b>pendiente</b> — todavía no se envió al proveedor.</div>
              <button disabled={busy} onClick={enviar} title="Abre la revisión: ves los ítems antes de mandar. Si hay otros pedidos PENDIENTES del mismo proveedor, podés unificarlos en uno. Recién al confirmar se manda el email al proveedor." className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50">📤 Enviar al proveedor</button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">Pedido <b>{(EST[e] || [e])[0]}</b>. Avanzá con las solapas → Confirmación, Pago y Recepción.</div>
          ))}

          {/* ② CONFIRMACIÓN DEL PROVEEDOR — varias proformas por pedido */}
          {solapa === "confirmar" && (
            <Paso n="②" t="Confirmación del proveedor — proformas por ítems" on={true}>
              <div className="space-y-3">
                {/* Cubrir con STOCK PROPIO: cierra la operación sin comprar a un proveedor. */}
                {p.estado !== "stock_propio" && (
                  <div className={`rounded-lg border p-2.5 flex flex-wrap items-center gap-2 ${esSinProveedor ? "border-emerald-300 bg-emerald-50" : "border-gray-200 bg-gray-50"}`}>
                    <span className="text-xs text-gray-600 flex-1 min-w-[180px]">{esSinProveedor ? "🏬 Pedido «Sin proveedor» → cubrilo con tu inventario propio." : "🏬 ¿Lo cubrís con stock propio? (sin comprarle a un proveedor)"}</span>
                    <button disabled={busy} onClick={cubrirStockPropio} title="Confirma todos los ítems como proforma interna y cierra la operación como válida, sin comprar a un proveedor y sin descontar stock acá. Saltea Pago/Factura/Recepción." className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50">✅ Cubrir con stock propio</button>
                  </div>
                )}
                {p.estado === "stock_propio" && <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-2.5 text-sm text-emerald-800 font-semibold">🏬 Cubierto con stock propio — operación cerrada (sin compra a proveedor).</div>}
                {/* Proformas ya cargadas (read-only + eliminar para corregir) */}
                {proformas.length > 0 && (
                  <div className="space-y-2">
                    {proformas.map((pf: any, idx: number) => (
                      <div key={idx} className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-2.5 text-xs">
                        <div className="flex items-center justify-between">
                          <div className="font-semibold text-emerald-800">📄 Proforma {pf.numero || "(s/N°)"} · {pf.moneda === "ARS" ? "$ " + Number(pf.monto || 0).toLocaleString("es-AR") : fUSD(pf.monto)}{pf.tc ? ` · TC ${pf.tc}` : ""}</div>
                          <div className="flex items-center gap-2">
                            {pf.archivo?.nombre && <a href={`data:${pf.archivo.tipo};base64,${pf.archivo.b64}`} download={pf.archivo.nombre} className="text-febo-azul underline">⬇ PDF</a>}
                            <button disabled={busy} onClick={() => eliminarProforma(idx)} title="Eliminar/corregir esta proforma" className="text-gray-400 hover:text-red-500">🗑</button>
                          </div>
                        </div>
                        <div className="mt-1 text-gray-600">{(pf.items || []).map((cod: string) => { const it = items.find((x: any) => String(x.codigo) === String(cod)); return <span key={cod} className="inline-block bg-white border border-emerald-200 rounded px-1.5 py-0.5 mr-1 mb-1">{cod}{it ? ` ×${it.cantidad}` : ""}</span>; })}</div>
                      </div>
                    ))}
                  </div>
                )}
                {/* Ítems pendientes de confirmar → nueva proforma */}
                {pendientes.length > 0 ? (
                  <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/40 p-2.5">
                    <div className="text-xs font-semibold text-amber-800">Ítems sin confirmar ({pendientes.length}) — marcalos y cargá la proforma que los cubre:</div>
                    <div className="border border-gray-100 bg-white rounded-lg divide-y">
                      {pendientes.map((it: any) => (
                        <label key={it.codigo} className="flex items-center gap-2 px-2 py-1 text-xs cursor-pointer">
                          <input type="checkbox" checked={conf[it.codigo] !== false} onChange={(ev) => setConf({ ...conf, [it.codigo]: ev.target.checked })} />
                          <b className="text-febo-azul">{it.codigo}</b><span className="text-gray-500 flex-1">{(it.descripcion || "").slice(0, 50)}</span><span>×{it.cantidad}</span>
                        </label>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="text-xs text-gray-500" title="El que figura en la proforma/PDF del proveedor (NO el GSA, que es nuestro N° interno). Se autocompleta al subir el PDF.">N° proforma <span className="text-red-500">*</span><input value={numProf} onChange={(ev) => setNumProf(ev.target.value)} className="block w-28 border border-gray-300 rounded px-2 py-1 text-sm" placeholder="del PDF" /></label>
                      <label className="text-xs text-gray-500">Moneda<select value={moneda} onChange={(ev) => setMoneda(ev.target.value)} className="block border border-gray-300 rounded px-2 py-1 text-sm"><option value="USD">USD</option><option value="ARS">$ (ARS)</option></select></label>
                      <label className="text-xs text-gray-500">Monto<input type="number" value={montoSolic} onChange={(ev) => setMontoSolic(ev.target.value)} className="block w-32 border border-gray-300 rounded px-2 py-1 text-sm" /></label>
                      <label className="text-xs text-gray-500">TC {moneda === "ARS" ? "(oblig.)" : "(si $)"}<input type="number" value={tc} onChange={(ev) => setTc(ev.target.value)} className="block w-24 border border-gray-300 rounded px-2 py-1 text-sm" /></label>
                    </div>
                    <label className="block text-xs text-gray-500">Proforma (PDF/imagen){proforma ? <span className="text-emerald-600 ml-1">✓ {proforma.nombre}</span> : ""}<input type="file" accept="image/*,application/pdf" onChange={(ev) => subirProforma(ev.target.files)} className="block mt-1 text-xs" /></label>
                    <button disabled={busy} onClick={agregarProforma} title="Agrega una proforma que confirma los ítems marcados (con su N°, monto y PDF). Podés cargar varias proformas por pedido. NO manda email; carga a la cuenta corriente del proveedor." className="px-3 py-1.5 rounded-lg bg-cyan-600 text-white text-sm font-semibold disabled:opacity-50">➕ Agregar proforma ({pendientes.filter((it: any) => conf[it.codigo] !== false).length} ítems)</button>
                  </div>
                ) : (
                  <div className="text-sm text-emerald-700 font-semibold">✔ Todos los ítems confirmados. Total: <b className="text-febo-azul">{fUSD(owedUsd)}</b></div>
                )}
              </div>
            </Paso>
          )}

          {/* ④ RECEPCIÓN */}
          {solapa === "recepcion" && (
            <Paso n="④" t="Recepción de mercadería (total o parcial) + remito" on={true}>
              {yaRecibido && !recep ? (
                <div className="text-sm text-gray-700">{e === "recibido_diferencias" ? "⚠️ Recibido con diferencias" : "✔ Recibido OK"}{p.numero_remito ? ` · Remito ${p.numero_remito}` : ""}{p.total_recibido_usd != null ? ` · ${fUSD(p.total_recibido_usd)}` : ""} <button onClick={iniciarRecep} className="text-febo-azul underline text-xs ml-2">re-registrar</button></div>
              ) : !recep ? <button onClick={iniciarRecep} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold">Registrar recepción</button>
                : <div className="space-y-2">
                  {recep.map((it, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs"><span className="flex-1"><b className="text-febo-azul">{it.codigo}</b> · pedida {it.pedida}</span><span>recibida:</span><input type="number" value={it.cantidad} onChange={(ev) => setRecep(recep.map((x, j) => j === i ? { ...x, cantidad: Number(ev.target.value) || 0 } : x))} className={`w-16 border rounded px-1 text-center ${Number(it.cantidad) !== it.pedida ? "border-amber-400 bg-amber-50" : "border-gray-300"}`} /></div>
                  ))}
                  <div className="flex gap-2"><input value={remito} onChange={(ev) => setRemito(ev.target.value)} placeholder="N° remito del proveedor" className="border border-gray-300 rounded px-2 py-1 text-xs w-44" /><input value={notas} onChange={(ev) => setNotas(ev.target.value)} placeholder="notas" className="border border-gray-300 rounded px-2 py-1 text-xs flex-1" /></div>
                  <div className="flex gap-2"><button disabled={busy} onClick={() => guardarRecep(false)} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold">✔ Recibido OK</button><button disabled={busy} onClick={() => guardarRecep(true)} className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-xs font-semibold">⚠️ Recibido c/diferencias</button><button onClick={() => setRecep(null)} className="text-xs text-gray-400">cancelar</button></div>
                </div>}
            </Paso>
          )}

          {/* ③ PAGO + FACTURA */}
          {solapa === "pago" && (
            <Paso n="③" t="Pago al proveedor + factura" on={true}>
              <div className="text-sm mb-1">Le debemos: <b className="text-febo-azul">{fUSD(owedUsd)}</b> · Pagado: <b>{fUSD(pagadoUsd)}</b> · Saldo: <b className={saldoUsd > 0.01 ? "text-red-600" : "text-emerald-600"}>{fUSD(saldoUsd)}</b></div>
              {proformas.length > 0 && (
                <div className="text-[11px] text-gray-500 mb-2">{proformas.length} proforma{proformas.length > 1 ? "s" : ""}: {proformas.map((pf: any, i: number) => <span key={i}>{i > 0 ? " + " : ""}{pf.numero ? `N° ${pf.numero} ` : ""}{pf.moneda || "USD"} {Number(pf.monto || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })}</span>)}</div>
              )}
              {pagos.length > 0 && <div className="text-xs text-gray-600 mb-2 space-y-0.5">{pagos.map((x: any, i: number) => <div key={i}>• {fmtF(x.fecha)} · {x.medio} · {x.moneda === "ARS" ? "$ " + Number(x.monto).toLocaleString("es-AR") + (x.tc ? ` (TC ${x.tc})` : "") : fUSD(x.monto)} → {fUSD(x.monto_usd)}{x.nota ? " · " + x.nota : ""}</div>)}</div>}
              <div className="flex flex-wrap items-end gap-2 mb-2">
                <label className="text-xs text-gray-500">Monto<input type="number" value={pgMonto} onChange={(ev) => setPgMonto(ev.target.value)} className="block w-28 border border-gray-300 rounded px-2 py-1 text-sm" /></label>
                <label className="text-xs text-gray-500">Moneda<select value={pgMoneda} onChange={(ev) => setPgMoneda(ev.target.value)} className="block border border-gray-300 rounded px-2 py-1 text-sm"><option value="USD">USD</option><option value="ARS">$ (ARS)</option></select></label>
                <label className="text-xs text-gray-500">TC {pgMoneda === "ARS" ? "(oblig.)" : ""}<input type="number" value={pgTc} onChange={(ev) => setPgTc(ev.target.value)} className="block w-24 border border-gray-300 rounded px-2 py-1 text-sm" /></label>
                <label className="text-xs text-gray-500">Medio<select value={pgMedio} onChange={(ev) => setPgMedio(ev.target.value)} className="block border border-gray-300 rounded px-2 py-1 text-sm"><option value="transferencia">Transferencia</option><option value="cheque">Cheque</option><option value="efectivo">Efectivo</option></select></label>
                <label className="text-xs text-gray-500">Fecha<input type="date" value={pgFecha} onChange={(ev) => setPgFecha(ev.target.value)} className="block border border-gray-300 rounded px-2 py-1 text-sm" /></label>
                <button disabled={busy} onClick={agregarPago} className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-sm font-semibold disabled:opacity-50">+ Registrar pago</button>
              </div>
              <input value={pgNota} onChange={(ev) => setPgNota(ev.target.value)} placeholder="nota del pago (opcional, ej. N° cheque)" className="w-full border border-gray-300 rounded px-2 py-1 text-xs mb-2" />
              <label className="block text-xs text-gray-500">Factura del proveedor (al cargarla se lee el N°){p.factura_archivo?.nombre ? <a href={`data:${p.factura_archivo.tipo};base64,${p.factura_archivo.b64}`} download={p.factura_archivo.nombre} className="text-emerald-600 underline ml-1">✓ {p.factura_archivo.nombre}</a> : ""}<input type="file" accept="image/*,application/pdf" onChange={(ev) => subirFactura(ev.target.files)} className="block mt-1 text-xs" /></label>
              {p.numero_factura && <div className="text-xs text-gray-700 mt-1">🧾 N° factura: <b>{p.numero_factura}</b>{p.factura_total ? ` · total ${fUSD(p.factura_total)}` : ""}{p.factura_fecha ? ` · ${fmtF(p.factura_fecha)}` : ""}</div>}
            </Paso>
          )}

          {/* Detalle */}
          {solapa === "detalle" && (
          <div>
            <div className="text-[11px] font-bold text-gray-400 uppercase mb-1">Detalle</div>
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase text-gray-400"><tr><th className="text-left px-2 py-1">Código</th><th className="text-left px-2 py-1">Descripción</th><th className="text-center px-2 py-1">Cant</th><th className="text-right px-2 py-1">Costo</th><th className="text-right px-2 py-1">Subtotal</th></tr></thead>
              <tbody>
                {items.map((it: any, i: number) => (
                  <tr key={i} className="border-t border-gray-100"><td className="px-2 py-1 font-semibold text-febo-azul">{it.codigo}</td><td className="px-2 py-1 text-gray-600">{it.descripcion}</td><td className="px-2 py-1 text-center">{it.cantidad}</td><td className="px-2 py-1 text-right">{fUSD(it.costo_usd)}</td><td className="px-2 py-1 text-right font-semibold">{fUSD((Number(it.costo_usd) || 0) * (Number(it.cantidad) || 0))}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
function Cell({ l, v }: { l: string; v: any }) { return <div><div className="text-[10px] uppercase text-gray-400">{l}</div><div className="text-gray-800">{v}</div></div>; }

// Seguimiento del proveedor: bandeja entrada+salida del pedido + responder/reenviar con adjuntos y CC del CRM.
const _filesToB64 = (files: File[]): Promise<{ filename: string; content: string }[]> =>
  Promise.all(files.map((f) => new Promise<{ filename: string; content: string }>((res) => { const r = new FileReader(); r.onload = () => res({ filename: f.name, content: String(r.result).split(",")[1] || "" }); r.readAsDataURL(f); })));

function RespuestaProvModal({ id, onClose }: { id: number; onClose: () => void }) {
  const [lista, setLista] = useState<any>(null); const [err, setErr] = useState("");
  const [selMsg, setSelMsg] = useState<number | null>(null); const [msg, setMsg] = useState<any>(null); const [verAdj, setVerAdj] = useState<number | null>(null);
  const [modo, setModo] = useState<"" | "reply" | "forward" | "new">(""); const [sending, setSending] = useState(false);
  const [cTo, setCTo] = useState(""); const [cCcSel, setCCcSel] = useState<Record<string, boolean>>({}); const [cCcExtra, setCCcExtra] = useState(""); const [cSubject, setCSubject] = useState(""); const [cBody, setCBody] = useState(""); const [cFiles, setCFiles] = useState<File[]>([]); const [cIncluirAdj, setCIncluirAdj] = useState(true);
  useEffect(() => { fetch("/api/proveedor-respuesta?id=" + id).then((r) => r.json()).then((j) => { if (!j.ok) { setErr(j.error || "error"); return; } setLista(j); if (j.mensajes?.length) setSelMsg(j.mensajes[0].id); }).catch((e) => setErr(e.message)); }, [id]);
  useEffect(() => { if (!selMsg) { setMsg(null); return; } setMsg(null); setVerAdj(null); setModo(""); fetch("/api/proveedor-respuesta?msg=" + selMsg).then((r) => r.json()).then((j) => { if (j.ok) setMsg(j); }); }, [selMsg]);
  const m = msg?.mensaje;
  const ccOps: string[] = lista?.cc_opciones || [];
  const ccElegido = () => Array.from(new Set([...ccOps.filter((e) => cCcSel[e]), ...cCcExtra.split(/[,;]/)].map((e) => e.trim()).filter((e) => /\S+@\S+\.\S+/.test(e))));
  const limpio = (s: string) => String(s || "").replace(/^(re:|rv:|fwd:)\s*/i, "");
  const toggleSeen = (x: any) => {
    const nv = !x.seen;
    setLista((L: any) => L ? { ...L, mensajes: L.mensajes.map((mm: any) => mm.id === x.id ? { ...mm, seen: nv } : mm) } : L);
    fetch("/api/proveedor-respuesta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ msg: x.id, seen: nv }) }).catch(() => {});
  };
  const abrir = (mo: "reply" | "forward" | "new") => {
    setVerAdj(null); setModo(mo); setCCcSel({}); setCCcExtra(""); setCFiles([]); setCIncluirAdj(true);
    if (mo === "reply") { setCTo(lista?.proveedor_email || m?.from_addr || ""); setCSubject("RE: " + limpio(m?.subject)); setCBody(""); }
    else if (mo === "forward") { setCTo(""); setCSubject("Rv: " + limpio(m?.subject)); setCBody(`\n\n---------- Mensaje reenviado ----------\nDe: ${m?.from_addr || ""}\nAsunto: ${m?.subject || ""}\n\n${m?.body_text || ""}`); }
    else { setCTo(lista?.proveedor_email || ""); setCSubject(lista?.gsa_numero ? `Pedido GSA ${lista.gsa_numero} — FEBECOS` : ""); setCBody(""); }
  };
  const enviar = async () => {
    if (!cTo.trim()) { alert("Falta el destinatario (Para)."); return; }
    setSending(true);
    try {
      const adj = cFiles.length ? await _filesToB64(cFiles) : [];
      const body = {
        to: cTo.trim(), cc: ccElegido().join(", ") || undefined, subject: cSubject, body: cBody,
        in_reply_to: modo === "reply" ? (m?.message_id || undefined) : undefined,
        forward_from: modo === "forward" && cIncluirAdj ? selMsg : undefined,
        attachments: adj.length ? adj : undefined,
      };
      const r = await fetch("/api/proveedor-responder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json(); if (!d.ok) throw new Error(d.error);
      alert("✅ Email enviado al proveedor."); setModo("");
    } catch (e: any) { alert("Error: " + e.message); } finally { setSending(false); }
  };
  return (
    <div className="fixed inset-0 z-[140] bg-black/50 flex items-stretch justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-[1200px] h-full flex flex-col shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="bg-febo-azul text-white rounded-t-xl px-5 py-3 flex items-center justify-between">
          <div className="font-bold">📨 Seguimiento del proveedor{lista?.gsa_numero ? ` · GSA ${lista.gsa_numero}` : ""}</div>
          <div className="flex items-center gap-3">
            {lista && <button onClick={() => abrir("new")} className="bg-white/15 hover:bg-white/25 border border-white/40 rounded-lg px-3 py-1 text-xs font-semibold">✍️ Nuevo email</button>}
            <button onClick={onClose} className="text-white/80 hover:text-white text-xl leading-none">✕</button>
          </div>
        </div>
        {err && <div className="p-5 text-red-500 text-sm">Error: {err}</div>}
        {!lista && !err && <div className="p-5 text-gray-400 text-sm">Cargando…</div>}
        {lista && !lista.mensajes?.length && <div className="p-5 text-gray-500 text-sm">No se encontró correspondencia con este proveedor para el pedido en la bandeja de gsandler.</div>}
        {lista && lista.mensajes?.length > 0 && (
          <div className="flex-1 flex min-h-0">
            {/* Bandeja: entrada + salida */}
            <div className="w-[260px] shrink-0 border-r border-gray-200 overflow-auto">
              {lista.mensajes.map((x: any) => { const noLeido = x.dir === "in" && !x.seen; return (
                <div key={x.id} onClick={() => setSelMsg(x.id)} className={`px-3 py-2 border-b border-gray-100 text-xs cursor-pointer ${selMsg === x.id ? "bg-blue-100 border-l-4 border-l-febo-azul" : noLeido ? "bg-amber-50 hover:bg-amber-100" : "hover:bg-gray-50"}`}>
                  <div className="flex items-center gap-1">
                    <span title={x.dir === "out" ? "Enviado" : "Recibido"}>{x.dir === "out" ? "📤" : "📥"}</span>
                    {noLeido && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" title="No leído" />}
                    <span className={`truncate ${noLeido ? "font-bold text-gray-900" : "font-semibold text-gray-700"}`}>{x.dir === "out" ? "Nosotros → " + (x.to_addrs || "") : (x.from_name || x.from_addr)}</span>
                    {x.dir === "in" && <button onClick={(ev) => { ev.stopPropagation(); toggleSeen(x); }} title={x.seen ? "Marcar como NO leído" : "Marcar como leído"} className="ml-auto text-gray-400 hover:text-febo-azul shrink-0">{x.seen ? "📭" : "📩"}</button>}
                  </div>
                  <div className={`truncate ${noLeido ? "text-gray-800 font-medium" : "text-gray-500"}`}>{x.subject}</div>
                  <div className="text-gray-400">{x.date ? new Date(x.date).toLocaleString("es-AR") : ""}</div>
                </div>
              ); })}
            </div>
            {/* Panel */}
            <div className="flex-1 flex flex-col min-w-0">
              {!m ? <div className="p-5 text-gray-400 text-sm">Cargando mensaje…</div> : (
                <>
                  <div className="px-4 py-2 border-b border-gray-100 text-sm flex items-center justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-semibold text-febo-azul truncate">{m.subject || "(sin asunto)"}</div>
                      <div className="text-gray-500 text-xs">De: {m.from_addr}{m.to_addrs ? " · Para: " + m.to_addrs : ""} · {m.date ? new Date(m.date).toLocaleString("es-AR") : ""}</div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => abrir("reply")} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold whitespace-nowrap">↩ Responder</button>
                      <button onClick={() => abrir("forward")} className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold whitespace-nowrap">↪ Reenviar</button>
                    </div>
                  </div>
                  {(msg.adjuntos || []).length > 0 && (
                    <div className="px-4 py-2 border-b border-gray-100 flex flex-wrap gap-2">
                      {msg.adjuntos.map((a: any) => (
                        <button key={a.id} onClick={() => setVerAdj(a.id)} className={`px-2.5 py-1 rounded-lg border text-xs font-semibold ${verAdj === a.id ? "border-febo-azul bg-blue-50 text-febo-azul" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>📎 {a.filename || "adjunto"}</button>
                      ))}
                      {verAdj && <a href={"/api/mail-adjunto?id=" + verAdj} target="_blank" rel="noreferrer" className="px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-500 hover:bg-gray-50">↗ pestaña</a>}
                      {verAdj && <button onClick={() => setVerAdj(null)} className="px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-500 hover:bg-gray-50">↩ volver al email</button>}
                    </div>
                  )}
                  {modo ? (
                    <div className="p-4 space-y-2 overflow-auto">
                      <div className="text-sm font-semibold text-gray-700">{modo === "reply" ? "↩ Responder" : modo === "forward" ? "↪ Reenviar" : "✍️ Nuevo email al proveedor"}</div>
                      <input value={cTo} onChange={(e) => setCTo(e.target.value)} placeholder="Para (email)" className="w-full border border-gray-300 rounded px-2 py-1 text-sm" />
                      <div>
                        <span className="block text-[10px] uppercase text-gray-400 font-semibold mb-1">CC (CRM) — tildá los que quieras</span>
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          {ccOps.map((e) => <label key={e} className="flex items-center gap-1.5 text-sm cursor-pointer"><input type="checkbox" checked={!!cCcSel[e]} onChange={(ev) => setCCcSel((s) => ({ ...s, [e]: ev.target.checked }))} /> {e}</label>)}
                          {!ccOps.length && <span className="text-xs text-gray-400">Sin contactos de copia en el CRM del proveedor.</span>}
                        </div>
                        <input value={cCcExtra} onChange={(e) => setCCcExtra(e.target.value)} placeholder="Otra copia (email, separá con coma)…" className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-xs" />
                      </div>
                      <input value={cSubject} onChange={(e) => setCSubject(e.target.value)} placeholder="Asunto" className="w-full border border-gray-300 rounded px-2 py-1 text-sm" />
                      <textarea value={cBody} onChange={(e) => setCBody(e.target.value)} rows={9} placeholder="Escribí el mensaje…" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
                      {modo === "forward" && (msg.adjuntos || []).length > 0 && <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={cIncluirAdj} onChange={(e) => setCIncluirAdj(e.target.checked)} /> Reenviar los {msg.adjuntos.length} adjunto(s) del original</label>}
                      <label className="block text-xs text-gray-600">📎 Adjuntar archivos<input type="file" multiple onChange={(e) => setCFiles(Array.from(e.target.files || []))} className="block mt-1 text-xs" /></label>
                      {cFiles.length > 0 && <div className="text-[11px] text-gray-500">{cFiles.map((f) => f.name).join(", ")}</div>}
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setModo("")} className="px-3 py-1.5 rounded-lg text-sm text-gray-500">Cancelar</button>
                        <button disabled={sending} onClick={enviar} className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50">{sending ? "Enviando…" : "📤 Enviar"}</button>
                      </div>
                      <div className="text-[11px] text-gray-400">Sale de gsandler@febecos.com.</div>
                    </div>
                  ) : verAdj
                    ? <iframe src={"/api/mail-adjunto?id=" + verAdj} className="flex-1 w-full border-0" title="Adjunto" />
                    : (m.body_html
                      ? <iframe srcDoc={'<base target="_blank">' + m.body_html} sandbox="allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation" className="flex-1 w-full border-0 bg-white" title="Email" />
                      : <pre className="p-4 whitespace-pre-wrap text-sm text-gray-700 overflow-auto">{m.body_text || "(sin contenido)"}</pre>)}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
