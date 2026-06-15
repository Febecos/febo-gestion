"use client";
import { useEffect, useState } from "react";

const chip = (txt: string, color: string) => (
  <span style={{ background: color + "1a", color }} className="rounded px-2 py-0.5 text-[11px] font-semibold">{txt}</span>
);

const SECCIONES = [
  { k: "talonarios", icon: "🔢", label: "Talonarios / Numeración" },
] as const;
type Sec = (typeof SECCIONES)[number]["k"];

export default function ConfigClient() {
  const [sec, setSec] = useState<Sec>("talonarios");
  const [denied, setDenied] = useState(false);
  useEffect(() => { fetch("/api/me").then((r) => r.json()).then((d) => { if (!d.ok || !d.es_owner) setDenied(true); }); }, []);
  if (denied) return <div className="p-8 text-center text-gray-500">🔒 Sección exclusiva del administrador (owner).</div>;
  return (
    <div className="flex gap-4 h-full">
      <aside className="w-52 shrink-0 border-r border-gray-200 pr-2">
        <div className="text-[11px] uppercase text-gray-400 font-bold px-2 py-2">⚙️ Configuración</div>
        {SECCIONES.map((s) => (
          <button key={s.k} onClick={() => setSec(s.k)}
            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-left mb-0.5 ${sec === s.k ? "bg-febo-azul text-white font-semibold" : "text-gray-600 hover:bg-gray-100"}`}>
            <span>{s.icon}</span><span>{s.label}</span>
          </button>
        ))}
      </aside>
      <div className="flex-1 min-w-0 overflow-auto">
        {sec === "talonarios" && <Talonarios />}
      </div>
    </div>
  );
}

function Talonarios() {
  const [rows, setRows] = useState<any[]>([]); const [loading, setLoading] = useState(true); const [err, setErr] = useState("");
  const load = () => fetch("/api/talonarios").then((r) => r.json()).then((d) => { if (d.ok) setRows(d.talonarios); else setErr(d.error || "Error"); setLoading(false); });
  useEffect(() => { load(); }, []);
  const patch = async (id: number, campo: string, valor: any) => {
    await fetch("/api/talonarios", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, campo, valor }) });
    load();
  };
  if (loading) return <div className="text-gray-400 py-8 text-center">Cargando…</div>;
  if (err) return <div className="text-red-600 py-8 text-center">{err}</div>;
  const inp = "border border-gray-300 rounded px-2 py-1 text-sm";
  return (
    <div>
      <h2 className="text-lg font-bold text-febo-azul mb-1">🔢 Talonarios / Numeración</h2>
      <div className="text-sm text-gray-500 mb-3">Numeración por comprobante (estilo Táctica). Editá <b>punto de venta</b>, <b>desde/hasta</b> y el <b>próximo número</b>. Las facturas <b>no electrónicas</b> generan <b>proforma</b>; las electrónicas (AFIP) quedan para más adelante. CAI/vencimiento aplican a comprobantes fiscales manuales.</div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr>
            <th className="text-left px-3 py-3">Comprobante</th>
            <th className="text-left px-3 py-3">Pto. venta</th>
            <th className="text-right px-3 py-3">Desde</th>
            <th className="text-right px-3 py-3">Hasta</th>
            <th className="text-right px-3 py-3">Próximo</th>
            <th className="text-left px-3 py-3">CAI</th>
            <th className="text-left px-3 py-3">Vto.</th>
            <th className="text-center px-3 py-3">Defecto</th>
            <th className="text-center px-3 py-3">Activo</th>
            <th className="text-center px-3 py-3">Bloq.</th>
          </tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-t border-gray-100">
                <td className="px-3 py-2"><div className="font-semibold">{t.nombre}</div><div className="text-[10px] text-gray-400 font-mono">{t.prefijo} · {t.electronica ? "electrónica AFIP" : "manual/proforma"}</div></td>
                <td className="px-3 py-2"><input defaultValue={t.serie || ""} onBlur={(e) => e.target.value !== (t.serie || "") && patch(t.id, "serie", e.target.value)} className={inp + " w-20"} /></td>
                <td className="px-3 py-2 text-right"><input type="number" defaultValue={t.nro_desde ?? 1} onBlur={(e) => Number(e.target.value) !== (t.nro_desde ?? 1) && patch(t.id, "nro_desde", e.target.value)} className={inp + " w-24 text-right"} /></td>
                <td className="px-3 py-2 text-right"><input type="number" defaultValue={t.nro_hasta ?? ""} placeholder="—" onBlur={(e) => String(e.target.value) !== String(t.nro_hasta ?? "") && patch(t.id, "nro_hasta", e.target.value)} className={inp + " w-24 text-right"} /></td>
                <td className="px-3 py-2 text-right"><input type="number" defaultValue={t.proximo_numero} onBlur={(e) => Number(e.target.value) !== t.proximo_numero && patch(t.id, "proximo_numero", e.target.value)} className={inp + " w-24 text-right font-semibold"} /></td>
                <td className="px-3 py-2"><input defaultValue={t.cai || ""} placeholder="—" onBlur={(e) => e.target.value !== (t.cai || "") && patch(t.id, "cai", e.target.value)} className={inp + " w-28"} /></td>
                <td className="px-3 py-2"><input type="date" defaultValue={t.vencimiento ? String(t.vencimiento).slice(0, 10) : ""} onBlur={(e) => e.target.value !== (t.vencimiento ? String(t.vencimiento).slice(0, 10) : "") && patch(t.id, "vencimiento", e.target.value)} className={inp} /></td>
                <td className="px-3 py-2 text-center"><input type="checkbox" checked={!!t.defecto} onChange={(e) => patch(t.id, "defecto", e.target.checked)} /></td>
                <td className="px-3 py-2 text-center"><input type="checkbox" checked={!!t.activo} onChange={(e) => patch(t.id, "activo", e.target.checked)} /></td>
                <td className="px-3 py-2 text-center"><input type="checkbox" checked={!!t.bloqueado} onChange={(e) => patch(t.id, "bloqueado", e.target.checked)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
