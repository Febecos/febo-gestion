import ClientesClient from "./ClientesClient";

export const dynamic = "force-dynamic";

export default function ClientesPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">👥 Clientes / CRM</h1>
      <p className="text-sm text-gray-500 mb-6">Base unificada de contactos (Neon central — compartida con el admin).</p>
      <ClientesClient />
    </div>
  );
}
