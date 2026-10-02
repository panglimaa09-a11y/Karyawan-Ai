import { NextResponse } from "next/server";
import { getPool, requireAdmin } from "@/lib/server/db";

export const runtime = "nodejs";

/** GET /api/artifacts?taskId=&limit= — metadata + pratinjau artefak. PRD §9. */
export async function GET(request: Request) {
  try {
    requireAdmin(request);
    const url = new URL(request.url);
    const taskId = url.searchParams.get("taskId");
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    const params: any[] = [];
    const where = taskId ? "WHERE a.task_id = $1" : "";
    if (taskId) params.push(taskId);
    params.push(limit);
    const { rows } = await getPool().query(
      `SELECT a.id, a.task_id, t.title AS task_title, a.employee_id, e.name AS employee_name,
              a.title, a.media_type, a.current_version, LENGTH(a.content) AS size_bytes,
              LEFT(a.content, 2000) AS preview, a.created_at,
              (SELECT COUNT(*) FROM artifact_versions v WHERE v.artifact_id = a.id) AS versions
       FROM artifacts a
       LEFT JOIN tasks t ON t.id = a.task_id
       LEFT JOIN employees e ON e.id = a.employee_id
       ${where}
       ORDER BY a.created_at DESC LIMIT $${params.length}`,
      params
    );
    return NextResponse.json({ artifacts: rows });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Internal error";
    return NextResponse.json({ error: m }, { status: m === "UNAUTHORIZED" ? 401 : 503 });
  }
}
