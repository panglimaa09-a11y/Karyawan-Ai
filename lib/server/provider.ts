import { getPool } from "./db";
import { decryptSecret } from "./crypto";

export type ApiFormat = "openai-chat" | "openai-responses";

export interface EmployeeProviderConfig {
  employeeId: string;
  employeeName: string;
  role: string;
  systemPrompt: string;
  personality: string;
  temperature: number;
  maxTokens: number;
  tokenBudgetPerTask: number | null;
  providerId: string;
  providerName: string;
  baseUrl: string;
  apiFormat: ApiFormat;
  model: string;
  token: string; // decrypted — server-side only, never sent to client
}

/**
 * Load an employee's effective provider configuration from the database.
 * Throws a clear, actionable error when anything is missing. PRD §5, §8.
 */
export async function getEmployeeProvider(employeeId: string): Promise<EmployeeProviderConfig> {
  const pool = getPool();
  const q = await pool.query(
    `SELECT e.id, e.name, e.role, e.system_prompt, e.personality,
            e.temperature, e.max_tokens, e.token_budget_per_task,
            p.id AS provider_id, p.name AS provider_name, p.base_url, p.api_format,
            COALESCE(e.model_id, p.default_model) AS model,
            c.encrypted_token
     FROM employees e
     LEFT JOIN providers p ON p.id = e.provider_id AND p.enabled = TRUE
     LEFT JOIN provider_credentials c ON c.provider_id = p.id
     WHERE e.id = $1 AND e.enabled = TRUE`,
    [employeeId]
  );
  if (!q.rowCount) throw new Error(`Karyawan "${employeeId}" tidak ditemukan atau nonaktif.`);
  const e = q.rows[0];
  if (!e.provider_id) throw new Error(`Karyawan ${e.name} belum dipasangkan provider. Tetapkan di /control.`);
  if (!e.encrypted_token) throw new Error(`Provider ${e.provider_name} belum menyimpan token API.`);
  if (!e.model) throw new Error(`Karyawan ${e.name} belum dipasangkan model. Sinkronkan model lalu tetapkan di /control.`);
  return {
    employeeId: e.id,
    employeeName: e.name,
    role: e.role,
    systemPrompt: e.system_prompt,
    personality: e.personality,
    temperature: Number(e.temperature ?? 0.4),
    maxTokens: Number(e.max_tokens ?? 2000),
    tokenBudgetPerTask: e.token_budget_per_task == null ? null : Number(e.token_budget_per_task),
    providerId: e.provider_id,
    providerName: e.provider_name,
    baseUrl: String(e.base_url).replace(/\/$/, ""),
    apiFormat: (e.api_format === "openai-responses" ? "openai-responses" : "openai-chat") as ApiFormat,
    model: e.model,
    token: decryptSecret(e.encrypted_token)
  };
}

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; }
export interface ChatResult {
  text: string;
  model: string;
  usage: { prompt_tokens: number | null; completion_tokens: number | null };
  durationMs: number;
}

function extractText(data: any, apiFormat: ApiFormat): string {
  if (apiFormat === "openai-responses") {
    if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text;
    const out = Array.isArray(data?.output) ? data.output : [];
    const text = out
      .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : [item]))
      .map((part: any) => (typeof part === "string" ? part : part?.text || ""))
      .filter(Boolean)
      .join("\n");
    if (text.trim()) return text;
  }
  const message = data?.choices?.[0]?.message;
  if (typeof message?.content === "string" && message.content.trim()) return message.content;
  if (Array.isArray(message?.content)) {
    const text = message.content
      .map((part: any) => (typeof part === "string" ? part : part?.text || ""))
      .filter(Boolean)
      .join("\n");
    if (text.trim()) return text;
  }
  return "";
}

/**
 * Call the employee's configured provider. Retries transient failures once.
 * Records usage into usage_records. Never logs the token.
 */
export async function callProvider(
  cfg: EmployeeProviderConfig,
  messages: ChatMessage[],
  opts?: { maxTokens?: number; temperature?: number; timeoutMs?: number; taskId?: string }
): Promise<ChatResult> {
  const started = Date.now();
  const timeoutMs = Math.min(180000, Math.max(15000, opts?.timeoutMs ?? 60000));
  const endpoint = cfg.apiFormat === "openai-responses" ? "/responses" : "/chat/completions";
  const url = cfg.baseUrl + endpoint;
  const maxTokens = opts?.maxTokens ?? cfg.maxTokens;
  const body =
    cfg.apiFormat === "openai-responses"
      ? { model: cfg.model, input: messages.map((m) => ({ role: m.role, content: m.content })), max_output_tokens: maxTokens, temperature: opts?.temperature ?? cfg.temperature }
      : {
          model: cfg.model,
          messages,
          temperature: opts?.temperature ?? cfg.temperature,
          max_tokens: maxTokens,
          stream: false
        };

  let lastError = "Provider tidak merespons.";
  let data: any = null;
  let httpStatus = 0;
  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { Authorization: "Bearer " + cfg.token, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
      httpStatus = resp.status;
      const raw = await resp.text();
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        lastError = raw.slice(0, 300) || `Provider mengembalikan respons non-JSON (HTTP ${resp.status}).`;
        data = null;
      }
      if (resp.ok && data) break;
      lastError = (data && data.error && (data.error.message || data.error.code)) || lastError || `Provider HTTP ${resp.status}.`;
      if (![408, 429, 500, 502, 503, 504].includes(resp.status)) break;
    } catch (err) {
      lastError = err instanceof Error && err.name === "TimeoutError"
        ? `Provider timeout setelah ${timeoutMs / 1000} detik.`
        : err instanceof Error ? err.message : "Koneksi ke provider gagal.";
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
  }

  const durationMs = Date.now() - started;
  const pool = getPool();
  if (!data) {
    await pool.query(
      `INSERT INTO usage_records(provider_id, employee_id, model_id, status, error_code, duration_ms)
       VALUES ($1, $2, $3, 'error', $4, $5)`,
      [cfg.providerId, cfg.employeeId, cfg.model, `HTTP_${httpStatus || "NO_RESPONSE"}`, durationMs]
    ).catch(() => {});
    throw new Error(lastError);
  }

  const text = extractText(data, cfg.apiFormat).trim();
  if (!text) {
    const refusal = data?.choices?.[0]?.message?.refusal;
    await pool.query(
      `INSERT INTO usage_records(provider_id, employee_id, model_id, status, error_code, duration_ms)
       VALUES ($1, $2, $3, 'error', 'EMPTY_RESPONSE', $4)`,
      [cfg.providerId, cfg.employeeId, cfg.model, durationMs]
    ).catch(() => {});
    throw new Error(refusal ? "Provider menolak permintaan: " + String(refusal).slice(0, 300) : "Provider merespons tanpa teks yang dikenali.");
  }

  const usage = data.usage || {};
  const promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? null;
  const completionTokens = usage.completion_tokens ?? usage.output_tokens ?? null;
  await pool.query(
    `INSERT INTO usage_records(provider_id, employee_id, model_id, prompt_tokens, completion_tokens, status, duration_ms)
     VALUES ($1, $2, $3, $4, $5, 'success', $6)`,
    [cfg.providerId, cfg.employeeId, cfg.model, promptTokens, completionTokens, durationMs]
  ).catch(() => {});

  return {
    text,
    model: data.model || cfg.model,
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
    durationMs
  };
}
