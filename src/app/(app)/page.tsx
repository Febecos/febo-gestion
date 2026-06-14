export default function Home() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 select-none p-10">
      <div className="text-5xl mb-3">🛰️</div>
      <div className="text-lg font-semibold text-gray-500">Bienvenido a FEBO-GESTION</div>
      <div className="text-sm mt-1">Abrí un módulo desde el menú de arriba. Cada uno se abre en su propia ventana.</div>
      <div className="text-xs mt-4 text-gray-300">Podés tener varias ventanas abiertas a la vez · arrastralas del título · doble clic para maximizar · ✕ para cerrar</div>
    </div>
  );
}
