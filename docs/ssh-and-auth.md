# SSH and authentication

## Root vs session

| Mechanism | What it’s for |
|---|---|
| **`PROXMOX_SSH_PASSWORD` or root key** (`PROXMOX_SSH_KEY_PATH`, default `/app/ssh/id_rsa`) | Server-side root SSH: admin tunnel to Ludus admin API, `pvesh` (SPICE, admin VM delete/power, shared pool discovery), GOAD impersonation, template install, log tail via SSH, `chpasswd`, rolling API keys in user `~/.bashrc`. **Key auth is the recommended default** on hardened Proxmox hosts. |
| **User password stored in session (login)** | Per-user GOAD, in-browser noVNC, and **fallback** for `pvesh` when root password/key is not set. noVNC uses this password with the logged-in user's `proxmoxUsername@pam` against the Proxmox HTTP API on port 8006. |

Optional: `PROXMOX_SSH_KEY_PASSPHRASE` for encrypted SSH keys.

## Console / noVNC authentication

noVNC uses the logged-in LUX user's PAM identity instead of `PROXMOX_SSH_USER`.

The browser console uses two separate Proxmox mechanisms:

- **SPICE / VNC `.vv` downloads** use `pvesh` over server-side SSH. Root key auth works here.
- **In-browser noVNC** uses the Proxmox HTTP API on `https://<LUDUS_SSH_HOST>:8006`. LUX logs in as the current LUX user's Ludus `proxmoxUsername@pam` using the password captured during LUX login, then requests the VM's VNC proxy ticket.

Green **Settings → Test root SSH & admin API** results do not prove noVNC will work. That test validates root SSH and the Ludus admin API, not the user's Proxmox PAM login on port 8006.

If noVNC fails with `Proxmox login failed (HTTP 401)`:

- Confirm the user can log in to Proxmox as `proxmoxUsername@pam` with the same password they used for LUX.
- Confirm Ludus has the expected `proxmoxUsername` for that user.
- Confirm `LUDUS_SSH_HOST` points at the Proxmox node or cluster endpoint serving port 8006.
- If an admin is using LUX impersonation, the console still uses the admin's own PAM credentials, not the impersonated user's password. That admin must have Proxmox permission to access the target VM.
- Root SSH key auth can be fully working while noVNC fails, because Proxmox's HTTP ticket endpoint does not accept SSH keys.

## Admin API URL (`LUDUS_ADMIN_URL`)

- **Typical:** `https://<same-host-as-LUDUS_URL>:8081` whenever Ludus listens for admin traffic on an address your **container** can reach (LAN IP or DNS name). `docker-compose.yml` defaults to that pattern.
- **Loopback-only 8081 on the Ludus box:** LUX can start an SSH tunnel and forward `127.0.0.1:18081` → the server’s `127.0.0.1:8081`. That requires working **root SSH** at container startup. If you set `LUDUS_ADMIN_URL` to a **non-localhost** host name, LUX **does not** overwrite it with the tunnel URL.
- **Settings → Admin API URL** is persisted in SQLite and overrides the value from the environment until you change it again.

## Root private key copied from the Ludus server

Copying **`id_rsa` off the box** is only half of SSH key authentication:

- **LUX (client)** needs the **private** key file (`id_rsa`).
- **sshd on the Ludus server** needs the matching **public** key in **`/root/.ssh/authorized_keys`**.

`/root/.ssh/id_rsa` on the server is often used for **outgoing** SSH (e.g. git) and its public half is **not** automatically trusted for **incoming** root logins. If that line is missing, you will see “All configured authentication methods failed” even though the key file is correct.

**One-time fix on the Ludus server (as root)** — append this keypair’s **public** line to `authorized_keys`:

```bash
mkdir -p /root/.ssh
chmod 700 /root/.ssh
if [ -f /root/.ssh/id_rsa.pub ]; then
  cat /root/.ssh/id_rsa.pub >> /root/.ssh/authorized_keys
else
  ssh-keygen -y -f /root/.ssh/id_rsa >> /root/.ssh/authorized_keys
fi
chmod 600 /root/.ssh/authorized_keys
```

Then restart LUX’s container and run **Settings → Test root SSH & admin API**.

**Alternative (cleaner):** generate a **new** keypair only for LUX on your workstation (`ssh-keygen`), put the **`.pub`** line in `/root/.ssh/authorized_keys` on the server, and mount only that **private** key in `./ssh/id_rsa`.

## Other SSH key notes

- The image has **no `ssh` CLI** — use **Settings → Test root SSH & admin API**, not `docker exec … ssh`.
- Use **OpenSSH PEM** keys (`id_rsa` / `id_ed25519`), not PuTTY **`.ppk`**.
- **CRLF** in the key file is normalized when LUX loads the key; **`dos2unix ./ssh/id_rsa`** on the host is still safe if you hit parse errors.
