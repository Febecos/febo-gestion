import { redirect } from "next/navigation";
// Clientes se abre como ventana (MDI) desde el menú. La ruta directa vuelve al escritorio.
export default function ClientesPage() { redirect("/"); }
