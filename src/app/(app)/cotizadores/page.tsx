import { redirect } from "next/navigation";
// El cotizador se abre como ventana (MDI) desde el menú. La ruta directa vuelve al escritorio.
export default function CotizadoresPage() { redirect("/"); }
