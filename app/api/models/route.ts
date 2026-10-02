import { NextResponse } from "next/server";
import { getPool, requireAdmin } from "@/lib/server/db";

export const runtime = "nodejs";

/**
 * GET /api/models?providerId=<uuid>
 * Lists models previously discovered from a real 9Router /v1/models call
 * (synced via POST /api/providers/[id]/models) and persisted in
 * provider_models. Never invents model IDs. PRD §8.
 */
export async function GET(request: Request) {
  try {
    requireAdmin(request);
    const pool = getPool();
    const url = new URL(request.url);
    const providerId = url.searchParams.get("providerId");

    let provider;
    if (providerId) {
      const q = await pool.query(
        "SELECT id, name, base_url, enabled FROM providers WHERE id = $1",
        [providerId]
      );
      if (!q.rowCount) {
        return NextResponse.json({ error: "Provider tidak ditemukan." }, { status: 404 });
      }
      provider = q.rows[0];
    } else {
      // Default: the seeded 9Router gateway, else the first enabled provider.
      const q = await pool.query(
        `SELECT id, name, base_url, enabled FROM providers
         WHERE enabled = TRUE
         ORDER BY (base_url = 'http://127.0.0.1:20128/v1') DESC, created_at ASC
         LIMIT 1`
      );
      if (!q.rowCount) {
        return NextResponse.json(
          { error: "Belum ada provider aktif. Tambahkan 9Router di /control lalu sinkronkan model.", models: [] },
          { status: 404 }
        );
      }
      provider = q.rows[0];
    }

    const { rows } = await pool.query(
      `SELECT model_id AS id, COALESCE(display_name, model_id) AS name, discovered_at
       FROM provider_models WHERE provider_id = $1 ORDER BY model_id`,
      [provider.id]
    );

    return NextResponse.json({
      provider: { id: provider.id, name: provider.name, base_url: provider.base_url, enabled: provider.enabled },
      models: rows,
      synced: rows.length > 0,
      hint: rows.length === 0
        ? "Belum ada model tersinkron. Jalankan POST /api/providers/[id]/models untuk membaca katalog nyata dari 9Router."
        : undefined
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal error";
    return NextResponse.json(
      { error: message, models: [] },
      { status: message === "UNAUTHORIZED" ? 401 : 503 }
    );
  }
}
