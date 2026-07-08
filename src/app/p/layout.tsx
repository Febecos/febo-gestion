import type { Metadata } from "next";

// Metadata propio de los comprobantes públicos (/p/[token]: facturas/remitos/presupuestos que se
// comparten con clientes). Sin esto heredaban el default del ERP ("FEBO-GESTION · ERP + CRM") en la
// preview al compartir el link (mismo problema que el visor, 07/07). Genérico por comprobante.
const TITULO = "Comprobante · Febecos";
const DESCRIPCION = "Bombas solares y energía fotovoltaica · Febecos";
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
