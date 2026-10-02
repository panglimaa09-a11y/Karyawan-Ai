export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { runMigrations } = await import("./lib/server/migrate");
      await runMigrations();
    } catch (e) {
      // Never crash the app on migration failure; the error is logged and
      // /api/health reports the database state.
      console.error("[instrumentation] migration error:", e instanceof Error ? e.message : e);
    }
  }
}
