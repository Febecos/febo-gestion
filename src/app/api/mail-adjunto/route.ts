import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// GET ?id=<mail_attachment_id> → devuelve el adjunto (inline) para verlo dentro de Febo.
export async function GET(req: NextRequest) {
  try {
    const sql = getDb();
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!id) return NextResponse.json({ ok: false, error: "id requerido" }, { status: 400 });
    const r = (await sql`SELECT filename, content_type, encode(content,'base64') AS b64 FROM mail_attachments WHERE id=${id} LIMIT 1` as any[])[0];
    if (!r || !r.b64) return NextResponse.json({ ok: false, error: "adjunto no encontrado o sin contenido" }, { status: 404 });
    const buf = Buffer.from(r.b64, "base64");
    return new NextResponse(buf as any, {
      headers: {
        "Content-Type": r.content_type || "application/octet-stream",
        "Content-Disposition": `inline; filename="${(r.filename || "adjunto").replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
