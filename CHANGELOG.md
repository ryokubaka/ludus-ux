# Changelog

All notable changes to Ludus UX (LUX) will be documented in this file.

Each bullet uses a single tag:

- **[Add]** — New capability
- **[Fix]** — Bug or wrong behavior
- **[Improve]** — UX polish or refactor without a new feature
- **[Perf]** — Performance improvement
- **[Security]** — Security fix
- **[Docs]** — Documentation improvement
- **[Remove]** — Removed capability
- **[Breaking]** — Breaking change

---

## [1.5.3] - 2026-10-30

**LUX**

- [Improve] **Documentation drift check** — CI refuses a docs tree whose framework version, documented environment names, or page index disagree with the code. It runs in the existing hygiene job on GitHub and GitLab, so no new check is required.
- [Improve] **Server library layout** — `src/lib` files are grouped by domain. Import paths changed inside the app; no route, export, or behavior changed.
- [Docs] **Documentation accuracy** — Architecture names Next.js 16 and React 19. Tuning knobs, legacy `GOAD_SSH_*` aliases, the Docker socket path, and the blueprint operator key fallback are documented in Environment variables.

## [1.5.2] - 2026-10-28

**LUX**

- [Security] **CodeQL sinks** — The pending-network snapshot write and the Docker socket request are marked on the lines code scanning reports. A marker on the call above those lines did not cover them, so those two alerts stayed open.
- [Security] **Bash syntax check** — The test that syntax-checks a shell script writes it to a file and runs `bash -n` on that path. Paths from the environment are no longer a `bash -c` argument.
- [Improve] **Build log** — Prerendering no longer prints a session failure for every page. `connection()` still opts those routes out of the static shell, and the source-sync loop and lux-host SSH stay off until the server is running.

**GOAD**

- [Fix] **Extension install** — Enabling an extension on an existing lab stopped before Ansible ran. The workspace writability check was joined into `then;`, which Bash rejects. Install, remove, workspace refresh, and the network snapshot before a deploy all use that check.
- [Fix] **Range switch on an instance** — Choosing another range in the sidebar while a GOAD instance is open left the page on that lab and put the sidebar back. It now opens that range's GOAD instance when one is deployed, and the Dashboard otherwise. The move uses the lab list already loaded on the page, so it does not wait on another host scan.

## [1.5.1] - 2026-10-28

**LUX**

- [Security] **Stdout logs** — Newlines and percent signs are removed before a request value is written, and an environment value whose name contains a secret marker is replaced with `[redacted]`.
- [Security] **File reads and ids** — SSH key probes, recovered task logs, and the security route walk read through an open file descriptor. New range ids and GOAD task ids come from a CSPRNG and keep the same shape, including the `goad-<millis>-` prefix.
- [Security] **GitHub URLs and password check** — Listing and raw reads are built from `api.github.com` and `raw.githubusercontent.com`, with each path segment encoded, and a clone URL counts as GitHub only when its hostname is `github.com`. The settings confirm check uses scrypt. The Ludus cache key stays a short SHA-256 digest.
- [Security] **Lab requests, IP sync, and host commands** — Ludus, PocketBase, and Proxmox calls still use the configured address, including a private range, and refuse another scheme, embedded credentials, the instance metadata host, and a redirect to a different host. Inventory rewrite accepts only an IPv4 prefix and quotes the workspace path. The privileged SSH username is checked against the Linux name pattern and is not copied into the command.
- [Security] **CodeQL lab sinks** — GitHub code scanning does not read `// codeql[js/...]` comments, so the CodeQL job drops results those comments cover before upload. Configured Ludus URLs, host commands, task logs, and the GitLab API body stay. Certificate checks for those hosts are still skipped only when `LUDUS_TLS_INSECURE` is set.
- [Fix] **Merge request summary** — The GitLab API payload is written in the checkout. A file from `mktemp` in the system temp directory was refused, so the merge request title and the release publish never ran.

## [1.5.0] - 2026-10-28

**LUX**

- [Breaking] **Container uid and SSH key mount** — The image user defaults to uid 64532. Set `LUX_UID` and `LUX_GID` in `.env`; Compose passes them into the image build, and a change needs a rebuild. `./ssh` is mounted read-only and is not chowned. A key that user cannot read, such as one still owned by uid 1001 after an upgrade, is copied at start into an in-memory `/run/lux-ssh` owned by that user, so host key auth keeps working and the host file is unchanged. Rootless Docker, a user namespace remap, or an NFS `root_squash` mount still need the key readable by that uid; startup warns when it is not. See persistent data.
- [Breaking] **`LUDUS_TLS_INSECURE` when unset** — A `.env` without `LUDUS_TLS_INSECURE` now verifies the Ludus, PocketBase, and Proxmox certificates. Before 1.5.0 that meant the checks were skipped, and the older quickstart never wrote the key. If Ludus uses its default self-signed certificate, add `LUDUS_TLS_INSECURE=true` to `.env` and run `docker compose up -d`. Login and Settings → Test credentials say when the key is missing. The flag applies only to Ludus, PocketBase, and Proxmox; other HTTPS is always verified.
- [Security] **Settings and login** — `GET /api/settings` returns an allowlist. The blueprint operator API key, root API key, and host SSH password are not sent to the browser. A manual API key login is accepted only when the Ludus profile matches the username. Operators with non-admin users should rotate the Ludus API key of every admin who has logged in, and rotate a host SSH password that was saved in Settings.
- [Security] **Sessions** — API routes check the server-side credential vault, so a cookie presented after logout is rejected. Changing the Ludus URL or SSH host requires the current SSH password. The legacy session cookie name is no longer accepted. `/api/auth/revoke` clears a session only when its credential row is already gone, so a link from another site cannot log a user out. Template and blueprint source listings checked the session only for registered sources; every listing now needs one.
- [Security] **Live admin check** — A route that grants admin power asks Ludus whether the signed-in user is still an admin. The cookie flag is reused for about a minute, then checked again. A demoted admin loses impersonation, host password changes, and the other admin branches instead of keeping them until the cookie expires.
- [Security] **SSH host keys** — Host keys are pinned on first use. `LUX_SSH_HOST_KEY` accepts what `ssh-keygen -lf` prints (with or without the trailing `=`), a public key line, or a `known_hosts` line, compared by key bytes; an unusable pin is logged once. A refused key names the host, the stored fingerprint, and the one presented. Settings → Auth lists stored fingerprints, and an admin can forget one after a legitimate host rebuild so the next connection stores the new key.
- [Security] **Host helper and requests** — `run-as-user` refuses privileged accounts and groups. Login rate limits and audit logs use `X-Real-IP`. Mutating browser requests must come from this app's origin, including over HTTPS on a port other than 443: nginx forwards the client's port in `Host`, and the check trusts the browser's `Sec-Fetch-Site: same-origin`.
- [Security] **Secrets out of process arguments** — The GOAD run, the LudusHound collection install and Neo4j check, saving the key to `~/.bashrc`, and lux-host's template add and remove no longer put the Ludus API key, the Proxmox token, or the Neo4j password in a command line, where any user on the Ludus host could read it with `ps`. They are sent on stdin; GOAD's environment is written from stdin to a 0600 file that the run loads and deletes first.
- [Security] **GOAD preview and execute** — Config preview runs as the signed-in user, rejects lab names that are not a single catalog segment, and renders templates in a Jinja sandbox under the GOAD tree. A session without an SSH password cannot run GOAD as the host account. Execute checks that the caller owns every instance the command names, including each `use <id>` in a REPL script.
- [Security] **Pending network snapshots** — Instance ids are a single path segment. Another user cannot read, delete, or write a snapshot, and reading one no longer deletes it. Storing rules (`POST .../pending-network`) and the deploy handoff (`POST /api/goad/deploy-handoff`) check that the caller owns the GOAD instance (the workspace owner, or the latest task's owner while GOAD still writes it as the host account), and the handoff checks that the caller's Ludus key can read the range. Linking a handoff to a task requires the same owner for both. After GOAD finishes, rules are applied only when the snapshot owner is the task owner, to the range on that owner's handoff. Without these checks, a user who knew an instance id could set the network rules on another user's range.
- [Security] **GOAD instance and task ownership** — Force delete, enabling or removing an extension, refreshing the workspace, syncing network rules or IPs, initializing or setting the range, reading inventories, and linking a task to an instance all check that the caller owns the instance, as above. Several of these compared the instance id with a username prefix, which GOAD ids do not have, so owners were refused and a user whose name matched the start of an id was let through; IP sync and range init had no check. Task events, stop, and stream show only the caller's own tasks. Listing GOAD instances, the GOAD catalog, and inventories require a live session.
- [Security] **Build pins** — The image install uses `npm ci`, a pinned esbuild, and pinned base image digests. GitHub Actions are pinned by commit.
- [Security] **Signed upgrade key** — Tag verification uses a keyring that contains only `LUX_UPGRADE_TRUSTED_KEY`. A tag signed by any other key is refused. `LUX_UPGRADE_TRUSTED_FPR` pins the primary fingerprint. Settings → About passes both through to the host switch.
- [Security] **Next.js** 16.4.2 — [GHSA-673q-mjm6-r5xr](https://github.com/advisories/GHSA-673q-mjm6-r5xr) (unauthenticated RCE when a `use cache` function returns typed arrays), [GHSA-2464-fhr4-w9xw](https://github.com/advisories/GHSA-2464-fhr4-w9xw) (image-optimization RCE when SVG files are used), and [GHSA-p3m5-59mp-jv5r](https://github.com/advisories/GHSA-p3m5-59mp-jv5r) (Server Actions denial of service). 16.3.8 is in the affected range. `eslint-config-next` is 16.4.2. `sharp` stays at 0.35.5. `partialPrefetching` is false so existing Cache Components keep their current prefetch behavior.
- [Security] **Vitest** 4.1.12 — [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8) (code injection via unauthenticated manual mock registration) and [GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp) (Windows backslash traversal in `@vitest/mocker`). Dev dependency only.
- [Security] **zod** 4.6.7 — [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) (memory exhaustion while validating oversized constrained collections). Dev dependency of `eslint-plugin-react-hooks` only.
- [Add] **Security checks before merge** — GitHub and GitLab CI run the same `scripts/ci` checks: unit tests and types, an audit of every API route for a session gate, an owner check, and GET side effects, a scan for secrets in command lines, a catalog of the advisory's regressions, repo hygiene, gitleaks, Semgrep, npm audit, and a changelog lint. GitHub also runs CodeQL. `scripts/ci/live-security.sh` tests a lab with a throwaway non-admin user and posts the result as a commit status. See `docs/security-testing.md`. GitLab check jobs print the apt install, give up on a mirror after 30 seconds, and use the Debian 13 Node image, because Debian 12 apt aborts in libgcrypt when the runner kernel is in FIPS mode. The smoke job talks to Docker-in-Docker on the job network without TLS.
- [Add] **GitLab merge request and release** — A merge request pipeline sets the title and description from the changelog, the same way GitHub does. A push to the default branch tags that version and publishes the changelog section. Those jobs trust `CI_SERVER_TLS_CA_FILE` when the pipeline provides it. Otherwise a File variable `NODE_EXTRA_CA_CERTS` holds the CA that signed GitLab.
- [Fix] **Admin API on a new Ludus server** — Port 8081 listens on 127.0.0.1 only, so `https://<ludus-host>:8081` is refused from the container. The error now says to set Admin API URL to `https://127.0.0.1:18081`, the SSH tunnel LUX already opens.
- [Fix] **Settings after a new APP_SECRET** — A stored secret that cannot be decrypted is cleared once and logged once. A new quickstart secret against an existing database no longer prints that stack on every settings read.
- [Fix] **lux-host install** — The helper is sent on stdin, so the install no longer dies with "Argument list too long". The root-shell paste no longer treats the script's own `EOF` lines as the end of the command.
- [Fix] **braces lockfile** — The `file:vendor/braces` override was locked as links to `node_modules/chokidar/vendor/braces` and `node_modules/micromatch/vendor/braces`, with no version. `braces` is now a direct `file:vendor/braces` dependency, the override is `$braces`, and the lockfile resolves to `vendor/braces`. `fill-range` moved to dependencies with it.
- [Fix] **GOAD network rules on a list item** — A rule whose first line is `- ip_last_octet_dst: 10.1.20.20` keeps only the last octet, as it already did for the same key on a later line.
- [Fix] **GOAD deploy redirect** — A new GOAD deploy leaves for that instance's Deploy Status page when the log prints the instance id. Waiting on the workspace list left the wizard on Deploy New Range after the instance already existed.
- [Fix] **GOAD lab destroy** — After a lab is destroyed, its page goes back to the GOAD list. It no longer opens the lab of whichever range the range picker selected next, and it no longer throws the shell error page by selecting the deleted range again after the sidebar has moved off it.
- [Fix] **Template repo requests** — Requests to a user-supplied repo host honor the caller's abort signal, time out after 30 seconds, and stop at 10 MB.
- [Fix] **Saving the API key to `~/.bashrc`** — The save could wait forever because the SSH output was never read.
- [Improve] **Deploy New Range** — Config Method is the first step. Wizard, YAML, and Blueprint then ask whether to create a range or replace an existing one. From GOAD, shown when GOAD is enabled, opens the GOAD deploy wizard on this page. GOAD Management still opens that wizard on its own.
- [Improve] **Quickstart** — Asks whether Ludus uses a self-signed certificate and sets `LUDUS_TLS_INSECURE` (default yes, scoped to Ludus, PocketBase, and Proxmox). After the host key is authorized, it runs `chown` on `./ssh/id_rsa` to the `LUX_UID`:`LUX_GID` pair in `.env` (default 64532:64532) when that uid is not already a local account. Replacing `./ssh/id_rsa` removes the previous file first, because that file is mode 600 and owned by the container user after a prior run, and `scp` was opening it and failing. The Compose action repeats the ownership check before `docker compose up`.
- [Improve] **Density** — The root type scale is 13px, so 100% browser zoom matches about 80% of the previous layout. Small labels stay near 10px. Log text and the remote console keep their own sizes.
- [Docs] **Install and SSH** — Getting started, environment, persistent data, and SSH docs describe the read-only `./ssh` mount, uid 64532 and the in-memory key copy, that an unset `LUDUS_TLS_INSECURE` verifies and applies only to Ludus, PocketBase, and Proxmox, the `LUX_SSH_HOST_KEY` formats, forgetting a stored host key, and upgrading from 1.4.5. The README badge, in-app version, and OpenAPI version are 1.5.0.

## [1.4.5] - 2026-10-21

**LUX**

- [Fix] **Deploy log timestamps** — A live range line is stamped when it appears, and that time stays. History for a running deploy spreads from the start to now. A finished run that was never recorded spreads from its start to its end.
- [Fix] **GOAD instance refresh** — Reloading an instance page loads the lab again. If the session, address, or selected range cannot be read, the shell stays up. The error screen reloads once, then offers Reload.
- [Fix] **Deploy tab logs** — The range and GOAD logs follow the latest run. An old task id in the address bar does not keep that run on screen after a newer deploy finishes.

## [1.4.4] - 2026-10-20

**LUX**

- [Fix] **Ansible collection pin** — GOAD lists `community.general` with no version. A force repair installed the newest Galaxy release, which removed `proxmox_kvm` and does not support the Ansible that range deploys use. LUX now installs the version pinned in Ludus `requirements.yml` (`community.general` 10.3.0) and reinstalls when the copy on disk is a different version.
- [Fix] **Deploy log stream** — The live range and GOAD panes read the same logs as Logs History while a deploy is running, so they fill in even when the event stream is held open until the job ends.
- [Fix] **GOAD instance page** — The lab id comes from the address bar. While GOAD is still creating the workspace, the page keeps checking instead of saying the instance was not found.
- [Security] **Vite** — Vitest's Vite is pinned to 8.2.4. 8.2.2 is affected by three `launch-editor` issues: missing `%` escaping on Windows, editor CLI flags that can be turned into commands, and a Windows existence check that can be bypassed.

## [1.4.3] - 2026-10-19

**LUX**

- [Fix] **SPICE console** — A `.vv` download uses the signed-in user's Proxmox account, the same way in-browser noVNC does. The host SSH account is not used, so a mounted root key does not open another user's console. Log in with your SSH/PAM password. A key-only login cannot request this ticket. ([Issue #44](https://github.com/ryokubaka/ludus-ux/issues/44))
- [Fix] **Linux router reboot** — A range deploy waits for SSH on a Linux VM to drop before it waits for SSH to return. Ludus was treating an already-open port 22 as a finished reboot, and the next task failed while the VM was still shutting down.
- [Fix] **Router clone** — A network deploy no longer clones a second router when one with that name already exists. VLAN setup uses one Proxmox VMID when more than one VM shares the name.
- [Fix] **Range VM list** — The dashboard keeps one row per Proxmox VMID. A one-VM first paint is replaced by the next full range snapshot instead of being appended, and the same short snapshot twice replaces the cached list.
- [Fix] **Domain controller OUs** — After a new forest is promoted, the deploy waits until Active Directory Web Services answers `Get-ADDomain` before creating the Workstations and Servers OUs. WinRM comes back first, and the stock task was failing while that service was still starting.
- [Fix] **Sysinternals checksum** — The additional-tools install no longer checks the Sysinternals zip against the Chocolatey package checksum. That URL is not versioned, so the package still has the previous zip's hash after Microsoft replaces the file.
- [Fix] **Host DNS env** — Compose passes `LUX_USE_LUDUS_HOST_DNS` into the app. A `.env` value was ignored because the container never received it. A value already saved in Settings still wins.
- [Add] **Pull request summary** — Opening a pull request sets the title to `vX.Y.Z - Feature, feature, and feature` and the description to a Summary list from that version's changelog section. Later pushes refresh it while the description still contains the `lux-pr-summary` comment. Delete that comment to keep a hand-edited description.

## [1.4.2] - 2026-10-15

**LUX**

- [Improve] **Settings** — GOAD, LudusHound, Ansible verbose, and Use Ludus host DNS are on General. The SSH tab is named Auth.
- [Add] **Host DNS** — Settings → General → **Use Ludus host DNS** (or `LUX_USE_LUDUS_HOST_DNS=true`). Before a deploy, LUX rewrites the AdGuard template so range DNS uses `192.0.2.254` instead of public resolvers. A Ludus update restores the stock template; the next deploy puts the host resolver back. If lux-host cannot apply the edit, the deploy continues.
- [Fix] **lux-host update** — A new LUX release replaces the helper already installed for the SSH account. The update body is written to a file and then given to `lux-host self-update`, because current sudo does not pass an SSH pipe through to the helper. The one-time root-password install is still what creates `/etc/lux-host.update-key`. After that key exists, later releases do not ask for it again.
- [Add] **Release check** — Settings → About → Releases has **Check again**. It reads the git remote immediately. The sidebar otherwise keeps a successful check for one hour.

**GOAD**

- [Fix] **Ansible dependencies** — Before provision, LUX installs every role and collection named in the GOAD requirements file. A role named `geerlingguy.mysql` no longer counts as the `community.mysql` collection. Each collection is confirmed under the Ludus user's `ansible_collections` tree. If Ludus already lists it but the range user cannot read it, LUX fixes ownership and installs that collection again.
- [Fix] **MySQL collection** — `community.mysql` 5.x does not ship `mysql_user`. The `community.mysql-5.0.2.info` folder is Galaxy's install receipt, not the collection. LUX also installs `ansible.mysql`, which has that module, and does not stop provision because the old module file is gone.

## [1.4.1] - 2026-10-14

**LUX**

- [Add] **Releases** — Settings → About lists `vX.Y.Z` tags and branches from the git remote this install was cloned from. A version branch with no tag is marked Unpublished and does not trigger the update banner. Links and upgrade/downgrade use that remote. `GITHUB_TOKEN` or `LUX_GITHUB_TOKEN` is sent when set.
- [Fix] **Host commands** — `lux-host-exec` changes to `/` after entering the host mount namespace, so bash no longer logs `getcwd: cannot access parent directories` on every command.
- [Fix] **Release lookup** — The checkout is discovered from the running container (Compose working directory or the host path of the `/app/data` bind mount). `LUX_REPO_PATH` is only an override when that fails. Mount paths come from the Docker API, including Windows `E:\` client paths, and are translated on the Linux host. Translation does not depend on a `docker` CLI in the host namespace. The probe runs as a base64-encoded host script. SSH uses the account that started the container. On Docker Desktop, a key file mode 777 is copied to a private directory for that one command and then deleted. Public GitHub remotes still need no key.
- [Fix] **VM and range lists** — Failed accessible-range fetches no longer clear the selected range. The dashboard keeps VMs across one empty Ludus poll, shows a spinner while range selection restores, and merges partial `/range` responses more predictably. The console picker uses the same merge rules as the dashboard.
- [Fix] **Admin VM inventory** — Refresh bypasses stale server caches; admin data is keyed per API key; Ludus empty or short VM lists merge with prior data instead of wiping rows.
- [Fix] **Cache invalidation** — Ludus proxy mutations invalidate in-process prefetch and admin SWR caches so the next navigation or admin GET is not stuck on an old VM list.
- [Fix] **Source catalog API** — Ensure `source_content_pins` (and related tables) exist on startup so `/api/sources/.../blueprints|templates|roles|collections` no longer 502 when the DB predates migration v17.
- [Fix] **Debian 11 apt** — Before a range or GOAD deploy, LUX tries to point Bullseye security apt at `https://archive.debian.org`. `security.debian.org` still lists those packages and returns 404 for the files. The guest task runs during hostname setup and does nothing on Debian 13. If the host's lux-host cannot apply the edit, the deploy continues.
- [Fix] **Windows Chocolatey** — The same deploys try to install Chocolatey and reboot the VM once so OpenSSH can see `choco.exe`. The stock bootstrap installs Chocolatey, then fails because the SSH session still has the old PATH. If lux-host cannot apply the edit, the deploy continues.
- [Perf] **Sources page** — Defer cross-source Ansible catalog fetches until roles/collections are expanded or Ansible is already installed on the host.
- [Perf] **Blueprint provenance** — Fetch source blueprint catalogs only for sources tied to installed blueprint IDs, not every registered source.
- [Perf] **Sidebar navigation** — Instant active state and header title on pointer down; hover/focus route warmup with `prefetch="auto"` (loading-boundary prefetch only); drop duplicate dynamic-import spinner when `loading.tsx` already covers the segment.
- [Security] **Dependencies** — Bump `sharp`, `source-map-js`, and `postcss-selector-parser` (via npm overrides) to clear reported moderate/high audit findings.

**GOAD**

- [Fix] **List after delete** — Deleting a range or a GOAD instance removes that row from the cached list before the page is shown again. The list no longer keeps a deleted range for the two-minute cache window. If the workspace folder is still on the host, the delete reports that instead of saying the lab is gone.
- [Fix] **Range delete** — Delete Instance + Range locks the action buttons and shows a deletion banner until the workspace is gone. The log is the GOAD `ludus range rm` output. Ludus deploy logs stay hidden during that delete. GOAD's destroy only removes VMs and keeps the range record; LUX waits for that to finish, then deletes the range. The active-range menu drops that range and selects the next one without a reload.
- [Fix] **Live range logs** — A new GOAD deploy passes the dedicated range id into the instance page, so range logs stream during provide instead of showing "No dedicated range" until a refresh.

## [1.4.0] - 2026-10-02

**LUX**

- [Add] **In-app releases** — Settings → About lists GitHub releases and asks before an upgrade or downgrade. The switch uses the Docker socket. If that socket is missing, SSH runs this build's upgrade script. Your data, SSH keys, and `.env` stay. A release older than v1.4.0 must be acknowledged. Set `LUX_REPO_PATH` when Docker cannot see the clone.
- [Add] **lux-host** — Host SSH can be any account. Privileged commands go through `/usr/local/sbin/lux-host`. Sudo allows that program only. Settings installs it with one command to paste in a root shell, or with the root password when root login is allowed. The password is used once and is not saved. That install stores an update key so later helper updates do not ask again. [What it is](docs/ssh-and-auth.md#lux-host).
- [Add] **Uninstall lux-host** — `bash scripts/uninstall.sh` removes `/usr/local/sbin/lux-host`, its sudoers rule, and the update key. `--print` writes a root-shell command and does not SSH. Containers, `./data`, `./ssh`, and `.env` stay.
- [Add] **Dashboard** — A Ludus host box shows cluster CPU and memory. It refreshes every 10 seconds.
- [Improve] **Quickstart** — Host SSH setup asks whether the account is root or another user. A non-root user gets lux-host after the key is authorized.
- [Improve] **Host SSH test** — The Packer directory path is shown only when that directory is not writable.
- [Improve] **Sources** — Install from a source on the Sources page. Cards show the owner and branch. Other users can install from a shared source. Re-sync follows that branch's own install.
- [Improve] **Lists** — Long pages show the first rows, then a bar for the rest.
- [Fix] **Template names** — Add from Source keeps the git folder and registers the Packer `vm_name`. [Templates](docs/templates.md#add-from-source).
- [Fix] **Template delete** — Delete removes the installed template folder. The source checkout is left alone. Delete fails if the installed folder is still on disk.
- [Fix] **Sources** — A role or collection has one installed copy. Another branch shows who owns it, and Re-sync replaces that copy.
- [Fix] **Source unpublish** — Turning a shared source off removes its installed templates. A leftover install folder is a warning. The source checkout staying on disk is fine.
- [Fix] **Shared source import** — A blueprint is not taken from a different git URL, including another fork of the same repo name.
- [Remove] **Deploy preflight** — Range deploy is sent to Ludus. LUX does not install Ansible requirements first.

**GOAD**

- [Add] **Firewall rules** — Network Rules lists rules from the selected extensions and from the existing range. Provide sends that same list to Ludus before the deploy that installs them.
- [Fix] **Firewall rules** — Existing range rules stay in their current order. New extension rules are added after them. Clearing the list keeps the range's other network settings, including whether VLANs can talk to each other.
- [Fix] **Range file** — Provide writes the range id as the workspace owner, after GOAD has finished creating that workspace. If the write fails, the instance stays unlinked.
- [Fix] **Ansible check** — Dependency checks use the signed-in Ludus user's Ansible folder, not the host SSH account.

**Security**

- [Security] **Next.js** 16.3.8 — closes a remote code execution bug in image generation ([GHSA-vcvr-r3jv-pc5j](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j)).
- [Security] **brace-expansion** 5.0.12 — closes denial-of-service bugs in a dependency ([GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr)).
- [Security] **braces** — deeply nested patterns are rejected instead of crashing Node ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)).
- [Security] **Releases** — The release title is passed to the job as data, not pasted into a shell command.

## [1.3.2] - 2026-09-10

**LUX**

- [Fix] **Router template gate (Ludus 2.3.2+)** — Require the version-correct Ludus router Packer template before GOAD/range deploy: Debian 13 on Ludus ≥2.3.2, Debian 11 on older hosts. Honors explicit `router.template` pins. Default deploy-limit router `vm_name` follows the same rules.
- [Fix] **GOAD dependency check** — Missing-dependencies panel now verifies Packer templates against Ludus `/templates` (built status), not Ansible inventory; fixes false “missing” for templates like `win2019-server-x64-template` that are already built.

**Security**

- [Security] **Next.js** 16.3.4 — [GHSA-p293-qw3h-jr36](https://github.com/advisories/GHSA-p293-qw3h-jr36) (Windows-hosted RCE), [GHSA-2xp9-vwfh-vxw4](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4) (AVIF image optimization RCE).
- [Security] **js-yaml** 4.3.2 — [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh) (merge-key CPU DoS).
- [Security] **sharp** 0.35.4+ (override on Next optional dep) — [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) (libheif CVEs inherited by image optimization).
- [Security] **browserslist** — [GHSA-c83g-rgw3-j3cx](https://github.com/advisories/GHSA-c83g-rgw3-j3cx), [GHSA-73wf-gq98-2v4g](https://github.com/advisories/GHSA-73wf-gq98-2v4g) (OOM / crash via custom stats; transitive via autoprefixer).
- [Security] **vitest** 4.1.11 — [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) (path traversal in `@vitest/mocker`; dev dependency only).
- [Security] **baseline-browser-mapping**, **postcss-selector-parser** — refresh lockfile for moderate/low DoS advisories ([GHSA-w5vr-8v7q-w6rv](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv), [GHSA-w9m9-85wc-3x92](https://github.com/advisories/GHSA-w9m9-85wc-3x92)).

## [1.3.1] - 2026-08-11

**Security**

- [Security] **postcss** — Close Dependabot [#19](https://github.com/ryokubaka/ludus-ux/security/dependabot/19) / [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) (CVE-2026-69153). Top-level was already 8.5.26; refresh lockfile so Next no longer nests vulnerable `postcss@8.5.18` (`overrides.next.postcss` → deduped 8.5.26).

## [1.3.0] - 2026-08-10

**Sources**

- [Add] **Content re-sync** — Installed Ansible / Templates / Blueprints show **In sync** / **Out of sync** with per-item **Re-sync** (and bulk **Re-sync outdated**). Uses `POST /sources/{id}/install` with `force`. False Ludus “built-in template name” collisions are filtered / rewritten (usually Packer `vm_name` already on the host).
- [Add] **Install version pins** — Stores catalog tip versions (`source_content_pins`) so bumps show **Update available** even when Ludus omits installed versions.
- [Add] **Versions from git tip** — Catalog prefers git tip (`meta/version.yml` / `blueprint.yml`) on the Sources-tab ref over Ludus sync cache.
- [Add] **Repo link + installed → catalog** — Matched items show git URL and `installed → catalog` versions.
- [Add] **Auto-sync** — Re-pulls git sources on a timer (default **5 minutes**, `SOURCE_AUTO_SYNC_INTERVAL_MS`) and when catalog is stale / before install+force.
- [Improve] **Change ref picker** — Lists remote branches/tags from GitHub/GitLab (`GET /api/sources/{id}/refs`) instead of free-typing a branch name.
- [Fix] **Same-repo multi-branch** — One git URL with different refs no longer collapses to a single source: distinct Ludus `id` (appends non-`main`/`master` ref), `ensureGitSource` matches URL+ref, register dialog shows suggested ID, **Change ref** (`PATCH`) then Sync so catalog tips follow the branch.
- [Fix] **Change ref / pathspec** — Shallow/single-branch Ludus clones fail `checkout` after PATCH (`pathspec '…' did not match`). Change-ref deletes (no purge) and re-registers for the new ref; pathspec sync errors include a re-register hint.
- [Fix] **Source sync git ownership** — Sync/auto-sync chowns `/opt/ludus/sources` to `ludus:ludus` over root SSH before pull, and retries once on `insufficient permission for adding an object` / `unpack-objects failed` (root-owned `.git/objects` from manual root git or older tooling).
- [Fix] **Targeted Re-sync** — Per-item / force install sends Ludus `noDeps` so blueprint re-sync does not reinstall unrelated ansible deps.

**LudusHound**

- [Add] **Integrations track** — `/ludushound` wraps [bagelByt3s/LudusHound](https://github.com/bagelByt3s/LudusHound): Full AD replica (external Neo4j / FilesMap) and Attack Path JSON → generate Ludus YAML → `setRangeConfig` + deploy. Feature flag `ENABLE_LUDUSHOUND` / Settings path `LUDUSHOUND_PATH` (default `/opt/LudusHound`).
- [Add] **Preflight** — Status + one-click clone/update, Go install when missing, `bagelByt3s.ludushound` collection from local tarball + `go build`.
- [Add] **BloodHound source** — External Neo4j (probe from Ludus host) or FilesMapJson; Attack Path skips live BH.
- [Add] **Template gate** — Parse Packer templates from generated YAML (+ router); block deploy until built.

**Ranges**

- [Add] **VM Management** — Ranges Overview tab listing all range VMs across users with template/range/owner/power filters; power on/off, noVNC console, .vv download, and bulk destroy. Range row opens that range’s dashboard (with impersonation when needed). Template-delete linked-clone errors deep-link via `?tab=vms&template=`.
- [Add] **Add VM wizard** — Configuration page dialog to append one or more VMs from built templates (hostname, VLAN, IP, CPU/RAM) without hand-editing YAML.
- [Fix] **Network rules YAML coerce** — Range config PUT normalizes `ip_last_octet_`* quoted strings and `ports` arrays to Ludus schema forms (integer octets / comma-separated port strings).
- [Fix] **SO sniff timing** — Security Onion labs only. While range is `DEPLOYING`, only hub-mode (`bridge-ageing 0`); do **not** attach sniff `net1` yet (same-VLAN tag breaks Ludus MAC→iface lookup). Role / post-deploy backstop adds `net1` after IP config.
- [Fix] **SO sniff SSH scripts** — Security Onion labs only. Pipe enable/cleanup bash via base64 so `sshExec`/`bash -c "..."` no longer strips `$vars` (empty `MARKER`/`VMID`, broken `qm`/`sed`). Cleanup restores bridge ageing in centiseconds.
- [Fix] **Deploy log SSE auto-reconnect** — Transient EventSource blips no longer kill the stream; backoff reconnect with `snapshotStart=false`, preserve lines, skip reconnect after intentional stop / `[DONE]` / `[ERROR]`.

**GOAD**

- [Add] **Install Extension** — `POST /api/goad/instances/{id}/enable-extension` + provide→provision chain when extension VMs are missing; skip provide when VMs already exist. History labels show `Install extension: <name>`.
- [Add] **Proxmox env for GOAD ansible** — Inject `PROXMOX_`* from Ludus host config/`token.cfg` so extension roles can attach NICs outside `ludus range deploy`.
- [Fix] **SO inventory sync-ips** — After prefix rewrite, correct Security Onion vlan-20 hosts (`10.R.10.20` → `10.R.20.20`) in `securityonion*_inventory`.
- [Fix] **Deploy↔GOAD history correlation** — Prefer closest start times over max overlap so a stale open Ludus deploy does not steal every live GOAD task.

**Blueprints & Ansible**

- [Add] **Template dependencies** — Apply dialog and range wizard parse `template:` fields from blueprint range-config and block apply until each template is registered and Packer-built (same semantics as GOAD / LudusHound template gates). Missing templates link to the Templates page.
- [Fix] **Ansible dependencies** — Treat a role as installed when Ludus has the namespaced Galaxy name (e.g. `ryokubaka.ludus_securityonion`) but the blueprint references the short name (`ludus_securityonion`). Matches Ansible catalog FQCN/short-name logic.
- [Fix] **Local source roles** — “Installed” badges and role counts follow `GET /ansible` only; stale Ludus source-catalog `state: installed` no longer marks roles installed when missing. SSR prefetch includes the full ansible list so a hard refresh no longer drops Galaxy roles/collections to source-catalog-only counts.
- [Fix] **Ansible log coloring** — Shared log viewer (range deploy + GOAD): do not paint task names containing “fail”/“failed” as errors; color only structural failures (`fatal:`, `failed: [`, `FAILED!`, `"failed": true`).

**Templates**

- [Add] **Delete — linked clones** — Detect blockers when a template still has range VMs; short error with link to VM Management instead of raw SSH output.

**Reliability**

- [Fix] **Stale UI state** — Re-enable `refetchOnWindowFocus`; stop persisting volatile queries (range status/logs, ranges list, template build status, GOAD tasks) to localStorage; invalidate those keys when the browser tab becomes visible again.

**Docs**

- [Docs] **OpenAPI** — Sources API (sync, catalog, install `force`, `autoSyncIntervalMs`, `PATCH` ref, `GET …/refs`), GOAD `enable-extension`, `info.version` **1.3.0**; `/api/health` returns `version`.
- [Docs] Features / workflows for SO sniff timing; NOTICE credit for LudusHound; `SOURCE_AUTO_SYNC_*` env notes.

**Security**

- [Security] **js-yaml** 4.3.1 — GHSA-5p4m-2wfm-xmqj (!!omap quadratic CPU).
- [Security] **nanoid** 3.3.18 — CVE-2026-67213 / GHSA-2v37-7h3g-55p8 (zero-size generator loop).
- [Security] **brace-expansion** 5.0.9 — GHSA-rgw5-rvv9-x895 (DoS via unbounded intermediate arrays).
- [Security] **postcss** 8.5.26 — direct dep + override (GHSA-fxqj-rqcc-2cmp); Next may still nest an older postcss (moderate only).

## [1.2.0] - 2026-07-29

**LUX**

- [Add] **Range config / GOAD** — Ludus 2.3.0+ top-level `ludus_extensions` is preserved across GOAD Provide/provision (sidecar + CLI wrapper + post-run restore), same pattern as `network:`. Config page notes when the key is available vs when the connected Ludus is older.
- [Improve] **Router template gate** — Block GOAD/`deployRange` until `debian-11-x64-server-template` is Packer-built (Ludus range router). Enforced in proxy, Dashboard Deploy, range wizards, and `executeGoad`; included in GOAD `templateAudit`.
- [Improve] **Sources** — Source ID always shown (Ludus 2.3.0+ may auto-prefix with userID); register dialog documents that behavior.
- [Improve] **Settings** — Ansible verbose + force quirk warning only when connected Ludus is ≤2.2.3 (or version unknown).
- [Improve] **Repo hygiene** — Stored LF line endings for remaining `docker/`** and `scripts/**` files so checkout/stash no longer dirties the tree (`.gitattributes` already required `eol=lf`).
- [Fix] **GOAD venv / exit code** — Recreate broken `~/.goad/.venv` (missing activate) and pip-install when `rich` missing; preserve `goad.sh` exit status so failures are not reported as EXIT 0.
- [Docs] Features / environment notes for `ludus_extensions` preservation and version-gated verbose warning.

## [1.1.11] - 2026-07-14

**LUX**

- [Fix] **GOAD and range deploy** — Fixed deploy failures like “Cannot write to ControlPath …/.ansible/cp”, especially when an admin runs GOAD or deploy as another user. LUX now sets up Ansible folders on the Ludus server the way Ludus expects: the server can write its SSH cache, and you can still edit installed roles and collections. GOAD runs use a separate cache folder so they do not clash with range deploy.
- [Improve] **Ansible installs** — After you install roles, collections, blueprints, or subscription content from the Ansible page (or when LUX installs dependencies before a deploy), permissions are corrected automatically. Same when an admin rolls a user’s API key. You should not need manual `chown` on the Ludus host for normal use.
- [Fix] **Templates — Add from Source** — Templates are installed to the correct folder on the Ludus server, registered under your Ludus account (not root), large uploads no longer fail with “Argument list too long”, and if the files are already on the server LUX treats that as success instead of erroring.
- [Docs] **Templates** — Added troubleshooting for Ansible deploy permission errors and how they differ from Packer cache permission fixes.
- [Security] **tar** 7.5.22 — patches GHSA-8x88-c5mf-7j5w (negative entry size infinite loop in archive replace).
- [Security] **sharp** 0.35.0+ (override on Next optional dep) — patches GHSA-f88m-g3jw-g9cj (libvips CVEs inherited by image optimization).
- [Security] **brace-expansion** 5.0.8 — npm overrides (including ESLint plugin `minimatch` 10.2.5); patches GHSA-3jxr-9vmj-r5cp and GHSA-mh99-v99m-4gvg.
- [Security] **Next.js** 16.2.11 — patches July 2026 release (CVE-2026-64641 Server Actions DoS, CVE-2026-64642 middleware/proxy bypass, CVE-2026-64645 rewrite SSRF, CVE-2026-64649 Server Actions SSRF on custom servers).
- [Security] **postcss** 8.5.18+ — direct devDependency, global override, and `overrides.next.postcss`; patches CVE-2026-45623 and GHSA-r28c-9q8g-f849 (source map disclosure).
- [Security] **js-yaml** 4.3.0+ — direct dependency and override (including ESLint); patches CVE-2026-59869 (crafted YAML DoS).

## [1.1.10] - 2026-07-09

**LUX**

- [Add] **GOAD** — On the GOAD instance page action bar, Provision Lab can target the entire lab, a single playbook, or from a playbook onward (`provision_lab` / `provision` / `provision_lab_from`). Playbook lists come from `playbooks.yml` (lab key, or `default` fallback like upstream GOAD).
- [Add] **Settings / env** — `LUDUS_ANSIBLE_VERBOSE` (default on) and Settings toggle to pass Ludus `--verbose-ansible` / API `verbose` on range deploy (proxy injects when omitted; GOAD Ludus CLI wrapper appends the flag).
- [Fix] **Exit impersonation** — Overlay “Returning to your account…”, clear cookie/range under it, then hard-navigate to dashboard (avoids root-layout crash from in-place cache clear that left “Try again” on `/`).
- [Fix] **Testing mode** — Starting or stopping testing mode opens the range log stream with `snapshotStart` so stale prior deploy output is not replayed before the new op writes logs.
- [Fix] **Testing mode start / EFI** — Before Ludus `PUT /testing/start` (snapshot), LUX detects EFI disks missing `ms-cert=2023k`, briefly powers those VMs off, runs `qm enroll-efi-keys`, restores power if they were running, then snapshots. Snapshots taken without 2023 UEFI certs cannot roll back later (Proxmox warning; Ludus often surfaces as `proxmox_snap` / `New-style module did not handle its own exit` — see badsectorlabs/ludus-source-bsl#3). Start aborts if enroll fails. Testing UI shows **Checking UEFI…** while probing; preview is stored until the range gains a new VM. BitLocker protectors (if any) are out of scope for lab VMs.
- [Docs] **Known issue (upstream Ludus):** On Ludus ≤2.2.3, `POST /range/deploy` ignores the client `verbose` field. The server passes `force` into Ansible as the verbosity flag, so deploys that require `--force` (e.g. testing mode) always run at Ansible `-vvvv`. LUX still sends `verbose` / `--verbose-ansible` for forward compatibility. Quiet Ludus range logs on force deploys need an upstream Ludus fix (add `Verbose` to `DeployRangeRequest`; pass `deployBody.Verbose` instead of `Force` into `RunRangeManagementAnsibleWithTag`).

## [1.1.9] - 2026-07-09

**LUX**

- [Fix] **GOAD extension playbooks** — SSH preamble `ANSIBLE_ROLES_PATH` now prepends `$GOAD_PATH/ansible/roles` so shared roles (`common`, `commonwkstn`, …) resolve when env overrides extension `ansible.cfg` `roles_path` (fixes `role 'common' was not found` on workstation extensions).

## [1.1.8] - 2026-07-07

**LUX**

- [Fix] **GOAD provisioning on Ludus** — Before each GOAD run, LUX installs missing Ansible roles/collections via Ludus API (`POST /ansible/collection`, `POST /ansible/role`) instead of `ansible-galaxy` over SSH, so installs are Ludus-tracked, visible on the Ansible page, and avoid permission errors writing into Ludus-managed collection trees.
- [Fix] **GOAD provisioning on Ludus** — After Ludus API install, LUX verifies canary collection plugin files on disk (e.g. `ansible.windows` → `win_dns_client.ps1`); broken or partial trees trigger a Ludus `force` reinstall before `ansible-playbook` runs, fixing `couldn't resolve module/action 'ansible.windows.win_dns_client'` when inventory listed the collection as installed.
- [Fix] **GOAD SSH preamble** — Export Ludus per-user Ansible env (`ANSIBLE_HOME`, `ANSIBLE_COLLECTIONS_PATH`, `ANSIBLE_ROLES_PATH`) so GOAD's venv `ansible-playbook` resolves collections Ludus installed under the user's tree; venv bootstrap remains on SSH (pip only).
- [Add] **Settings / env** — `LUDUS_INSTALL_PATH` (`/opt/ludus` default) for Ludus install root on the server; wired through Settings UI, Docker Compose, `.env.example`, OpenAPI, and `runtime-paths` helpers used by GOAD SSH, range log paths, and template discovery (no hardcoded `/opt/ludus` or `/opt/GOAD` in runtime code).
- [Improve] **GOAD paths** — All GOAD API routes and SSH helpers resolve `GOAD_PATH` via `resolveGoadPath()` instead of inline fallbacks.

## [1.1.7] - 2026-07-06

**LUX**

- [Add] **Log viewers** — All log windows (Range Logs, Dashboard deploy log, GOAD terminal, and the Templates / Blueprints / New Range / inventory config panes) are vertically resizable by dragging the bottom-right corner; the chosen height persists per view.
- [Add] **Configuration / Deploy New Range / GOAD** — Deploy **Only Roles** selector on Range Configuration, Deploy New Range wizard (Deploy Tags step), and Deploy New GOAD Instance (advanced panel); maps to Ludus `--only-roles` / `only_roles` API field and auto-includes the `user-defined-roles` tag when roles are selected.
- [Fix] **GOAD** — Switching GOAD instances now updates the sidebar active range so Range Logs stream the correct Ludus range.
- [Fix] **Log viewers** — ANSI stripping no longer corrupts bracketed text starting with `m` (e.g. `TASK [main : ...]`, `ok: [myhost]`); the SGR regex now requires a digit group so only real color codes are removed.
- [Fix] **Log viewers** — Carriage-return handling keeps a trailing-CR line's text (e.g. `downloading...\r`) instead of blanking it, and Packer phase-separator blank lines are preserved.
- [Fix] **Log viewers** — Packer `==>` build-step lines keep a readable highlight color in the light theme.
- [Fix] **E2E tests** — Corrected banner heading-level selectors in the perf and navigation specs so authenticated Playwright runs pass against the current header markup.
- [Improve] **Code quality** — ESLint cleanup: removed stale disable directives, stabilized `useMemo` / query-key inputs, and migrated avatar `<img>` tags to `next/image`.
- [Improve] **Configuration** — Deploy Host Limit parsing of range-config `router:`/`vm_name` now uses a YAML parser instead of regex, correctly handling comments, quoting, and nested structures.
- [Improve] **Deploy New Range** — Wizard and blueprint paths move deploy tags and only-roles to **Advanced tag options** on Review & Deploy collapsible panel; dedicated Deploy Tags wizard step removed. Deployment via Blueprint in wizard now adds editable config YAML plus the same advanced deploy options.
- [Improve] **Deploy New GOAD Instance** — Extension Ansible readiness shows a distinct "Checking Ansible…" state while loading (no more disabled button with an empty reason), and concurrent dependency installs track their own spinner without clobbering each other.
- [Improve] **GOAD** — Provider role discovery understands inline `roles: [a, b]` lists and `role:`/`name:`/`src:` dict refs; temporary wizard config files in `/tmp` are cleaned up.
- [Improve] **Templates** — Real (non-404) Ludus Sources errors are surfaced alongside the SSH-fallback failure instead of being silently swallowed.
- [Improve] **Reliability** — Centralized session/SSH-credential helpers, shared cache-revalidation, and replaced silent `catch {}` blocks with logged warnings across API routes; expanded unit-test coverage.
- [Security] **Ansible Galaxy search** — Proxy endpoint now requires an authenticated session and is rate-limited to prevent open, unauthenticated upstream fan-out.
- [Security] **Blueprints** — Deleting a source-catalog (global) blueprint now requires an admin session, enforced server-side.
- [Security] **Console / Profile** — Numeric `vmId` and node-name validation on console routes; avatar file paths are sanitized against path traversal.
- [Perf] **Log viewers** — Long logs (>500 lines) are virtualized (`@tanstack/react-virtual`) and share a single memoized line parser, keeping scroll and search smooth on large deploys while preserving auto-tail, jump-to-live, and search navigation.
- [Perf] **Log search** — Skips scanning while the search bar is closed and debounces re-scans during live streaming.
- [Perf] **Session requests** — Concurrent `/api/auth/session` calls fired by shell components on page load are coalesced into a single in-flight request (no stale caching), cutting the reload request fan-out.
- [Perf] **API polling** — Blueprint sharing details load only for blueprints that have shares; the Groups add-range dialog polls status only for selected ranges; Dashboard log-enrichment pauses while a deploy log is streaming; Templates build-log fetch skips re-render when the output is unchanged.
- [Perf] **Rendering** — Memoized Range / Impersonation / Deploy-log context values, a single shared elapsed-time ticker, memoized VM-table sorting and rows, and dynamic import of the Dashboard log viewer reduce re-renders and initial bundle size.

## [1.1.6] - 2026-06-22

**LUX**

- [Fix] **Templates** — Packer build logs strip ANSI escape codes (including literal `[1;32m` sequences from Ludus storage) so build output renders cleanly in the log viewer.

## [1.1.5] - 2026-06-26

**LUX**

- [Fix] **Configuration** — Deploy Host Limit uses `vm_name` from range config (not Ansible `hostname`) for Ludus `--limit`; the range router is omitted from the checkbox list and auto-included at deploy (Proxmox `vm_name`, including `{range_id}-router` shorthand) so DNS/network plays still run when limiting to other VMs.

## [1.1.4] - 2026-06-22

**LUX**

- [Add] **Deploy New GOAD Instance** — Review step shows generated Ludus `provider/config.yml` preview in an editable YAML editor; custom config is injected at deploy via Ludus CLI wrapper.
- [Add] **Deploy New GOAD Instance** — Ansible role/collection dependency checks with inline install on Review; extension checkboxes gated when required roles are missing (same pattern as template readiness).
- [Add] **GOAD instance Extensions tab** — Gate extension install on missing Ansible roles; **Install dependencies** inline; refresh catalog on instance load for `requiredRoles`.
- [Improve] **Deploy New Range (wizard)** — Review step uses inline Monaco YAML editor (editable generated config, reset/reload, validation) like the GOAD wizard.

## [1.1.3] - 2026-06-22

**LUX**

- [Add] **Configuration** — Deploy Host Limit panel on Range Configuration: checkbox host picker (config YAML + sync deployed VMs), maps to Ludus CLI `--limit` / `POST /range/deploy` `limit`; combinable with deploy tags.

## [1.1.2] - 2026-06-16

**LUX**

- [Fix] **Auth** — Sign out then sign in as another user no longer keeps prior username, badge, or role nav; logout clears client caches and uses full reload; login reloads layout with fresh session.
- [Fix] **Configuration / Deploy New Range / GOAD** — Deploy tag checkboxes now toggle correctly when clicking the checkbox itself (removed double-toggle from parent click + `onCheckedChange`).
- [Fix] **Range Logs** — Auto-scroll toolbar button no longer disappears on full page refresh; stream start waits for range selection and abort races no longer leave `isStreaming` stuck false.
- [Fix] **Testing Mode** — Same auto-scroll toolbar visibility fix as Range Logs.
- [Fix] **Sidebar** — Addressed issue where multiple nav items highlighted (e.g. Ludus Performance no longer also highlights Ranges Overview).
- [Add] **Blueprints** — Pencil edit on owned blueprints (Monaco YAML editor); source/global installs stay read-only — duplicate first to get an editable copy you own.
- [Add] **Sources** — New `/sources` page to register, sync, delete (with optional purge), and browse catalog status from Ludus 2.2.0 Sources API; feature-gated when server lacks Sources. Sources nav hidden unless connected Ludus is 2.2.0+ (page still reachable by URL).
- [Add] **Ansible Galaxy** — Search galaxy.ansible.com and install roles/collections from the UI; results group versions per artifact with expandable list (newest first).
- [Improve] **Templates / Blueprints** — Add-from-source catalog prefers Ludus-native listing (description, `min_ludus_version`) when Sources API is available; GitHub/GitLab tree fallback unchanged.
- [Improve] **Templates** — Source catalog distinguishes **Added** (on Ludus, not built) vs **Built**; main list uses same labels.
- [Improve] **Templates** — Build History moved below Add from Source.
- [Improve] **Templates** — Starting a build auto-scrolls to live Packer logs.
- [Improve] **Templates / Blueprints / Ansible** — Add-from-source defaults to registered Ludus sources with auto-fetch; GitHub/custom repo still available.
- [Improve] **UI** — Expandable section headers vertically centered (previously slightly off-center).

## [1.1.1] - 2026-06-15

**LUX**

- [Fix] **Testing Mode** — Start/stop no longer stuck on "Starting…" when ansible finished but Ludus/PocketBase lagged: SSH-first op-scoped log slice (2 MB), capped-length slicing before tail-anchor (avoids false matches on repeated ansible output), POST completion retries after PUT returns, and awaited PocketBase `testingEnabled` sync with backoff before the op is marked complete.
- [Fix] **Templates** — Official add-from-source catalog now pulls from GitHub `[badsectorlabs/ludus-source-bsl](https://github.com/badsectorlabs/ludus-source-bsl)` (replacing the retired GitLab `badsectorlabs/ludus` repo); shared `template-repo-client` handles GitLab and GitHub tree/raw APIs for list and add flows.
- [Add] **Blueprints** — Add from Source installs from `[badsectorlabs/ludus-source-bsl/blueprints](https://github.com/badsectorlabs/ludus-source-bsl/tree/main/blueprints)` via Ludus Sources when available, else `POST /blueprints` / from-range config upload from fetched YAML.
- [Add] **Deploy New Range** — Config method **From Blueprint** applies an installed or source blueprint then deploys.
- [Add] **Blueprints** — Apply dialog and range wizard **From Blueprint** check Ansible roles/collections against `GET /ansible`, list missing deps, and offer **Install dependencies** (`POST /blueprints/{id}/install` with per-item fallback).

## [1.1.0] - 2026-06-09

**LUX**

- [Add] **Next.js 16** — Upgraded to Next 16.2.7 and React 19; enabled `cacheComponents` with `AuthenticatedRoot` Suspense boundary and server-side LUX version cache on Settings.
- [Add] **SSR prefetch** — TanStack `HydrationBoundary` + non-blocking server prefetch on Users, Templates, Groups, Blueprints, Ansible, Dashboard, Logs, Snapshots, Testing, and Range Config pages (accessible ranges and version still prefetched globally in the root layout).
- [Add] **Selected range cookie** — httpOnly `__Host-lux_selected_range` mirrors sidebar selection (scope-tagged) via `POST /api/session/selected-range` so range-scoped pages can prefetch the correct range on first paint.
- [Add] **Ludus data cache** — `"use cache"` L2 layer (`cached-ludus-fetch.ts`) behind in-process SWR peek; `revalidateTag(tag, 'max')` invalidation on admin/range mutations and Ludus proxy writes (`ludus-cache-revalidate.ts`, `ludus-proxy-cache-invalidate.ts`).
- [Add] **Impersonation verify script** — `scripts/verify-impersonation-ssh.mjs` ships in the Docker image for live bashrc API-key reads (no manual UI retest).
- [Add] **LogViewer compound API** — `LogViewerCompound.Root|Toolbar|Search|Body` for composable log panes; adopted on Dashboard, Range Logs, Admin → Application Logs, Templates, Testing, and Range Config.
- [Add] **E2E** — GOAD task ACL unauthenticated (`e2e/goad-task-acl.spec.ts`); deploy tab smoke (`e2e/goad-instance-deploy.spec.ts`); Extensions/History tabs with auth (`e2e/goad-instance-tabs.spec.ts`).
- [Add] **Tests** — Unit coverage for bashrc API-key parsing, selected-range cookie resolution, Ludus group list parsing, snapshots view grouping, and Ludus proxy cache invalidation (112 tests).
- [Improve] **GOAD instance page** — Six typed tab modules (`goad-instance-tabs/`*), shell components (header, action bar, reassign dialog, tab triggers), and action hooks (`use-goad-run-action`, `use-goad-instance-action-handlers`); orchestrator ~1.2k lines (down from ~2.8k).
- [Improve] **Next 16 proxy** — Renamed `middleware.ts` → `proxy.ts` and `middleware()` → `proxy()` per Next 16 network-boundary convention (auth gate + security headers unchanged).
- [Improve] **Cache Components hygiene** — `markRouteDynamic()` in `getLayoutSession` and `requireAdminPage` before cookie reads under `cacheComponents`; `cached-lux-version` uses stable `cacheLife` import.
- [Improve] **Shared parsers** — `parseLudusGroupList`, `buildSnapshotsViewData`, and `NetworkSnapshot` type for Ludus list/YAML/network handling.
- [Improve] **Impersonation UX** — Toast surfaces server `message` when auto-fetch of `~/.bashrc` API key fails; range cookie cleared on impersonate start/stop and logout.
- [Perf] **Cold-start SSR** — Warm Ludus cache entries shared across Next workers; proxy mutations bust groups/blueprints/templates/ansible/ranges tags so the next navigation reflects Ludus writes without a hard refresh.
- [Fix] **CI lint** — Scoped npm `brace-expansion` override to `@eslint/config-array` so `npm run lint` no longer hits ESLint 9 circular-config validation on GitHub Actions.

---

## [1.0.7] - 2026-06-08

**LUX**

- [Security] **GOAD task API** — GET no longer returns `ludusApiKey` or log `lines`; list and detail share a public DTO. PATCH `/api/goad/tasks/[taskId]` and POST `link-instance` enforce task ownership (same as GET/stop/stream).
- [Security] **GOAD task secrets** — `goad_tasks.ludus_api_key` encrypted at rest in SQLite (migration v14).
- [Security] **Session vault** — API key, SSH password, and impersonation key moved server-side; cookie holds opaque `sessionId` only (migration v15). Edge middleware uses a SQLite-free session layer so the app stays healthy behind nginx.
- [Security] **Login** — Step two uses a one-time server continuation token so the SSH password is not re-sent from the browser; login blocked over plain HTTP in production. TLS/certificate failures surface as connection errors instead of a false “stale ~/.bashrc API key” prompt.
- [Security] **Admin gate** — Admin mutations re-validate `isAdmin` against Ludus live; impersonation POST validates `apiKey` matches the principal.
- [Security] **Deploy log SSE** — Errors sanitized via `safeClientError` in production.
- [Improve] **Settings secrets** — PBKDF2 (`enc:v2:`) with backward-compatible `enc:v1:` decrypt.
- [Perf] **Deploy log SSE** — Adaptive poll backoff (2s → 5s → 10s when idle); optional `LOG_STREAM_MAX_MS` cap.
- [Perf] **Range list** — Polling slows to 60s when the browser tab is hidden.
- [Improve] `/api/logo` — Public for favicon; `global-error.tsx` root fallback added.
- [Fix] **GOAD reconcile logs** — `/range/logs` no longer retries with `LUDUS_ROOT_API_KEY` when the task owner's Ludus user API key is set; empty HTTP body during deploy uses SSH `ansible.log` instead of spurious root-key 401 warnings.
- [Fix] **Admin impersonation** — `setSessionCookie` no longer re-writes vault secrets into the cookie (which wiped `impersonationApiKey` on the next request); proxy and prefetch again scope Ludus calls to the impersonated user.
- [Fix] **Users → WireGuard** — Admin download for another user reads their `LUDUS_API_KEY` from `~/.bashrc` and calls Ludus as them (`GET /api/admin/user-wireguard`); Ludus `/user/wireguard` is scoped to the caller's API key, not `X-Impersonate-User`.
- [Improve] **Build** — ESLint runs during production builds (`eslint.ignoreDuringBuilds: false`).
- [Add] **Tests** — Unit coverage for GOAD ACL DTO, `requireAdmin`, session vault, and at-rest encryption; Playwright smoke for GOAD task ACL, auth gates, login UI, and public health/logo routes.
- [Docs] **Architecture & environment** — Session vault, TLS policy, and single-instance constraints documented.

---

## [1.0.6] - 2026-06-04

**LUX**

- [Fix] **GOAD deploy (overwrite existing range)** — Wait for Ludus VM destroy to finish before starting GOAD so dynamic inventory does not fail mid-teardown (stuck deploy after VM wipe).
- [Fix] **GOAD deploy (overwrite existing range)** — Regenerate workspace `config.yml` and inventory files before Provide/Install when reusing an existing GOAD instance (`update_instance_files` REPL + `refresh-workspace` API to sync `instance.json` extensions).
- [Fix] **GOAD deploy logs** — Pass `instanceId` into execute, `?goadTaskId=` on redirect, and retry task resume on the instance page so the GOAD log panel streams without a manual refresh.

---

## [1.0.5] — 2026-06-02

**LUX**

- [Add] **Admin → Application Logs** — Admin Application Logs page with live streaming of sign-in and application events. Ludus proxy and LUX API routes log user actions so the Application filter is populated, not only auth events.
- [Add] Structured application event logging for settings, impersonation, user roles, ranges, and GOAD.
- [Fix] Settings admin controls respect current Ludus admin role (live revalidation on session refresh).
- [Fix] **Testing Mode** — PocketBase `testingEnabled` reconciles when Ludus/ansible finishes (op-scoped, log slice after op start) so UI matches backend state.
- [Fix] **Testing Mode** — Op completion follows op-scoped ansible logs first; PocketBase sync is best-effort only. Removed passive pb-status reconcile that could fight in-flight ops and flip `testingEnabled` wrong.
- [Fix] **Testing Mode** — Log markers persisted in SQLite so op completion survives container restart; full-tail fallback when marker missing.
- [Fix] **Range Logs** — History timestamps anchor to ansible.log mtime on Ludus host instead of browser refresh time.
- [Improve] **Testing Mode** — Range selection locked on the Testing page and sidebar Active Range dropdown while start/stop is in progress.
- [Improve] Ludus Performance moved from Settings to Admin → Performance.
- [Security] Shorter session lifetime (eight hours).
- [Security] Login rate limiting to slow down password guessing (one-minute lockout after too many attempts).
- [Security] Stronger upload checks for profile images and the site logo (10 MB logo limit).
- [Security] Safer error pages and API responses in production.
- [Security] Improved web server and TLS settings behind nginx.
- [Security] Console connections use single-use access tokens.
- [Security] Sign-in and sign-out events are written to the application log.
- [Security] **vitest** 4.1.8 — patches GHSA-5xrq-8626-4rwp / CVE-2026-47429

---

## [1.0.4] — 2026-05-28

**LUX**

- [Fix] **Testing Mode** — Start/stop progress labels (button, log panel, alerts) follow PocketBase `testingEnabled` instead of the DB op record, so stopping testing no longer briefly shows "Starting Testing Mode…" while Ludus is still processing.
- [Fix] **Settings → Ludus Performance** — CPU chart reads utilization from Proxmox `pvesh get /cluster/resources` (pvestatd) instead of `/nodes/{node}/status`, which often reported 0% on independent polls.
- [Add] **Settings → About → Release notes** — Keyword search and quick filters by tag (Add, Fix, Enhance, …) across version titles, groups (LUX/GOAD), and descriptions, with match counts, auto-expanded hits, and highlighted terms.
- [Improve] **CHANGELOG** — Retired generic `[Change]` tag; all historical bullets recategorized (see [tag guide](https://github.com/ryokubaka/ludus-ux/blob/main/CHANGELOG.md)).
- [Improve] **Ranges Overview** — Hide the **ROOT** user row from Users & Ranges; ROOT is admin-only and not a Ludus utilization user.
- [Docs] **Templates** — New [docs/templates.md](docs/templates.md): how the Templates page works (build, add-from-source, logs), Proxmox permissions for `iso_download_pve`, and troubleshooting `403 Permission check failed` when `AccessNetwork` ACL is on the wrong node (e.g. `/nodes/127.0.0.1` vs `proxmox_node`).

---

## [1.0.3] — 2026-05-26

**LUX**

- [Improve] **Dashboard → VM power** — Per-VM and bulk power on/off stay in a pending/spinning state until Ludus confirms each VM is running or stopped; status shows **Starting…** / **Stopping…**; **All On** / **All Off** spin until every targeted VM confirms (slow Ludus timeouts still poll for confirmation).
- [Fix] **Post-GOAD firewall redeploy banner** — Step 2 no longer sticks after **Deploy Tags: network** succeeds; empty-template Ludus history rows now match in terminal state (not only while `running`), GOAD tasks poll while `phase=network-deploy`, and the dashboard clears stale phase when history already shows completion.
- [Security] **ws** 8.21.0 — patches GHSA-58qx-3vcg-4xpx / CVE-2026-45736; **brace-expansion** 5.0.6+ override — patches GHSA-jxxr-4gwj-5jf2 / CVE-2026-45149.

---

## [1.0.2] — 2026-05-22

**LUX**

- [Fix] **GOAD instance → Extensions tab** — Long extension lists scroll inside the tab panel again (scrollbar visible); same layout fix for **Lab Info** and **Inventories** tabs when content exceeds the viewport.
- [Improve] **GOAD extensions (no new VMs)** — Extensions with no Ludus machines show **Provision** instead of **Install** and confirm Ansible-only enablement (no range deploy). Feature requires modification to GOAD (see [goad-mod](https://github.com/ryokubaka/goad-mod)). Normal GOAD will execute `ludus range deploy` even for a zero-VM extension.

---

## [1.0.1] — 2026-05-14

**LUX**

- [Add] **Quickstart** — `scripts/quickstart.sh` supports `--full`, `--menu`, and an in-script choice of a lighter **menu** versus the **full wizard** again.
- [Add] **Quickstart** — During interactive setup, the script can install `sudo` on the Ludus/Proxmox SSH target where minimal Debian-style installs omit it
- [Improve] **Quickstart** — Publishes your `SSH_KEY_PATH`/`id_rsa` public half to the Ludus server to address SSH key only based authentication 
- [Fix] **Range creation** `userID` — Client `ludusApi.createRange` resolves the caller’s Ludus `userID` instead of incorrect `name`
- [Fix] **Admin impersonation** — “Manage as” stores `userID`, `name`, and **SSH login** separately so Ludus range APIs see the real `userID`, SSH/GOAD still use `proxmoxUsername` (`name` fallback), instead of collapsing everything into `name` and breaking impersonated workflows
- [Fix] **Settings merge** — Empty `proxmoxSshPassword` / `proxmoxSshUser` values stored in SQLite no longer override `PROXMOX_SSH_`* from the environment (same idea as the root API key), so `.env` Proxmox SSH credentials are not masked after a Settings save with blank fields.
- [Fix] **Ranges Overview → shared services (ADMIN pool)** — `/api/admin/shared-vms` and `/api/admin/vm` now authenticate to Proxmox only with configured root SSH: `PROXMOX_SSH_USER`, `PROXMOX_SSH_PASSWORD`, and/or the mounted private key. They no longer reuse the browser session’s Ludus SSH password.
- [Fix] **Shared VM start/stop** — `PUT /api/admin/vm` accepts key-only Proxmox auth (previously required a non-empty password even when a root key was mounted).

**GOAD**

- [Fix] **Long** `provide` **→** `provision_lab` **stall** — `goad-ludus-reconcile` now resolves the Ludus range from `.goad_range_id`, SQLite `goad_instance_ranges`, or `deploy_handoffs` (by `taskId` / `instanceId`) when the SSH sidecar file is missing. **Deploy-poll detection** accepts a few alternate Ludus status strings. `appendLine` **reconcile** no longer joins the entire in-memory GOAD log (was O(n) every 6 lines and could freeze Node on 30+ minute streams); it passes the last **25 000** lines only so PocketBase `SUCCESS` patching keeps up and GOAD can exit `provide` into `provision_lab`.

**Docs**

- [Improve] **Getting started (requirements)** — Optional GOAD row now calls out `sudo` on the Ludus server for minimal Debian/Proxmox-style installs (`apt`-style reminder).

---

## [1.0.0] — 2026-05-13

**LUX**

- [Add] First stable release — out of beta!
- [Add] **Range Configuration → Firewall Rules** — Toolbar next to **Apply to Config** adds **Save Config**, **Force** (same testing-mode `--force` flag as the page header), and **Deploy Firewall Rules** (merge rules into YAML, save to Ludus, then deploy with the `network` tag only).
- [Docs] **README** — Root readme is a short overview + quick links; long-form install, SSH, env, features, architecture, dev, API, and screenshots live under **[docs/](docs/index.md)**.
- [Improve] **Range logs → History** — Saved deploy logs show clock times the same way as the live log, in order top to bottom, without confusing extra digits on the time.
- [Improve] **Groups → remove a shared range** — Adding or removing a range from a group may need that range’s **router** machine turned on first. Dialog box now allows router power operations and ability to add/remove from the group.
- [Improve] **Refresh feedback** — Groups, GOAD home (including recent activity), and the console **Reconnect** button show a brief spinner while things load again.
- [Fix] **Range sidebar** — `refreshRanges()` now invalidates every scoped `ranges/accessible` query so deleted ranges disappear reliably after impersonation / cache timing quirks
- [Fix] **Dashboard** — No more brief HTTP 400 error on the home dashboard while a range is deploying or live logs are connecting
- [Fix] **GOAD → Deploy New Instance** — Abort deploy (with toast) when dedicated Ludus range creation fails instead of running GOAD with no `LUDUS_RANGE_ID`; re-select that range and refresh the accessible-range list before redirect so the shell sidebar matches the GOAD lab
- [Fix] **Ludus admin & range creation** — Infer admin API URL when unset; `POST /ranges/create` (and GOAD init-range) use the session Ludus key first, with optional ROOT fallback.
- [Fix] **Settings root API key** — Persists to SQLite, encrypted at rest, env overrides DB, trims BOM/quotes.
- [Security] **Impersonation API key** removed from `sessionStorage` — key lives only in the encrypted `httpOnly` session cookie; all server routes derive it via `resolveAdminImpersonationFromRequest`
- [Security] **Task stream IDOR** — non-admin access to `/api/goad/tasks/:id/stream` for an unknown task now returns 404
- [Security] **Proxy error sanitisation** — internal exception details logged server-side only; client receives generic `"Internal proxy error"`
- [Security] **Impersonation header merge** — both `X-Impersonate-`* headers required together; a single header falls back to the session cookie
- [Perf] **GOAD wizard redirect** — instant redirect to instance page on first `[TASKID]` SSE event; 30-minute poll removed
- [Perf] **TanStack** `staleTime` **audit** — admin ranges, GOAD instance lists, and task lists promoted to `STALE.medium`

**GOAD**

- [Add] **Resizable log split** — Drag the center handle between **Ludus range logs** and **GOAD logs** on Deploy Status and Logs History; panel widths persist (browser localStorage).
- [Improve] **GOAD deploy history** — History rows read more clearly when a small firewall-only redeploy comes right after a big GOAD run, so labels and GOAD log groupings are less likely to look wrong.
- [Improve] **GOAD terminal** — If the live stream ends without a clear “finished with exit code …” line, the UI still learns success or failure from the server once the task has stopped.
- [Fix] **Range logs** — Ansible line colouring ignores benign JSON `"failed": false`; GOAD instance/new pages fill the shell below the impersonation banner without hard-coded `100vh` offsets.
- [Fix] **Extension Installations** — Lab setup and each add-on now run one after another on the server so nothing gets skipped.

**Docs**

- [Add] `docs/workflows.md` — plain-English guide: Ludus ranges, GOAD instances, two-stage deploy, redeployment, network rules queue, and admin impersonation
- [Add] `docs/architecture.md` — GOAD task flow diagram, SSE stream resume notes, updated design decisions
- [Add] `docs/features.md` — dedicated Admin Impersonation and GOAD redeploy semantics sections
- [Add] `docs/about.md` — GOAD ↔ Ludus relationship summary

---

## [0.9.9] — 2026-05-07

**LUX**

- [Improve] **Slow Ludus responses** — The app waits longer for heavy work (snapshots, deploys, powering VMs, template builds, testing allow/deny, and similar). If the wait times out but the job might still be running, messaging is clearer and many pages refresh their view instead of only showing a scary error.
- [Improve] **Log timestamps** — Live range/GOAD lines use the Ludus host’s clock when SSH is set up, so times read like the server you’re deploying to—not only the app container’s timezone.
- [Perf] **Post-refresh load time** — PBKDF2 session key is derived once per process (middleware + RSC no longer repeat expensive crypto); TanStack no longer invalidates hydrated range/blueprint cache on every mount; sidebar nav links use `prefetch={false}` to cut RSC storms; server passes a small **shell session** snapshot so the header/sidebar skip redundant `/api/auth/session` calls; effective scope skips a network round-trip when it already matches the server.
- [Add] **Settings → Ludus Performance** — Live charts (CPU, memory, load) for every Proxmox node returned by `pvesh`, polled over root SSH (same auth as SSH & GOAD).
- [Fix] **Snapshots page** — Create, revert, and delete now match what Ludus expects and stay tied to the range you selected, so bulk actions actually run instead of looking like they did nothing.
- [Fix] **Testing mode stop stuck** — Treat Ludus ERROR/ABORTED as terminal for testing ops (Ansible can fail mid-play while state still looks deploying). One automatic `testing/stop` retry after 4 min; POST body `dismissStuckOp` clears a stuck DB op; Testing page shows **Unlock UI** after 90s and toasts on server-reported op failure.

**GOAD**

- [Add] **GOAD lab — Range logs** — **Refresh** on the range log panel reconnects the live stream when new lines stop appearing (handy right after kicking off a deploy).
- [Add] **GOAD lab — Install** — One action runs **Provide** then **Provision lab** with a plain-language confirmation. Action order is Install → Provide → Provision Lab → Sync IPs, then the rest; only **Install** stays highlighted in green.
- [Fix] **GOAD provide → provision (Ludus)** — `goad-ludus-reconcile` uses a **3 MB** Ludus log tail (was 200 KB), strips `[HH:MM:SS]` prefixes before PLAY RECAP parsing, throttled `[goad-ludus-reconcile]` diagnostics when root API key / `instanceId` / `.goad_range_id` / admin range state are missing or `/range/logs` fails, **8** deploy-poll lines when recap is only in Ludus logs (was 10), and reconcile runs every **12** GOAD log lines (was 18).

---

## [0.9.8] — 2026-05-06

**LUX**

- [Breaking] **Docker / TLS layout** — Compose includes an **nginx** edge container (`ludus-ux-web`) for HTTPS on host **:443**; Defaults `DISABLE_HTTPS=true` + `TRUST_PROXY_TLS=true` so session cookies stay correct behind TLS termination. 
  - **TLS PEMs** for nginx moved from repo-root `certificates/` to `docker/nginx/certificates/` (`cert.pem`, `key.pem`) — **migrate files** before or after pull; nginx generates self-signed certs on first boot if missing.
- [Fix] Admin delete user — purge PocketBase `logs` rows that reference the user (`POST /api/users/purge-pocketbase-logs`) before Ludus `DELETE /user`; fixes referential integrity errors when deploy-run history exists
- [Fix] GOAD terminal word wrap — inner `<pre>` replaced with `<div>` (`white-space: pre` blocked wrapping); wrap on by default; scroll pane `min-w-0` for flex shrink
- [Improve] Light log theme — black body text on GOAD terminal and shared `LogViewer`; Ansible / PLAY RECAP line colours for light backgrounds via `ansibleClassForTheme`

**GOAD**

- [Fix] `provide` stuck on **deployment in progress (DEPLOYING)** after Ansible **PLAY RECAP** succeeds — LUX watches streamed GOAD logs; when Ludus never flips PocketBase `rangeState` off DEPLOYING/WAITING, writes **SUCCESS** via PB (same escape hatch as abort; requires configured Ludus root API key and root SSH to read `.goad_range_id`)
- [Fix] Dedicated-range deploy uses the logged-in API user — seed missing `~/.goad/goad.ini` with GOAD’s stock sections plus `[ludus] use_impersonation=no` before `goad.sh` (GOAD does not overwrite an existing file)
- [Fix] Ludus CLI shim omits `--range` for `ludus user …` so `user list` / `user list all` match GOAD expectations
- [Fix] When `LUDUS_RANGE_ID` is set, patch `use_impersonation=no` before and after `goad.sh` so stale configs cannot re-enable synthetic-user mode mid-session

---

## [0.9.7] — 2026-05-04

**LUX**

- [Add] Playwright smoke (`npm run test:e2e`) — optional `E2E_*` env vars; see `config/playwright.config.ts`
- [Add] Playwright: health, auth-gate, login UI, navigation, logout (`e2e/helpers/auth.ts`)
- [Improve] Tooling layout: `config/next.config.cjs`, `tailwind.config.ts`, `playwright.config.ts`, `postcss.config.cjs`, and `tsconfig.base.json` under `config/`
- [Perf] TanStack cache + `localStorage` namespaced per login/impersonation scope (`@sc` query keys); dashboard inventory cache keyed by scope; manual refresh no longer blocked by 15s poll
- [Fix] Admin manual impersonation waits for `/api/auth/impersonate` cookie before navigating home
- [Fix] Login: derive `isAdmin` from the correct Ludus `GET /user` row when the API returns an array; fixes missing admin sidebar for real admins
- [Fix] Stop calling Ludus `GET /range` without `rangeID` (404 on v2); dashboard range query waits for selection; logs page passes `rangeID`; remove SSR prefetch that hit bare `/range`
- [Fix] Dashboard: merge partial or empty `GET /range` VM lists with cached rows — use `numberOfVMs` when it exceeds `VMs.length`, union-merge subset responses; manual refresh / 15s poll no longer intermittently drops VMs

---

## [0.9.6] — 2026-04-29

**LUX**

- [Add] Range Configuration: optional **Force save & deploy** (`--force`) for Ludus testing mode — applies to config upload and to `POST /range/deploy`
- [Add] Dashboard: **Destroy all VMs** (range object kept) via `DELETE /range/{rangeID}/vms`; confirmation copy contrasts with **Delete Range**
- [Add] VM Operations audit entry for bulk destroy-all-VMs
- [Fix] `ConfirmBar` preserves newline characters in multi-line confirmation prompts (`whitespace-pre-line`)
- [Fix] Configuration page: removed non-functional yaml-language-server schema tip banner
- [Security] **postcss** 8.5.10+ (CVE-2026-41305 / GHSA-qx2v-qp2m-jg93) — direct devDependency; `overrides.next.postcss` so Next’s nested copy matches patched release

---

## [0.9.5] — 2026-04-28

**LUX**

- [Add] Additional controls on streamed and static logs — pause (freeze display while the buffer keeps filling), toggle auto-follow, font size stepper (A− / A+), word-wrap, light vs dark log pane, search with match navigation, copy all, download, clear
- [Add] Shared `LogDockToolbar` across `LogViewer` (Dashboard, Range Logs, Templates, Testing, Range Config, …) and `GoadTerminal` (GOAD instance pages); Range Logs toolbar shows Live when SSE is connected
- [Fix] Log body font-size now follows the toolbar (`.log-line` no longer pinned `text-xs`, which blocked resizing on Ludus Ansible output)
- [Fix] noVNC resolves the Proxmox node from cluster resources by VMID before creating the VNC proxy ticket, instead of assuming the first node.
- [Fix] noVNC missing-password errors now clearly explain that Proxmox HTTP tickets require the user's PAM password; SSH keys still work for SPICE and `pvesh` paths only.
- [Fix] noVNC now authenticates to Proxmox as the logged-in LUX user's PAM account (`proxmoxUsername@pam`) using the user's session password, instead of reusing `PROXMOX_SSH_USER` / root PAM credentials.
- [Security] `proxmoxSshPassword` saved from the Settings UI is encrypted at rest in SQLite using `APP_SECRET`; existing plaintext values are rewritten encrypted on next settings load.
- [Docs] README now separates root SSH auth from browser-console PAM auth and adds VNC 401 troubleshooting.
- [Docs] Quickstart now explains the optional root `PROXMOX_SSH_PASSWORD` and that in-browser noVNC uses the logged-in user's password.
- [Docs] `scripts/upgrade.sh` — upgrade/downgrade helper; quiet `git fetch`, lists active remote branches and tags via `git ls-remote` (no stale deleted branches), supports tag checkout; README section updated.

---

## [0.9.4] — 2026-04-20

**LUX**

- [Fix] Range stuck in "Deploying…" / Abort visible after deploy errors — `deploying` flag now cleared when Ludus GET returns a terminal state; stream-completion fallback added for streams that end without a `[DONE]` message
- [Add] Deploy History and Build History — click any past run to view full output; paginated (5/page)
- [Add] VM operation audit log — per-VM destroy and extension removal logged on Dashboard and Range Logs
- [Add] Per-VM destroy action from the Dashboard range card
- [Add] Settings page redesigned with tabs (General, SSH & GOAD, Branding, About)
- [Add] About tab — version badge, release notes accordion, and dependency list
- [Fix] Abort shows "Aborting…" immediately and polls until range exits DEPLOYING
- [Fix] Power On/Off scoped to selected range — fixes errors on non-default ranges
- [Fix] Monaco NLS console warning and favicon 404 eliminated
- [Fix] Range Config save toast surfaces actual Ludus error instead of generic message
- [Security] Next.js 15.5.15 — patches GHSA-q4gf-8mx6-v5v3 (Server Components DoS)

**GOAD**

- [Add] Deployment pipeline graphic (Step 1 → Step 2) shown when post-GOAD firewall restore is needed
- [Add] Live elapsed-time timers on GOAD Deploy Status and dashboard; persist across page refresh
- [Add] GOAD terminal streams to any browser or session — sessionStorage dependency removed
- [Add] Dashboard pulsing GOAD badge and in-card banner while Ansible provisioning runs
- [Add] "Open GOAD Instance" jump button on Dashboard for GOAD-mapped ranges
- [Add] Unified GOAD + Ludus row in Logs History with correlated metadata and timing
- [Add] Remove extension — destroys Ludus VMs and strips entries from range-config.yml
- [Fix] GOAD logs stream correctly on page refresh — no longer stuck on empty terminal
- [Fix] Abort button deduplicated — single control in toolbar only
- [Fix] Network YAML comparison now semantic — eliminates false-positive post-GOAD firewall deploys
- [Fix] Trailing quote removed from GOAD Logs History extension names
- [Fix] Ansible `{{ range_id }}` resolved to actual value in VM operation audit entries
- [Add] GOAD task phase, network flags, and start time persisted server-side in SQLite

---

## [0.9.3] — 2026-04-10

**LUX**

- [Add] Firewall Rules visual editor on Range Configuration page (drag-and-drop reorder)
- [Add] Firewall Rules step in Deploy New Range wizard
- [Add] VLAN smart dropdowns — grouped Range VLANs, Special keywords, and Custom number
- [Add] NetworkRule / NetworkConfig types and utility functions in network-rules.ts
- [Fix] Deploy Logs not streaming — correctly passes selectedRangeId to startStreaming
- [Fix] Ansible ports schema error — `ports: all` emitted when `protocol: all`
- [Fix] iptables rule ordering — rules written reversed to match Ludus `-I` insert semantics
- [Fix] Deploy Logs panel moved above toolbar for immediate visibility without scrolling
- [Improve] Protocol and Action dropdowns display text centred for readability

**GOAD**

- [Add] Firewall Rules step in Deploy New GOAD Instance wizard

---

## [0.9.2] — 2026-04-02

- [Security] Next.js 15.5.14 — patches GHSA-h25m-26qc-wcjf (RSC-related DoS)
- [Fix] React 18.3.1 pinned as minimum for Next 15 compatibility

---

## [0.9.1] — 2026-04-01

- [Add] Root SSH via private key — mount Ludus host root key; optional password fallback
- [Add] Settings → Test root SSH & admin API with SSH key probe diagnostics
- [Add] Blueprints — sharing and apply workflows (current vs new range)
- [Add] Groups — checklist UX for assigning ranges and users
- [Fix] Root SSH mount edge cases — CRLF normalisation, chown, clearer auth error messages

---

## [0.9.0] — 2026-03-30

**LUX**

- [Add] Initial beta release — web UI for Ludus cyber range management
- [Add] Dashboard with live range status, deployment state, and VM overview
- [Add] Deploy New Range wizard (multi-step) and raw YAML mode
- [Add] Range Configuration editor with syntax highlighting and live deploy
- [Add] Testing Mode with SQLite-backed durable state and allowed domains/IPs
- [Add] Snapshots, Blueprints, and Ansible Roles pages
- [Add] Range Logs with SSE streaming and download
- [Add] Admin: Ranges Overview, Users, and Groups management
- [Add] noVNC in-browser VM console via Proxmox WebSocket proxy
- [Add] PocketBase integration for authoritative range and testing state
- [Add] SSH admin tunnel for Ludus admin API access from Docker
- [Add] HTTPS support with self-signed or custom TLS certificates
- [Add] Custom branding — uploadable logo and configurable app name
- [Add] Dark/light theme, sidebar range selector, and session-aware impersonation

**GOAD**

- [Add] GOAD Management — deploy, manage, and stream GOAD instances

