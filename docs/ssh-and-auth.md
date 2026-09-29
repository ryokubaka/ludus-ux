# SSH and authentication

## Host SSH vs session

| Mechanism | What it’s for |
|---|---|
| **`PROXMOX_SSH_USER` + password or key** (`PROXMOX_SSH_KEY_PATH`, default `/app/ssh/id_rsa`) | Server-side SSH for admin tunnel, `pvesh`, template install, `chown` under `/opt/ludus`, `chpasswd`, and API keys in `~/.bashrc`. The account is **root**, or another user allowed to run **`sudo -n /usr/local/sbin/lux-host`**. That helper is the only passwordless command. A normal Ludus login with neither is not enough. **Key auth is the recommended default** on hardened Proxmox hosts. |
| **User password stored in session (login)** | Per-user GOAD, in-browser noVNC, and **fallback** for `pvesh` when that host password or key is not set. noVNC uses this password with the logged-in user's `proxmoxUsername@pam` against the Proxmox HTTP API on port 8006. |

Optional: `PROXMOX_SSH_KEY_PASSPHRASE` for encrypted SSH keys.

## Console / noVNC authentication

noVNC uses the logged-in LUX user's PAM identity instead of `PROXMOX_SSH_USER`.

The browser console uses two separate Proxmox mechanisms:

- **SPICE / VNC `.vv` downloads** use `pvesh` over server-side SSH. Host SSH key auth works here.
- **In-browser noVNC** uses the Proxmox HTTP API on `https://<LUDUS_SSH_HOST>:8006`. LUX logs in as the current LUX user's Ludus `proxmoxUsername@pam` using the password captured during LUX login, then requests the VM's VNC proxy ticket.

Green **Settings → Test host SSH & admin API** results do not prove noVNC will work. That test validates host SSH and the Ludus admin API, not the user's Proxmox PAM login on port 8006.

If noVNC fails with `Proxmox login failed (HTTP 401)`:

- Confirm the user can log in to Proxmox as `proxmoxUsername@pam` with the same password they used for LUX.
- Confirm Ludus has the expected `proxmoxUsername` for that user.
- Confirm `LUDUS_SSH_HOST` points at the Proxmox node or cluster endpoint serving port 8006.
- If an admin is using LUX impersonation, the console still uses the admin's own PAM credentials, not the impersonated user's password. That admin must have Proxmox permission to access the target VM.
- Host SSH key auth can be fully working while noVNC fails, because Proxmox's HTTP ticket endpoint does not accept SSH keys.

## Admin API URL (`LUDUS_ADMIN_URL`)

- **Typical:** `https://<same-host-as-LUDUS_URL>:8081` whenever Ludus listens for admin traffic on an address your **container** can reach (LAN IP or DNS name). `docker-compose.yml` defaults to that pattern.
- **Loopback-only 8081 on the Ludus box:** LUX can start an SSH tunnel and forward `127.0.0.1:18081` → the server’s `127.0.0.1:8081`. That requires working **host SSH** (`PROXMOX_SSH_USER`) at container startup. The tunnel itself does not need root. If you set `LUDUS_ADMIN_URL` to a **non-localhost** host name, LUX **does not** overwrite it with the tunnel URL.
- **Settings → Admin API URL** is persisted in SQLite and overrides the value from the environment until you change it again.

## Host private key for `PROXMOX_SSH_USER`

Copying that account’s private key off the Ludus server is only half of SSH key authentication:

- **LUX (client)** needs the **private** key file (`id_rsa`), placed at `./ssh/id_rsa`.
- **sshd on the Ludus server** needs the matching **public** key in **that account’s** `authorized_keys`.

| `PROXMOX_SSH_USER` | Private key on the server | `authorized_keys` |
|---|---|---|
| `root` | `/root/.ssh/id_rsa` | `/root/.ssh/authorized_keys` |
| not root (example `ludus`) | `/home/ludus/.ssh/id_rsa` | `/home/ludus/.ssh/authorized_keys` |

That private key is often used for **outgoing** SSH (for example git). Its public half is **not** automatically trusted for **incoming** logins as the same account. If that line is missing, you will see “All configured authentication methods failed” even though the key file is correct.

**One-time fix on the Ludus server** — run as `PROXMOX_SSH_USER` and append this keypair’s **public** line. When the account is root, `$HOME` is `/root` and the file is `/root/.ssh/authorized_keys`. When it is not, `$HOME` is that user’s home (`/home/ludus/.ssh/authorized_keys` for user `ludus`):

```bash
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
if [ -f "$HOME/.ssh/id_rsa.pub" ]; then
  cat "$HOME/.ssh/id_rsa.pub" >> "$HOME/.ssh/authorized_keys"
else
  ssh-keygen -y -f "$HOME/.ssh/id_rsa" >> "$HOME/.ssh/authorized_keys"
fi
chmod 600 "$HOME/.ssh/authorized_keys"
```

Then restart LUX’s container and run **Settings → Test host SSH & admin API**.

When the account is not root, privileged host commands need `sudo -n /usr/local/sbin/lux-host` (the scoped rule in the next section, not `NOPASSWD: ALL`).

## Non-root host SSH

`scripts/quickstart.sh` asks before it installs anything when `PROXMOX_SSH_USER` is not root. Answering yes writes:

- `/usr/local/sbin/lux-host` (root-owned, mode 755)
- `/etc/sudoers.d/lux-host`

The sudoers rule is only:

```
Cmnd_Alias LUX_HOST = /usr/local/sbin/lux-host
<user> ALL=(root) NOPASSWD: LUX_HOST
```

It does **not** grant `NOPASSWD: ALL`. `sudo apt`, `sudo bash`, and other commands still ask for a password. LUX calls `sudo -n /usr/local/sbin/lux-host` for template directories, `chown`, `pvesh`, `qm`, `chpasswd`, and `~/.bashrc` updates. The same prompt is menu item **5** (`bash scripts/quickstart.sh --menu`). Settings → SSH & GOAD can install the same two files (**Install lux-host sudo rule**). Leave the root password blank when this account can already run `sudo -n /usr/local/sbin/lux-host`. Key auth can install or refresh the helper with no password; `sudo -n true` and `sudo -n bash` are not required. A password login that cannot yet run the helper uses the SSH password once as the sudo password. If the account is not in sudoers, enter the Ludus host root password. That password is used once to SSH as root and is not saved.

The templates live in `scripts/lux-host/`. To install by hand, replace `__LUX_SSH_USER__` in `sudoers.in`, check it with `visudo -cf`, and install both files as root (`lux-host` mode 755, sudoers mode 440).

**Alternative (cleaner):** generate a **new** keypair only for LUX on your workstation (`ssh-keygen`), append the **`.pub`** line to that account’s `authorized_keys` (`/root/.ssh/authorized_keys` when `PROXMOX_SSH_USER` is root, or `/home/<user>/.ssh/authorized_keys` when it is not), and mount only that **private** key in `./ssh/id_rsa`.

## Other SSH key notes

- The image has **no `ssh` CLI** — use **Settings → Test host SSH & admin API**, not `docker exec … ssh`.
- Use **OpenSSH PEM** keys (`id_rsa` / `id_ed25519`), not PuTTY **`.ppk`**.
- **CRLF** in the key file is normalized when LUX loads the key; **`dos2unix ./ssh/id_rsa`** on the host is still safe if you hit parse errors.
