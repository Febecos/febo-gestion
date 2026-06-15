import { NextResponse } from "next/server";

// DIAGNÓSTICO TEMPORAL del puente gestión↔fv. Público a propósito (no expone secretos:
// solo reporta si fv aceptó la llamada). BORRAR después de diagnosticar.
export async function GET() {
  const fvBridge = !!process.env.FV_BRIDGE_SECRET;
  const internal = !!process.env.INTERNAL_SERVICE_SECRET;
  const secret = process.env.FV_BRIDGE_SECRET || process.env.INTERNAL_SERVICE_SECRET;
  const usando = process.env.FV_BRIDGE_SECRET ? "FV_BRIDGE_SECRET" : (process.env.INTERNAL_SERVICE_SECRET ? "INTERNAL_SERVICE_SECRET" : "NINGUNO");
  let fvStatus: number | null = null;
  let fvBody: any = null;
  try {
    if (secret) {
      const r = await fetch("https://fv.febecos.com/api/internal-session", {
        headers: { Authorization: "Bearer " + secret }, cache: "no-store",
      });
      fvStatus = r.status;
      const d = await r.json().catch(() => ({}));
      fvBody = { ok: d.ok === true, tokenRecibido: !!d.token, error: d.error || null };
    }
  } catch (e: any) { fvBody = { fetchError: e.message }; }

  return NextResponse.json({
    gestion_tiene_FV_BRIDGE_SECRET: fvBridge,
    gestion_tiene_INTERNAL_SERVICE_SECRET: internal,
    gestion_usando: usando,
    fv_internal_session_status: fvStatus,
    fv_resultado: fvBody,
    veredicto: fvStatus === 200 && fvBody?.tokenRecibido ? "✅ PUENTE OK (fv aceptó el secreto y devolvió token)" : "❌ fv rechazó (secretos no coinciden o no deployado)",
  });
}
