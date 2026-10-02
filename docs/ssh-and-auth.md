# SSH and authentication

## Host SSH vs session

| Mechanism | What it’s for |
|---|---|
| **`PROXMOX_SSH_USER` + password or key** (`PROXMOX_SSH_KEY_PATH`, default `/app/ssh/id_rsa`) | Server-side SSH for the admin tunnel, `pvesh`, template install, `chown` under `/opt/ludus`, `chpasswd`, and API keys in `~/.bashrc`. Any account can do this. Root runs those commands directly. Any other account runs them through [lux-host](#lux-host). A normal Ludus login, with neither root nor lux-host, is not enough. **Key auth is the recommended default** on hardened Proxmox hosts. |
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

When the account is not root, privileged host commands need [lux-host](#lux-host).

## lux-host

LUX used to require `PROXMOX_SSH_USER=root` because template installs, `chown`, `pvesh`, `qm`, password changes, and `~/.bashrc` updates run as root on the Ludus host. **lux-host** is the replacement: a small root-owned program at `/usr/local/sbin/lux-host`. Passwordless sudo is granted for that path only. The program does not run a caller-supplied root shell. It accepts one named operation and checks every argument. A LUX admin whose host account is not root runs another Linux user's command through `run-as-user`: the username is an argument, and the script is on stdin. Other users run with their own SSH credentials and cannot switch accounts. The operations are listed at the top of `scripts/lux-host/lux-host`.

```
Cmnd_Alias LUX_HOST = /usr/local/sbin/lux-host
<user> ALL=(root) NOPASSWD: LUX_HOST
```

`sudo apt`, `sudo bash`, and every other command still ask for a password. LUX calls `sudo -n /usr/local/sbin/lux-host`. Root SSH does not use the helper.

Install it in any of these ways when `PROXMOX_SSH_USER` is not root:

- **Quickstart** asks whether host SSH is root or a non-root user, then copies and authorizes that account's key. A non-root user is offered lux-host after the key step. The same choice is individual action **2** (`bash scripts/quickstart.sh --menu`).
- **Settings → SSH & GOAD → Install lux-host sudo rule** writes `/usr/local/sbin/lux-host` (mode 755), `/etc/sudoers.d/lux-host` (mode 440), and `/etc/lux-host.update-key` (root, mode 0600) the first time. The dialog asks you to pick one path. **Run as root** is a single command to paste into a root shell; that paste is the whole install. **Root SSH password** is for an `sshd` that allows root login: LUX logs in as root, writes the same files plus the update key, and does not save that password. The update key is stored encrypted and is not shown. After the helper is installed with that key, LUX compares it with the copy shipped in this build and updates it on its own: as root, with passwordless `sudo`, or through the helper's `self-update` operation. `self-update` and the SSH version-switch fallback accept a script only when the HMAC-SHA256 matches that key. If the key is missing, install lux-host once from Settings with the root password. The Docker socket switch does not need the key. Later updates do not ask for the root password again.
- **By hand, from this repo:** the files are in `scripts/lux-host/`. The Settings **Run as root** command is that install in one paste. It does not write the update key. The root-password install is the one that keeps automatic updates working.

The credential test fails when the account is not root and cannot run the helper, or cannot write the Packer directory.

## Other SSH key notes

- Prefer a keypair that exists only for LUX. Generate it on the workstation (`ssh-keygen`), append the **`.pub`** line to that account’s `authorized_keys` (`/root/.ssh/authorized_keys` for root, `/home/<user>/.ssh/authorized_keys` otherwise), and mount only the private key at `./ssh/id_rsa`.
- The image has **no `ssh` CLI** — use **Settings → Test host SSH & admin API**, not `docker exec … ssh`.
- Use **OpenSSH PEM** keys (`id_rsa` / `id_ed25519`), not PuTTY **`.ppk`**.
- **CRLF** in the key file is normalized when LUX loads the key; **`dos2unix ./ssh/id_rsa`** on the host is still safe if you hit parse errors.
