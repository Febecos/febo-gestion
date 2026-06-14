import { Suspense } from "react";
import TopNav from "./TopNav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Suspense fallback={<div className="h-[90px] border-b border-gray-200" />}>
        <TopNav />
      </Suspense>
      <main className="flex-1 p-6 overflow-auto">{children}</main>
    </div>
  );
}
