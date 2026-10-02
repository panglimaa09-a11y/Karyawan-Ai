-- KARYAWAN AI — Migration 002: PRD tables & task lifecycle
-- Apply after database/schema.sql:
--   psql "$DATABASE_URL" -f database/schema.sql -f database/migrations/002-prd-tables.sql
-- Idempotent: safe to run multiple times. Never drops data.

-- ---------------------------------------------------------------------------
-- 1. Task lifecycle aligned with PRD §6
-- PRD: Draft, Queued, Planning, Running, Blocked, Awaiting Approval,
--      Testing, Completed, Failed, Cancelled
-- ---------------------------------------------------------------------------
UPDATE tasks SET status = 'queued'  WHERE status = 'assigned';
UPDATE tasks SET status = 'blocked' WHERE status = 'waiting';
UPDATE tasks SET status = 'testing' WHERE status = 'review';

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks
  ADD CONSTRAINT tasks_status_check CHECK (status IN (
    'draft','queued','planning','running','blocked',
    'awaiting_approval','testing','completed','failed','cancelled'
  ));
ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'queued';

-- Priority & planning fields (PRD §5, §10)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id UUID;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal'
  CHECK (priority IN ('low','normal','high','urgent'));
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS acceptance_criteria TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS result_evidence TEXT;

-- ---------------------------------------------------------------------------
-- 2. Projects (PRD §14)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_project_fk') THEN
    ALTER TABLE tasks
      ADD CONSTRAINT tasks_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
  END IF;
END
$$;
CREATE INDEX IF NOT EXISTS tasks_project_id_idx ON tasks(project_id);

-- ---------------------------------------------------------------------------
-- 3. Task dependencies & assignments (PRD §10, §14)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS task_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  assignment_role TEXT NOT NULL DEFAULT 'owner',
  status TEXT NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned','in_progress','done','released')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, employee_id)
);

-- ---------------------------------------------------------------------------
-- 4. Per-agent model & tool configuration (PRD §5, §14)
-- employees.provider_id / employees.model_id stay the primary link used by
-- the chat/meeting pipelines; the columns below carry generation parameters
-- and budgets (PRD: agent_model_configs).
-- ---------------------------------------------------------------------------
ALTER TABLE employees ADD COLUMN IF NOT EXISTS temperature NUMERIC NOT NULL DEFAULT 0.4;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS max_tokens INTEGER NOT NULL DEFAULT 2000;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS token_budget_per_task INTEGER;

CREATE TABLE IF NOT EXISTS agent_tool_permissions (
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, tool_name)
);

-- Default tool matrix for the ten PRD employees.
-- Tools: chat, file_read, file_write, shell_exec, git_read, artifact_zip, meeting
INSERT INTO agent_tool_permissions (employee_id, tool_name, allowed) VALUES
  ('raka','chat',TRUE),('raka','file_read',TRUE),('raka','meeting',TRUE),
  ('sinta','chat',TRUE),('sinta','file_read',TRUE),('sinta','file_write',TRUE),
  ('andi','chat',TRUE),('andi','file_read',TRUE),('andi','file_write',TRUE),('andi','shell_exec',TRUE),('andi','git_read',TRUE),
  ('dina','chat',TRUE),('dina','file_read',TRUE),('dina','file_write',TRUE),
  ('bima','chat',TRUE),('bima','file_read',TRUE),('bima','shell_exec',TRUE),
  ('maya','chat',TRUE),('maya','file_read',TRUE),('maya','file_write',TRUE),
  ('dimas','chat',TRUE),('dimas','file_read',TRUE),('dimas','file_write',TRUE),('dimas','shell_exec',TRUE),('dimas','git_read',TRUE),('dimas','artifact_zip',TRUE),
  ('nadia','chat',TRUE),('nadia','file_read',TRUE),('nadia','file_write',TRUE),
  ('fajar','chat',TRUE),('fajar','file_read',TRUE),
  ('lila','chat',TRUE),('lila','file_read',TRUE),('lila','meeting',TRUE)
ON CONFLICT (employee_id, tool_name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Provider health (PRD §8, §19)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_health_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('ok','degraded','down')),
  latency_ms INTEGER,
  checked_model TEXT,
  detail TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS provider_health_checks_provider_idx
  ON provider_health_checks(provider_id, checked_at DESC);

-- Seed the PRD §8 default 9Router gateway (no token yet — operator adds it).
INSERT INTO providers (name, base_url, api_format, enabled)
SELECT '9Router', 'http://127.0.0.1:20128/v1', 'openai-chat', TRUE
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE base_url = 'http://127.0.0.1:20128/v1');

-- ---------------------------------------------------------------------------
-- 6. Tool runs — every filesystem/shell/git execution is recorded (PRD §12)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tool_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  arguments JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('started','succeeded','failed','denied','timeout')),
  output TEXT,
  exit_code INTEGER,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tool_runs_task_idx ON tool_runs(task_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 7. Audit log — every important action (PRD §3.8, §17)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs(entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- 8. Artifacts: versions + workspace file registry (PRD §9, §14)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artifact_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, version)
);
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS current_version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS workspace_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  path TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  media_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  sha256 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, path)
);

-- ---------------------------------------------------------------------------
-- 9. Approvals: execution linkage (PRD §11)
-- ---------------------------------------------------------------------------
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS decided_by TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS executed_result JSONB;

-- ---------------------------------------------------------------------------
-- 10. Scheduler (PRD §16)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  cron_expr TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS scheduled_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','skipped')),
  result TEXT,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scheduled_runs_schedule_idx ON scheduled_runs(schedule_id, ran_at DESC);

-- ---------------------------------------------------------------------------
-- 11. Notifications (PRD §14)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient TEXT NOT NULL DEFAULT 'owner',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications(recipient, created_at DESC);

-- ---------------------------------------------------------------------------
-- 12. Minimal users/sessions/roles (PRD §4). Local mode keeps the
-- KAI_ADMIN_TOKEN bootstrap; this table enables a limited-admin role later.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'limited_admin' CHECK (role IN ('owner','limited_admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
