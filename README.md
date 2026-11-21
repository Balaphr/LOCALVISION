# LocalVision

Phase 1 foundation for a self-hosted, vendor-neutral AI CCTV platform. This directory is intentionally isolated from any existing recorder or AI service.

## Development

Backend (PowerShell):

```powershell
cd localvision/backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY = "set-a-development-secret"
$env:ENCRYPTION_KEY = "set-a-development-encryption-secret"
uvicorn app.main:app --reload --port 8000
```

Frontend:

```powershell
cd localvision/frontend
npm install
npm run dev
```

Run backend tests with `pytest` from `localvision/backend`. SQLite is used by default for development; production PostgreSQL is configured through `DATABASE_URL`. ONVIF discovery is a safe no-op foundation in Phase 1 and does not automatically save devices.

## Always-on cloud VPS + Cloudflare (recommended)

Use this when the site must stay online after your PC or office machine shuts down. The full application (frontend and API) runs on a cloud VM and is published through a Cloudflare Tunnel. There is no local server, no port forwarding, no public-IP firewall rule, and no TLS certificate to manage. Cloudflare error `530` means the origin was unreachable; this setup keeps the origin online 24/7.

### 1. Create the tunnel in Cloudflare

1. In the Cloudflare Zero Trust dashboard, open **Networks → Tunnels → Create a tunnel** and choose **Cloudflared**.
2. Name it `localvision` and copy the tunnel token.
3. Add a **Public Hostname**: subdomain `localvision`, your domain, service `HTTP`, URL `127.0.0.1:8000`.
4. Save. Use that hostname below as `LOCALVISION_APP_DOMAIN`.

If an old proxied DNS record or Worker route still points at the dead local machine, remove it. Requests must reach the tunnel hostname, otherwise the `530` will remain.

### 2. Prepare the VPS

Use an Ubuntu 22.04/24.04 VM with at least 2 GB RAM. Push these changes to GitHub first, then on the VM:

```bash
git clone https://github.com/Balaphr/LOCALVISION.git /tmp/localvision-source
cd /tmp/localvision-source
```

### 3. Deploy

```bash
export LOCALVISION_APP_DOMAIN=localvision.example.com
export TUNNEL_TOKEN="paste-the-tunnel-token-here"
sudo --preserve-env=LOCALVISION_APP_DOMAIN,TUNNEL_TOKEN bash scripts/deploy-vps.sh
```

The script installs Python/Node/ffmpeg, creates the `localvision` system user, writes `/opt/localvision/backend/.env` with random secrets and a random admin password (printed once), builds the frontend, applies database migrations, installs and starts the `localvision-api` and `localvision-cloudflared` systemd services, and verifies `/api/health`. Everything is enabled on boot and restarts automatically. `ADMIN_PASSWORD` is only used on the first deployment; change it later from the Users page.

Open `https://localvision.example.com` and sign in with the printed credentials. Cookies are HTTPS-only (`COOKIE_SECURE=true`) and CORS is restricted to your hostname.

Useful commands:

```bash
systemctl status localvision-api localvision-cloudflared
journalctl -u localvision-api -f
```

To update, pull the changes on the VM and rerun the same deploy command. It preserves the database, storage, and existing environment file.

Data lives in `/opt/localvision/backend/localvision.db` and `/opt/localvision/backend/storage`. Redeploying preserves the database, storage, and `.env`.

### 4. If you keep the Cloudflare Worker/Pages deployment

The tunnel origin can also serve only the API. Add a second public hostname such as `origin.example.com` pointing to `HTTP` / `127.0.0.1:8000`, then set the Worker variable:

```bash
npx wrangler secret put BACKEND_ORIGIN
```

Enter `https://origin.example.com`. Keep that hostname outside the Worker's route so requests do not loop. The Worker serves the frontend and proxies `/api` to the VPS. For Pages, set `BACKEND_ORIGIN` in the Pages project settings instead.

## Ubuntu LAN deployment (legacy, depends on a local machine)

This deployment runs the API and built frontend together in one foreground Uvicorn process. It does not install a systemd unit, alter Nginx, stop another application, or install OS packages. All deployment state (virtual environment, Node modules/cache, database, recordings/storage, and backend `.env`) is kept under:

```text
/media/manoranjitham/Admin2/LocalVision
```

The `Admin2` path must already be mounted. The deploy script aborts rather than creating files on the wrong filesystem. It also checks that the target port is free before starting; it will not stop an existing listener.

### Prerequisites

Install or otherwise provide these on Ubuntu before running the script; the script itself does not use `sudo` or modify system packages:

- Python 3.11 or newer, with `venv` support
- Node.js 20.19+ or 22.12+, plus npm (required by the checked-in Vite lockfile)
- `openssl`, `tar`, `mountpoint`, and `ss`
- `ffmpeg` for camera media/recording features
- Network access to the configured Python and npm package registries during the first install

### Deploy and start

The Windows workspace provides `LocalVision-Ubuntu-Port8082.zip`, a source package with deployment scripts and this procedure but without `.env` files, databases, storage, virtual environments, Node modules, or build caches. Transfer the zip to Ubuntu using your existing local/VMware file-transfer method. Extract it directly into the target project directory, then run:

```bash
mkdir -p /media/manoranjitham/Admin2/LocalVision
cd /media/manoranjitham/Admin2/LocalVision
unzip -o LocalVision-Ubuntu-Port8082.zip
bash scripts/deploy-ubuntu.sh
bash scripts/run-ubuntu.sh
```

On the first deployment, the script creates `backend/.env` with random application secrets and a random initial admin password. It prints the admin password once to that Ubuntu terminal; save it securely. The file is created with owner-only permissions and is never copied from the source checkout. Subsequent deployments preserve the existing `.env`, database, and storage. To change deployment settings, edit only `backend/.env` inside the deployment folder.

The LAN deployment uses HTTP on `192.168.1.25:8082`, leaving BalaSoftware on port 8081 untouched. `COOKIE_SECURE=false` is required for browser sign-in over HTTP. **HTTP sends passwords and session cookies without transport encryption. Use this only on a trusted private LAN; do not port-forward or expose this port to the internet.** For HTTPS through an already-configured trusted terminator, set `COOKIE_SECURE=true` in the project-local `.env`; these scripts do not configure TLS or a proxy.

Open `http://192.168.1.25:8082`. The API health check is `http://192.168.1.25:8082/api/health`. Keep the terminal running; press `Ctrl+C` to stop only this LocalVision process. No firewall, service-manager, or Nginx rules are changed by these scripts.
