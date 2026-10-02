import { getPool } from "./db";
import { getEmployeeProvider, callProvider } from "./provider";
import { officeEvent } from "./audit";

export interface AgentTaskInput {
  employeeId: string;
  taskId?: string;
  title: string;
  description: string;
  deliverable?: string;
  acceptanceCriteria?: string;
  context?: string;
}

export interface AgentTaskResult {
  employeeId: string;
  employeeName: string;
  model: string;
  artifact: string;
  usage: { prompt_tokens: number | null; completion_tokens: number | null };
  durationMs: number;
  approvalRequested: { actionType: string; description: string } | null;
}

/**
 * Execute one task with the employee's configured provider and persist the
 * output as an artifact. Detects "APPROVAL_REQUIRED:" markers for sensitive
 * actions instead of executing them. PRD §10, §11.
 */
export async function executeAgentTask(input: AgentTaskInput): Promise<AgentTaskResult> {
  const started = Date.now();
  const pool = getPool();
  const cfg = await getEmployeeProvider(input.employeeId);

  if (input.taskId) {
    await pool.query("UPDATE tasks SET status = 'running', updated_at = now() WHERE id = $1", [input.taskId]);
  }
  await officeEvent(cfg.employeeId, "task_started", "working", `${cfg.employeeName} mengerjakan: ${input.title}`, {
    taskId: input.taskId || null,
    model: cfg.model
  });

  const userContent = [
    `TUGAS: ${input.title}`,
    input.description ? `\nDESKRIPSI:\n${input.description}` : "",
    input.deliverable ? `\nDELIVERABLE YANG DIHARAPKAN:\n${input.deliverable}` : "",
    input.acceptanceCriteria ? `\nKRITERIA PENERIMAAN:\n${input.acceptanceCriteria}` : "",
    input.context ? `\nKONTEKS DARI PEKERJAAN LAIN:\n${input.context}` : "",
    `\nKerjakan tugas ini sekarang. Hasilkan output yang bisa ditinjau, bukan penjelasan cara mengerjakan.`,
    `\nATURAN PENTING: Jika tugas ini membutuhkan tindakan sensitif (push GitHub, deployment publik, hapus data, kirim ke layanan eksternal, ubah secret/konfigurasi keamanan, atau perintah sistem berisiko), JANGAN mengeksekusinya. Sebagai gantinya akhiri responsmu dengan baris:\nAPPROVAL_REQUIRED: <jenis_tindakan> | <deskripsi singkat>`
  ].join("\n");

  const result = await callProvider(
    cfg,
    [
      { role: "system", content: `${cfg.systemPrompt} Kepribadian: ${cfg.personality}. Jangan mengklaim tool, eksekusi, atau tindakan yang belum benar-benar dijalankan.` },
      { role: "user", content: userContent }
    ],
    { taskId: input.taskId, timeoutMs: 180000 }
  );

  // Detect approval request marker.
  let artifact = result.text;
  let approvalRequested: AgentTaskResult["approvalRequested"] = null;
  const marker = result.text.match(/APPROVAL_REQUIRED:\s*([^\n|]+)\|?\s*([^\n]*)/i);
  if (marker) {
    approvalRequested = {
      actionType: marker[1].trim().slice(0, 100) || "external_side_effect",
      description: (marker[2] || input.title).trim().slice(0, 2000)
    };
    artifact = result.text.replace(marker[0], "").trim();
  }

  let artifactId: string | null = null;
  if (input.taskId && artifact) {
    const ins = await pool.query(
      `INSERT INTO artifacts(task_id, employee_id, title, media_type, content)
       VALUES ($1, $2, $3, 'text/plain', $4) RETURNING id`,
      [input.taskId, cfg.employeeId, `Hasil: ${input.title}`.slice(0, 200), artifact]
    );
    artifactId = ins.rows[0].id;
  }

  if (input.taskId) {
    const nextStatus = approvalRequested ? "awaiting_approval" : "testing";
    await pool.query("UPDATE tasks SET status = $2, updated_at = now() WHERE id = $1", [input.taskId, nextStatus]);
    if (approvalRequested) {
      await pool.query(
        `INSERT INTO approval_requests(task_id, action_type, description, payload)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [input.taskId, approvalRequested.actionType, approvalRequested.description,
         JSON.stringify({ requestedBy: cfg.employeeName, artifactId })]
      );
    }
  }

  await officeEvent(
    cfg.employeeId,
    approvalRequested ? "task_awaiting_approval" : "task_testing",
    approvalRequested ? "awaiting_approval" : "testing",
    approvalRequested
      ? `${cfg.employeeName} meminta persetujuan: ${approvalRequested.actionType}.`
      : `${cfg.employeeName} selesai; hasil masuk tahap pengujian.`,
    { taskId: input.taskId || null, artifactId, model: result.model }
  );

  return {
    employeeId: cfg.employeeId,
    employeeName: cfg.employeeName,
    model: result.model,
    artifact,
    usage: result.usage,
    durationMs: Date.now() - started,
    approvalRequested
  };
}
