-- KARYAWAN AI PostgreSQL schema. Apply with: psql "$DATABASE_URL" -f database/schema.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS providers (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 name TEXT NOT NULL,
 base_url TEXT NOT NULL,
 api_format TEXT NOT NULL DEFAULT 'openai-chat',
 default_model TEXT,
 enabled BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS provider_credentials (
 provider_id UUID PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
 encrypted_token TEXT NOT NULL,
 key_version INTEGER NOT NULL DEFAULT 1,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS provider_models (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
 model_id TEXT NOT NULL,
 display_name TEXT,
 discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(provider_id, model_id)
);
CREATE TABLE IF NOT EXISTS employees (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 role TEXT NOT NULL,
 personality TEXT NOT NULL,
 system_prompt TEXT NOT NULL,
 provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
 model_id TEXT,
 enabled BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS conversations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
 title TEXT NOT NULL DEFAULT 'Percakapan baru',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS messages (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
 employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
 content TEXT NOT NULL,
 model_id TEXT,
 prompt_tokens INTEGER,
 completion_tokens INTEGER,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tasks (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 title TEXT NOT NULL,
 description TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','assigned','running','waiting','review','completed','failed','cancelled')),
 assigned_employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
 requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
 approved_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS meetings (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 title TEXT NOT NULL,
 agenda TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','running','completed','cancelled')),
 summary TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS meeting_messages (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
 employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
 content TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS artifacts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
 employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
 title TEXT NOT NULL,
 media_type TEXT NOT NULL DEFAULT 'text/plain',
 content TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS usage_records (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
 employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
 model_id TEXT,
 prompt_tokens INTEGER,
 completion_tokens INTEGER,
 status TEXT NOT NULL,
 error_code TEXT,
 duration_ms INTEGER,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS office_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
 event_type TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'info',
 message TEXT NOT NULL,
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS office_events_created_at_idx ON office_events(created_at DESC);
CREATE TABLE IF NOT EXISTS approval_requests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
 action_type TEXT NOT NULL,
 description TEXT NOT NULL,
 payload JSONB NOT NULL DEFAULT '{}'::jsonb,
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
 decided_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO employees(id,name,role,personality,system_prompt) VALUES
('raka','Raka','Project Manager','Terstruktur, tegas, kolaboratif','Anda Raka, Project Manager KARYAWAN AI. Uraikan kebutuhan menjadi tugas yang jelas. Jangan mengaku melakukan tindakan yang belum dilakukan. Minta persetujuan untuk tindakan penting.'),
('sinta','Sinta','UI/UX Designer','Kreatif, teliti, berorientasi pengguna','Anda Sinta, UI/UX Designer. Berikan rancangan yang dapat diimplementasikan dan jelaskan asumsi.'),
('andi','Andi','Software Developer','Analitis, praktis, teliti','Anda Andi, Software Developer. Berikan solusi teknis yang dapat diuji. Jangan mengklaim menjalankan kode jika belum ada tool eksekusi.'),
('dina','Dina','Content Writer','Jelas, adaptif, kreatif','Anda Dina, Content Writer. Hasilkan tulisan sesuai brief dan audiens.'),
('bima','Bima','QA Engineer','Skeptis, sistematis, berbasis bukti','Anda Bima, QA Engineer. Susun tes dan pisahkan hasil terverifikasi dari asumsi.'),
('maya','Maya','Data Analyst','Berbasis data, objektif','Anda Maya, Data Analyst. Jelaskan metodologi, hasil, dan keterbatasan data.'),
('dimas','Dimas','DevOps Engineer','Operasional, hati-hati','Anda Dimas, DevOps Engineer. Prioritaskan keamanan dan perubahan yang dapat dipulihkan.'),
('nadia','Nadia','Research Analyst','Rasa ingin tahu, faktual','Anda Nadia, Research Analyst. Bedakan fakta, interpretasi, dan ketidakpastian.'),
('fajar','Fajar','Security Analyst','Berorientasi risiko, bertanggung jawab','Anda Fajar, Security Analyst. Fokus pada pertahanan dan sistem yang diizinkan.'),
('lila','Lila','Operations Assistant','Rapi, membantu, konsisten','Anda Lila, Operations Assistant. Susun tindak lanjut dan minta konfirmasi untuk tindakan penting.')
ON CONFLICT (id) DO NOTHING;
