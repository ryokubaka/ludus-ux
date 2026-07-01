# Features

### Range management

- **Dashboard** — VM table (sortable by display name), power state, bulk/per-VM power controls, **per-VM destroy** (Ludus `DELETE /vm/{vmID}`), range state, deploy/abort, SSE deployment logs, optional Ansible inventory modal; **Deploy History** deep-links to a GOAD instance’s Logs History (side-by-side Ludus + GOAD) when the range is mapped in LUX’s GOAD range store
- **Range Config Editor** — Monaco YAML for `range-config.yml`, save, selective Ansible tags, live logs
- **Firewall Rules Editor** — Collapsible visual panel on the Config page to add, edit, reorder (drag-and-drop), and delete `network.rules` entries without hand-editing YAML; "Apply to Config" merges rules into the Monaco editor. Also available as a wizard step in Deploy New Range and Deploy New GOAD Instance flows.
- **New Range Wizard** — Guided flow: range selection → templates → domain → **firewall rules** → tags → deploy
- **Range Logs** — Standalone SSE viewer with timestamps, download, clear; snapshot mode for post-connect streams; deploy history list matches Dashboard behavior (**GOAD** rows open the GOAD instance history view when linked)
- **Log viewers** — Every log window (Range Logs, Dashboard deploy log, GOAD terminal, and the Templates / Blueprints / New Range / inventory config panes) is vertically resizable — drag the bottom-right corner and the height persists per view. Long output (>500 lines) is virtualized for smooth scrolling while keeping auto-tail, jump-to-live, and search navigation intact.

### Testing & snapshots

- **Testing Mode** — Isolated network, allowlists, pending-state reconciliation against Ludus API delays
- **Snapshots** — Create, revert, delete across range VMs; per-VM and by snapshot name

### Infrastructure

- **Templates** — List, build, stop, delete Packer templates; install from official Ludus GitLab or custom sources
- **Blueprints** — Save/share/deploy range configs; user & group ACLs, unshare, apply-to-range workflow
- **Ansible Roles** — Galaxy roles and collections (add with version pin, list, remove)

### VM access

- **Consoles** — noVNC in browser (uses the logged-in user's PAM password with Proxmox HTTP API on port 8006); SPICE / VNC `.vv` via `pvesh` over SSH (works with key-based root SSH)
- **Console range picker** — Choose any accessible range and VM from the Consoles page

### GOAD integration

- **Overview & wizards** — Instances load without waiting on a full session round-trip before cards appear; live deploy streams, dedicated range per instance, task history with resumable SSE; Deploy New Instance wizard includes a **Firewall Rules** step to define router iptables rules before the Ansible run. For **Ludus + GOAD** with extensions, the wizard sends a single REPL session: one `provide` (one Ludus `range deploy` for the merged lab+extension config), then `provision_lab`, then `provision_extension` per extension — avoiding GOAD’s `install` path that would re-run Ludus deploy for each extension.
- **Range YAML vs Range Configuration** — GOAD **Provide**, **Provision lab**, and **Install extension** refresh Ludus `range-config.yml` from GOAD templates (which would overwrite edits you made in the Range Configuration UI). LUX uses a two-layer approach to keep your `network:` block (firewall defaults + rules) intact: a Ludus CLI wrapper injected into the GOAD SSH session re-merges the block into every `ludus range config set` call during the run, so GOAD's own Ansible deploy already applies iptables correctly and rules are never temporarily flushed. If the block is still missing from range-config after the run (e.g. after **Provide**, which fully regenerates config from templates), LUX re-applies it as a post-run safety net. Other top-level keys still come from GOAD until you edit them in Ludus or the UI.
- **Instance actions** — Provision, provide, start/stop, destroy, delete instance only (workspace, keep Ludus range), delete instance + range, sync IPs, stop running Ansible
- **Extensions** — **Install** (per-extension button → switches to Deploy Status), re-provision, **remove** (destroys extension VMs via Ludus and updates `instance.json` + workspace inventories over SSH). VM destroys and extension removals append rows to the local SQLite table `vm_operation_log` (`POST /api/vm-operation-log`), surfaced in the UI as a **VM Operations** panel on the Dashboard (collapsible, next to Deploy History) and on the Range Logs page (dedicated card) via `GET /api/vm-operation-log?rangeId=…` — non-admins are scoped to their own rows; admins see everyone by default and can pass `?username=…`. You can also inspect directly with e.g. `sqlite3 data/ludus-ux.db "SELECT datetime(ts/1000,'unixepoch'),kind,vm_id,vm_name,extension_name,status,detail FROM vm_operation_log ORDER BY ts DESC LIMIT 30"` on the LUX host.
- **Dashboard provisioning indicator** — For GOAD-mapped ranges, the Dashboard range header shows a pulsing `GOAD: <kind>` badge and an in-card banner with an "Open GOAD" link whenever a GOAD task (`provide` / `install_extension` / `provision_lab` / `provision_extension`) is still running, even after the Ludus range deploy itself flips to `SUCCESS`. Dashboard polls `/api/goad/tasks` every 3 s while anything is running and auto-refreshes range status + deploy history when the task ends.
- **Logs History** — Integrated GOAD + Ludus runs show as a single **GOAD** row; click for side-by-side range deploy log and GOAD CLI output (standalone Ludus deploys still show as Range Deploy). Detail view includes id/time/template metadata for Ludus and GOAD. **Deep links**: `?tab=history&deployLogId=` opens that deploy; range→instance mapping uses `GET /api/goad/by-range` (SQLite + enriched instances fallback). **Dashboard / Range Logs** only tag a deploy with **GOAD** when it correlates with a GOAD task (time overlap or proximity); manual range-config deploys stay plain Ludus rows. Deploy history there is paginated (5 per page).
- **Inventory** — View workspace inventory from the UI

### Users & groups *(admin)*

- **Users** — Create/delete, roll keys, change passwords, WireGuard export, admin flag, impersonation banner + context
- **Groups** — Members and ranges, shared access control, range removal from groups

### Admin panel

- **Ranges overview** — All ranges, ownership hints persisted in SQLite
- **Shared services** — ADMIN pool VMs (Nexus, Ludus Share), deploy/start/stop/console/delete

### Admin impersonation

Admins can impersonate any user to see and manage their ranges and GOAD instances exactly as that user would.

**How it works:**
1. On the Users or Admin panel, click **Impersonate** next to the target user (you need their API key)
2. LUX writes the impersonation state to the encrypted session cookie and shows a banner
3. All subsequent API calls use the impersonated user's API key from the cookie — the key is never written to `sessionStorage` or sent in request headers
4. Click **Stop Impersonating** in the banner to exit

**What impersonation affects:**
- GOAD instance listing and actions (scoped to the impersonated user)
- Range creation, deploy, config edit, and abort (uses the impersonated user's Ludus API key)
- GOAD deploys create ranges owned by the impersonated user (named `<their-username>-<lab>`)
- All TanStack Query cache keys include the impersonated user's identity so data never leaks across identity switches

**What impersonation does not affect:**
- noVNC console — still uses each user's own PAM password; you cannot open another user's VM console without knowing their password
- Your own admin session is preserved and you can exit impersonation at any time

### GOAD redeploy semantics

When you redeploy an existing GOAD instance (as opposed to creating a new one):

1. **Workspace is preserved** — GOAD keeps the same instance ID, `instance.json`, and workspace directory
2. **VMs are cleared** in the background before GOAD runs — this gives GOAD a clean Proxmox slate without deleting the range itself
3. **The same rangeID is reused** — no new Ludus range is created; ownership and config history are retained
4. **Firewall rules are re-applied** after GOAD finishes via the pending-network queue (same as a fresh deploy)

This is the recommended way to recover from a broken install or update the lab after a GOAD version upgrade.

### Settings & branding

- Runtime settings persisted in SQLite (URLs, SSH, GOAD path, secrets)
- Custom logo upload
- Ludus API and SSH connectivity tests
