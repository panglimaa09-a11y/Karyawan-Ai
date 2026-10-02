import { NextResponse } from "next/server";
import { getPool, requireAdmin } from "@/lib/server/db";
import { decryptSecret } from "@/lib/server/crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

interface CheckResult {
  name: string;
  status: "ok" | "degraded" | "down";
  detail?: string;
  latencyMs?: number;
}

/** GET /api/health — status aplikasi, database, dan gateway 9Router. PRD §19. */
export async function GET(request: Request) {
  const checks: CheckResult[] = [];
  const started = Date.now();

  // Database
  try {
    const pool = getPool();
    const t0 = Date.now();
    await pool.query("SELECT 1");
    checks.push({ name: "database", status: "ok", latencyMs: Date.now() - t0 });
  } catch (e) {
    checks.push({ name: "database", status: "down", detail: e instanceof Error ? e.message : "unreachable" });
  }

  // 9Router gateway (default provider)
  try {
    requireAdmin(request);
    const pool = getPool();
    const q = await pool.query(
      `SELECT p.id, p.name, p.base_url, c.encrypted_token
       FROM providers p LEFT JOIN provider_credentials c ON c.provider_id = p.id
       WHERE p.enabled = TRUE
       ORDER BY (p.base_url = 'http://127.0.0.1:20128/v1') DESC, p.created_at ASC LIMIT 1`
    );
    if (!q.rowCount) {
      checks.push({ name: "gateway:9router", status: "degraded", detail: "Belum ada provider aktif." });
    } else {
      const p = q.rows[0];
      const t0 = Date.now();
      try {
        const resp = await fetch(p.base_url.replace(/\/$/, "") + "/models", {
          headers: p.encrypted_token ? { Authorization: "Bearer " + decryptSecret(p.encrypted_token) } : {},
          signal: AbortSignal.timeout(10000)
        });
        const latencyMs = Date.now() - t0;
        const status = resp.ok ? "ok" : resp.status === 401 ? "degraded" : "down";
        checks.push({
          name: `gateway:${p.name}`, status,
          detail: resp.ok ? `${p.base_url} merespons /v1/models.` : `HTTP ${resp.status}`,
          latencyMs
        });
        await pool.query(
          `INSERT INTO provider_health_checks(provider_id, status, latency_ms, detail)
           VALUES ($1, $2, $3, $4)`,
          [p.id, status, latencyMs, `GET /models -> HTTP ${resp.status}`]
        ).catch(() => {});
      } catch (e) {
        checks.push({ name: `gateway:${p.name}`, status: "down", detail: e instanceof Error ? e.message : "unreachable" });
        await pool.query(
          `INSERT INTO provider_health_checks(provider_id, status, detail) VALUES ($1, 'down', $2)`,
          [p.id, e instanceof Error ? e.message.slice(0, 500) : "unreachable"]
        ).catch(() => {});
      }
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : "Internal error";
    if (m === "UNAUTHORIZED") return NextResponse.json({ error: m }, { status: 401 });
    checks.push({ name: "gateway:9router", status: "degraded", detail: m });
  }

  const overall = checks.every((c) => c.status === "ok") ? "ok"
    : checks.some((c) => c.status === "down") ? "down" : "degraded";
  return NextResponse.json({ status: overall, checks, durationMs: Date.now() - started });
}
