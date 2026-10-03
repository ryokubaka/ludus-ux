# Persistent data

All persistent state lives in the `data/` directory (Docker volume):

| Path | Contents |
|---|---|
| `data/ludus-ux.db` | SQLite: settings, GOAD tasks, range ownership, pending ops, instance→range mappings, `vm_operation_log` (VM/extension deletion audit) |
| `data/tasks/` | GOAD task log files |
| `data/uploads/` | Custom logo |
| `docker/nginx/certificates/` | TLS PEMs for the **nginx** edge proxy (`cert.pem`, `key.pem`); auto-generated on first nginx boot if missing |
| `SSH_KEY_PATH` (default `./ssh/`) | `PROXMOX_SSH_USER` private key **from the Ludus server** (`/root/.ssh/id_rsa` when that user is root, otherwise that user’s home, for example `/home/ludus/.ssh/id_rsa`), placed on the LUX host; mounted at **`/app/ssh`**. Writable mount so the entrypoint can `chown` for user `nextjs`. Use **`chmod 755`** on this directory on Linux. |
