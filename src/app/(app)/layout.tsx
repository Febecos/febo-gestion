import WindowManager from "./WindowManager";
import TopNav from "./TopNav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <WindowManager>
      <div className="min-h-screen flex flex-col">
        <TopNav />
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>
    </WindowManager>
  );
}
