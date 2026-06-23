import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getUser } from "@/lib/owner";
import { syncCatalogStock } from "@/lib/catalog-stock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// STOCK (depósito propio) sobre fg_productos.stock + stock_minimo, con bitácora fg_stock_mov.
//  GET                 → lista de productos con stock/mínimo (q, bajo, limit)
//  GET ?count=1        → { count } de productos bajo mínimo (badge/alarma)
//  GET ?codigo=X&mov=1 → últimos movimientos del producto
//  POST {accion:'ajustar', codigo, delta, motivo}   → ajuste manual (suma/resta) + bitácora
//  POST {accion:'minimo',  codigo, stock_minimo}    → setear mínimo de aviso

async function ensure(sql: any) {
  await sql`ALTER TABLE fg_productos ADD COLUMN IF NOT EXISTS stock NUMERIC`.catch(() => {});
  await sql`ALTER TABLE fg_productos ADD COLUMN IF NOT EXISTS stock_minimo NUMERIC`.catch(() => {});
  await sql`ALTER TABLE fg_productos ADD COLUMN IF NOT EXISTS clasif TEXT[] DEFAULT '{}'`.catch(() => {});
  await sql`CREATE TABLE IF NOT EXISTS fg_stock_mov (
    id BIGSERIAL PRIMARY KEY,
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    codigo TEXT NOT NULL,
    descripcion TEXT,
    delta NUMERIC NOT NULL,
    tipo TEXT NOT NULL,          -- entrada | salida | ajuste
    motivo TEXT,
    ref TEXT,                    -- pedido / remito / etc.
    usuario TEXT,
    stock_resultante NUMERIC
  )`.catch(() => {});
}

export async function GET(req: NextRequest) {
  try {
    const sql = getDb();
    await ensure(sql);
    const sp = req.nextUrl.searchParams;

    if (sp.get("count")) {
      const r = (await sql`
        SELECT COUNT(*)::int AS count FROM fg_productos
        WHERE COALESCE(stock_minimo,0) > 0 AND COALESCE(stock,0) < stock_minimo AND activo = true
          AND COALESCE(origen,'') NOT IN ('pumps','kit_bomba')` as any[])[0];
      return NextResponse.json({ ok: true, count: r.count });
    }

    if (sp.get("mov") && sp.get("codigo")) {
      const codigo = String(sp.get("codigo"));
      const movs = await sql`SELECT ts, delta, tipo, motivo, ref, usuario, stock_resultante FROM fg_stock_mov WHERE codigo=${codigo} ORDER BY ts DESC LIMIT 50` as any[];
      return NextResponse.json({ ok: true, movimientos: movs });
    }

    // Facets para los selectores de filtro (categorías + emisores presentes).
    if (sp.get("facets")) {
      const cats = await sql`SELECT DISTINCT categoria FROM fg_productos WHERE activo=true AND categoria IS NOT NULL AND COALESCE(origen,'') NOT IN ('pumps','kit_bomba') ORDER BY categoria` as any[];
      const ems = await sql`SELECT DISTINCT emisor FROM fg_productos WHERE activo=true AND emisor IS NOT NULL AND emisor <> 'N/A' AND COALESCE(origen,'') NOT IN ('pumps','kit_bomba') ORDER BY emisor` as any[];
      const lis = await sql`SELECT DISTINCT proveedor FROM fg_productos WHERE activo=true AND proveedor IS NOT NULL AND COALESCE(origen,'') NOT IN ('pumps','kit_bomba') ORDER BY proveedor` as any[];
      return NextResponse.json({ ok: true, categorias: cats.map((r) => r.categoria), emisores: ems.map((r) => r.emisor), listas: lis.map((r) => r.proveedor) });
    }

    const q = (sp.get("q") || "").trim().toLowerCase();
    const like = `%${q}%`;
    const bajo = sp.get("bajo") === "1";
    const categoria = (sp.get("categoria") || "").trim();
    const emisor = (sp.get("emisor") || "").trim();
    const lista = (sp.get("lista") || "").trim();
    const stockF = (sp.get("stock") || "").trim();   // 'con' = stock>0 · 'sin' = sin stock local
    const kit = sp.get("kit") === "1";
    const fv = sp.get("fv") === "1";
    // Familias FV (por categoría → sobrevive al re-sync que borra las etiquetas). Excluye bombas.
    const FV_RX = "(panel|inversor|bater|regulador|microinversor|optimizador|mc4|cable|estructura|gabinete|proteccion|comunicacion|all-in-one|cargador|estacion|sensor)";
    const limit = Math.min(300, Number(sp.get("limit")) || 150);
    const rows = await sql`
      SELECT id, codigo, descripcion, categoria, proveedor, emisor, origen, disponibilidad, stock, stock_minimo, COALESCE(clasif,'{}') AS clasif FROM fg_productos
      WHERE activo = true AND codigo IS NOT NULL
        AND COALESCE(origen,'') NOT IN ('pumps','kit_bomba')
        AND (${q} = '' OR lower(coalesce(codigo,'')||' '||coalesce(descripcion,'')) LIKE ${like})
        AND (${bajo} = false OR (COALESCE(stock_minimo,0) > 0 AND COALESCE(stock,0) < stock_minimo))
        AND (${categoria} = '' OR categoria = ${categoria})
        AND (${emisor} = '' OR emisor = ${emisor})
        AND (${lista} = '' OR proveedor = ${lista})
        AND (${stockF} = '' OR (${stockF} = 'con' AND COALESCE(stock,0) > 0) OR (${stockF} = 'sin' AND COALESCE(stock,0) = 0))
        AND (${kit} = false OR (('kit_bomba' = ANY(COALESCE(clasif,'{}')) OR categoria = 'BOMBAS SOLARES') AND coalesce(descripcion,'') NOT ILIKE '%completo%'))
        AND (${fv} = false OR (coalesce(categoria,'') NOT ILIKE '%bomba%' AND (lower(coalesce(categoria,'')) ~ ${FV_RX} OR 'fv' = ANY(COALESCE(clasif,'{}')))))
      ORDER BY (COALESCE(stock_minimo,0) > 0 AND COALESCE(stock,0) < stock_minimo) DESC, categoria ASC, descripcion ASC
      LIMIT ${limit}` as any[];
    return NextResponse.json({ ok: true, productos: rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const sql = getDb();
    await ensure(sql);
    const u = await getUser(req);
    const b = await req.json();
    // Operar SIEMPRE por id (cada fila = código+marca; el mismo código puede tener 2 marcas).
    const id = Number(b.id);
    if (!id) return NextResponse.json({ ok: false, error: "id requerido" }, { status: 400 });

    if (b.accion === "clasif") {
      const tag = String(b.tag || "").trim();
      if (!["kit_bomba", "fv"].includes(tag)) return NextResponse.json({ ok: false, error: "tag inválido" }, { status: 400 });
      if (b.on) await sql`UPDATE fg_productos SET clasif = (SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(clasif,'{}') || ARRAY[${tag}]))) WHERE id=${id}`;
      else await sql`UPDATE fg_productos SET clasif = array_remove(COALESCE(clasif,'{}'), ${tag}) WHERE id=${id}`;
      return NextResponse.json({ ok: true });
    }

    if (b.accion === "emisor") {
      const em = String(b.emisor || "").trim() || null;
      await sql`UPDATE fg_productos SET emisor=${em} WHERE id=${id}`;
      return NextResponse.json({ ok: true });
    }

    if (b.accion === "minimo") {
      const m = Number(b.stock_minimo);
      if (!Number.isFinite(m) || m < 0) return NextResponse.json({ ok: false, error: "mínimo inválido" }, { status: 400 });
      await sql`UPDATE fg_productos SET stock_minimo=${m} WHERE id=${id}`;
      return NextResponse.json({ ok: true });
    }

    if (b.accion === "set_stock") {
      const v = Number(b.stock);
      if (!Number.isFinite(v) || v < 0) return NextResponse.json({ ok: false, error: "stock inválido" }, { status: 400 });
      const prod = (await sql`SELECT codigo, descripcion, stock FROM fg_productos WHERE id=${id} LIMIT 1` as any[])[0];
      if (!prod) return NextResponse.json({ ok: false, error: "producto no encontrado" }, { status: 404 });
      const delta = +(v - Number(prod.stock || 0)).toFixed(2);
      await sql`UPDATE fg_productos SET stock=${v} WHERE id=${id}`;
      if (delta !== 0) await sql`INSERT INTO fg_stock_mov (codigo, descripcion, delta, tipo, motivo, usuario, stock_resultante)
        VALUES (${prod.codigo}, ${prod.descripcion || null}, ${delta}, 'ajuste', 'edición directa en lista', ${u?.email || null}, ${v})`;
      await syncCatalogStock(sql, prod.codigo);   // liga el stock del catálogo de bombas (pumps) al depósito
      return NextResponse.json({ ok: true, stock: v });
    }

    if (b.accion === "ajustar") {
      const delta = Number(b.delta);
      if (!Number.isFinite(delta) || delta === 0) return NextResponse.json({ ok: false, error: "delta inválido" }, { status: 400 });
      const prod = (await sql`SELECT codigo, descripcion, stock FROM fg_productos WHERE id=${id} LIMIT 1` as any[])[0];
      if (!prod) return NextResponse.json({ ok: false, error: "producto no encontrado" }, { status: 404 });
      const nuevo = +(Number(prod.stock || 0) + delta).toFixed(2);
      await sql`UPDATE fg_productos SET stock=${nuevo} WHERE id=${id}`;
      await sql`INSERT INTO fg_stock_mov (codigo, descripcion, delta, tipo, motivo, usuario, stock_resultante)
        VALUES (${prod.codigo}, ${prod.descripcion || null}, ${delta}, 'ajuste', ${b.motivo || "ajuste manual"}, ${u?.email || null}, ${nuevo})`;
      await syncCatalogStock(sql, prod.codigo);
      return NextResponse.json({ ok: true, stock: nuevo });
    }

    return NextResponse.json({ ok: false, error: "acción desconocida" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
