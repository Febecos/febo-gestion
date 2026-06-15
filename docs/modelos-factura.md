# Modelos de comprobante FEBECOS (layout a replicar)

PDFs modelo (con datos reales de clientes → NO versionar) en:
`D:\Dropbox\FEBECOS - FULL CLAUDE\modelos-factura\`
- `MODELO - Factura PROFORMA (A o B, no electronica).pdf` (Anjofer Nº 00008-00000032)
- `MODELO - Factura ELECTRONICA (con CAE).pdf` (Yanni Nº 0008-00000486)

Emisor (FEBECOS) — fijo en ambos:
- Razón social: **Sandler Guillermo Javier** · CUIT **20-21730156-5** · **Responsable Inscripto**
- Domicilio: **Rojas 441 (1405) – C.A.B.A. – Buenos Aires – Argentina**
- Email: **ventas@febecos.com** · Tel: **549 11 2575 0323** · Inicio de actividades: **10/2017**
- (estos datos = los de `fg_empresa`)

---

## 1) Factura PROFORMA (cuando es A o B, NO electrónica)

Encabezado:
- Letra grande (**A**/**B**) en el centro/medio entre emisor y datos del comprobante.
- Bloque comprobante (derecha): **"Factura Proforma"**, **Nº: 00008-NNNNNNNN** (pto vta 4 + número 8), **Fecha Emisión**, **Fecha Vencimiento**, **Hoja X de Y**.
- Texto obligatorio: **"Documento No Válido como Factura"**.
- Bloque emisor (izquierda): Sandler Guillermo Javier, CUIT, Condición Fiscal: Responsable Inscripto.
- Bloque cliente: **Razón Social, CUIT, Contacto, Condición de IVA, Dirección**.
- Datos de operación: **Forma de Pago, Condición de Pago, Plazo de Entrega, Lugar de Entrega**.

Cuerpo (tabla): **Cantidad · Descripción · Precio Unitario · Precio Total**.

Totales (derecha): **Subtotal · IVA 10,5% · IVA 21% · Total**.
Importe en letras: **"SON Pesos …"**.

Notas:
- Es proforma → sin CAE, sin código de barras.
- Multi-página con "Hoja X de Y" repitiendo encabezado emisor/cliente.

---

## 2) Factura ELECTRÓNICA (con CAE) — modelo final cuando se active AFIP/WSFE

Encabezado:
- **"FACTURA ORIGINAL"**, **Cód. 01** (tipo de comprobante AFIP), letra **A**.
- **Nº: 0008-00000486**, **FECHA**, **VENCIMIENTO**.
- Emisor completo: Sandler Guillermo Javier, Rojas 441 (1405) CABA, email, tel, CUIT, Condición Fiscal: Responsable Inscripto, **Inicio de actividades: 10/2017**.
- Cliente: **Señor(es)**, **Domicilio**, **Condición Fiscal**, **CUIT**, **Condiciones de Venta**, **Forma de Pago**, **Lugar de Entrega**.

Cuerpo (tabla): **CANTIDAD · DESCRIPCION · PRECIO UNITARIO · PRECIO TOTAL**.
Importe en letras.

Leyendas obligatorias (según receptor):
- Receptor Monotributo: *"El crédito fiscal discriminado en el presente comprobante, sólo podrá ser computado a efectos del Régimen de Sostenimiento e Inclusión Fiscal para Pequeños Contribuyentes de la Ley Nº 27.618"* (cód. 10217).
- **Cód. 10245 (RG 5616)**: *"El campo Condición Frente al IVA del receptor resultará obligatorio…"* → **condición IVA del receptor SIEMPRE visible**.

Totales: **SubTotal · IVA 21% · IVA 10,5% · Total**.

Pie fiscal (lo agrega AFIP al autorizar):
- **C.A.E. Nº: <14 dígitos>** · **Vto. CAE: <fecha>** · **código de barras** (CUIT+tipo+ptoVta+CAE+vto).

Ver [[afip-arca-facturacion]]. Hoy emitimos PROFORMA con la letra/leyendas correctas; el CAE es el paso de integración WSFE pendiente.
