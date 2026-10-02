import { NextResponse } from "next/server";
import { getPool, requireAdmin } from "@/lib/server/db";

export const runtime = "nodejs";

/** GET /api/tasks?projectId=&status= — daftar tugas dengan nama karyawan. PRD §9. */
export async function GET(request: Request) {
  try {
    requireAdmin(request);
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const status = url.searchParams.get("status");
    const conditions: string[] = [];
    const params: any[] = [];
    if (projectId) { params.push(projectId); conditions.push(`t.project_id = $${params.length}`); }
    if (status) { params.push(status); conditions.push(`t.status = $${params.length}`); }
    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    const { rows } = await getPool().query(
      `SELECT t.id, t.project_id, p.name AS project_name, t.title, t.status, t.priority,
              t.assigned_employee_id, e.name AS employee_name,
              t.requires_approval, t.created_at, t.updated_at,
              (SELECT COUNT(*) FROM task_dependencies d WHERE d.task_id = t.id) AS dependency_count,
              (SELECT COUNT(*) FROM artifacts a WHERE a.task_id = t.id) AS artifact_count
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN employees e ON e.id = t.assigned_employee_id
       ${where}
       ORDER BY t.created_at DESC LIMIT 200`,
      params
    );
    return NextResponse.json({ tasks: rows });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Internal error";
    return NextResponse.json({ error: m }, { status: m === "UNAUTHORIZED" ? 401 : 503 });
  }
}
