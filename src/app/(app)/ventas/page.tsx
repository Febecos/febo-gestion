import { redirect } from "next/navigation";
// Ventas se abre como ventana (MDI) desde el menú. La ruta directa vuelve al escritorio.
export default function VentasPage() { redirect("/"); }
