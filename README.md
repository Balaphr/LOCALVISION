# LocalVision

LocalVision runs entirely on Cloudflare: the React frontend is served as Worker assets, the API is a Cloudflare Worker, and all data lives in a D1 database. There is no local server, no Ubuntu VM, no tunnel, no port forwarding, and no proxy to keep online.

## What works in the cloud

- Sign in, sessions, password change, guest mode, users and roles
- Cameras, zones, shares, integrations, storage server configuration
- Events, detections, alerts, audit logs, settings and health endpoints

Live camera video, RTSP/ONVIF probing, ffmpeg recording, local media files and AI inference need hardware on your network, so those endpoints return a clear "unavailable in the Cloudflare-only deployment" response. They cannot run on Cloudflare Workers.

## One-time setup

You need a Cloudflare account. From this folder:

```bash
npx wrangler login
npm run setup:cloudflare
```

The setup script applies `cloudflare/schema.sql` to the existing D1 database, stores `ENCRYPTION_KEY`, `SECRET_KEY` and `ADMIN_PASSWORD` as Worker secrets (you will be prompted for the admin password), builds the frontend, and deploys the Worker.

The D1 binding is already configured in `wrangler.toml` with the existing database id:

```toml
[[d1_databases]]
binding = "DB"
database_name = "localvision"
database_id = "edd8abfb-39b3-4ee2-8ecc-b6cb4cffa399"
```

Open the URL printed by `wrangler deploy` and sign in with username `admin` (or the `ADMIN_USERNAME` var in `wrangler.toml`) and the password you entered. Change the password later from the Account Settings page; changing the `ADMIN_PASSWORD` secret only affects a fresh database.

## Connect your domain

Do **not** delete the proxied `AAAA 100::` placeholder records on the apex and `www`. They keep the hostname on Cloudflare's edge and are correct for a Worker-route-only setup. The `530` is caused by having no route to the new Worker, not by those records.

Add the route **after** the new code is deployed. If you add `balasoftware.in/*` before deploying, it will still point at the old proxy Worker, which fails without a live `BACKEND_ORIGIN`. The apex route is already configured in `wrangler.toml`:

```toml
[[routes]]
pattern = "balasoftware.in/*"
zone_name = "balasoftware.in"
```

It is applied by `npx wrangler deploy`. To serve `www` as well, add a second `[[routes]]` block with `pattern = "www.balasoftware.in/*"` and deploy again. Adding routes disables the `workers.dev` subdomain unless you also set `workers_dev = true`.

Remove any old Worker route that still points at the old proxy Worker. Keep the DNS records as they are.

## Manual setup

If you prefer to run each step yourself, in this order:

```bash
npx wrangler d1 execute localvision --remote --file=cloudflare/schema.sql
npx wrangler deploy
```

Confirm the deploy output lists a D1 binding named `DB`, then add the routes described above. Set the initial password with `npx wrangler secret put ADMIN_PASSWORD` if you have not already.

## Updates

```bash
npm run deploy
```

Database migrations are additive: rerun `npx wrangler d1 execute localvision --remote --file=cloudflare/schema.sql` after pulling a newer schema.

## Local development

```bash
npx wrangler d1 execute localvision --local --file=cloudflare/schema.sql
npx wrangler dev
```

For frontend-only work, run `npm run dev`; the Vite proxy still targets a local FastAPI backend on port 8000 and is only needed for the legacy Python code in `backend/`.

## Configuration

| Setting | Where | Notes |
| --- | --- | --- |
| `ADMIN_USERNAME` | `wrangler.toml` vars | Default `admin`; used only when the users table is empty. |
| `ADMIN_PASSWORD` | Worker secret | Initial password on a fresh database. |
| `SESSION_HOURS` | `wrangler.toml` vars | Default `24`. |
| `ALLOW_GUEST_MODE` | `wrangler.toml` vars | Default `false`. |
| `ENCRYPTION_KEY`, `SECRET_KEY` | Worker secrets | Generated automatically by the setup script. |

Cookies are `HttpOnly`, `Secure` and `SameSite=Lax` on HTTPS deployments.

## Access control

All `/api` routes except health, login and guest require the `localvision_session` cookie. User management requires the `admin` role. Sessions are stored in D1 with expiry enforced per request.
