"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [paso, setPaso] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function pedirCodigo(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setMsg("");
    try {
      const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "No se pudo enviar el código");
      setPaso("code"); setMsg("Te enviamos un código por email.");
    } catch (e: any) { setMsg("✕ " + e.message); } finally { setLoading(false); }
  }

  async function verificar(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setMsg("");
    try {
      const r = await fetch("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "Código incorrecto");
      router.push("/clientes"); router.refresh();
    } catch (e: any) { setMsg("✕ " + e.message); } finally { setLoading(false); }
  }

  const inp = "border border-gray-300 rounded-lg px-3 py-2.5 text-sm w-full";
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-[360px]">
        <div className="flex items-center gap-2 mb-1"><span className="text-2xl">🛰️</span><span className="font-extrabold text-febo-azul text-lg">FEBO-GESTION</span></div>
        <p className="text-xs text-gray-400 mb-6">ERP + CRM · acceso interno</p>
        {paso === "email" ? (
          <form onSubmit={pedirCodigo} className="flex flex-col gap-3">
            <label className="text-xs font-semibold text-gray-600">Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inp + " mt-1"} placeholder="tu@febecos.com" />
            </label>
            <button disabled={loading} className="bg-febo-azul text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50">{loading ? "Enviando…" : "Enviar código"}</button>
          </form>
        ) : (
          <form onSubmit={verificar} className="flex flex-col gap-3">
            <label className="text-xs font-semibold text-gray-600">Código (enviado a {email})
              <input value={code} onChange={(e) => setCode(e.target.value)} required className={inp + " mt-1 tracking-widest text-center"} placeholder="••••••" />
            </label>
            <button disabled={loading} className="bg-febo-azul text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50">{loading ? "Verificando…" : "Entrar"}</button>
            <button type="button" onClick={() => setPaso("email")} className="text-xs text-gray-400">‹ Cambiar email</button>
          </form>
        )}
        {msg && <p className="text-xs mt-4" style={{ color: msg.startsWith("✕") ? "#e53935" : "#059669" }}>{msg}</p>}
      </div>
    </div>
  );
}
