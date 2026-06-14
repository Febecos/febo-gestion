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

  // Ocupa todo el alto de la ventana; el iframe scrollea (una sola barra).
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-1 border-b border-gray-100 text-[11px] text-gray-400 shrink-0">
        {interno && <span className="bg-emerald-100 text-emerald-700 rounded px-2 py-0.5 font-semibold">tu perfil interno</span>}
        {url && <a href={url} target="_blank" rel="noreferrer" className="ml-auto text-febo-azul">abrir en pestaña ↗</a>}
      </div>
      {error ? (
        <div className="text-red-600 text-sm p-4">Error: {error}</div>
      ) : !url ? (
        <div className="text-gray-400 text-sm p-4">Cargando cotizador…</div>
      ) : (
        <iframe src={url} className="flex-1 w-full border-0" title={tipo === "fv" ? "Cotizador FV" : "Cotizador bombas"} />
      )}
    </div>
  );
}
