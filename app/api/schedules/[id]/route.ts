import { NextResponse } from "next/server";
import { getPool, requireAdmin } from "@/lib/server/db";
import { executeAgentTask } from "@/lib/server/agent-run";
import { audit } from "@/lib/server/audit";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/schedules/[id]/trigger — jalankan jadwal sekarang.
 * Dirancang dipanggil oleh cron eksternal (sistem/Termux) sesuai cron_expr,
 * karena proses Next.js lokal tidak dijamin hidup 24/7 (PRD §16, §22).
 * Payload yang didukung: {type:'agent_task', employeeId, title, task}.
 * Idempotency: trigger yang sedang 'running' untuk jadwal yang sama ditolak.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const pool = getPool();
  let runId: string | null = null;
  try {
    requireAdmin(request);
    const { id } = await context.params;
    const s = await pool.query("SELECT * FROM schedules WHERE id = $1", [id]);
    if (!s.rowCount) return NextResponse.json({ error: "Jadwal tidak ditemukan." }, { status: 404 });
    const schedule = s.rows[0];
    if (!schedule.enabled) return NextResponse.json({ error: "Jadwal nonaktif." }, { status: 409 });

    const busy = await pool.query(
      "SELECT 1 FROM scheduled_runs WHERE schedule_id = $1 AND status = 'running' AND ran_at > now() - interval '15 minutes' LIMIT 1",
      [id]
    );
    if (busy.rowCount) {
      await pool.query("INSERT INTO scheduled_runs(schedule_id, status, result) VALUES ($1, 'skipped', 'Masih ada run yang berjalan.')", [id]);
      return NextResponse.json({ error: "Jadwal sedang berjalan; trigger dilewati (idempotency).", skipped: true }, { status: 409 });
    }

    const ins = await pool.query(
      "INSERT INTO scheduled_runs(schedule_id, status) VALUES ($1, 'running') RETURNING id",
      [id]
    );
    runId = ins.rows[0].id;

    const payload = schedule.payload || {};
    let result: unknown = null;
    if (payload.type === "agent_task") {
      const employeeId = String(payload.employeeId || "");
      const task = String(payload.task || "");
      if (!employeeId || !task) throw new Error("Payload agent_task butuh employeeId dan task.");
      result = await executeAgentTask({
        employeeId,
        title: String(payload.title || task).slice(0, 200),
        description: task
      });
    } else {
      throw new Error("Payload tidak dikenali. Gunakan {type:'agent_task', employeeId, title, task}.");
    }

    await pool.query("UPDATE scheduled_runs SET status = 'succeeded', result = $2 WHERE id = $1",
      [runId, JSON.stringify({ ok: true }).slice(0, 4000)]);
    await audit("scheduler", "schedule_triggered", "schedule", id, { runId });
    return NextResponse.json({ ok: true, runId, result });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Internal error";
    if (runId) {
      await pool.query("UPDATE scheduled_runs SET status = 'failed', result = $2 WHERE id = $1",
        [runId, m.slice(0, 4000)]).catch(() => {});
    }
    return NextResponse.json({ error: m, runId }, { status: m === "UNAUTHORIZED" ? 401 : 502 });
  }
}

/** DELETE /api/schedules/[id] — hapus jadwal. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(request);
    const { id } = await context.params;
    const pool = getPool();
    const { rows } = await pool.query("DELETE FROM schedules WHERE id = $1 RETURNING id, name", [id]);
    if (!rows.length) return NextResponse.json({ error: "Jadwal tidak ditemukan." }, { status: 404 });
    await audit("owner", "schedule_deleted", "schedule", id, { name: rows[0].name });
    return NextResponse.json({ ok: true, schedule: rows[0] });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Internal error";
    return NextResponse.json({ error: m }, { status: m === "UNAUTHORIZED" ? 401 : 503 });
  }
}
