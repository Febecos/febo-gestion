import WindowManager from "./WindowManager";
import TopNav from "./TopNav";

// El WindowManager renderiza el escritorio (gris) + las ventanas MDI. Las páginas de
// ruta redirigen a "/" — todo se trabaja por ventanas desde el menú.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <WindowManager>
      <TopNav />
      <div className="hidden">{children}</div>
    </WindowManager>
  );
}
