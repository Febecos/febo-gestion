import WindowManager from "./WindowManager";
import TopNav from "./TopNav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <WindowManager>
      <div className="h-screen flex flex-col">
        <TopNav />
        {/* Escritorio: las ventanas MDI flotan encima de este fondo */}
        <main className="flex-1 overflow-hidden bg-slate-700" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,.06) 1px, transparent 0)", backgroundSize: "22px 22px" }}>
          {children}
        </main>
      </div>
    </WindowManager>
  );
}
