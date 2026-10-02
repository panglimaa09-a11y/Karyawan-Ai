import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { getPool, requireAdmin } from "@/lib/server/db";
import { workspaceRoot, assertCommandAllowed, checkToolPermission } from "@/lib/server/workspace";
import { audit } from "@/lib/server/audit";

export const runtime = "nodejs";
export const maxDuration = 180;

function run(cmd: string, cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number; timedOut: boolean }> {
  const started = Date.now();
  const shell = process.platform === "win32" ? "cmd.exe" : "bash";
  const args = process.platform === "win32" ? ["/c", cmd] : ["-c", cmd];
  return new Promise((resolve) => {
    execFile(shell, args, { cwd, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      const durationMs = Date.now() - started;
      resolve({
        stdout: String(stdout || "").slice(0, 100000),
        stderr: String(stderr || "").slice(0, 100000),
        exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0,
        durationMs,
        timedOut: !!error && (error as any).killed === true
      });
    });
  });
}

/**
 * POST /api/tools/exec — jalankan perintah di dalam workspace KAI saja.
 * Body: { command, employeeId?, taskId?, timeoutMs? }
 * Mencatat command, cwd, output, exit code, durasi ke tool_runs. PRD §12.
 */
export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const body = await request.json();
    const command = String(body?.command || "");
    const employeeId = body?.employeeId ? String(body.employeeId) : null;
    const taskId = body?.taskId ? String(body.taskId) : null;
    const timeoutMs = Math.min(120000, Math.max(1000, Number(body?.timeoutMs) || 30000));

    assertCommandAllowed(command);
    await checkToolPermission(employeeId, "shell_exec");

    const cwd = workspaceRoot();
    const result = await run(command, cwd, timeoutMs);
    const status = result.timedOut ? "timeout" : result.exitCode === 0 ? "succeeded" : "failed";

    await getPool().query(
      `INSERT INTO tool_runs(task_id, employee_id, tool_name, arguments, status, output, exit_code, duration_ms)
       VALUES ($1, $2, 'shell_exec', $3::jsonb, $4, $5, $6, $7)`,
      [taskId, employeeId,
       JSON.stringify({ command: command.slice(0, 2000), cwd }),
       status,
       `STDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`.slice(0, 100000),
       result.exitCode, result.durationMs]
    );
    await audit(employeeId ? `agent:${employeeId}` : "owner", "shell_exec", "tool_run", taskId || undefined,
      { command: command.slice(0, 500), exitCode: result.exitCode, status });

    return NextResponse.json({
      cwd, command,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      status
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Internal error";
    return NextResponse.json({ error: m }, { status: m === "UNAUTHORIZED" ? 401 : m.includes("persetujuan") ? 403 : 503 });
  }
}
