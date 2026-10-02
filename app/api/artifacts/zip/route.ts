import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireAdmin } from "@/lib/server/db";
import { workspaceRoot, resolveWorkspacePath } from "@/lib/server/workspace";
import { audit } from "@/lib/server/audit";

export const runtime = "nodejs";
export const maxDuration = 120;

const ZIP_SCRIPT = `
import sys, zipfile, os
root, out = sys.argv[1], sys.argv[2]
files = sys.argv[3:]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for rel in files:
        full = os.path.join(root, rel)
        if os.path.isfile(full):
            z.write(full, rel)
print("OK")
`;

/**
 * POST /api/artifacts/zip — buat ZIP dari file workspace yang benar-benar ada.
 * Body: { paths: string[] } — path relatif terhadap workspace KAI.
 * Hanya file yang ada yang masuk; yang hilang dilaporkan, bukan dipalsukan. PRD §9.
 */
export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const body = await request.json();
    const paths = Array.isArray(body?.paths) ? body.paths.map((p: unknown) => String(p)) : [];
    if (!paths.length || paths.length > 200) {
      return NextResponse.json({ error: "paths wajib diisi (1–200 file, relatif terhadap workspace)." }, { status: 400 });
    }

    const root = workspaceRoot();
    const missing: string[] = [];
    const existing: string[] = [];
    for (const rel of paths) {
      try {
        const abs = resolveWorkspacePath(rel);
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) existing.push(rel);
        else missing.push(rel);
      } catch {
        missing.push(rel);
      }
    }
    if (!existing.length) {
      return NextResponse.json({ error: "Tidak ada file valid di workspace.", missing }, { status: 404 });
    }

    const out = path.join(os.tmpdir(), `kai-artifacts-${Date.now()}.zip`);
    await new Promise<void>((resolve, reject) => {
      execFile("python3", ["-c", ZIP_SCRIPT, root, out, ...existing], { timeout: 60000 }, (err, stdout, stderr) => {
        if (err) reject(new Error("Gagal membuat ZIP: " + (stderr || err.message).slice(0, 300)));
        else resolve();
      });
    });

    const data = fs.readFileSync(out);
    fs.unlink(out, () => {});
    await audit("owner", "artifacts_zipped", "workspace", undefined, { files: existing.length, missing: missing.length });

    return new NextResponse(data, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="kai-artifacts-${Date.now()}.zip"`,
        "X-KAI-Zip-Missing": String(missing.length)
      }
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Internal error";
    return NextResponse.json({ error: m }, { status: m === "UNAUTHORIZED" ? 401 : 503 });
  }
}
