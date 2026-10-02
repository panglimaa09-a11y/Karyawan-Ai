import fs from "node:fs";
import path from "node:path";
import { getPool } from "./db";

const MIGRATIONS_DIR = path.join(process.cwd(), "database", "migrations");

/**
 * Apply pending SQL migrations in filename order. Additive only — never
 * drops tables or deletes data (PRD §3.6). Safe to run on every boot.
 * Tracks applied files in kai_schema_migrations.
 */
export async function runMigrations(): Promise<string[]> {
  if (!process.env.DATABASE_URL) {
    console.log("[migrate] DATABASE_URL not set — skipping migrations.");
    return [];
  }
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  const pool = getPool();
  await pool.query(
    `CREATE TABLE IF NOT EXISTS kai_schema_migrations (
       filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  );
  const applied = new Set(
    (await pool.query("SELECT filename FROM kai_schema_migrations")).rows.map((r: any) => r.filename)
  );
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const done: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO kai_schema_migrations(filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      done.push(file);
      console.log(`[migrate] applied ${file}`);
    } catch (e) {
      await client.query("ROLLBACK");
      console.error(`[migrate] FAILED ${file}:`, e instanceof Error ? e.message : e);
      throw e;
    } finally {
      client.release();
    }
  }
  return done;
}
