import { NextResponse } from "next/server";
import { getPool, requireAdmin } from "@/lib/server/db";
import { getEmployeeProvider, callProvider } from "@/lib/server/provider";
import { audit, officeEvent } from "@/lib/server/audit";

export const runtime = "nodejs";
export const maxDuration = 300;

type PlannedTask = {
  title: string;
  description: string;
  agentId: string;
  deliverable: string;
  acceptanceCriteria: string;
  priority: "low" | "normal" | "high" | "urgent";
  dependsOn: number[];
};

function extractJsonObject(raw: string): string {
  const cleaned = raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  if (start < 0) throw new Error("Raka tidak mengembalikan objek JSON.");
  let depth = 0, quote = "", escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === "{") depth++;
    if (ch === "}") { depth--; if (depth === 0) return cleaned.slice(start, i + 1); }
  }
  throw new Error("Raka mengembalikan JSON yang tidak lengkap.");
}

function parsePlan(raw: string): { summary: string; tasks: PlannedTask[] } {
  const candidate = extractJsonObject(raw);
  try {
    return JSON.parse(candidate);
  } catch {
    const normalized = candidate
      .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, value) => JSON.stringify(String(value).replace(/\\'/g, "'")))
      .replace(/([{,]\s*)([A-Za-z_$][\w$-]*)\s*:/g, '$1"$2":');
    return JSON.parse(normalized);
  }
}

/**
 * POST /api/manager — Bos Angga mengirim instruksi; Raka menyusun rencana;
 * sistem menyimpan project + tugas + dependensi ke PostgreSQL. PRD §10.
 */
export async function POST(request: Request) {
  const pool = getPool();
  try {
    requireAdmin(request);
    const body = await request.json();
    const projectText = String(body?.project || "").trim().slice(0, 8000);
    const title = String(body?.title || "").trim().slice(0, 200) || projectText.slice(0, 80);
    if (projectText.length < 3) {
      return NextResponse.json({ error: "Deskripsi project wajib diisi (minimal 3 karakter)." }, { status: 400 });
    }

    let raka;
    try {
      raka = await getEmployeeProvider("raka");
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Raka belum dikonfigurasi.", setupRequired: true },
        { status: 409 }
      );
    }

    const roster = await pool.query(
      "SELECT id, name, role FROM employees WHERE enabled = TRUE ORDER BY name"
    );
    const rosterText = roster.rows.map((r: any) => `- ${r.id} (${r.name} — ${r.role})`).join("\n");

    await officeEvent("raka", "planning_started", "working", "Raka mulai menyusun rencana.", { title });

    const planPrompt =
`INSTRUKSI BOS ANGGA:
${projectText}

KARYAWAN YANG TERSEDIA:
${rosterText}

Tugasmu sebagai Project Manager: susun rencana eksekusi konkret.
Kembalikan HANYA JSON valid dengan bentuk:
{"summary": string, "tasks": [{"title": string, "description": string, "agentId": string, "deliverable": string, "acceptanceCriteria": string, "priority": "low"|"normal"|"high"|"urgent", "dependsOn": number[]}]}

Aturan:
- agentId harus salah satu ID karyawan di atas.
- dependsOn berisi indeks tugas (0-based) yang harus selesai dulu; [] bila tidak ada.
- Tulis acceptanceCriteria yang bisa diverifikasi (bukan sekadar "selesai").
- Jangan mengklaim akses ke sistem eksternal yang tidak ada.
- 3 sampai 12 tugas. Ringkas tapi konkret.`;

    let plan;
    try {
      const result = await callProvider(
        raka,
        [
          { role: "system", content: raka.systemPrompt + " Kepribadian: " + raka.personality + ". Jangan mengklaim tindakan yang belum dijalankan." },
          { role: "user", content: planPrompt }
        ],
        { maxTokens: 4000, temperature: 0.2, timeoutMs: 120000 }
      );
      plan = parsePlan(result.text);
    } catch (e) {
      await officeEvent("raka", "planning_failed", "failed", "Raka gagal menyusun rencana: " + (e instanceof Error ? e.message : "error"));
      throw e;
    }

    const validIds = new Set(roster.rows.map((r: any) => r.id));
    if (!plan.summary || !Array.isArray(plan.tasks) || plan.tasks.length < 1 || plan.tasks.length > 12) {
      throw new Error("Rencana Raka tidak lengkap (butuh 1–12 tugas dengan ringkasan).");
    }
    const tasks: PlannedTask[] = plan.tasks.map((t: any, i: number) => {
      const agentId = String(t?.agentId || "").trim();
      if (!validIds.has(agentId)) throw new Error(`Tugas #${i + 1} menunjuk karyawan tak dikenal: "${agentId}".`);
      const dependsOn: number[] = Array.isArray(t?.dependsOn)
        ? (t.dependsOn as any[]).map((d: any) => Number(d)).filter((d: number) => Number.isInteger(d) && d >= 0 && d < plan.tasks.length && d !== i)
        : [];
      const priority = ["low", "normal", "high", "urgent"].includes(t?.priority) ? t.priority : "normal";
      const title = String(t?.title || "").trim().slice(0, 200);
      if (!title) throw new Error(`Tugas #${i + 1} tidak memiliki judul.`);
      return {
        title,
        description: String(t?.description || "").trim().slice(0, 4000),
        agentId,
        deliverable: String(t?.deliverable || "").trim().slice(0, 2000),
        acceptanceCriteria: String(t?.acceptanceCriteria || "").trim().slice(0, 2000),
        priority,
        dependsOn: [...new Set(dependsOn)]
      };
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const proj = await client.query(
        "INSERT INTO projects(name, description) VALUES ($1, $2) RETURNING id, name",
        [title, projectText]
      );
      const projectId = proj.rows[0].id;
      const created: any[] = [];
      for (const t of tasks) {
        const ins = await client.query(
          `INSERT INTO tasks(project_id, title, description, status, priority, acceptance_criteria, assigned_employee_id)
           VALUES ($1, $2, $3, 'planning', $4, $5, $6)
           RETURNING id, title, status`,
          [projectId, t.title, `${t.description}\n\nDeliverable: ${t.deliverable}`, t.priority, t.acceptanceCriteria || null, t.agentId]
        );
        const taskId = ins.rows[0].id;
        await client.query(
          "INSERT INTO task_assignments(task_id, employee_id, assignment_role) VALUES ($1, $2, 'owner')",
          [taskId, t.agentId]
        );
        created.push({ ...ins.rows[0], agentId: t.agentId, deliverable: t.deliverable, priority: t.priority });
      }
      for (let i = 0; i < tasks.length; i++) {
        for (const dep of tasks[i].dependsOn) {
          await client.query(
            "INSERT INTO task_dependencies(task_id, depends_on_task_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [created[i].id, created[dep].id]
          );
        }
      }
      await client.query("UPDATE tasks SET status = 'queued', updated_at = now() WHERE project_id = $1", [projectId]);
      await client.query("COMMIT");

      for (const c of created) {
        await officeEvent(c.agentId, "task_queued", "info", `Tugas "${c.title}" masuk antrean.`, { taskId: c.id, projectId });
      }
      await officeEvent("raka", "planning_completed", "completed", `Rencana selesai: ${created.length} tugas.`, { projectId });
      await audit("owner", "plan_created", "project", projectId, { title, taskCount: created.length, summary: plan.summary });

      return NextResponse.json({
        project: { id: projectId, name: proj.rows[0].name, summary: plan.summary },
        tasks: created.map((c, i) => ({ ...c, dependsOn: tasks[i].dependsOn })),
        model: raka.model
      }, { status: 201 });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal error";
    const status = message === "UNAUTHORIZED" ? 401 : message.includes("Raka belum") || (e as any)?.setupRequired ? 409 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
