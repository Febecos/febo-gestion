import { NextRequest, NextResponse } from "next/server";

// Operaciones es ahora una VISTA DE SOLO LECTURA derivada de los pedidos reales.
// El avance del circuito (reservar, confirmar, pagar, FACTURAR) se hace ÚNICAMENTE
// en el modal de Pedidos, que es la fuente de verdad. Esto evita estados
// desincronizados y doble facturación. Por eso este endpoint ya no muta nada.
export async function POST(_req: NextRequest) {
  return NextResponse.json({
    ok: false,
    error: "Operaciones es solo lectura. Avanzá el pedido (reservar / confirmar / pagar / facturar) desde Ventas → Pedidos.",
  }, { status: 410 });
}
