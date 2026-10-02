import { getPool } from "./db";

/**
 * Append an audit log entry. Never throws — audit must not break the
 * operation it records. PRD §3.8, §17.
 */
export async function audit(
  actor: string,
  action: string,
  entityType?: string,
  entityId?: string,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO audit_logs(actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [actor, action, entityType || null, entityId || null, JSON.stringify(details || {})]
    );
  } catch (err) {
    console.error("audit log failed", err instanceof Error ? err.message : err);
  }
}

export async function officeEvent(
  employeeId: string | null,
  eventType: string,
  status: string,
  message: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO office_events(employee_id, event_type, status, message, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [employeeId, eventType, status, message, JSON.stringify(metadata || {})]
    );
  } catch (err) {
    console.error("office event failed", err instanceof Error ? err.message : err);
  }
}
