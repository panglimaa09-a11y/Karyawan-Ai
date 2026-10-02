import { NextResponse } from "next/server";
import { getPool, requireAdmin } from "@/lib/server/db";
import { audit } from "@/lib/server/audit";

export const runtime = "nodejs";

/** GET /api/tasks/[id] — detail lengkap: assignment, dependensi, artefak, approval, tool runs. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(request);
    const { id } = await context.params;
    const pool = getPool();
    const task = await pool.query(
      `SELECT t.*, e.name AS employee_name, p.name AS project_name
       FROM tasks t LEFT JOIN employees e ON e.id = t.assigned_employee_id
       LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = $1`,
      [id]
    );
    if (!task.rowCount) return NextResponse.json({ error: "Tugas tidak ditemukan." }, { status: 404 });
    const [deps, assigns, artifacts, approvals, toolRuns] = await Promise.all([
      pool.query(
        `SELECT d.depends_on_task_id AS id, t.title, t.status FROM task_dependencies d
         JOIN tasks t ON t.id = d.depends_on_task_id WHERE d.task_id = $1`, [id]),
      pool.query(
        `SELECT ta.*, e.name AS employee_name FROM task_assignments ta
         JOIN employees e ON e.id = ta.employee_id WHERE ta.task_id = $1`, [id]),
      pool.query(
        "SELECT id, title, media_type, current_version, created_at, LEFT(content, 4000) AS preview FROM artifacts WHERE task_id = $1 ORDER BY created_at DESC", [id]),
      pool.query(
        "SELECT id, action_type, description, status, created_at, decided_at FROM approval_requests WHERE task_id = $1 ORDER BY created_at DESC", [id]),
      pool.query(
        "SELECT id, tool_name, status, exit_code, duration_ms, created_at FROM tool_runs WHERE task_id = $1 ORDER BY created_at DESC LIMIT 50", [id])
    ]);
    return NextResponse.json({
      task: task.rows[0],
      dependencies: deps.rows,
      assignments: assigns.rows,
      artifacts: artifacts.rows,
      approvals: approvals.rows,
      toolRuns: toolRuns.rows
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Internal error";
    return NextResponse.json({ error: m }, { status: m === "UNAUTHORIZED" ? 401 : 503 });
  }
}

/**
 * PATCH /api/tasks/[id] — { action: "cancel" | "requeue" }.
 * Completed tasks are immutable (PRD §6: Completed only after acceptance).
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(request);
    const { id } = await context.params;
    const body = await request.json();
    const action = String(body?.action || "");
    if (!["cancel", "requeue"].includes(action)) {
      return NextResponse.json({ error: 'action harus "cancel" atau "requeue".' }, { status: 400 });
    }
    const pool = getPool();
    const cur = await pool.query("SELECT status FROM tasks WHERE id = $1", [id]);
    if (!cur.rowCount) return NextResponse.json({ error: "Tugas tidak ditemukan." }, { status: 404 });
    if (cur.rows[0].status === "completed" && action === "cancel") {
      return NextResponse.json({ error: "Tugas yang sudah Completed tidak dapat dibatalkan." }, { status: 409 });
    }
    const next = action === "cancel" ? "cancelled" : "queued";
    const { rows } = await pool.query(
      "UPDATE tasks SET status = $2, updated_at = now() WHERE id = $1 RETURNING id, title, status",
      [id, next]
    );
    await audit("owner", action === "cancel" ? "task_cancelled" : "task_requeued", "task", id, {});
    return NextResponse.json({ task: rows[0] });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Internal error";
    return NextResponse.json({ error: m }, { status: m === "UNAUTHORIZED" ? 401 : 503 });
  }
}
