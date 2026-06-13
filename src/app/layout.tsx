import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FEBO-GESTION",
  description: "ERP + CRM de Febecos",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
