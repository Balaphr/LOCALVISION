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

## Ubuntu LAN deployment (no system-service or Nginx changes)

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
