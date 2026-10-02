import { NextResponse } from "next/server";
import { getPool, requireAdmin } from "@/lib/server/db";

export const runtime = "nodejs";

/** GET /api/projects — daftar project + ringkasan status tugas. PRD §9. */
export async function GET(request: Request) {
  try {
    requireAdmin(request);
    const { rows } = await getPool().query(
      `SELECT p.id, p.name, p.description, p.status, p.created_at, p.updated_at,
              COUNT(t.id)::int AS task_count,
              COUNT(t.id) FILTER (WHERE t.status = 'completed')::int AS completed_count,
              COUNT(t.id) FILTER (WHERE t.status IN ('running','planning'))::int AS active_count,
              COUNT(t.id) FILTER (WHERE t.status = 'awaiting_approval')::int AS approval_count,
              COUNT(t.id) FILTER (WHERE t.status = 'failed' OR t.status = 'blocked')::int AS attention_count
       FROM projects p LEFT JOIN tasks t ON t.project_id = p.id
       GROUP BY p.id ORDER BY p.created_at DESC LIMIT 100`
    );
    return NextResponse.json({ projects: rows });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Internal error";
    return NextResponse.json({ error: m }, { status: m === "UNAUTHORIZED" ? 401 : 503 });
  }
}
