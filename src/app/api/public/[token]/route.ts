import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// GET /api/public/[token]  → comprobante + ítems + datos del cliente, SOLO por token.
// Público (sin sesión): el token aleatorio es la credencial.
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const token = (params.token || "").trim();
    if (!token) return NextResponse.json({ ok: false, error: "token requerido" }, { status: 400 });

    // ── Token DEMO: factura de ejemplo con el CAE/QR reales de la prueba de homologación ──
    // Solo para previsualizar el formato del comprobante electrónico. No toca la DB.
    if (token === "DEMO-CAE") {
      const qrData = { ver: 1, fecha: "2026-06-16", cuit: 20217301565, ptoVta: 1, tipoCmp: 6, nroCmp: 1, importe: 121, moneda: "PES", ctz: 1, tipoDocRec: 99, nroDocRec: 0, tipoCodAut: "E", codAut: 86240266365982 };
      const qr = "https://www.afip.gob.ar/fe/qr/?p=" + Buffer.from(JSON.stringify(qrData), "utf8").toString("base64");
      const comprobante = {
        id: 0, tipo: "factura", letra: "B", numero: "00001-00000001",
        fecha: "2026-06-16", vencimiento: "2026-06-16", moneda: "ARS",
        subtotal: 100, total: 121, iva_detalle: { "21": 21 },
        condicion_iva_receptor: "Consumidor Final",
        leyendas: [], afip_cae: "86240266365982", afip_cae_vto: "20260626", afip_qr: qr,
        cliente_nombre: "Consumidor Final", cliente_cuit: null,
      };
      const items = [{ descripcion: "Producto de prueba (homologación)", cantidad: 1, precio_unitario: 100, descuento_pct: 0, total: 100 }];
      const empresa = { cuit: "20217301565", razon_social: "Sandler Guillermo Javier", domicilio: "Rojas 441", localidad: "CABA", provincia: "", cod_postal: "", condicion_iva: "Responsable Inscripto", inicio_actividades: "10/2017" };
      return NextResponse.json({ ok: true, comprobante, items, cliente: null, empresa });
    }

    const sql = getDb();

    const comp = await sql`SELECT * FROM fg_comprobantes WHERE token = ${token} LIMIT 1`;
    if (!comp.length) return NextResponse.json({ ok: false, error: "no encontrado" }, { status: 404 });
    const c = comp[0] as any;

    const items = await sql`SELECT descripcion, cantidad, precio_unitario, descuento_pct, total FROM fg_items WHERE comprobante_id = ${c.id} ORDER BY orden`;

    let cliente: any = null;
    if (c.cliente_id) {
      const cl = await sql`
        SELECT nombre, razon_social, cuit, condicion_fiscal, domicilio, localidad, provincia, cod_postal, email, whatsapp
        FROM clientes WHERE id = ${c.cliente_id} LIMIT 1`;
      cliente = cl[0] || null;
    }

    // Emisor (FEBECOS) para el encabezado del comprobante
    let empresa: any = null;
    try { const e = await sql`SELECT cuit, razon_social, nombre_fantasia, domicilio, localidad, provincia, cod_postal, condicion_iva, iibb, inicio_actividades FROM fg_empresa WHERE id=1`; empresa = e[0] || null; } catch {}

    return NextResponse.json({ ok: true, comprobante: c, items, cliente, empresa });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
