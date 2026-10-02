import { NextResponse } from "next/server";
import { getPool, requireAdmin } from "@/lib/server/db";
import { audit, officeEvent } from "@/lib/server/audit";

export const runtime = "nodejs";

/**
 * POST /api/tasks/[id]/review — verifikasi hasil oleh QA (Bima) atau owner.
 * Body: { verdict: "pass" | "fail", evidence?: string, note?: string }
 * Completed hanya setelah kriteria penerimaan terpenuhi + bukti tersedia. PRD §6.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(request);
    const { id } = await context.params;
    const body = await request.json();
    const verdict = String(body?.verdict || "");
    const evidence = String(body?.evidence || "").trim().slice(0, 4000);
    const note = String(body?.note || "").trim().slice(0, 2000);
    if (!["pass", "fail"].includes(verdict)) {
      return NextResponse.json({ error: 'verdict harus "pass" atau "fail".' }, { status: 400 });
    }
    const pool = getPool();
    const cur = await pool.query("SELECT * FROM tasks WHERE id = $1", [id]);
    if (!cur.rowCount) return NextResponse.json({ error: "Tugas tidak ditemukan." }, { status: 404 });
    const t = cur.rows[0];
    if (!["testing", "awaiting_approval", "failed"].includes(t.status)) {
      return NextResponse.json({ error: `Tugas berstatus "${t.status}" belum siap direview.` }, { status: 409 });
    }
    if (verdict === "pass" && !evidence) {
      return NextResponse.json({ error: "Verdict pass wajib menyertakan evidence (bukti verifikasi)." }, { status: 400 });
    }
    const arts = await pool.query("SELECT COUNT(*)::int AS n FROM artifacts WHERE task_id = $1", [id]);
    if (verdict === "pass" && arts.rows[0].n === 0) {
      return NextResponse.json({ error: "Tidak ada artefak hasil untuk tugas ini." }, { status: 409 });
    }

    const next = verdict === "pass" ? "completed" : "failed";
    const { rows } = await pool.query(
      `UPDATE tasks SET status = $2, result_evidence = $3, updated_at = now()
       WHERE id = $1 RETURNING id, title, status`,
      [id, next, verdict === "pass" ? evidence : (note || "Gagal review QA.")]
    );

    await officeEvent(t.assigned_employee_id, next === "completed" ? "task_completed" : "task_failed",
      next, `Tugas "${t.title}" ${next === "completed" ? "selesai terverifikasi" : "gagal review"}.`, { taskId: id, evidence: evidence || null });
    await audit("owner", next === "completed" ? "task_completed" : "task_review_failed", "task", id,
      { verdict, evidence: evidence || null, note: note || null });

    return NextResponse.json({ task: rows[0], verdict });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Internal error";
    return NextResponse.json({ error: m }, { status: m === "UNAUTHORIZED" ? 401 : 503 });
  }
}
