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
| `SSH_KEY_PATH` | **Host** directory for the `PROXMOX_SSH_USER` private key copied from the Ludus server. Mounted **read-only** at **`/app/ssh`**. A key `LUX_UID` cannot read is copied at start to an in-memory `/run/lux-ssh`, see [Persistent data](persistent-data.md). Who that account is: [SSH and authentication](ssh-and-auth.md). | `./ssh` |
| `LUX_UID` | Image user id. Passed into the Dockerfile as a build arg. Use a uid that `getent passwd` does not list on this host. A change applies on the next `docker compose up -d --build`. | `64532` |
| `LUX_GID` | Image group id. Passed into the Dockerfile as a build arg, same rebuild rule as `LUX_UID`. | `64532` |
| `DATA_DIR` | **Host** directory for SQLite, uploads, GOAD task logs (`/app/data` in the container) | `./data` |
| `LUX_REPO_PATH` | Optional override for the host git clone used by Settings → About. LUX auto-detects the Compose project directory and the host path of the `./data` → `/app/data` bind mount when the Docker socket is mounted. | unset |
| `GITHUB_TOKEN` / `LUX_GITHUB_TOKEN` | Optional GitHub PAT. Used only when this clone's remote is GitHub, to attach release notes. The version list itself comes from `git ls-remote` on that remote. | unset |

## Admin / user management

| Variable | Description |
|---|---|
| `LUDUS_ADMIN_URL` | Admin API base URL. Compose defaults to `https://` + `LUDUS_SSH_HOST` + `:8081`. A default Ludus install binds 8081 to 127.0.0.1, so that address is refused from the container. Set this to `https://127.0.0.1:18081` to use the SSH tunnel LUX opens at startup (`127.0.0.1:18081` → the server's `127.0.0.1:8081`). Host SSH must work. Use `https://<ludus-host>:8081` only after the server listens on that address. A non-localhost URL is not replaced by the tunnel. |
| `LUDUS_ROOT_API_KEY` | Root API key (from `<LUDUS_INSTALL_PATH>/install/root-api-key` on the server) |
| `PROXMOX_SSH_USER` | SSH account for server-side host commands. Root, or any other user who can run `sudo -n /usr/local/sbin/lux-host`. That helper is the only passwordless sudo command. Quickstart or Settings → Auth can install it. Not the LUX login user unless that account can elevate. See [lux-host](ssh-and-auth.md#lux-host). |
| `PROXMOX_SSH_PASSWORD` | Optional for server-side host SSH if using key auth. In-browser noVNC and SPICE / VNC `.vv` downloads use the logged-in user's PAM password from the LUX session, not this key. |
| `PROXMOX_SSH_KEY_PATH` | Private key path **inside** the container; must match the file under `SSH_KEY_PATH` on the host (default `/app/ssh/id_rsa`) |
| `PROXMOX_SSH_KEY_PASSPHRASE` | Optional passphrase for the key |

## GOAD

| Variable | Description | Default |
|---|---|---|
| `ENABLE_GOAD` | Show GOAD in the UI (`false` to hide) | `true` |
| `GOAD_PATH` | Path to the GOAD installation on the Ludus server | `/opt/GOAD` |
| `LUDUS_INSTALL_PATH` | Ludus install root on the Ludus server (ranges, packer, user Ansible collections) | `/opt/ludus` |
| `LUDUS_ANSIBLE_VERBOSE` | Pass Ludus `--verbose-ansible` / API `verbose` on range deploy (`false` to default off). Also toggleable in Settings. Stock Ludus ≤2.2.3 may ignore this when `force` is set (upstream bug: server passes `force` as Ansible verbosity). Settings UI hides that warning when the connected server reports ≥2.2.4. | `true` |
| `LUX_USE_LUDUS_HOST_DNS` | Before a deploy, rewrite `AdGuardHome.yaml.j2` so upstream and bootstrap DNS are `192.0.2.254` (`true` to enable). Also toggleable in Settings. A Ludus update extracts a fresh template; the next deploy puts the host resolver back. | `false` |
| `GOAD_SSH_KEY_PATH` | Optional override for key discovery (usually same as `PROXMOX_SSH_KEY_PATH`) | — |

## LudusHound

| Variable | Description | Default |
|---|---|---|
| `ENABLE_LUDUSHOUND` | Show LudusHound in the UI (`false` to hide) | `true` |
| `SOURCE_AUTO_SYNC_ENABLED` | Periodically re-pull registered git Ludus sources (`false` to disable). Also syncs a source when its catalog is opened and last sync is older than the interval. | `true` |
| `SOURCE_AUTO_SYNC_INTERVAL_MS` | Auto-sync interval / staleness threshold in milliseconds (minimum `60000`) | `300000` (5 min) |
| `LUDUSHOUND_PATH` | Path to the cloned [LudusHound](https://github.com/bagelByt3s/LudusHound) repo on the Ludus server | `/opt/LudusHound` |

Operator clones the repo on the Ludus host (or use LUX Clone); LUX installs Go when missing, builds the binary, and installs the local Ansible collection tarball. SSH uses the same `LUDUS_SSH_*` settings as GOAD.

## TLS / HTTPS

**Docker Compose:** TLS terminates at the **`nginx`** service (`ludus-ux-web`). The host publishes **443→443** only; place **`docker/nginx/certificates/cert.pem`** and **`docker/nginx/certificates/key.pem`** on the LUX host (or let nginx generate self-signed files on first boot). The **`ludus-ux`** container listens on **plain HTTP :3000** inside the Docker network; **`DISABLE_HTTPS=true`** and **`TRUST_PROXY_TLS=true`** are the compose defaults so session cookies and HSTS still match HTTPS in the browser.

| Variable | Description |
|---|---|
| `DISABLE_HTTPS` | When `true`, Node does not terminate TLS (normal with bundled nginx). |
| `TRUST_PROXY_TLS` | When `true`, treat the deployment as HTTPS for cookies/HSTS while Node listens on HTTP (required behind nginx). |
| `TLS_HOSTNAME` | Optional CN/SAN hint when nginx auto-generates the edge certificate |
| `LUDUS_TLS_INSECURE` | When `true`, HTTPS and WSS to Ludus, PocketBase, and Proxmox skip certificate checks. Other HTTPS stays verified. When the key is missing from `.env`, certificates are verified. Before 1.5.0 a missing key meant `true`, so an upgraded `.env` written by an older quickstart needs `LUDUS_TLS_INSECURE=true` added for Ludus's default self-signed certificate; login says so when the check fails. Or mount the CA with `NODE_EXTRA_CA_CERTS`. |
| `LUX_SSH_HOST_KEY` | Optional pin for the Ludus SSH host key. Accepts the fingerprint exactly as `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` prints it (`SHA256:...`, trailing `=` optional), a public key line (`ssh-ed25519 AAAA... [comment]`), or a `known_hosts` line. A value that is none of those refuses every connection. When unset, the first key seen for that host and port is stored in SQLite and a different key is rejected; an admin can forget a stored key in **Settings → Auth**. |
| `LUX_UPGRADE_TRUSTED_KEY` | Absolute path on the Docker host to a public key file. When set, an in-app upgrade verifies the tag in a keyring that contains only that key and refuses anything else, including a key already in the host keyring. A value that is not a file is an error. |
| `LUX_UPGRADE_TRUSTED_FPR` | Optional primary-key fingerprint (40 or 64 hex digits). The tag's signature must match it. A signing subkey still matches its primary key. |

**Production:** set a strong **`APP_SECRET`** (32+ random characters, not a placeholder). The app refuses to start in `NODE_ENV=production` if `APP_SECRET` is missing, too short, or matches documented example values.

**Local `npm run dev`:** use **`http://localhost:3000`**; unset or override `DISABLE_HTTPS` / `TRUST_PROXY_TLS` as needed — see [Development](development.md).

**Debug:** `docker compose -f docker-compose.yml -f docker-compose.debug.yml up -d` publishes **`127.0.0.1:3000`** to the app directly (bypass nginx).

## DNS resolution

If `LUDUS_SSH_HOST` is a hostname, set `LUDUS_SERVER_IP` to the server's IP. On start the container pins that name in `/etc/hosts`, including when DNS answers at startup and later returns `EAI_AGAIN`. Rebuild and recreate the app container after changing the entrypoint or this value.
