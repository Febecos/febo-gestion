import type { Metadata } from "next";

// Metadata propio de la página pública de envío (/envio/[token]). Evita que la preview al compartir
// muestre el default del ERP ("FEBO-GESTION · ERP + CRM"). Mismo criterio que el visor (07/07).
const TITULO = "Febecos";
const DESCRIPCION = "Todo en energía solar para el Gremio";
const LOGO = "https://fv.febecos.com/images/febecos-logo.png";

export const metadata: Metadata = {
  title: TITULO,
  description: DESCRIPCION,
  openGraph: { siteName: "Febecos", title: TITULO, description: DESCRIPCION, type: "website", images: [{ url: LOGO }] },
  twitter: { card: "summary_large_image", title: TITULO, description: DESCRIPCION, images: [LOGO] },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
