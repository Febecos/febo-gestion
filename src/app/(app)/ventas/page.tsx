import VentasClient from "./VentasClient";

export const dynamic = "force-dynamic";

export default function VentasPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">🧾 Ventas</h1>
      <p className="text-sm text-gray-500 mb-6">Presupuesto → Pedido → Factura → Remito. Pagos y cuenta corriente.</p>
      <VentasClient />
    </div>
  );
}
