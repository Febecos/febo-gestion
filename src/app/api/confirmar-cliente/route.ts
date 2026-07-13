import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { validarStock, descontarStock } from "@/lib/stock";
import { getUser } from "@/lib/owner";
import { emitEvento } from "@/lib/eventos";

export const runtime = "nodejs";

// POST { numero } → "Pasar a pedido": crea el PEDIDO (fv_pedidos) desde el presupuesto y lo
// marca 'pedido'. NATIVO: NO llama al selector ni manda mail (el aviso de pago es aparte, al aprobar).
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const numero = (b.numero || "").trim();
    if (!numero) return NextResponse.json({ ok: false, error: "numero requerido" }, { status: 400 });
    const sql = getDb();
    const pr = (await sql`SELECT numero, cliente_nombre, cliente_apellido, cliente_razon_social, cliente_email, cliente_telefono,
      cliente_zona, cliente_direccion, cliente_cuit, revendedor_email, revendedor_nombre, tipo_precio, condiciones, notas_internas,
      fv_items, descuento_pct, precio_ofrecido, moneda, tc, public_token, tipo, estado,
      bomba_codigo, bomba_descripcion, profundidad_m FROM presupuestos WHERE numero=${numero} LIMIT 1` as any[])[0];
    if (!pr) return NextResponse.json({ ok: false, error: "presupuesto no encontrado" }, { status: 404 });

    // ── Chequeo de STOCK antes de pasar a pedido (bomba/FV). Si falta stock y no se forzó,
    //    devolvemos sin_stock=true para que el front muestre el cartel "pedido sin stock / pedir al proveedor".
    const itemsChk = Array.isArray(pr.fv_items) && pr.fv_items.length
      ? pr.fv_items
      : (pr.tipo === "bomba" ? [{ codigo: pr.bomba_codigo, descripcion: pr.bomba_descripcion, cantidad: 1 }] : []);
    const usuario = await getUser(req);
    let sinStock = false;
    if ((pr.tipo === "fv" || pr.tipo === "bomba") && itemsChk.length) {
      const chk = await validarStock(sql, itemsChk).catch(() => ({ ok: true, faltantes: [] as any[] }));
      sinStock = !chk.ok;
      if (sinStock && !b.force_sin_stock) {
        return NextResponse.json({ ok: false, sin_stock: true, faltantes: chk.faltantes });
      }
      // Forzar con falta de stock = solo el owner (Guillermo).
      if (sinStock && b.force_sin_stock && !usuario?.es_owner) {
        return NextResponse.json({ ok: false, error: "Stock a confirmar manualmente: solo el administrador puede forzar la confirmación.", faltantes: chk.faltantes, sin_stock: true }, { status: 409 });
      }
    }

    // "Pasar a pedido": NO envía mail al cliente ni pide al proveedor (eso es aparte, desde el pedido).
    // Marca el presupuesto como 'pedido'.
    await sql`UPDATE presupuestos SET estado='pedido' WHERE numero=${numero} AND COALESCE(estado,'') NOT IN ('anulado','pagado')`.catch(() => {});

    // Crear el PEDIDO (fv_pedidos) para que aparezca en Ventas → Pedidos y habilite la cadena
    // facturar/remitir. Idempotente. Aplica a FV y a BOMBA (el kit de bomba debe confirmarse
    // completo, no solo la bomba → se persiste como fv_items desde el Portal; ver SPEC-KIT-BOMBA-ITEMS-PORTAL).
    let pedido_numero: string | null = null;
    if (pr.tipo === "fv" || pr.tipo === "bomba") {
      try {
        const ya = (await sql`SELECT numero FROM fv_pedidos WHERE payload->>'presupuesto_numero'=${numero} LIMIT 1` as any[])[0];
        if (ya) {
          pedido_numero = ya.numero;
        } else {
          const items = Array.isArray(pr.fv_items) ? [...pr.fv_items] : [];
          // BOMBA sin kit desglosado (Portal aún no persiste fv_items) → reconstruimos el kit desde
          // el catálogo de bombas (pump_components): bomba + paneles + soporte + cables + soga + caja…
          let kitPendiente = false;
          if (pr.tipo === "bomba" && items.length === 0) {
            const base = Number(pr.precio_ofrecido) || 0;
            items.push({ codigo: pr.bomba_codigo || "", descripcion: pr.bomba_descripcion || pr.bomba_codigo || "Bomba", cantidad: 1, iva_pct: 21, subtotal: +(base / 1.21).toFixed(2) });
            try {
              const pump = (await sql`SELECT id FROM pumps WHERE regexp_replace(lower(codigo),'[[:space:]]','','g') = regexp_replace(lower(${pr.bomba_codigo || ""}),'[[:space:]]','','g') LIMIT 1` as any[])[0];
              if (pump) {
                const comps = (await sql`SELECT cc.codigo, cc.nombre, cc.unidad, pc.cantidad, cc.precio_usd
                  FROM pump_components pc JOIN components cc ON cc.id = pc.component_id
                  WHERE pc.pump_id = ${pump.id} AND COALESCE(pc.habilitado_default, true) = true AND COALESCE(pc.opcional, false) = false` as any[]);
                for (const k of comps) {
                  // El PANEL solar va a 10,5% (alineado con fv_items del Portal; el total no cambia,
                  // solo la discriminación de IVA). El resto del kit a 21%.
                  const esPanel = /panel|fotovolt|m[oó]dulo\s*solar/i.test(`${k.nombre || ""} ${k.codigo || ""}`);
                  items.push({ codigo: k.codigo || "", descripcion: k.nombre || "", cantidad: Number(k.cantidad) || 1, unidad: k.unidad || null, iva_pct: esPanel ? 10.5 : 21, subtotal: 0, costo_usd: Number(k.precio_usd) || 0, kit_reconstruido: true });
                }
              } else {
                kitPendiente = true;   // no hay pump en catálogo → solo la bomba
              }
            } catch { kitPendiente = true; }
          }
          // Totales con IVA desglosado, aplicando el descuento del presupuesto (igual que el cotizador).
          let netoBase = 0; const ivaMap: Record<string, number> = {};
          for (const it of items) {
            const sub = Number(it.subtotal) || 0; const pct = Number(it.iva_pct ?? 21);
            netoBase += sub; ivaMap[pct] = (ivaMap[pct] || 0) + sub * pct / 100;
          }
          // Descuento ANCLADO en precio_ofrecido (igual que el PDF/visor): f = precio_ofrecido / total_lista.
          // Así el total del pedido = precio_ofrecido exacto (no recalculado desde ítems).
          const ivaLista = +Object.values(ivaMap).reduce((a: number, b: any) => a + b, 0).toFixed(2);
          const totalLista = +(netoBase + ivaLista).toFixed(2);
          const saved = Number(pr.precio_ofrecido) || 0;
          let f = 1, descMonto = 0, descPct = Math.max(0, Math.min(100, Number(pr.descuento_pct) || 0));
          if (saved > 0 && saved < totalLista - 0.5 && totalLista > 0) {
            f = saved / totalLista;
            descMonto = +(netoBase * (1 - f)).toFixed(2);
            descPct = Math.round((1 - f) * 100);
          }
          const neto = +(netoBase * f).toFixed(2);
          const ivaDetalle = Object.entries(ivaMap).sort().map(([pct, m]) => ({ pct: Number(pct), monto: +((m as number) * f).toFixed(2) }));
          const ivaFinal = +ivaDetalle.reduce((a, d2) => a + d2.monto, 0).toFixed(2);
          const totales = {
            neto, iva: ivaFinal, iva_detalle: ivaDetalle,
            total: saved > 0 ? +saved.toFixed(2) : +(neto + ivaFinal).toFixed(2),
            descuento_pct: descPct || null, descuento_monto: descMonto || null,
            moneda: pr.moneda || (pr.tipo === "bomba" ? "ARS" : "USD"), tc: pr.tc ? Number(pr.tc) : null,
          };
          // Capturar el PROVEEDOR real del catálogo al crear el pedido (los fv_items del presupuesto no lo
          // traen → sin esto todo caía en "Sin proveedor"). Fila NO-espejo (origen ≠ pumps/kit_bomba),
          // mismo criterio anti-espejo del ruteo/costo. Es red de seguridad en origen; el enrichEmisor del
          // pedido igual lo resuelve al leer, pero así queda persistido y no depende del fallback.
          const provMap: Record<string, string> = {};
          const faltanProv = items.filter((it: any) => !it.emisor && !it.proveedor && it.codigo).map((it: any) => String(it.codigo));
          if (faltanProv.length) {
            try { const pr2 = await sql`SELECT codigo, proveedor FROM fg_productos WHERE COALESCE(proveedor,'') <> '' AND codigo = ANY(${faltanProv}) AND COALESCE(origen,'') NOT IN ('pumps','kit_bomba')` as any[];
              for (const r of pr2) if (provMap[String(r.codigo)] == null) provMap[String(r.codigo)] = r.proveedor; } catch {}
          }
          const itemsPed = items.map((it: any) => ({
            ...it,
            pvp_sin_iva_usd: it.pvp_sin_iva_usd ?? +(((Number(it.subtotal) || 0) / (Number(it.cantidad) || 1)).toFixed(2)),
            proveedor: it.proveedor || provMap[String(it.codigo)] || it.proveedor,
          }));
          const clienteNombre = [pr.cliente_nombre, pr.cliente_apellido].filter(Boolean).join(" ").trim() || pr.revendedor_nombre || "";
          const payload = {
            tipo_origen: "cotizador", tipo_presupuesto: pr.tipo, kit_pendiente: kitPendiente,
            sin_stock: sinStock, nota_stock: sinStock ? "⚠️ Pedido SIN STOCK — pedir el equipo al proveedor" : null,
            presupuesto_numero: numero, items: itemsPed, totales,
            revendedor: {
              nombre: clienteNombre, whatsapp: pr.cliente_telefono || "", email: pr.revendedor_email || "",
              empresa: pr.cliente_razon_social || "", localidad: pr.cliente_zona || "", direccion: pr.cliente_direccion || "", cuit: pr.cliente_cuit || "",
            },
            cliente: { nombre: clienteNombre, email: pr.cliente_email || "", cuit: pr.cliente_cuit || "" },
            condiciones: pr.condiciones || {}, notas: pr.notas_internas || "",
            tipo_cliente: pr.tipo_precio === "revendedor" ? "rev" : "cf",
          };
          await sql`CREATE TABLE IF NOT EXISTS pedidos_counter (clave TEXT PRIMARY KEY, ultimo_numero INT NOT NULL DEFAULT 0)`;
          await sql`INSERT INTO pedidos_counter (clave, ultimo_numero) VALUES ('PED', 0) ON CONFLICT (clave) DO NOTHING`;
          const numRow = await sql`UPDATE pedidos_counter SET ultimo_numero = ultimo_numero + 1 WHERE clave='PED' RETURNING ultimo_numero` as any[];
          const nro = numRow[0].ultimo_numero;
          pedido_numero = "PED-" + String(nro).padStart(4, "0");
          try {
            await sql`INSERT INTO fv_pedidos (numero, recibido, estado, payload) VALUES (${pedido_numero}, ${new Date().toISOString()}, 'pendiente_confirmacion', ${JSON.stringify(payload)}::jsonb)`;
            // ── Stock propio: al CONFIRMAR se descuenta del depósito todo ítem que tenga stock cargado
            //    (descontarStock saltea lo que no existe en fg_productos) y el pedido queda con
            //    stock_validado=true en un solo paso (auto). ──
            try {
              await descontarStock(sql, payload.items || [], pedido_numero, usuario?.email || null);
              if (sinStock) await sql`UPDATE fv_pedidos SET stock_validado=true, stock_validado_at=now(), stock_override_by=${usuario?.email || "owner"} WHERE numero=${pedido_numero}`;
              else await sql`UPDATE fv_pedidos SET stock_validado=true, stock_validado_at=now() WHERE numero=${pedido_numero}`;
            } catch (stkErr: any) { console.error("[confirmar-cliente] descuento de stock falló:", stkErr.message); }
            // Bus de eventos (C5): el cliente confirmó el presupuesto → nace el pedido.
            const cidEv = (await sql`SELECT cliente_id FROM presupuestos WHERE numero=${numero} LIMIT 1` as any[])[0]?.cliente_id ?? null;
            await emitEvento(sql, { tipo: "presupuesto.aceptado", entidad: "presupuesto", entidadId: numero,
              payload: { pedido_numero, total: totales?.total ?? null, moneda: totales?.moneda ?? null }, idempotencyKey: `gestion:presupuesto.aceptado:${numero}`, clienteId: cidEv });
            await emitEvento(sql, { tipo: "pedido.creado", entidad: "pedido", entidadId: pedido_numero,
              payload: { presupuesto_numero: numero, origen: "confirmacion_cliente", sin_stock: sinStock, total: totales?.total ?? null, moneda: totales?.moneda ?? null }, idempotencyKey: `gestion:pedido.creado:${pedido_numero}`, clienteId: cidEv });
            // PROMOCIÓN (plan tipo 'prospecto'): confirmar el pedido = el cliente COMPRÓ. Le agregamos el
            // tag 'compro' (a cualquier comprador salvo proveedor) y, si era prospecto/contacto, lo
            // promovemos a cliente_final. NUNCA degrada revendedor (mantiene su tipo + tag compro, norma)
            // ni pisa un cliente_final existente. Best-effort: no bloquea la confirmación.
            if (cidEv) {
              try {
                await sql`UPDATE clientes SET tags = ARRAY(SELECT DISTINCT unnest(COALESCE(tags,'{}'::text[]) || ARRAY['compro'])), updated_at = now() WHERE id = ${cidEv} AND tipo <> 'proveedor'`;
                await sql`UPDATE clientes SET tipo = 'cliente_final', updated_at = now() WHERE id = ${cidEv} AND tipo IN ('prospecto','contacto')`;
              } catch (promErr: any) { console.error("[confirmar-cliente] promoción a cliente_final falló:", promErr.message); }
            }
          } catch (insErr) {
            // Liberar el número si el INSERT falló (no quemar números → evita huecos).
            await sql`UPDATE pedidos_counter SET ultimo_numero = ultimo_numero - 1 WHERE clave='PED' AND ultimo_numero = ${nro}`.catch(() => {});
            pedido_numero = null;
            throw insErr;
          }
        }
      } catch (e: any) {
        // No bloquea la confirmación; se registra para diagnóstico.
        console.error("[confirmar-cliente] no se pudo crear el fv_pedido:", e.message);
      }
    }
    return NextResponse.json({ ok: true, pedido_numero, sin_stock: sinStock });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
