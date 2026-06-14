export default function Home() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center text-slate-300 select-none p-10">
      <div className="text-5xl mb-3 opacity-80">🛰️</div>
      <div className="text-lg font-semibold text-slate-100">FEBO-GESTION</div>
      <div className="text-sm mt-1 text-slate-300">Abrí un módulo desde el menú de arriba — cada uno se abre en su ventana.</div>
      <div className="text-xs mt-4 text-slate-400">Varias ventanas a la vez · arrastrá del título · doble clic = maximizar · ✕ = cerrar (libera memoria)</div>
    </div>
  );
}
