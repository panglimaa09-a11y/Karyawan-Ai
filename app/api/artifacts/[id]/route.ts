import { NextResponse } from "next/server";
import { getPool, requireAdmin } from "@/lib/server/db";

export const runtime = "nodejs";

/** GET /api/artifacts/[id] — isi penuh satu artefak + riwayat versi. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(request);
    const { id } = await context.params;
    const pool = getPool();
    const a = await pool.query(
      `SELECT a.*, e.name AS employee_name, t.title AS task_title
       FROM artifacts a LEFT JOIN employees e ON e.id = a.employee_id
       LEFT JOIN tasks t ON t.id = a.task_id WHERE a.id = $1`,
      [id]
    );
    if (!a.rowCount) return NextResponse.json({ error: "Artefak tidak ditemukan." }, { status: 404 });
    const versions = await pool.query(
      "SELECT version, LENGTH(content) AS size_bytes, created_at FROM artifact_versions WHERE artifact_id = $1 ORDER BY version DESC",
      [id]
    );
    return NextResponse.json({ artifact: a.rows[0], versions: versions.rows });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Internal error";
    return NextResponse.json({ error: m }, { status: m === "UNAUTHORIZED" ? 401 : 503 });
  }
}
