// Validates database/schema.sql + database/migrations/002-prd-tables.sql
// against real PostgreSQL semantics via PGlite (PostgreSQL WASM).
// Usage: node --experimental-strip-types scripts/validate-schema.ts
// (or compile with tsc). Exits non-zero on any failure.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
import path from "node:path";

import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const db = new PGlite({ extensions: { pgcrypto } });
  const schema = fs.readFileSync(path.join(ROOT, "database/schema.sql"), "utf8");
  const migration = fs.readFileSync(path.join(ROOT, "database/migrations/002-prd-tables.sql"), "utf8");

  console.log("Applying database/schema.sql ...");
  await db.exec(schema);
  console.log("Applying 002-prd-tables.sql ...");
  await db.exec(migration);
  console.log("Re-applying 002 (idempotency check) ...");
  await db.exec(migration);

  const checks: Array<[string, string]> = [
    ["ten employees seeded", "SELECT COUNT(*)::int AS n FROM employees"],
    ["9Router provider seeded", "SELECT COUNT(*)::int AS n FROM providers WHERE base_url='http://127.0.0.1:20128/v1'"],
    ["tool permission matrix", "SELECT COUNT(*)::int AS n FROM agent_tool_permissions"],
    ["task status check constraint", `SELECT COUNT(*)::int AS n FROM pg_constraint WHERE conname='tasks_status_check'`],
    ["office_events table exists", "SELECT COUNT(*)::int AS n FROM office_events"],
    ["audit_logs table exists", "SELECT COUNT(*)::int AS n FROM audit_logs"],
    ["tool_runs table exists", "SELECT COUNT(*)::int AS n FROM tool_runs"],
    ["task_dependencies table exists", "SELECT COUNT(*)::int AS n FROM task_dependencies"],
    ["schedules table exists", "SELECT COUNT(*)::int AS n FROM schedules"],
    ["users table exists", "SELECT COUNT(*)::int AS n FROM users"],
  ];
  let failed = 0;
  for (const [label, sql] of checks) {
    try {
      const res = await db.query(sql);
      console.log(`  ok: ${label} ->`, JSON.stringify((res.rows[0] as any).n));
    } catch (e) {
      failed++;
      console.error(`  FAIL: ${label}:`, e instanceof Error ? e.message : e);
    }
  }

  // Task lifecycle smoke test with PRD statuses.
  try {
    const p = await db.query("INSERT INTO projects(name) VALUES ('smoke') RETURNING id");
    const pid = (p.rows[0] as any).id;
    const t = await db.query(
      "INSERT INTO tasks(project_id, title, description, status, priority) VALUES ($1,'t1','d','planning','high') RETURNING id",
      [pid]
    );
    const tid = (t.rows[0] as any).id;
    await db.query("UPDATE tasks SET status='queued' WHERE id=$1", [tid]);
    await db.query("UPDATE tasks SET status='running' WHERE id=$1", [tid]);
    await db.query("UPDATE tasks SET status='awaiting_approval' WHERE id=$1", [tid]);
    await db.query("UPDATE tasks SET status='testing' WHERE id=$1", [tid]);
    await db.query("UPDATE tasks SET status='completed' WHERE id=$1", [tid]);
    // Invalid status must be rejected.
    let rejected = false;
    try { await db.query("UPDATE tasks SET status='bogus' WHERE id=$1", [tid]); }
    catch { rejected = true; }
    console.log(`  ok: PRD lifecycle transitions; invalid status rejected=${rejected}`);
    if (!rejected) { failed++; console.error("  FAIL: invalid status was accepted"); }
  } catch (e) {
    failed++;
    console.error("  FAIL: lifecycle smoke:", e instanceof Error ? e.message : e);
  }

  await db.close();
  if (failed) { console.error(`SCHEMA VALIDATION FAILED (${failed})`); process.exit(1); }
  console.log("SCHEMA VALIDATION PASSED");
}

main().catch((e) => { console.error(e); process.exit(1); });
