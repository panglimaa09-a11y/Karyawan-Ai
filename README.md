# KARYAWAN AI — Virtual AI Office

Next.js + React Three Fiber 3D office. This branch adds a real PostgreSQL-backed provider registry and encrypted credentials, provider connection testing, and real model chat for employees.

## Requirements
- Node.js 20+
- PostgreSQL 14+
- 9Router reachable from the Next.js server (default example: `http://127.0.0.1:20128/v1`)

## Local setup
1. Copy `.env.example` to `.env.local`.
2. Generate a 32-byte encryption key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. Set a long random `KAI_ADMIN_TOKEN` and `DATABASE_URL`.
4. Create the database and apply schema: `psql "$DATABASE_URL" -f database/schema.sql`.
5. Install dependencies: `npm install`.
6. Start: `npm run dev`.

## API
All routes require `Authorization: Bearer <KAI_ADMIN_TOKEN>`. Never bundle this token into browser JavaScript.
- `GET /api/providers` lists provider metadata only.
- `POST /api/providers` JSON: `{ "name":"9Router", "baseUrl":"http://127.0.0.1:20128/v1", "apiFormat":"openai-chat", "defaultModel":"model-id", "token":"..." }`. Token is encrypted using AES-256-GCM before persistence.
- `POST /api/providers/:id/test` performs a real minimal model request.
- `POST /api/chat` JSON: `{ "employeeId":"raka", "message":"Halo", "conversationId":null }`.

Supported API formats are `openai-chat` and `openai-responses`. Other vendor-specific APIs need their own adapter. To enable an employee for chat, assign a provider UUID and model ID to that employee row in PostgreSQL, e.g. `UPDATE employees SET provider_id='<provider-uuid>', model_id='<model-id>' WHERE id='raka';`.

## Security
- Intended for local/trusted backend use. Do not expose without adding real login/session and CSRF protection.
- Do not send `KAI_ADMIN_TOKEN` from client-side JavaScript in a public app; mediate requests through a same-origin authenticated server session.
- No arbitrary shell execution is exposed. Important side effects must have a separate approval workflow.
- Keep `KAI_ENCRYPTION_KEY` backed up securely; changing it without re-encrypting tokens makes saved credentials unreadable.
- For local-only use, bind the server to loopback and do not forward the port to an untrusted network.

## Honest implementation status
Implemented in this branch: SQL schema, ten seeded employee profiles, encrypted provider credential storage, provider metadata endpoint, provider connectivity test, real employee chat, and usage records. Not yet implemented: provider/model management UI, automatic model discovery, full meeting orchestration, artifact UI, employee assignment UI, end-to-end test suite, and a complete approval execution flow. These are not represented as finished features.
