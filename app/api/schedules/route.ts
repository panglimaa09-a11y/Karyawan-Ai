import { NextResponse } from "next/server";
import { getPool, requireAdmin } from "@/lib/server/db";
import { audit } from "@/lib/server/audit";

export const runtime = "nodejs";

function validCron(expr: string): boolean {
  // Accepts standard 5-field cron (minute hour dom month dow). Full schedule
  // evaluation is done by the external trigger; this only guards the shape.
  return /^(\S+\s+){4}\S+$/.test(expr.trim());
}

/** GET /api/schedules — daftar jadwal. PRD §16. */
export async function GET(request: Request) {
  try {
    requireAdmin(request);
    const { rows } = await getPool().query(
      `SELECT s.id, s.name, s.cron_expr, s.enabled, s.created_at, s.updated_at,
              (SELECT COUNT(*)::int FROM scheduled_runs r WHERE r.schedule_id = s.id) AS run_count,
              (SELECT r.status FROM scheduled_runs r WHERE r.schedule_id = s.id ORDER BY r.ran_at DESC LIMIT 1) AS last_status
       FROM schedules s ORDER BY s.created_at DESC`
    );
    return NextResponse.json({ schedules: rows });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Internal error";
    return NextResponse.json({ error: m }, { status: m === "UNAUTHORIZED" ? 401 : 503 });
  }
}

/** POST /api/schedules — {name, cron_expr, payload?, enabled?}. */
export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const body = await request.json();
    const name = String(body?.name || "").trim().slice(0, 200);
    const cronExpr = String(body?.cron_expr || "").trim();
    if (!name || !validCron(cronExpr)) {
      return NextResponse.json({ error: "name dan cron_expr 5-field (mis. '0 7 * * *') wajib valid." }, { status: 400 });
    }
    const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};
    // Only agent_task payloads are supported by the built-in trigger.
    if (payload.type && payload.type !== "agent_task") {
      return NextResponse.json({ error: "payload.type yang didukung: 'agent_task'." }, { status: 400 });
    }
    const { rows } = await getPool().query(
      "INSERT INTO schedules(name, cron_expr, payload, enabled) VALUES ($1, $2, $3::jsonb, $4) RETURNING id, name, cron_expr, enabled, created_at",
      [name, cronExpr, JSON.stringify(payload), body?.enabled !== false]
    );
    await audit("owner", "schedule_created", "schedule", rows[0].id, { name, cron_expr: cronExpr });
    return NextResponse.json({ schedule: rows[0] }, { status: 201 });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Internal error";
    return NextResponse.json({ error: m }, { status: m === "UNAUTHORIZED" ? 401 : 503 });
  }
}
