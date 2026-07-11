import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// Parámetros de cálculo FV (capa 2 "matriz viva"): el motor dimensionar() los lee EN VIVO de fv_config.
// Esta pantalla los edita. Whitelist = solo las claves del motor (B–F de PARAMETROS-FV-CONFIG.md) para
// NO pisar las claves del cotizador (markup_tramos, usar_tramos, dolar, markup_cf_pct, etc.) que viven
// en la misma fila fv_config. Las de precios (A) las maneja la config de precios del cotizador aparte.
const PARAM_KEYS = [
  // Dimensionado on-grid
  "cobertura_objetivo", "ratio_min", "ratio_max", "factor_aprovechamiento",
  // Plano real (tilt/azimut)
  "inclinacion_default", "inclinacion_coplanar_default", "fraccion_diurna_default",
  // Microinversor (sistemas chicos, inyección cero)
  "umbral_micro_paneles", "paneles_por_micro", "micro_default", "codigo_micro_conector", "codigo_micro_endcap",
  // Protecciones / embalaje
  "termica_min_a", "umbral_embalaje", "codigo_embalaje_x1", "codigo_embalaje_x2",
  // Off-grid
  "autonomia_dias", "dod_litio", "dod_plomo", "factor_autonomia_default", "pr_offgrid", "sobredim_paneles", "margen_inversor",
  // Validación de tensión
  "temp_diseno_frio", "temp_diseno_calor", "strings_por_mppt",
  // Armado del BOM
  "panel_default", "estructura_default", "paneles_por_estructura", "metros_cable_default", "metros_tierra_default", "factor_proteccion", "loss_pvgis",
  // Códigos de ítems de norma
  "codigo_cable_tierra", "codigo_cable_solar_metro", "codigo_jabalina", "codigo_limitador_tri", "codigo_limitador_mono",
] as const;

// Defaults (espejo de motor/config.default.mjs) para mostrar aunque fv_config aún no los tenga.
const DEFAULTS: Record<string, any> = {
  cobertura_objetivo: 1.0, ratio_min: 1.15, ratio_max: 1.20, factor_aprovechamiento: 0.7,
  inclinacion_default: 30, inclinacion_coplanar_default: 10, fraccion_diurna_default: 0.5,
  umbral_micro_paneles: 4, paneles_por_micro: 2, micro_default: "NEO1000M-X", codigo_micro_conector: "ACTRUNKCONNECTOR", codigo_micro_endcap: "ACTRUNKENDCAP",
  termica_min_a: 16, umbral_embalaje: 4, codigo_embalaje_x1: "EMBALAJEPANELESX1", codigo_embalaje_x2: "EMBALAJEPANELESX2",
  autonomia_dias: 2, dod_litio: 90, dod_plomo: 50, factor_autonomia_default: 1.0, pr_offgrid: 0.72, sobredim_paneles: 1.3, margen_inversor: 1.2,
  temp_diseno_frio: -10, temp_diseno_calor: 65, strings_por_mppt: 2,
  panel_default: "AS-7M144N-HC-580W", estructura_default: "chapa-inclinada", paneles_por_estructura: 4, metros_cable_default: 20, metros_tierra_default: 20, factor_proteccion: 1.25, loss_pvgis: 14,
  codigo_cable_tierra: "CAB-TIE", codigo_cable_solar_metro: "CAB-SOL", codigo_jabalina: "JAB", codigo_limitador_tri: "TPM-E", codigo_limitador_mono: "SPM-E",
};

async function ensureRow(sql: any) {
  await sql`CREATE TABLE IF NOT EXISTS fv_config (id INT PRIMARY KEY DEFAULT 1, data JSONB NOT NULL DEFAULT '{}'::jsonb)`.catch(() => {});
}

export async function GET() {
  try {
    const sql = getDb();
    await ensureRow(sql);
    const r = await sql`SELECT data FROM fv_config WHERE id = 1 LIMIT 1`;
    const data = (r[0]?.data) || {};
    // Devolver cada param con su valor actual (o el default si no está seteado).
    const params: Record<string, any> = {};
    for (const k of PARAM_KEYS) params[k] = data[k] != null ? data[k] : DEFAULTS[k];
    return NextResponse.json({ ok: true, params, defaults: DEFAULTS });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const incoming = b?.params || {};
    // Solo aceptamos claves whitelisted; el resto de fv_config queda intacto (merge JSONB).
    const patch: Record<string, any> = {};
    for (const k of PARAM_KEYS) if (incoming[k] !== undefined && incoming[k] !== "") patch[k] = incoming[k];
    if (!Object.keys(patch).length) return NextResponse.json({ ok: false, error: "sin parámetros válidos" }, { status: 400 });
    const sql = getDb();
    await ensureRow(sql);
    // Merge no destructivo: data = data || patch (el patch pisa solo sus claves).
    await sql`INSERT INTO fv_config (id, data) VALUES (1, ${JSON.stringify(patch)}::jsonb)
              ON CONFLICT (id) DO UPDATE SET data = fv_config.data || ${JSON.stringify(patch)}::jsonb`;
    return NextResponse.json({ ok: true, guardados: Object.keys(patch) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
