import { redirect } from "next/navigation";
// Productos se abre como ventana (MDI) desde el menú. La ruta directa vuelve al escritorio.
export default function ProductosPage() { redirect("/"); }
