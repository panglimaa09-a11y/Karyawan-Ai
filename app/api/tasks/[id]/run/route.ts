import { NextResponse } from "next/server";
import { getPool, requireAdmin } from "@/lib/server/db";
import { executeAgentTask } from "@/lib/server/agent-run";
import { audit } from "@/lib/server/audit";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/tasks/[id]/run — eksekusi tugas oleh karyawan yang ditugaskan.
 * Dependensi harus Completed dulu; jika belum, kembalikan 409 (Blocked).
 * PRD §10.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(request);
    const { id } = await context.params;
    const pool = getPool();

    const task = await pool.query("SELECT * FROM tasks WHERE id = $1", [id]);
    if (!task.rowCount) return NextResponse.json({ error: "Tugas tidak ditemukan." }, { status: 404 });
    const t = task.rows[0];

    if (["running", "completed"].includes(t.status)) {
      return NextResponse.json({ error: `Tugas sedang berstatus "${t.status}" dan tidak dapat dijalankan ulang dari sini.` }, { status: 409 });
    }
    if (!t.assigned_employee_id) {
      return NextResponse.json({ error: "Tugas belum memiliki karyawan penanggung jawab." }, { status: 409 });
    }

    const deps = await pool.query(
      `SELECT d.depends_on_task_id AS id, tt.title, tt.status
       FROM task_dependencies d JOIN tasks tt ON tt.id = d.depends_on_task_id
       WHERE d.task_id = $1`,
      [id]
    );
    const blocking = deps.rows.filter((d: any) => d.status !== "completed");
    if (blocking.length) {
      await pool.query("UPDATE tasks SET status = 'blocked', updated_at = now() WHERE id = $1", [id]);
      return NextResponse.json({
        error: "Tugas diblokir oleh dependensi yang belum selesai.",
        blockedBy: blocking
      }, { status: 409 });
    }

    // Gather context from completed dependencies' latest artifacts.
    let depContext = "";
    if (deps.rows.length) {
      const arts = await pool.query(
        `SELECT a.title, LEFT(a.content, 3000) AS content, e.name AS employee_name
         FROM artifacts a LEFT JOIN employees e ON e.id = a.employee_id
         WHERE a.task_id = ANY($1::uuid[]) ORDER BY a.created_at DESC`,
        [deps.rows.map((d: any) => d.id)]
      );
      depContext = arts.rows.map((a: any) => `[${a.employee_name || "?"}] ${a.title}:\n${a.content}`).join("\n\n").slice(0, 12000);
    }

    let result;
    try {
      result = await executeAgentTask({
        employeeId: t.assigned_employee_id,
        taskId: id,
        title: t.title,
        description: t.description || "",
        deliverable: "",
        acceptanceCriteria: t.acceptance_criteria || "",
        context: depContext
      });
    } catch (execError) {
      // PRD §6: interrupted tasks must be recognizable and safely recoverable —
      // never leave the row stuck in "running".
      const msg = execError instanceof Error ? execError.message : "Eksekusi gagal.";
      await pool.query(
        "UPDATE tasks SET status = 'failed', result_evidence = $2, updated_at = now() WHERE id = $1",
        [id, ("Gagal eksekusi: " + msg).slice(0, 2000)]
      );
      await pool.query(
        "INSERT INTO office_events(employee_id, event_type, status, message, metadata) VALUES ($1, 'task_failed', 'failed', $2, $3::jsonb)",
        [t.assigned_employee_id, `Tugas "${t.title}" gagal: ${msg.slice(0, 200)}`, JSON.stringify({ taskId: id })]
      );
      throw execError;
    }

    await audit("owner", "task_executed", "task", id, {
      employee: result.employeeId, model: result.model,
      approvalRequested: result.approvalRequested,
      usage: result.usage, durationMs: result.durationMs
    });

    return NextResponse.json({
      taskId: id,
      status: result.approvalRequested ? "awaiting_approval" : "testing",
      employee: { id: result.employeeId, name: result.employeeName },
      model: result.model,
      artifact: result.artifact,
      usage: result.usage,
      durationMs: result.durationMs,
      approvalRequested: result.approvalRequested
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Internal error";
    return NextResponse.json({ error: m }, { status: m === "UNAUTHORIZED" ? 401 : 502 });
  }
}
