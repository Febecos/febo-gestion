import ProductosClient from "./ProductosClient";

export const dynamic = "force-dynamic";

export default function ProductosPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">📦 Productos</h1>
      <p className="text-sm text-gray-500 mb-6">Catálogo unificado: kits de bombas + fotovoltaico.</p>
      <ProductosClient />
    </div>
  );
}
