# KARYAWAN AI — Virtual AI Office

Next.js app for a real multi-provider AI office. The existing 3D office is retained; this branch adds a persistent PostgreSQL core for providers, encrypted credentials, employees, conversations, messages, meetings, tasks, and audit events.

## Requirements
- Node.js 20+
- PostgreSQL
- A provider with a compatible API endpoint and valid API key

## Local setup
1. Copy `.env.example` to `.env` and set `DATABASE_URL` and `CREDENTIAL_ENCRYPTION_KEY` (at least 32 characters; use a unique random value).
2. Install dependencies: `npm install`
3. Generate Prisma client: `npx prisma generate`
4. Apply schema: `npx prisma db push`
5. Start: `npm run dev`

## Real APIs
- `GET/POST /api/providers`: list and create providers. API keys are encrypted with AES-256-GCM and never returned by API.
- `PATCH/DELETE /api/providers/:id`: update/rotate credentials, enable/disable, delete.
- `POST /api/providers/:id/test`: test the configured provider and retrieve available models from its `/models` endpoint.
- `GET/PATCH /api/employees`: seed the ten initial employees and manage their provider/model/prompt.
- `POST /api/chat`: real provider request with persistent conversation messages and usage metadata.
- `GET /api/conversations/:id`: load persisted conversation history.

## Important
The provider/chat endpoints are server-side. Configure HTTPS for remote providers; HTTP is accepted only for localhost. Never commit real API keys or the encryption secret. Before deploying publicly, add authentication/authorization and rate limiting in front of all management routes. Database migrations and a live provider test are required before considering the installation operational.
