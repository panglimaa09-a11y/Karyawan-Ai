# KARYAWAN AI (KAI) — Virtual AI Office

Platform AI Agent Office: Bos Angga mengelola **10 karyawan AI** melalui kantor virtual 3D,
memberi instruksi, membagi pekerjaan, mengawasi proses, meninjau hasil, dan menyetujui
tindakan penting. Semua panggilan AI memakai provider sungguhan via **9Router**
(API kompatibel OpenAI); tidak ada data demo yang disajikan sebagai data nyata.

Stack: Next.js 15 (App Router) + React 19 + React Three Fiber · PostgreSQL · 9Router.

## Requirements
- Node.js 20+
- PostgreSQL 14+
- 9Router dapat dijangkau dari server Next.js (default: `http://127.0.0.1:20128/v1`)

## Local setup
1. Copy `.env.example` ke `.env.local`.
2. Generate kunci enkripsi 32-byte: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` → `KAI_ENCRYPTION_KEY`.
3. Isi `KAI_ADMIN_TOKEN` (acak, ≥24 karakter) dan `DATABASE_URL`.
4. Buat database dan terapkan schema dasar: `psql "$DATABASE_URL" -f database/schema.sql`.
   Migrasi berikutnya (`database/migrations/*.sql`) diterapkan otomatis saat aplikasi start
   (aditif saja — tidak pernah drop/reset data).
5. `npm install`
6. `npm run dev` → buka `/` (kantor 3D), `/control` (provider & agent), `/tasks` (task board).

Alur setup di UI: `/control` → masukkan admin token → tambah provider 9Router
(`http://127.0.0.1:20128/v1`) + token → **Sinkronkan model** → tetapkan provider+model
per karyawan → tes via **Chat AI agent nyata**.

## API (semua butuh `Authorization: Bearer <KAI_ADMIN_TOKEN>`, kecuali disebut)
- `GET /api/health` — status aplikasi, database, dan gateway 9Router.
- `GET/POST /api/providers`, `POST /api/providers/:id/test`, `POST /api/providers/:id/models` — registry provider, tes koneksi nyata, sinkronisasi katalog model nyata ke DB.
- `GET /api/models?providerId=` — model tersinkron dari DB (bukan env).
- `GET/PATCH /api/employees` — daftar & penetapan provider/model per karyawan.
- `POST /api/manager` `{project, title?}` — Raka menyusun rencana; project+tugas+dependensi tersimpan di DB.
- `GET /api/tasks`, `GET /api/tasks/:id`, `PATCH /api/tasks/:id` (cancel/requeue), `POST /api/tasks/:id/run`, `POST /api/tasks/:id/review` — orkestrasi & verifikasi QA.
- `POST /api/agent` `{employeeId, task, ...}` — eksekusi satu tugas oleh satu karyawan.
- `POST /api/chat` `{employeeId, message, conversationId?}` — chat nyata per karyawan.
- `GET/POST /api/meetings` — meeting antar-agent (maks 2 putaran), tersimpan persisten.
- `GET/POST /api/approvals`, `PATCH /api/approvals/:id` — antrean persetujuan Bos Angga; tercatat di audit log.
- `POST /api/tools/exec` `{command, employeeId?, taskId?}` — shell **hanya di dalam workspace KAI**, pola berbahaya ditolak, tercatat di tool_runs.
- `GET/POST /api/tools/files` — list/read/write/mkdir terisolasi di workspace (anti path traversal).
- `GET /api/artifacts`, `GET /api/artifacts/:id`, `POST /api/artifacts/zip` — artefak + ZIP dari file yang benar-benar ada.
- `GET /api/office/status` (tanpa auth, read-only) — status karyawan untuk kantor 3D.
- `GET /api/projects` — project + ringkasan status tugas.

Siklus tugas (PRD): `draft → queued → planning → running → blocked → awaiting_approval → testing → completed/failed/cancelled`.
`completed` hanya via review QA dengan bukti (evidence).

## Security
- Token provider dienkripsi AES-256-GCM di server; tidak pernah dikirim ke browser atau log.
- `KAI_ADMIN_TOKEN` untuk mode lokal/tepercaya. Jangan expose tanpa login/session + CSRF.
- Shell/filesystem terisolasi di `KAI_WORKSPACE` (default `./workspace`); perintah berbahaya butuh persetujuan.
- Push GitHub (`POST /api/github/push`) wajib `approvalId` yang sudah di-approve dan belum dieksekusi.
- Jangan expose port 9Router ke internet tanpa autentikasi.

## Honest implementation status
Sudah nyata: schema + migrasi PRD (tervalidasi), 10 karyawan, registry provider terenkripsi,
sinkronisasi & tes model 9Router, chat/meeting nyata per karyawan, orkestrasi tugas Raka
dengan dependensi, eksekusi + artefak + review QA, approval-gated GitHub push, tool shell/file
terisolasi beraudit, ZIP artefak nyata, health check, task board UI, kantor 3D 10 karyawan.

Belum / terbatas: scheduler UI (tabel ada, eksekutor cron belum), login multi-user penuh
(tabel users/sessions ada, auth masih token admin), notifikasi UI, end-to-end test suite.
Yang belum ada tidak diklaim selesai di UI.
