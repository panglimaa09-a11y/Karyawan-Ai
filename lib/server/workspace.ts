import path from "node:path";
import fs from "node:fs";
import { getPool } from "./db";

export function workspaceRoot(): string {
  const root = process.env.KAI_WORKSPACE || path.join(process.cwd(), "workspace");
  const abs = path.resolve(root);
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}

/**
 * Resolve a user-supplied relative path strictly inside the workspace.
 * Throws on path traversal or absolute-path escapes. PRD §12.
 */
export function resolveWorkspacePath(rel: string): string {
  const root = workspaceRoot();
  const cleaned = String(rel || "").replace(/\\/g, "/").trim();
  if (!cleaned || cleaned.startsWith("/")) throw new Error("Path harus relatif terhadap workspace.");
  const resolved = path.resolve(root, cleaned);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Path traversal ditolak: di luar workspace.");
  }
  return resolved;
}

/** Check agent_tool_permissions; owner (no employeeId) bypasses with audit. */
export async function checkToolPermission(employeeId: string | null, toolName: string): Promise<void> {
  if (!employeeId) return; // owner-initiated, recorded in audit by caller
  const pool = getPool();
  const q = await pool.query(
    "SELECT allowed FROM agent_tool_permissions WHERE employee_id = $1 AND tool_name = $2",
    [employeeId, toolName]
  );
  if (!q.rowCount || !q.rows[0].allowed) {
    // Record the denial for transparency (PRD §12).
    await pool.query(
      `INSERT INTO tool_runs(employee_id, tool_name, arguments, status, output)
       VALUES ($1, $2, '{}'::jsonb, 'denied', 'Izin tool ditolak oleh agent_tool_permissions.')`,
      [employeeId, toolName]
    ).catch(() => {});
    throw new Error(`Karyawan tidak memiliki izin tool "${toolName}".`);
  }
}

/** Patterns that always require an approval instead of direct execution. */
const DANGEROUS = [
  /\brm\s+-[a-z]*r/i, /:\(\)\s*{\s*:\s*\|\s*:\s*&\s*}/, /\bmkfs\b/i, /\bdd\b.*\bof=\/dev\//i,
  /\bshutdown\b/i, /\breboot\b/i, /\bhalt\b/i, />\s*\/dev\/sd/i, /\bchmod\s+-R\s+777\s+\//,
  /\bcurl\b.*\|\s*(ba)?sh/i, /\bwget\b.*\|\s*(ba)?sh/i
];

export function assertCommandAllowed(command: string): void {
  const cmd = command.trim();
  if (!cmd) throw new Error("Perintah kosong.");
  if (cmd.length > 4000) throw new Error("Perintah melebihi 4000 karakter.");
  for (const pattern of DANGEROUS) {
    if (pattern.test(cmd)) {
      throw new Error("Perintah terdeteksi berbahaya dan membutuhkan persetujuan eksplisit (PRD §11).");
    }
  }
}
