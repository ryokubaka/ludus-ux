# Environment variables

All configuration is in `.env`. See [`.env.example`](../.env.example) for the full list with descriptions.

## Core settings

| Variable | Description | Default |
|---|---|---|
| `LUDUS_SSH_HOST` | Ludus server hostname or IP | — |
| `LUDUS_SSH_PORT` | SSH port | `22` |
| `LUDUS_SERVER_IP` | Optional IP when `LUDUS_SSH_HOST` is not resolvable inside the container | — |
| `LUDUS_URL` | Ludus API URL (port **8080**) | Compose default: `https://` + `LUDUS_SSH_HOST` + `:8080`; override in `.env` if needed |
| `APP_SECRET` | Session encryption key (32+ chars). Also encrypts sensitive Settings values stored in SQLite, including `proxmoxSshPassword`; changing it invalidates those encrypted values. | — |

## Docker Compose (host → container)

| Variable | Description | Default |
|---|---|---|
| `SSH_KEY_PATH` | **Host** directory where you put the root private key **copied from the Ludus server**. Mounted at **`/app/ssh`** in the container. | `./ssh` |
| `DATA_DIR` | **Host** directory for SQLite, uploads, GOAD task logs (`/app/data` in the container) | `./data` |

## Admin / user management

| Variable | Description |
|---|---|
| `LUDUS_ADMIN_URL` | Admin API base URL (port **8081**). Compose default uses `LUDUS_SSH_HOST` with `:8081` (override in `.env` if needed). Prefer `https://<ludus-host>:8081` when reachable from the container. SSH tunnel to `127.0.0.1:18081` is optional when 8081 is loopback-only; remote URLs are not overwritten by the tunnel. |
| `LUDUS_ROOT_API_KEY` | Root API key (from `/opt/ludus/install/root-api-key` on the server) |
| `PROXMOX_SSH_USER` | Root (or privileged) SSH user for server-side Proxmox/Ludus operations |
| `PROXMOX_SSH_PASSWORD` | Optional for server-side root SSH if using key auth. In-browser noVNC uses the logged-in user's PAM password from the LUX session, not the root key. |
| `PROXMOX_SSH_KEY_PATH` | Private key path **inside** the container; must match the file under `SSH_KEY_PATH` on the host (default `/app/ssh/id_rsa`) |
| `PROXMOX_SSH_KEY_PASSPHRASE` | Optional passphrase for the key |

## GOAD

| Variable | Description | Default |
|---|---|---|
| `ENABLE_GOAD` | Show GOAD in the UI (`false` to hide) | `true` |
| `GOAD_PATH` | Path to the GOAD installation on the Ludus server | `/opt/GOAD` |
| `GOAD_SSH_KEY_PATH` | Optional override for key discovery (usually same as `PROXMOX_SSH_KEY_PATH`) | — |

## TLS / HTTPS

**Docker Compose:** TLS terminates at the **`nginx`** service (`ludus-ux-web`). The host publishes **443→443** only; place **`docker/nginx/certificates/cert.pem`** and **`docker/nginx/certificates/key.pem`** on the LUX host (or let nginx generate self-signed files on first boot). The **`ludus-ux`** container listens on **plain HTTP :3000** inside the Docker network; **`DISABLE_HTTPS=true`** and **`TRUST_PROXY_TLS=true`** are the compose defaults so session cookies and HSTS still match HTTPS in the browser.

| Variable | Description |
|---|---|
| `DISABLE_HTTPS` | When `true`, Node does not terminate TLS (normal with bundled nginx). |
| `TRUST_PROXY_TLS` | When `true`, treat the deployment as HTTPS for cookies/HSTS while Node listens on HTTP (required behind nginx). |
| `TLS_HOSTNAME` | Optional CN/SAN hint when nginx auto-generates the edge certificate |
| `LUDUS_TLS_INSECURE` | When `true`, Node accepts invalid TLS certificates for outbound HTTPS/WSS to Ludus, PocketBase, and Proxmox (typical lab self-signed). Compose defaults to `true`; set `LUDUS_TLS_INSECURE=false` in `.env` for self-signed Ludus/PVE lab installs. |

**Production:** set a strong **`APP_SECRET`** (32+ random characters, not a placeholder). The app refuses to start in `NODE_ENV=production` if `APP_SECRET` is missing, too short, or matches documented example values.

**Local `npm run dev`:** use **`http://localhost:3000`**; unset or override `DISABLE_HTTPS` / `TRUST_PROXY_TLS` as needed — see [Development](development.md).

**Debug:** `docker compose -f docker-compose.yml -f docker-compose.debug.yml up -d` publishes **`127.0.0.1:3000`** to the app directly (bypass nginx).

## DNS resolution

If `LUDUS_SSH_HOST` is a hostname Docker can't resolve (e.g. only in your host's `/etc/hosts`), set `LUDUS_SERVER_IP` to the server's IP and the container will inject it into `/etc/hosts` automatically.
