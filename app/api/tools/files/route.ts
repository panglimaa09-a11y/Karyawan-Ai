import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getPool, requireAdmin } from "@/lib/server/db";
import { workspaceRoot, resolveWorkspacePath, checkToolPermission } from "@/lib/server/workspace";
import { audit } from "@/lib/server/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

const READ_LIMIT = 200 * 1024; // 200 KB
const WRITE_LIMIT = 2 * 1024 * 1024; // 2 MB

function mediaTypeFor(p: string): string {
  const ext = path.extname(p).toLowerCase();
  const map: Record<string, string> = {
    ".txt": "text/plain", ".md": "text/markdown", ".json": "application/json",
    ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
    ".ts": "text/plain", ".tsx": "text/plain", ".py": "text/plain",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".svg": "image/svg+xml", ".pdf": "application/pdf",
    ".zip": "application/zip"
  };
  return map[ext] || "application/octet-stream";
}

/**
 * POST /api/tools/files — { action: list|read|write|mkdir, path, content?, employeeId?, taskId? }
 * Semua path terisolasi di dalam workspace KAI (anti path traversal). PRD §12.
 */
export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const body = await request.json();
    const action = String(body?.action || "");
    const rel = String(body?.path || "");
    const employeeId = body?.employeeId ? String(body.employeeId) : null;
    const taskId = body?.taskId ? String(body.taskId) : null;
    if (!["list", "read", "write", "mkdir"].includes(action)) {
      return NextResponse.json({ error: "action harus list, read, write, atau mkdir." }, { status: 400 });
    }
    const toolName = action === "read" || action === "list" ? "file_read" : "file_write";
    await checkToolPermission(employeeId, toolName);

    const abs = resolveWorkspacePath(rel);
    const pool = getPool();

    if (action === "list") {
      const dir = abs;
      const st = fs.existsSync(dir) ? fs.statSync(dir) : null;
      if (!st || !st.isDirectory()) return NextResponse.json({ error: "Direktori tidak ditemukan di workspace." }, { status: 404 });
      const entries = fs.readdirSync(dir, { withFileTypes: true }).map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "dir" : "file",
        size: e.isFile() ? fs.statSync(path.join(dir, e.name)).size : 0
      }));
      return NextResponse.json({ path: rel, entries });
    }

    if (action === "mkdir") {
      fs.mkdirSync(abs, { recursive: true });
      await pool.query(
        `INSERT INTO tool_runs(task_id, employee_id, tool_name, arguments, status, output)
         VALUES ($1, $2, 'file_mkdir', $3::jsonb, 'succeeded', 'Direktori dibuat.')`,
        [taskId, employeeId, JSON.stringify({ path: rel })]
      );
      return NextResponse.json({ ok: true, path: rel });
    }

    if (action === "read") {
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return NextResponse.json({ error: "File tidak ditemukan di workspace." }, { status: 404 });
      }
      const size = fs.statSync(abs).size;
      if (size > READ_LIMIT) return NextResponse.json({ error: `File ${size} byte melebihi batas baca ${READ_LIMIT} byte.` }, { status: 413 });
      const content = fs.readFileSync(abs, "utf8");
      await pool.query(
        `INSERT INTO tool_runs(task_id, employee_id, tool_name, arguments, status, output)
         VALUES ($1, $2, 'file_read', $3::jsonb, 'succeeded', $4)`,
        [taskId, employeeId, JSON.stringify({ path: rel, bytes: size }), `Dibaca ${size} byte.`]
      );
      return NextResponse.json({ path: rel, size, mediaType: mediaTypeFor(abs), content });
    }

    // write
    const content = String(body?.content ?? "");
    if (Buffer.byteLength(content, "utf8") > WRITE_LIMIT) {
      return NextResponse.json({ error: `Konten melebihi batas tulis ${WRITE_LIMIT} byte.` }, { status: 413 });
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
    const size = fs.statSync(abs).size;
    const sha256 = crypto.createHash("sha256").update(content, "utf8").digest("hex");
    await pool.query(
      `INSERT INTO workspace_files(task_id, employee_id, path, size_bytes, media_type, sha256)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (task_id, path) DO UPDATE SET size_bytes = EXCLUDED.size_bytes, media_type = EXCLUDED.media_type, sha256 = EXCLUDED.sha256, created_at = now()`,
      [taskId, employeeId, rel, size, mediaTypeFor(abs), sha256]
    );
    await pool.query(
      `INSERT INTO tool_runs(task_id, employee_id, tool_name, arguments, status, output)
       VALUES ($1, $2, 'file_write', $3::jsonb, 'succeeded', $4)`,
      [taskId, employeeId, JSON.stringify({ path: rel, bytes: size, sha256 }), `Ditulis ${size} byte.`]
    );
    await audit(employeeId ? `agent:${employeeId}` : "owner", "file_write", "workspace_file", taskId || undefined, { path: rel, bytes: size });
    return NextResponse.json({ ok: true, path: rel, size, sha256 });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Internal error";
    return NextResponse.json({ error: m }, { status: m === "UNAUTHORIZED" ? 401 : 503 });
  }
}

/** GET /api/tools/files?path= — daftar file workspace (read-only info). */
export async function GET(request: Request) {
  try {
    requireAdmin(request);
    const url = new URL(request.url);
    const rel = url.searchParams.get("path") || "";
    const abs = rel ? resolveWorkspacePath(rel) : workspaceRoot();
    const { rows } = await getPool().query(
      "SELECT task_id, employee_id, path, size_bytes, media_type, created_at FROM workspace_files ORDER BY created_at DESC LIMIT 200"
    );
    return NextResponse.json({ workspace: workspaceRoot(), files: rows, listingFor: rel || "/" });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Internal error";
    return NextResponse.json({ error: m }, { status: m === "UNAUTHORIZED" ? 401 : 503 });
  }
}
