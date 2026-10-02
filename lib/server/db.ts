import { Pool } from "pg";

declare global { var __kaiPool: Pool | undefined; }

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL belum dikonfigurasi.");
  if (!global.__kaiPool) global.__kaiPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: true } : undefined });
  return global.__kaiPool;
}

export function requireAdmin(request: Request): void {
  const expected = process.env.KAI_ADMIN_TOKEN;
  if (!expected || expected.length < 24) throw new Error("KAI_ADMIN_TOKEN wajib diatur (minimal 24 karakter).");
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (supplied !== expected) throw new Error("UNAUTHORIZED");
}
