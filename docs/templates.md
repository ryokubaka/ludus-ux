# Templates

LUX **Templates** page wraps Ludus Packer template operations: list installed templates, build or abort builds, install templates from GitLab, and review logs. Builds run on the Ludus host against Proxmox — not in your browser.

See also [Ludus upstream template docs](https://docs.ludus.cloud/docs/using-ludus/templates) for Packer file conventions and custom template authoring.

---

## What a template is

A **template** is a Proxmox VM image built from an ISO via [Packer](https://www.packer.io/). Ludus stores Packer definitions under:

- Built-in: `/opt/ludus/packer/<name>/`
- User-added: `/opt/ludus/users/<username>/packer/<name>/`

After a successful build, the VM is converted to a template in the **`SHARED`** pool so all Ludus users can deploy from it. Range configs reference templates by name (for example `win2025-server-x64-tpm-template`).

Templates are intentionally minimal (SSH/WinRM, Python/PowerShell, default `localuser:password`) so Ludus Ansible can customize VMs on each deploy.

---

## How the Templates page works

### Template list

On load, LUX calls Ludus `GET /templates` and shows each template’s name, OS type, and **Built** / **Not Built** status.

- **Built** — Packer finished at least once; Proxmox has a usable template in `SHARED`.
- **Not Built** — Definition exists but no successful build yet (common right after **Add from Source**).

Use the **all / built / unbuilt** filter and row checkboxes to select what to build.

### Build

**Build Selected** or the per-row play button calls Ludus `POST /templates` with body `{ "templates": ["<name>", ...] }`.

What happens on the Ludus server:

1. Ludus runs Packer as the **logged-in Ludus user** (respecting admin impersonation scope in LUX).
2. Packer authenticates to Proxmox with that user’s **`ludus-token` API token** (`user@pam!ludus-token`, privilege separation off — token inherits the user’s group ACLs).
3. Packer reads `/opt/ludus/config.yml` for `proxmox_node`, VM/ISO storage pools, and NAT bridge.
4. Many templates (including Windows TPM builds) set `iso_download_pve = true`, so Proxmox downloads boot ISOs via its **`download-url` API** on the configured node — not via your PC browser.
5. Packer creates a temporary VM, installs the OS, runs provisioners (Ansible, PowerShell, etc.), then converts the result to a template in `SHARED`.

While a build runs:

- **Packer Build Logs** polls Ludus `GET /templates/logs` every few seconds.
- **Abort** calls Ludus abort endpoint and stops the Packer process.
- Navigating away and back resumes log streaming if a build is still active.

Logs are written under `/opt/ludus/users/<username>/packer/` on the Ludus host.

### Build history

**Build History** reads Ludus `/templates/logs/history`. Ludus stores template builds and range deploys in the same history table; LUX defaults to rows whose `template` field matches a known template name. Use **Show all log runs** to include range deploy entries.

### Add from Source

The collapsible **Add Templates from Source** panel installs template directories that are not bundled with Ludus:

1. **Fetch Available Templates** — LUX calls `GET /api/templates/sources`, which lists directories under [badsectorlabs/ludus `templates/`](https://gitlab.com/badsectorlabs/ludus/-/tree/main/templates) (or a custom git repo you configure).
2. **Add Selected** — LUX calls `POST /api/templates/add`, which SSHs to the Ludus host, downloads the repo tree, places files under the server templates directory, runs `ludus templates add -d …`, and registers the template in Ludus.

After a successful add, the template appears as **Not Built** until you run **Build**.

### Delete

The trash icon removes a template via LUX `DELETE /api/templates/delete`:

1. Ludus API `DELETE /template/{name}` (clears built Proxmox VM when possible)
2. `ludus templates rm -n …` over root SSH (unregisters when API soft-refuses)
3. Disk cleanup of `/opt/ludus/packer/<aliases>`, `/opt/ludus/users/*/packer/<aliases>`, and `/opt/ludus/sources/*/templates/<aliases>`

Dir aliases include list name, name without `-template`, and without `-x64`/`-amd64` (e.g. `securityonion-2.4-x64-template` → also `securityonion-2.4`). Ludus alone often returns HTTP 200 for shared-packer installs but refuses the folder (“included template”) — LUX treats that as needing CLI + disk cleanup, not success.

---

## Proxmox permissions template builds need

Packer uses the **user’s** Proxmox token, not root. Ludus install creates:

| Custom role | Privileges |
|-------------|------------|
| `DatastoreUser` | `Datastore.AllocateSpace`, `Datastore.AllocateTemplate`, `Datastore.Audit` |
| `AccessNetwork` | `Sys.AccessNetwork` |

Typical group ACLs (from Ludus install):

| Group | Path | Role |
|-------|------|------|
| `ludus_users` | `/storage/<iso_pool>` | `DatastoreUser` |
| `ludus_users` | `/nodes/<node>` | `AccessNetwork` |
| `ludus_admins` | `/storage/<iso_pool>` | `PVEDatastoreAdmin` |

Templates with `iso_download_pve = true` need **both**:

- `Datastore.AllocateTemplate` on the ISO storage pool
- `Sys.AccessNetwork` on the **same node name** as `proxmox_node` in `/opt/ludus/config.yml`

That pair is enforced by Proxmox’s `download-url` API ([Proxmox PVE #5254](https://bugzilla.proxmox.com/show_bug.cgi?id=5254)).

Ludus grants `AccessNetwork` to **`ludus_users`** at install. Users in **`ludus_admins`** should also be in **`ludus_users`** (normal for Ludus-created accounts). Promoting someone to admin in Proxmox with `pveum user modify … --groups ludus_admins` **without `--append`** can drop `ludus_users` and break ISO download.

---

## Troubleshooting

### `403 Permission check failed` when downloading an ISO (Packer / Ludus template build)

**Symptoms** — Build fails in milliseconds with log lines like:

```text
beginning download of https://…microsoft.com/…iso to node ludus
failed to download iso from https://…: 403 Permission check failed
```

The ISO URL often works in a desktop browser. That is expected: the browser downloads from your PC; Packer asks **Proxmox** to download via API using **your Ludus user’s token**.

**Cause** — Proxmox rejected the `download-url` call before any HTTP download started. Common reasons:

1. **`AccessNetwork` ACL on the wrong node path** — ACL on `/nodes/127.0.0.1` (or another stale hostname) while `proxmox_node` in `/opt/ludus/config.yml` is `ludus`.
2. **User not in `ludus_users`** — no `Sys.AccessNetwork` or `Datastore.AllocateTemplate` via group ACLs.
3. **ISO storage ACL missing** — `proxmox_iso_storage_pool` changed in config but group ACLs were not updated (see [Ludus Proxmox deployment docs](https://docs.ludus.cloud/docs/deployment-options/proxmox)).

**Diagnose** (on the Proxmox/Ludus host as root):

```bash
# Node name Packer uses
grep proxmox_node /opt/ludus/config.yml
hostname

# AccessNetwork must be on /nodes/<proxmox_node>, not an old IP/hostname
pveum acl list --output-format json | jq '.[] | select(.roleid=="AccessNetwork")'

# User groups (Ludus users should include ludus_users; admins usually both)
pveum user list --output-format json | jq '.[] | select(.userid=="YOURUSER@pam")'

# Effective token permissions (quote the token id — bash expands !)
pveum user permissions 'YOURUSER@pam!ludus-token'
```

Look for `Sys.AccessNetwork` on `/nodes/ludus` (matching `proxmox_node`) and `Datastore.AllocateTemplate` on your ISO storage path.

**Fix** — Move `AccessNetwork` to the correct node and grant it to both Ludus groups:

```bash
NODE=ludus   # must match proxmox_node in /opt/ludus/config.yml

# Remove stale ACL if install/migrate ran when hostname was 127.0.0.1
pveum acl delete /nodes/127.0.0.1 -group ludus_users -role AccessNetwork 2>/dev/null || true

# Grant on the correct node
pveum acl modify /nodes/${NODE} -group ludus_users -role AccessNetwork
pveum acl modify /nodes/${NODE} -group ludus_admins -role AccessNetwork
```

Ensure the building user is in the right groups:

```bash
pveum user modify YOURUSER@pam --groups ludus_users --append
pveum user modify YOURUSER@pam --groups ludus_admins --append   # if admin
```

If you changed ISO storage in `/opt/ludus/config.yml`:

```bash
ISO_POOL=$(grep proxmox_iso_storage_pool /opt/ludus/config.yml | awk '{print $2}')
pveum acl modify /storage/${ISO_POOL} -group ludus_users -role DatastoreUser
pveum acl modify /storage/${ISO_POOL} -group ludus_admins -role PVEDatastoreAdmin
```

Re-run the build from LUX or `ludus templates build -n <template-name>`.

**Workarounds** if you cannot fix ACLs immediately:

- Set `iso_download_pve = false` in the template’s `.pkr.hcl` so Packer downloads to cache and uploads (different permission path).
- Manually upload the ISO to Proxmox ISO storage and point the template at `local:iso/….iso` instead of a Microsoft URL.

See [Ludus template troubleshooting](https://docs.ludus.cloud/docs/troubleshooting/templates) for pre-downloaded ISO and `iso_download_pve` details.

### Build fails after “Retrieving additional ISO” / `permission denied` on cache dir

Packer could not create a cache subdirectory under `/opt/ludus/users/<username>/packer/`. Fix ownership:

```bash
chown -R ludus:ludus /opt/ludus/users/<username>/packer
```

If you copied template directories in as root, `chown -R ludus:ludus` the template folder as well.

### GOAD / range deploy fails: `Cannot write to ControlPath …/.ansible/cp`

Ludus **server-side** range deploy runs `ansible-playbook` as the **`ludus`** Linux user (`ANSIBLE_HOME` and `ANSIBLE_SSH_CONTROL_PATH_DIR` point at `/opt/ludus/users/<username>/.ansible` — see [Ludus roles docs](https://docs.ludus.cloud/docs/roles) and [GET/POST `/ansible`](https://api-docs.ludus.cloud/retrieve-available-ansible-roles-and-collections-24251967e0)). SSH ControlPath lives at `…/.ansible/cp`, which must be writable by **`ludus`**, not the range owner.

**Right after a Galaxy install via the Ludus API, `ludus:ludus` ownership is normal (transient).** Ludus runs `ansible-galaxy` as the service user, then may attempt a recursive chown to the range owner — that can fail or leave a mixed tree. LUX normalizes to the **split layout** below on every install and before GOAD / range deploy.

| Path | Steady-state owner | Mode |
|------|-------------------|------|
| `cp/`, `tmp/` | **`ludus:ludus`** | `700` |
| `roles/`, `collections/`, `galaxy_cache/` | **`<username>:ludus`** | `770` |
| `.ansible/` directory | **`<username>:ludus`** | `770` |

GOAD **user-context** ansible uses **`~/.goad/ansible-cp`** instead (not `~/.ansible/cp`).

Adding the range owner to the Linux **`ludus` group does not fix ControlPath** — the server process runs as user **`ludus`**, not as the range owner. Do **not** run `chown -R <username>:<username> .ansible` — that breaks deploy.

**Diagnose** (on the Ludus host):

```bash
getent passwd <username>
ls -la /opt/ludus/users/<username>/.ansible/cp
# Should be: drwx------ ludus ludus
sudo -u ludus test -w /opt/ludus/users/<username>/.ansible/cp && echo OK || echo FAIL
```

**Fix manually:**

```bash
sudo mkdir -p /opt/ludus/users/<username>/.ansible/{cp,tmp}
sudo chown ludus:ludus /opt/ludus/users/<username>/.ansible/cp /opt/ludus/users/<username>/.ansible/tmp
sudo chmod 700 /opt/ludus/users/<username>/.ansible/cp /opt/ludus/users/<username>/.ansible/tmp
sudo chown -R <username>:ludus /opt/ludus/users/<username>/.ansible/{roles,collections,galaxy_cache} 2>/dev/null || true
```

When LUX has root SSH configured, it runs this repair after Ludus API ansible installs (roles, collections, blueprints, subscription roles), on user provisioning, and before GOAD / range deploy.

### Add from Source succeeds but template missing from the build list

**Symptoms:** Toast says the template was added; **Add from Source** shows it as installed, but the main template table never lists it (and `ludus templates list` on the Ludus host does not either).

**Common causes:**

1. **List filter** — New templates are **Not Built**. Use the **all** or **added** filter on the Templates page (not **built** only).
2. **False success (fixed in LUX 1.1.11+)** — Older LUX wrote files under `/opt/ludus/sources/.../templates/` (sync mirror) and ran `ludus templates add` as **root**. The Ludus CLI prints `[ERROR] The ROOT key can only be used for user actions` but exits **0**, so LUX reported success without registering the template. Current LUX installs under `/opt/ludus/packer/<name>/` and registers as the logged-in Ludus user (via `sudo` / `runuser` / `su` — hosts without `sudo` are supported).

3. **Stale UI** — Click the refresh icon on Templates after add; LUX invalidates cache on success but a long `staleTime` can lag briefly.

**Diagnose on the Ludus host** (as a normal Ludus user, not root):

```bash
ludus templates list
ls -la /opt/ludus/packer/ubuntu-24.04-x64-server   # example
```

If files exist under `packer/` but `ludus templates list` omits the name, re-add from LUX (1.1.11+) or run manually:

```bash
export LUDUS_API_KEY=<your-user-key>
ludus templates add -d /opt/ludus/packer/<template-dir-name>
```

### Template added but build uses wrong definition

User templates live under `/opt/ludus/users/<username>/packer/`. Built-ins live under `/opt/ludus/packer/`. A name collision or stale copy can cause confusing builds — delete the user copy in LUX or on disk and re-add from source if needed.

---

## Related

- [Features → Templates](features.md#infrastructure) — short feature list
- [Workflows](workflows.md) — how ranges and GOAD use built templates
- [Ludus CLI: `ludus templates`](https://docs.ludus.cloud/docs/using-ludus/templates) — equivalent operations outside LUX
