import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Datos en vivo: no cachear. force-dynamic saca la ruta del prerender, pero NO frena el Data Cache
// de las queries internas (neon corre sobre fetch y Next lo cachea → devolvía el snapshot del
// borrador aun con la fila ya emitida). fetchCache=force-no-store obliga a leer la DB en cada request.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

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
        fecha: "2026-06-16", vencimiento: "2026-06-16", moneda: "ARS", copia: "ORIGINAL",
        subtotal_bruto: 121, total: 121,
        condicion_iva_receptor: "Consumidor Final",
        leyendas: [], afip_cae: "86240266365982", afip_cae_vto: "20260626", afip_qr: qr,
        cliente_nombre: "Consumidor Final", cliente_cuit: null,
      };
      const items = [{ descripcion: "Producto de prueba (homologación)", cantidad: 1, precio_unitario: 121, descuento_pct: 0, total: 121 }];
      const empresa = { cuit: "20217301565", razon_social: "Sandler Guillermo Javier", domicilio: "Rojas 441", localidad: "CABA", provincia: "", cod_postal: "", condicion_iva: "Responsable Inscripto", inicio_actividades: "10/2017" };
      return NextResponse.json({ ok: true, comprobante, items, cliente: null, empresa });
    }

    // ── Token DEMO-A: Factura A completa (Resp. Inscripto, descuento, doble IVA) ──
    // Replica el modelo real 0008-00000483 para validar el formato A4. No toca la DB.
    if (token === "DEMO-A") {
      const qrData = { ver: 1, fecha: "2026-05-27", cuit: 20217301565, ptoVta: 8, tipoCmp: 1, nroCmp: 483, importe: 2433481.92, moneda: "PES", ctz: 1, tipoDocRec: 80, nroDocRec: 33711881749, tipoCodAut: "E", codAut: 86217133099918 };
      const qr = "https://www.afip.gob.ar/fe/qr/?p=" + Buffer.from(JSON.stringify(qrData), "utf8").toString("base64");
      const comprobante = {
        id: 0, tipo: "factura", letra: "A", numero: "0008-00000483",
        fecha: "2026-05-27", vencimiento: "2026-05-27", moneda: "ARS", copia: "ORIGINAL",
        subtotal_bruto: 2313420, descuento_general_pct: 10, descuento_general_monto: 231342,
        neto: 2082078, total: 2433481.92,
        iva_detalle: { "21": 265571.46, "10.5": 85832.46 },
        condicion_iva_receptor: "Responsable Inscripto",
        condiciones_venta: "Anticipado", forma_pago: "Transferencia",
        lugar_entrega: "Transporte indicado y flete a Cargo del cliente.",
        tipo_transporte: "De Terceros - Expreso Lobruno (011) 4602-2892",
        leyendas: ["El campo Condición Frente al IVA del receptor resulta obligatorio conforme lo reglamentado por la Resolución General Nro 5616. Para más información consultar método FEParamGetCondicionIvaReceptor."],
        afip_cae: "86217133099918", afip_cae_vto: "20260606", afip_qr: qr,
        cliente_nombre: "Sol Del Este S.A.", cliente_cuit: "33711881749",
      };
      const items = [
        { descripcion: "Bomba Centrifuga 1800w con controlador WE-4CP9.1-105-240-1800", cantidad: 1, precio_unitario: 1070100, total: 1070100 },
        { descripcion: "Panel Solar Fotovoltaico Mono Amerisolar 144 celdas 550W 30mm", cantidad: 4, precio_unitario: 227070, total: 908280 },
        { descripcion: "Descargador de sobretensiones en corriente continua Tipo II 500CC marca Suntree", cantidad: 1, precio_unitario: 49845, total: 49845 },
        { descripcion: "Interruptor Termomagnetico de CC 550V 20A", cantidad: 1, precio_unitario: 34710, total: 34710 },
        { descripcion: "Cable Sensor 2x0.75mm2", cantidad: 20, precio_unitario: 1335, total: 26700 },
        { descripcion: "Cable Solar Conducom SA 1 x4.00mm2", cantidad: 2, precio_unitario: 2250, total: 4500 },
        { descripcion: "Kit Puesta Tierra Jabalina 3/8 X 1mt Con Morceto", cantidad: 1, precio_unitario: 10335, total: 10335 },
        { descripcion: "Gabinete Tablero Caja PVC IP65", cantidad: 1, precio_unitario: 11325, total: 11325 },
        { descripcion: "Cable plano sumergible 4 x 2.5 Extraflexible, de excelente deslizamiento", cantidad: 30, precio_unitario: 6375, total: 191250 },
        { descripcion: "Cable tierra 4mm", cantidad: 5, precio_unitario: 1275, total: 6375 },
      ];
      const cliente = { razon_social: "Sol Del Este S.A.", cuit: "33711881749", condicion_fiscal: "responsable_inscripto", domicilio: "Ruta 317 Km 20", localidad: "Virginia", provincia: "Tucumán", cod_postal: "4186" };
      const empresa = { cuit: "20217301565", razon_social: "Sandler Guillermo Javier", domicilio: "Rojas 441", localidad: "Buenos Aires", provincia: "C.A.B.A.", cod_postal: "1405", telefono: "549 11 2575 0323", email: "ventas@febecos.com", condicion_iva: "Responsable Inscripto", inicio_actividades: "10/2017" };
      return NextResponse.json({ ok: true, comprobante, items, cliente, empresa });
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

    // no-store: el comprobante cambia de estado (borrador→emitida con CAE/QR); nunca servir cacheado.
    return NextResponse.json({ ok: true, comprobante: c, items, cliente, empresa }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
