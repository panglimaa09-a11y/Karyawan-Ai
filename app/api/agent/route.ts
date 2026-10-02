import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/db";
import { executeAgentTask } from "@/lib/server/agent-run";
import { audit } from "@/lib/server/audit";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/agent — jalankan satu tugas dengan karyawan tertentu.
 * Body: { employeeId, title?, task, deliverable?, acceptanceCriteria?, context?, taskId? }
 * Karyawan memakai provider/model/parameter dari database (PRD §5, §8).
 * Menggantikan route 21-persona berbasis env pada versi lama.
 */
export async function POST(req: Request) {
  try {
    requireAdmin(req);
    const body = await req.json();
    const employeeId = String(body?.employeeId || "").trim();
    const title = String(body?.title || body?.task || "").trim().slice(0, 200);
    const task = String(body?.task || "").trim();
    if (!employeeId || !task) {
      return NextResponse.json({ error: "employeeId dan task wajib diisi." }, { status: 400 });
    }
    if (task.length > 20000) {
      return NextResponse.json({ error: "Task melebihi 20.000 karakter." }, { status: 413 });
    }

    const result = await executeAgentTask({
      employeeId,
      taskId: body?.taskId ? String(body.taskId) : undefined,
      title: title || task.slice(0, 80),
      description: task,
      deliverable: String(body?.deliverable || ""),
      acceptanceCriteria: String(body?.acceptanceCriteria || ""),
      context: String(body?.context || "").slice(0, 14000)
    });

    await audit("owner", "agent_executed", "employee", employeeId, {
      taskId: body?.taskId || null, model: result.model, usage: result.usage
    });

    return NextResponse.json({
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
