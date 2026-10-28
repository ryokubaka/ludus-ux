# Persistent data

All persistent state lives in the `data/` directory (Docker volume):

| Path | Contents |
|---|---|
| `data/ludus-ux.db` | SQLite: settings, GOAD tasks, range ownership, pending ops, instance→range mappings, `vm_operation_log` (VM/extension deletion audit) |
| `data/tasks/` | GOAD task log files |
| `data/uploads/` | Custom logo |
| `docker/nginx/certificates/` | TLS PEMs for the **nginx** edge proxy (`cert.pem`, `key.pem`); auto-generated on first nginx boot if missing |
| `SSH_KEY_PATH` (default `./ssh/`) | `PROXMOX_SSH_USER` private key **from the Ludus server** (`/root/.ssh/id_rsa` when that user is root, otherwise that user’s home, for example `/home/ludus/.ssh/id_rsa`), placed on the LUX host; mounted **read-only** at **`/app/ssh`**. The container does not change ownership of these files. The runtime user is `LUX_UID` / `LUX_GID` in `.env`, default **64532**. When that user cannot read a key, for example a key still owned by uid 1001 from before 1.5.0, the entrypoint (as root) copies it to `/run/lux-ssh`, a tmpfs mounted by Compose, owned by that user with mode 600. The copy lives only in memory and is made again on each container start, so restart the container after replacing the key. It cannot help when root in the container cannot read the key either: rootless Docker, a `userns-remap`, or an NFS mount with `root_squash`. Then the entrypoint logs a warning and the key has to be readable by that uid. On the host, `getent passwd` should not list that uid before you `chown` the key to it. A user namespace remap (`userns-remap`) keeps that uid from matching a host account. To choose another pair, set `LUX_UID` and `LUX_GID` in `.env` and rebuild (`docker compose up -d --build`). Do not set Compose `user:`, because the entrypoint still starts as root so it can write `/etc/hosts`. |
