"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function CotizadorEmbed({ tipoProp }: { tipoProp?: "fv" | "bomba" }) {
  const sp = useSearchParams();
  const tipo = tipoProp || (sp.get("t") === "fv" ? "fv" : "bomba");
  const [url, setUrl] = useState<string>("");
  const [interno, setInterno] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setUrl(""); setError("");
    fetch("/api/cotizadores").then((r) => r.json()).then((d) => {
      if (!d.ok) { setError(d.error || "No se pudo cargar"); return; }
      setInterno(!!d.interno);
      setUrl(tipo === "fv" ? d.fv : d.bombas);
    }).catch((e) => setError(e.message));
  }, [tipo]);

  const titulo = tipo === "fv" ? "☀️ Cotizador fotovoltaico" : "🔧 Cotizador de bombas";

  return (
    <div className="flex flex-col h-[calc(100vh-130px)]">
      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-lg font-bold">{titulo}</h1>
        {interno && <span className="text-[11px] bg-emerald-100 text-emerald-700 rounded px-2 py-0.5 font-semibold">tu perfil interno</span>}
        {url && <a href={url} target="_blank" rel="noreferrer" className="text-xs text-febo-azul ml-auto">abrir en pestaña ↗</a>}
      </div>
      {error ? (
        <div className="text-red-600 text-sm">Error: {error}</div>
      ) : !url ? (
        <div className="text-gray-400 text-sm">Cargando cotizador…</div>
      ) : (
        <iframe src={url} className="flex-1 w-full rounded-xl border border-gray-200 bg-white" title={titulo} />
      )}
      <div className="text-[11px] text-gray-400 mt-1">Si te pide login, ingresá con tu email (el mismo del admin). El presupuesto que generes queda guardado y lo vas a ver en Ventas.</div>
    </div>
  );
}
