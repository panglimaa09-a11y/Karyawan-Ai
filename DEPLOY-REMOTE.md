# Remote deployment: keep KARYAWAN AI running when your PC is off

A localhost process stops when the PC is powered off. To keep agents and the database available 24/7, run this repository on an always-on remote VPS/server. Your PC then acts only as a browser client. A cloud host does not make an API gateway on your home PC stay online: 9Router must also run on the VPS or be reachable from the VPS.

## Recommended setup
- Ubuntu 24.04 VPS with Docker Engine and Compose plugin.
- Persistent VPS disk and PostgreSQL Docker volume.
- HTTPS reverse proxy (Caddy/Nginx) and domain.
- Restrict admin access using a VPN such as Tailscale or an authenticated reverse proxy. Do not expose port 3000 directly to the public internet.
- Run 9Router on the VPS if you need its local models/catalog. Configure its provider Base URL to the address reachable from the app container, not 127.0.0.1 inside the app container.

## Deploy
1. Install Docker Engine and Docker Compose on the VPS.
2. Clone this branch/repository on the VPS.
3. Create a private `.env` file beside docker-compose.yml; never commit it:
   ```dotenv
   POSTGRES_DB=karyawan_ai
   POSTGRES_USER=kai_user
   POSTGRES_PASSWORD=replace_with_a_long_random_password
   KAI_ENCRYPTION_KEY=64_hex_characters_generated_with_node_crypto
   KAI_ADMIN_TOKEN=long_random_secret_at_least_24_characters
   ```
4. Generate secrets locally on the VPS with `openssl rand -hex 32` for the encryption key and `openssl rand -hex 32` for the admin token. Restrict the file: `chmod 600 .env`.
5. Start services: `docker compose up -d --build`.
6. Check health/logs: `docker compose ps` and `docker compose logs --tail=100 app postgres`.
7. The app binds to 127.0.0.1:3000 on the VPS. Add an HTTPS reverse proxy and VPN/authentication before accessing it remotely.
8. Open `https://your-domain.example/control`, enter KAI_ADMIN_TOKEN, add the 9Router provider and token, synchronize models, assign models to employees, test, and chat.
9. Back up the PostgreSQL volume and store the encryption key in a separate secure place. Losing the key means stored provider tokens cannot be decrypted.

## Local development
For development on a PC use PostgreSQL and Node.js, configure `.env.local`, apply `database/schema.sql`, then `npm install` and `npm run dev`. Local 9Router at `http://127.0.0.1:20128/v1` works only if Next.js is running on that same host. If the app is inside Docker, use a host-reachable address (e.g. host.docker.internal on supported Docker Desktop setups).

## Operations and limitations
- Docker restart policy restarts containers after process/host reboot, but cannot keep a powered-off VPS alive; use a provider with persistent compute.
- This compose stack does not include TLS proxy, backups, VPN, or automatic OS updates; configure them before production use.
- The current admin Bearer token is a prototype access gate, not a full user login/session system. Do not expose this deployment publicly until proper session auth, CSRF protections, rate limiting, and security review are implemented.
- Remote agent work can only call a 9Router endpoint reachable from the VPS. If the provider token/model is only configured on your PC's 9Router instance, it will not work after the PC is off.
- Schema is applied automatically only when PostgreSQL volume is new. For an existing volume, apply new schema changes manually with psql.
