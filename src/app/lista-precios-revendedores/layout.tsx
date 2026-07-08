import type { Metadata } from "next";

// Metadata PROPIO del visor público (pisa el default del ERP en src/app/layout.tsx). Sin esto, la
// preview al compartir el link por WhatsApp mostraba "FEBO-GESTION · ERP + CRM" (reportado 07/07).
const TITULO = "Lista de Precios · Febecos";
const DESCRIPCION = "Bombas solares y energía fotovoltaica · Febecos";
const LOGO = "https://fv.febecos.com/images/febecos-logo.png";
const URL = "https://visor.febecos.com/lista-precios-revendedores";

export const metadata: Metadata = {
  title: TITULO,
  description: DESCRIPCION,
  openGraph: {
    siteName: "Febecos",
    title: TITULO,
    description: DESCRIPCION,
    url: URL,
    type: "website",
    images: [{ url: LOGO }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITULO,
    description: DESCRIPCION,
    images: [LOGO],
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
