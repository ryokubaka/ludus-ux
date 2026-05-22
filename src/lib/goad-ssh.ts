/**
 * GOAD SSH integration - runs server-side only.
 * Connects to the Ludus server via SSH and runs goad commands.
 *
 * All public GOAD functions accept an optional SSHCreds parameter.
 * When provided (user-facing operations), the logged-in user's own
 * SSH credentials are used so that GOAD runs in their personal context.
 * When omitted (e.g. admin/root operations like change-password), the
 * root credentials from the settings store are used as fallback.
 */

import type { NextRequest } from "next/server"
import { Client as SSHClient, ConnectConfig, type ClientChannel } from "ssh2"
import type { GoadInstance, GoadCatalog } from "./types"
import { resolveAdminImpersonationFromRequest } from "./admin-impersonation-request"
import type { SessionData } from "./session"
import { getSettings } from "./settings-store"
import { readPrivateKey, getSshKeyPassphrase, isRootProxmoxSshConfigured } from "./root-ssh-auth"
import { filterLudusDeployTags } from "./ludus-deploy-tags"

// ── ludus CLI wrapper script (decoded on the remote host) ─────────────────
//
// REAL_LUDUS_PATH is replaced by sed at deploy time with the actual binary path.
// Two responsibilities:
//  1. Inject --range $LUDUS_RANGE_ID into every ludus call (range scoping).
//  2. For `range config set -f <file>`: re-inject the user's network: block from
//     a sidecar JSON written by sync-network, so GOAD's template regeneration
//     (which wipes the block) doesn't cause iptables to be flushed during deploy.
const LUDUS_WRAPPER_SH = [
  '#!/bin/sh',
  '_R="REAL_LUDUS_PATH"',
  '',
  '# Do not scope `ludus user …` — GOAD checks global users (lab-user IDs vs',
  '# `user list all`).  With --range, the catalog can omit entries and GOAD',
  '# wrongly runs `ludus user add` for the synthetic lab user.',
  'if [ "$1" = "user" ]; then',
  '  exec "$_R" "$@"',
  'fi',
  '',
  '# Firewall preservation: detect `range config set` anywhere in argv (GOAD',
  '# prepends `--user <id>` when impersonating — see goad/command/linux.py).',
  '_has_rcs=0',
  '_p2=""',
  '_p1=""',
  'for _a in "$@"; do',
  '  if [ "$_p2" = "range" ] && [ "$_p1" = "config" ] && [ "$_a" = "set" ]; then',
  '    _has_rcs=1',
  '    break',
  '  fi',
  '  _p2="$_p1"',
  '  _p1="$_a"',
  'done',
  '',
  'if [ "$_has_rcs" -eq 1 ]; then',
  '  _CF=""',
  '  _P=""',
  '  for _a in "$@"; do',
  '    case "$_P" in -f|-c) _CF="$_a"; break;; esac',
  '    _P="$_a"',
  '  done',
  '  if [ -n "$_CF" ]; then',
  '    _SD="$(dirname "$_CF")/.lux-network-snapshot.json"',
  '    if [ -f "$_SD" ]; then',
  "      _LUX_ERR=$(mktemp 2>/dev/null || echo /tmp/lux-net-err.$$)",
  // python3 -c: double-quoted strings only inside single-quoted -c body.
  "      if ! python3 -c '",
  'import json,yaml,sys',
  'with open(sys.argv[2]) as f: n=json.load(f)',
  'with open(sys.argv[1]) as f: d=yaml.safe_load(f) or {}',
  'if isinstance(d,dict):',
  ' d["network"]=n',
  ' with open(sys.argv[1],"w") as f: yaml.safe_dump(d,f,default_flow_style=False,sort_keys=False)',
  "' \"$_CF\" \"$_SD\" 2>\"$_LUX_ERR\"; then",
  '        echo "[LUX] network snapshot merge failed (config + .lux-network-snapshot.json). First lines of stderr:" >&2',
  '        head -n 8 "$_LUX_ERR" >&2',
  '      fi',
  '      rm -f "$_LUX_ERR" 2>/dev/null',
  '    fi',
  '  fi',
  'fi',
  '',
  '# Optional: limit `ludus range deploy` (LUX GOAD / Range wizards — GOAD_LUDUS_DEPLOY_TAGS comma list).',
  '_has_rd=0',
  '_p1=""',
  'for _a in "$@"; do',
  '  if [ "$_p1" = "range" ] && [ "$_a" = "deploy" ]; then',
  '    _has_rd=1',
  '    break',
  '  fi',
  '  _p1="$_a"',
  'done',
  'if [ "$_has_rd" -eq 1 ] && [ -n "${GOAD_LUDUS_DEPLOY_TAGS:-}" ]; then',
  '  _has_t=0',
  '  for _a in "$@"; do',
  '    case "$_a" in --tags|-t) _has_t=1;; esac',
  '  done',
  '  if [ "$_has_t" -eq 0 ]; then',
  '    set -- "$@" --tags "$GOAD_LUDUS_DEPLOY_TAGS"',
  '  fi',
  'fi',
  '',
  '# Range scoping: inject --range unless already supplied.',
  'for _a in "$@"; do case "$_a" in --range|-r) exec "$_R" "$@";; esac; done',
  'exec "$_R" --range "$LUDUS_RANGE_ID" "$@"',
].join('\n')
const LUDUS_WRAPPER_B64 = Buffer.from(LUDUS_WRAPPER_SH).toString("base64")

/**
 * When ~/.goad/goad.ini is missing, write the same template GOAD's Config.create_config_file()
 * would produce (goad/config.py) with [ludus] use_impersonation=no. GOAD only creates the file
 * if absent — it does not overwrite an existing path — so this pre-seed is not clobbered at startup.
 */
const GOAD_FIRST_RUN_INI_SEED_B64 = Buffer.from(
  [
    "import configparser, os, sys",
    'ini = os.path.expanduser("~/.goad/goad.ini")',
    "if os.path.isfile(ini):",
    "    sys.exit(0)",
    'cdir = os.path.expanduser("~/.goad")',
    "os.makedirs(cdir, mode=0o750, exist_ok=True)",
    "cfg = configparser.ConfigParser(allow_no_value=True)",
    "cfg.add_section('default')",
    "cfg.set('default', '; lab: GOAD / GOAD-Light / MINILAB / NHA / SCCM')",
    "cfg.set('default', 'lab', 'GOAD')",
    "cfg.set('default', '; provider : virtualbox / vmware / vmware_esxi / aws / azure / proxmox')",
    "cfg.set('default', 'provider', 'vmware')",
    "cfg.set('default', '; provisioner method : local / remote')",
    "cfg.set('default', 'provisioner', 'local')",
    "cfg.set('default', '; ip_range (3 first ip digits)')",
    "cfg.set('default', 'ip_range', '192.168.56')",
    "cfg.add_section('aws')",
    "cfg.set('aws', 'aws_region', 'eu-west-3')",
    "cfg.set('aws', 'aws_zone', 'eu-west-3c')",
    "cfg.add_section('azure')",
    "cfg.set('azure', 'az_location', 'westeurope')",
    "cfg.add_section('proxmox')",
    "cfg.set('proxmox', 'pm_api_url', 'https://192.168.1.1:8006/api2/json')",
    "cfg.set('proxmox', 'pm_user', 'infra_as_code@pve')",
    "cfg.set('proxmox', 'pm_node', 'GOAD')",
    "cfg.set('proxmox', 'pm_pool', 'GOAD')",
    "cfg.set('proxmox', 'pm_full_clone', 'false')",
    "cfg.set('proxmox', 'pm_storage', 'local')",
    "cfg.set('proxmox', 'pm_vlan', '10')",
    "cfg.set('proxmox', 'pm_network_bridge', 'vmbr3')",
    "cfg.set('proxmox', 'pm_network_model', 'e1000')",
    "cfg.add_section('proxmox_templates_id')",
    "cfg.set('proxmox_templates_id', 'WinServer2019_x64', '201900')",
    "cfg.set('proxmox_templates_id', 'WinServer2016_x64', '201600')",
    "cfg.set('proxmox_templates_id', 'WinServer2022_x64', '202201')",
    "cfg.set('proxmox_templates_id', 'WinServer2025_x64', '202501')",
    "cfg.set('proxmox_templates_id', 'WinServer2019_x64_utd', '201901')",
    "cfg.set('proxmox_templates_id', 'Windows10_22h2_x64', '102221')",
    "cfg.set('proxmox_templates_id', 'Windows11_23h2_x64', '112321')",
    "cfg.set('proxmox_templates_id', 'Windows11_24h2_x64', '112421')",
    "cfg.set('proxmox_templates_id', 'Windows11_25h2_x64', '112521')",
    "cfg.set('proxmox_templates_id', 'Ubuntu_2204_x64', '922040')",
    "cfg.set('proxmox_templates_id', 'Ubuntu_2404_x64', '924040')",
    "cfg.add_section('ludus')",
    "cfg.set('ludus', '; api key must not have % if you have a % in it, change it by a %%')",
    "cfg.set('ludus', 'ludus_api_key', 'change_me')",
    "cfg.set('ludus', 'use_impersonation', 'no')",
    "cfg.add_section('vmware_esxi')",
    "cfg.set('vmware_esxi', 'esxi_hostname', '10.10.10.10')",
    "cfg.set('vmware_esxi', 'esxi_username', 'root')",
    "cfg.set('vmware_esxi', 'esxi_password', 'password')",
    "cfg.set('vmware_esxi', 'esxi_net_nat', 'VM Network')",
    "cfg.set('vmware_esxi', 'esxi_net_domain', 'GOAD-LAN')",
    "cfg.set('vmware_esxi', 'esxi_datastore', 'datastore1')",
    "with open(ini, 'w') as f:",
    "    cfg.write(f)",
  ].join("\n")
).toString("base64")

const goadIniSeedCmd = `echo '${GOAD_FIRST_RUN_INI_SEED_B64}' | base64 -d | python3`

/** Patch ~/.goad/goad.ini — when file already exists (or after goad.sh) set use_impersonation=no. */
const GOAD_INI_DISABLE_IMPERSONATION_B64 = Buffer.from(
  [
    "import configparser, os",
    'p = os.path.expanduser("~/.goad/goad.ini")',
    "if os.path.isfile(p):",
    "    cfg = configparser.ConfigParser()",
    "    cfg.read(p)",
    '    if not cfg.has_section("ludus"):',
    '        cfg.add_section("ludus")',
    '    cfg.set("ludus", "use_impersonation", "no")',
    '    with open(p, "w") as f:',
    "        cfg.write(f)",
  ].join("\n")
).toString("base64")

/**
 * Strip ANSI/VT100 escape sequences from terminal output so raw text
 * is stored in the task store and displayed cleanly in the web UI.
 *
 * Covers:
 *  - CSI sequences  ESC [ … m / ESC [ … h / ESC [ … l  etc.
 *  - OSC sequences  ESC ] … BEL / ESC ] … ST
 *  - Cursor-movement sequences that produce no visible text
 *  - Standalone ESC byte
 */
function stripAnsi(text: string): string {
  return text
    // CSI sequences: ESC [ followed by parameter bytes and a final byte
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    // OSC sequences: ESC ] … BEL or ESC ] … ST
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    // Standalone ESC + single char (e.g. ESC =, ESC >, ESC M)
    .replace(/\x1b[^[\]]/g, "")
    // Any remaining bare ESC
    .replace(/\x1b/g, "")
    // Carriage-return + overwrite sequences (e.g. progress bars rewriting a line)
    // Keep only the last segment after the final \r on each line
    .replace(/^.*\r(?!\n)/gm, "")
    // Cursor-control chars except newline/tab
    .replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, "")
}

/** Per-user SSH credentials extracted from the encrypted session cookie. */
export interface SSHCreds {
  username: string
  password: string
}

function pickFirstNonEmpty(...values: Array<string | undefined>): string {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return ""
}

export function isGoadConfigured(): boolean {
  // Runtime overrides can accidentally contain empty strings and mask env defaults.
  // Treat GOAD as configured when any known host source has a non-empty value.
  return !!pickFirstNonEmpty(
    getSettings().sshHost,
    process.env.LUDUS_SSH_HOST,
    process.env.GOAD_SSH_HOST
  )
}

/**
 * Build an SSH ConnectConfig.
 * If `creds` is provided (user SSH credentials from the session), those are used.
 * Otherwise falls back to the root/admin credentials in the settings store.
 */
function buildConnectConfig(creds?: SSHCreds): ConnectConfig {
  const settings = getSettings();
  const resolvedHost = pickFirstNonEmpty(
    settings.sshHost,
    process.env.LUDUS_SSH_HOST,
    process.env.GOAD_SSH_HOST
  );

  const base: ConnectConfig = {
    host: resolvedHost,
    port: settings.sshPort || 22,
    readyTimeout: 15000,
    keepaliveInterval: 10000,
  };

  if (creds?.username && creds?.password) {
    // Use the logged-in user's own credentials
    return {
      ...base,
      username: creds.username,
      password: creds.password,
      authHandler: ["password"],
    };
  }

  // Fall back to root/admin credentials for admin-level operations
  const username = process.env.GOAD_SSH_USER || settings.proxmoxSshUser || "root"
  const password = (process.env.GOAD_SSH_PASSWORD || settings.proxmoxSshPassword || "").trim()

  const config: ConnectConfig = { ...base, username }

  if (password) {
    config.password = password
  } else {
    const key = readPrivateKey()
    if (key) {
      config.privateKey = key
      const ph = getSshKeyPassphrase()
      if (ph) config.passphrase = ph
    }
  }

  return config
}

/**
 * Execute a command over SSH and return the full output.
 * Pass `creds` to run as the logged-in user; omit to run as root/admin.
 */
export async function sshExec(
  command: string,
  creds?: SSHCreds
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    let stdout = "";
    let stderr = "";

    conn.on("ready", () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          conn.end();
          return reject(err);
        }

        stream.on("close", (code: number) => {
          conn.end();
          resolve({ stdout, stderr, code: code ?? 0 });
        });

        stream.on("data", (data: Buffer) => { stdout += data.toString(); });
        stream.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
      });
    });

    conn.on("error", (err) => {
      reject(new Error(`SSH connection error: ${err.message}`));
    });

    conn.connect(buildConnectConfig(creds));
  });
}

/**
 * Plan a one-shot `sshExec` for workspace mutations (`workspace/<instanceId>/…`).
 *
 * Files there are owned by the Ludus/GOAD Linux user. When an admin impersonates
 * another user, we must SSH as **root** (from settings) and run the script as that
 * user via `sudo -H -u …` — matching {@link streamGoadCommand}. Using the admin's
 * own SSH user hits permission denied on the target workspace.
 */
export function workspaceSshExecPlan(
  request: NextRequest,
  session: Pick<
    SessionData,
    "isAdmin" | "username" | "sshPassword" | "impersonationApiKey" | "impersonationUserId" | "impersonationLudusUserId" | "impersonationSshLogin"
  >,
  innerCommand: string,
  rootCreds: SSHCreds | undefined,
  userCreds: SSHCreds | undefined,
):
  | { ok: true; command: string; creds: SSHCreds | undefined }
  | { ok: false; status: number; error: string } {
  const imp = resolveAdminImpersonationFromRequest(session, request)
  const sudoUser = (imp.sshLogin || imp.ludusPrincipal || "").trim()
  const impersonateAs =
    session.isAdmin && sudoUser && imp.apiKey ? { username: sudoUser } : null

  if (impersonateAs) {
    const settings = getSettings()
    if (!isRootProxmoxSshConfigured(settings)) {
      return {
        ok: false,
        status: 503,
        error:
          "Admin impersonation requires root SSH to the GOAD host: set PROXMOX_SSH_PASSWORD, GOAD_SSH_PASSWORD, or mount a readable root private key (same as Settings → Root SSH test).",
      }
    }
    const safeUser = impersonateAs.username.replace(/'/g, "")
    const safeInner = innerCommand.replace(/'/g, "'\\''")
    // Omit creds so sshExec uses buildConnectConfig(undefined) — root via settings/env
    // password OR mounted key (rootPasswordCredsIfSet is password-only and would falsely
    // fail key-only setups).
    return {
      ok: true,
      command: `sudo -H -u '${safeUser}' bash -c '${safeInner}'`,
      creds: undefined,
    }
  }

  const creds = rootCreds ?? userCreds
  if (!creds) {
    return {
      ok: false,
      status: 503,
      error: "No SSH credentials available (set root SSH password or log in with SSH password).",
    }
  }
  return { ok: true, command: innerCommand, creds }
}

/** GOAD prints this after create_empty / load_instance. */
const GOAD_INSTANCE_LOADED_RE = /\[\+\]\s+Instance\s+(\S+)\s+loaded/

/**
 * When a piped REPL runs `provision_lab` then `provision_extension …`, ansible-playbook
 * may read the same stdin pipe as goad.py and consume remaining REPL lines (so only
 * lab playbooks run). Split: phase1 through `provision_lab`, then a fresh goad.sh
 * with `unload`, `use <id>`, then extension lines (each phase gets its own stdin pipe).
 */
function trySplitReplAfterProvisionLab(rawCmds: string): {
  phase1Parts: string[]
  extensionLines: string[]
  allParts: string[]
} | null {
  const allParts = rawCmds
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
  let labIdx = -1
  for (let i = 0; i < allParts.length; i++) {
    const p = allParts[i] ?? ""
    if (p === "provision_lab" || p.startsWith("provision_lab ")) {
      labIdx = i
      break
    }
  }
  if (labIdx < 0) return null
  const afterLab = allParts.slice(labIdx + 1)
  const extensionLines = afterLab.filter((p) => p.startsWith("provision_extension "))
  if (extensionLines.length === 0) return null
  return { phase1Parts: allParts.slice(0, labIdx + 1), extensionLines, allParts }
}

function extractUseInstanceIdFromReplParts(parts: string[]): string | null {
  for (const p of parts) {
    const m = p.trim().match(/^use\s+(\S+)$/i)
    if (m) return m[1]
  }
  return null
}

/** Prefer last `[+] Instance … loaded` — phase 1 often prints default first, then the new instance. */
function extractInstanceIdFromGoadOutput(blob: string): string | null {
  const re = new RegExp(GOAD_INSTANCE_LOADED_RE.source, "g")
  let lastLoaded: string | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(blob)) !== null) {
    if (m[1]) lastLoaded = m[1]
  }
  if (lastLoaded) return lastLoaded

  const rowRe = /\|\s*>\s*([a-f0-9]+-[\w-]+-ludus)\s*\|/gi
  let lastRow: string | null = null
  for (const row of blob.matchAll(rowRe)) {
    if (row[1]) lastRow = row[1]
  }
  return lastRow
}

/**
 * Stream a goad command over SSH, yielding lines as they appear.
 * @param apiKey  - the user's Ludus API key (injected as LUDUS_API_KEY env var)
 * @param creds   - the user's SSH credentials from the session (run goad as them)
 */
export async function streamGoadCommand(
  goadArgs: string,
  apiKey: string | null | undefined,
  onData: (line: string) => void,
  onClose: (code: number) => void,
  onError: (err: Error) => void,
  creds?: SSHCreds,
  /** When set, the command is wrapped with `sudo -H -u {username}` and the
   *  impersonated user's API key replaces the caller's key.  The SSH connection
   *  itself uses root credentials (creds is ignored and falls back to root/key). */
  impersonateAs?: { username: string; apiKey: string },
  /** Dedicated Ludus rangeID for this GOAD instance. When set, LUDUS_RANGE_ID
   *  is injected into the GOAD environment so Ludus operations target only
   *  this range — leaving other ranges completely untouched. */
  rangeId?: string,
  /** When non-empty, Ludus wrapper appends `--tags` to every `ludus range deploy`
   *  in this session (comma-joined allowlist from {@link filterLudusDeployTags}). */
  ludusDeployTags?: string[]
): Promise<() => void> {
  const conn = new SSHClient();
  // Impersonation: use the target user's API key; connect as root (creds ignored).
  const effectiveCreds = impersonateAs ? undefined : creds;
  const ludusApiKey = impersonateAs?.apiKey || apiKey || process.env.LUDUS_API_KEY || "";
  const goadPath = getSettings().goadPath || "/opt/GOAD";

  // --repl "cmd1;cmd2" → pipe semicolon-separated commands to goad.py via stdin
  // PYTHONUNBUFFERED=1 prevents Python from block-buffering stdout when stdin is a pipe,
  // ensuring ansible output is flushed to the SSH stream line-by-line in real time.
  // LUDUS_RANGE_ID is passed as an env var so the ludus wrapper (see below) can
  // inject --range into every ludus CLI call made by GOAD subprocesses.
  //
  // LUDUS_API_KEY is only injected when we actually have a key.  Passing an
  // empty string causes the ludus CLI to reject it with "Malformed API Key"
  // instead of falling back to reading the key from ~/.config/ludus/config.yml
  // (which is set up correctly during `goad -t install`).
  const safeRangeId = rangeId ? rangeId.replace(/'/g, "") : ""
  const safeDeployTags = filterLudusDeployTags(ludusDeployTags ?? [])
  const deployTagsJoined = safeDeployTags.join(",")
  const pyEnvParts = [
    "PYTHONUNBUFFERED=1",
    "LUDUS_VERSION=2",
    ...(ludusApiKey ? [`LUDUS_API_KEY='${ludusApiKey.replace(/'/g, "'\\''")}'`] : []),
    ...(safeRangeId ? [`LUDUS_RANGE_ID='${safeRangeId}'`] : []),
    ...(deployTagsJoined
      ? [`GOAD_LUDUS_DEPLOY_TAGS='${deployTagsJoined.replace(/'/g, "'\\''")}'`]
      : []),
  ]
  const pyEnv = pyEnvParts.join(" ")

  // ── Pre-flight: ensure workspace is writable (as root, separate SSH) ────────
  //
  // The GOAD workspace directory is typically owned by root after installation.
  // Non-root SSH users cannot create instance sub-directories in it, which
  // causes goad.py to crash with "Instance dir creation error".
  //
  // We open a *separate* root SSH connection (reusing the root credentials in
  // the settings store) and create+chmod the directory before the user's command
  // starts.  This runs as actual root — no sudo required.
  //
  // The await adds ~1-2 s of setup latency, which is negligible for a GOAD deployment.
  // GOAD deployment.  Failure is silenced here; the preamble below still checks
  // writability and prints a clear actionable error if it isn't writable.
  const GOAD_WORKSPACE = `${goadPath}/workspace`;
  try {
    await sshExec(`mkdir -p '${GOAD_WORKSPACE}' && chmod 777 '${GOAD_WORKSPACE}'`);
  } catch {
    // Root SSH may not be configured; writability check in preamble below handles it
  }

  // ── ludus CLI wrapper ────────────────────────────────────────────────────────
  //
  // The Ludus CLI's --range flag is NOT readable from any environment variable
  // (confirmed from ludus-client/cmd/root.go: viper.BindPFlag is never called for
  // the "range" flag).  Without the wrapper, every `ludus range rm / deploy /
  // status` call inside GOAD targets the user's DEFAULT Ludus range regardless of
  // what LUDUS_RANGE_ID is set to — causing destructive cross-range contamination.
  //
  // Solution: when a rangeId is known, create a tiny sh wrapper script at a
  // temporary path and prepend that path to $PATH.  GOAD's Python code does
  // `env = os.environ.copy()` before every subprocess.run(), so the modified PATH
  // (and LUDUS_RANGE_ID) propagate into every `ludus` call inside GOAD.
  //
  // The wrapper does two things:
  //
  // 1. **Range scoping** — rewrites `ludus …` to `ludus --range $LUDUS_RANGE_ID …`
  //    unless --range/-r was already supplied.
  //
  // 2. **Firewall preservation** — when GOAD calls `ludus range config set -f
  //    <file>`, the wrapper checks for a `.lux-network-snapshot.json` sidecar
  //    (written by sync-network before the GOAD session) and injects the user's
  //    `network:` block into the config file *right before* pushing it to Ludus.
  //    This closes the window where GOAD's template regeneration wipes firewall
  //    rules: the deploy runs against a config that already contains them, so
  //    iptables on the router is never flushed.
  //
  // The wrapper is base64-encoded and decoded on the remote to avoid shell
  // quoting nightmares (nested single/double quotes, Python inside sh, etc.).
  const ludusWrapSetup = safeRangeId
    ? `_LUDUS_REAL=$(command -v ludus 2>/dev/null || true);` +
      ` if [ -n "$_LUDUS_REAL" ]; then` +
      ` _LUDUS_WRAP=$(mktemp -d 2>/dev/null || true);` +
      ` if [ -n "$_LUDUS_WRAP" ]; then` +
      ` echo '${LUDUS_WRAPPER_B64}' | base64 -d | sed "s#REAL_LUDUS_PATH#$_LUDUS_REAL#" > "$_LUDUS_WRAP/ludus" 2>/dev/null &&` +
      ` chmod +x "$_LUDUS_WRAP/ludus" 2>/dev/null &&` +
      ` export PATH="$_LUDUS_WRAP:$PATH";` +
      ` fi; fi`
    : "";

  // Dedicated-range deploys: force [ludus] use_impersonation=no (see GOAD_LUDUS_* comment above).
  const goadIniPatchCmd = safeRangeId
    ? `echo '${GOAD_INI_DISABLE_IMPERSONATION_B64}' | base64 -d | python3`
    : ""
  // Run again after goad.sh — catches configs written without seed or with use_impersonation=yes.
  const goadIniPatchPostfix = goadIniPatchCmd ? `; ${goadIniPatchCmd}` : ""

  // ── Per-command preamble (runs in the user's SSH context) ────────────────────
  //
  // 1. Idempotent bashrc check — ensures LUDUS_VERSION=2 is set for interactive
  //    and UI-triggered commands alike.
  // 2. Writability gate — emits a clear, actionable message if root SSH above
  //    didn't succeed (e.g. root creds not configured).
  // 3. goad.sh venv activation — activates $HOME/.goad/.venv if it already
  //    exists.  goad.sh itself creates the venv on first run, so this is only
  //    for subsequent invocations where we want the activated PATH before the
  //    actual command runs (e.g. so the ludus wrapper step can find the right
  //    python3 / ansible on PATH).  Silently skipped on first run — goad.sh
  //    will create the venv as part of the main command.
  // 4. First-run ~/.goad/goad.ini — if missing, seed full GOAD-compatible template
  //    with use_impersonation=no before goad.py starts (GOAD skips create_config_file
  //    when the file exists and does not overwrite it).
  // 5. When LUX passes a dedicated rangeId — patch existing goad.ini to enforce
  //    use_impersonation=no; runs again after goad.sh for edge cases.
  // 6. ludus wrapper — prepends a range-scoping shim to $PATH (only when
  //    a dedicated rangeId is known for this operation).
  const pythonEnvSetup =
    `if [ -f "$HOME/.goad/.venv/bin/activate" ]; then . "$HOME/.goad/.venv/bin/activate"; fi`

  const setupPreamble = [
    `grep -qxF 'export LUDUS_VERSION=2' ~/.bashrc 2>/dev/null || echo 'export LUDUS_VERSION=2' >> ~/.bashrc 2>/dev/null || true`,
    `if [ ! -d '${GOAD_WORKSPACE}' ] || [ ! -w '${GOAD_WORKSPACE}' ]; then echo "[-] GOAD workspace '${GOAD_WORKSPACE}' is not writable by $(whoami). Set PROXMOX_SSH_PASSWORD or mount a root SSH key (./ssh) for workspace setup."; exit 1; fi`,
    pythonEnvSetup,
    goadIniSeedCmd,
    ...(goadIniPatchCmd ? [goadIniPatchCmd] : []),
    ...(ludusWrapSetup ? [ludusWrapSetup] : []),
  ].join("; ");

  // ── pyEnv as export statements ───────────────────────────────────────────────
  //
  // The pyEnv vars are needed by goad.sh, python3 goad.py, and all subprocesses
  // (including the ludus CLI called by GOAD's provide command).
  //
  // For the non-REPL path `${pyEnv} bash goad.sh` works fine — env var prefixes
  // are inherited by the named command and all its children.
  //
  // For the REPL path the command is `${pyEnv} printf '...' | bash goad.sh`.
  // In bash, `VAR=value cmd1 | cmd2` only sets VAR for cmd1 (printf) — NOT for
  // cmd2 (bash goad.sh).  printf doesn't use these vars, so GOAD never sees
  // LUDUS_API_KEY and falls back to its config file (which may be stale/wrong).
  //
  // Solution: export the vars into the shell's environment BEFORE the pipeline
  // runs.  Exported vars are inherited by every subsequent command including the
  // right-hand side of pipes.
  const pyEnvExports = pyEnvParts.map((kv) => `export ${kv}`).join("; ")

  const wrapInnerForSudo = (inner: string) =>
    impersonateAs
      ? `sudo -H -u '${impersonateAs.username}' bash -c '${inner.replace(/'/g, "'\\''")}'`
      : inner

  // Build the inner goad command.
  //
  // Both paths go through goad.sh rather than invoking python3 goad.py directly.
  // This is critical: goad.sh creates $HOME/.goad/.venv on first run and activates
  // it on every run (source $venv/bin/activate).  The venv contains the correct
  // versions of ansible-playbook and all Python deps.  If we bypass goad.sh and
  // call python3 directly, the system ansible at /usr/local/bin/ansible-playbook
  // (which may have a broken/incompatible installation) is used instead.
  //
  // For REPL mode we pipe the GOAD REPL commands to goad.sh via stdin.  bash
  // propagates stdin to child processes, so goad.sh → python3 goad.py all see
  // the piped input.  goad.py reads from stdin when no args are given, entering
  // interactive REPL mode where our commands are executed.
  //
  // When the REPL runs `provision_lab` followed by `provision_extension` lines,
  // ansible-playbook may read the same stdin pipe and swallow the extension
  // commands.  We split into two piped goad.sh invocations on one SSH connection
  // (see trySplitReplAfterProvisionLab).
  let replSplitTail: { extensionLines: string[]; allParts: string[] } | null = null
  let innerCommand: string
  if (goadArgs.startsWith("--repl ")) {
    const rawCmds = goadArgs.slice(7).replace(/^"|"$/g, "")
    const split = trySplitReplAfterProvisionLab(rawCmds)
    if (split) {
      const esc1 = [...split.phase1Parts, "exit"].join("\n").replace(/'/g, "'\\''")
      innerCommand =
        [setupPreamble, pyEnvExports, `cd ${goadPath}`, `printf '${esc1}\n' | bash '${goadPath}/goad.sh'`].join("; ") +
        goadIniPatchPostfix
      replSplitTail = { extensionLines: split.extensionLines, allParts: split.allParts }
    } else {
      const stdinCmds = rawCmds.split(";").join("\n")
      const escaped = stdinCmds.replace(/'/g, "'\\''")
      innerCommand = [
        setupPreamble,
        pyEnvExports,
        `cd ${goadPath}`,
        `printf '${escaped}\nexit\n' | bash '${goadPath}/goad.sh'`,
      ].join("; ") + goadIniPatchPostfix
    }
  } else {
    innerCommand = `${setupPreamble}; cd ${goadPath} && ${pyEnv} bash '${goadPath}/goad.sh' ${goadArgs}${goadIniPatchPostfix}`
  }

  const command = wrapInnerForSudo(innerCommand)

  // Captured once the exec channel is open; used to send Ctrl+C on abort.
  let channelStream: ClientChannel | null = null

  conn.on("ready", () => {
    const ptyOpts = { term: "xterm-256color" as const, rows: 50, cols: 220, width: 0, height: 0 }

    const runPtySession = (
      cmdStr: string,
      opts: { captureStrippedLines?: string[] },
      onSessionEnd: (exitCode: number) => void,
    ) => {
      conn.exec(cmdStr, { pty: ptyOpts }, (err, stream) => {
        if (err) {
          conn.end()
          onError(err)
          return
        }
        channelStream = stream

        let lineBuffer = ""

        function flushBuffer(raw: string) {
          const trimmed = raw.trim()
          if (/\([yY]\/[nN]\)[:\s]*$/.test(trimmed) || /\bDo you want to continue\?\s*$/i.test(trimmed)) {
            try {
              stream.write("y\n")
            } catch {
              /* ignore */
            }
          }
          const text = stripAnsi(lineBuffer + raw)
          const parts = text.split(/\r?\n/)
          lineBuffer = parts.pop() ?? ""
          for (const line of parts) {
            opts.captureStrippedLines?.push(line)
            onData(line)
          }
        }

        stream.on("close", (code: number) => {
          if (lineBuffer.trim()) {
            opts.captureStrippedLines?.push(stripAnsi(lineBuffer))
            onData(lineBuffer)
          }
          lineBuffer = ""
          onSessionEnd(code ?? 0)
        })

        stream.on("data", (data: Buffer) => {
          flushBuffer(data.toString())
        })

        stream.stderr.on("data", (data: Buffer) => {
          flushBuffer(data.toString())
        })
      })
    }

    if (replSplitTail) {
      const captured: string[] = []
      runPtySession(command, { captureStrippedLines: captured }, (code1) => {
        if (code1 !== 0) {
          conn.end()
          onClose(code1)
          return
        }
        const id =
          extractUseInstanceIdFromReplParts(replSplitTail.allParts) ??
          extractInstanceIdFromGoadOutput(captured.join("\n"))
        if (!id) {
          onData(
            "[ERROR] LUX: could not resolve GOAD instance id after provision_lab; extension phase skipped.",
          )
          conn.end()
          onClose(1)
          return
        }
        const esc2 = ["unload", "use " + id, ...replSplitTail.extensionLines, "exit"]
          .join("\n")
          .replace(/'/g, "'\\''")
        const inner2 =
          [setupPreamble, pyEnvExports, `cd ${goadPath}`, `printf '${esc2}\n' | bash '${goadPath}/goad.sh'`].join(
            "; ",
          ) + goadIniPatchPostfix
        const cmd2 = wrapInnerForSudo(inner2)
        runPtySession(cmd2, {}, (code2) => {
          conn.end()
          onClose(code2)
        })
      })
    } else {
      runPtySession(command, {}, (code) => {
        conn.end()
        onClose(code)
      })
    }
  })

  conn.on("error", (err) => {
    onError(new Error(`SSH connection error: ${err.message}`));
  });

  // When impersonating, connect as root (effectiveCreds = undefined → root fallback).
  conn.connect(buildConnectConfig(effectiveCreds));

  // ansible-playbook explicitly ignores SIGHUP (which is what conn.end() triggers via
  // the SSH daemon). We must send Ctrl+C (\x03) to the PTY instead — this delivers
  // SIGINT to the entire foreground process group and ansible handles it correctly.
  return (): void => {
    if (channelStream) {
      try { channelStream.write("\x03\x03"); } catch {}
    }
    // Give ansible ~600 ms to react to SIGINT before tearing down the connection.
    setTimeout(() => { try { conn.end(); } catch {} }, 600);
  };
}

// ── Per-instance Ludus range tracking ────────────────────────────────────────
//
// Each GOAD instance should have its own dedicated Ludus range so that
// destroying it only removes that instance's VMs — not the operator's
// other ranges.
//
// The range ID is stored in <goadPath>/workspace/<instanceId>/.goad_range_id
// as a plain string. GOAD is invoked with LUDUS_RANGE_ID=<rangeId> so it
// targets the correct range for all Ludus API calls.

/** Write the dedicated Ludus rangeID for a GOAD instance workspace. */
export async function writeGoadRangeId(
  instanceId: string,
  rangeId: string,
  creds?: SSHCreds
): Promise<void> {
  const goadPath = getSettings().goadPath || "/opt/GOAD"
  const safeId = instanceId.replace(/[^a-zA-Z0-9_-]/g, "")
  const dir = `${goadPath}/workspace/${safeId}`
  const filePath = `${dir}/.goad_range_id`
  const safeRangeId = rangeId.replace(/'/g, "")
  await sshExec(`mkdir -p '${dir}' && printf '%s' '${safeRangeId}' > '${filePath}'`, creds)
}

/** Read the dedicated Ludus rangeID for a GOAD instance. Returns null if not set. */
export async function readGoadRangeId(
  instanceId: string,
  creds?: SSHCreds
): Promise<string | null> {
  try {
    const goadPath = getSettings().goadPath || "/opt/GOAD"
    const safeId = instanceId.replace(/[^a-zA-Z0-9_-]/g, "")
    const filePath = `${goadPath}/workspace/${safeId}/.goad_range_id`
    const { stdout, code } = await sshExec(`cat '${filePath}' 2>/dev/null`, creds)
    if (code !== 0 || !stdout.trim()) return null
    return stdout.trim()
  } catch {
    return null
  }
}

// Python script that reads the entire workspace in one SSH call.
// Encoded as base64 and piped through the existing SSH connection to avoid
// shell-quoting issues.  Returns a JSON array of instance objects, each with
// a synthetic "__owner__" field containing the Linux username from stat(2).
const LIST_INSTANCES_PY = `
import os, json, pwd, sys, stat as statmod

goad_path = sys.argv[1] if len(sys.argv) > 1 else '/opt/GOAD'
workspace  = os.path.join(goad_path, 'workspace')

results = []
try:
    entries = sorted(os.listdir(workspace)) if os.path.isdir(workspace) else []
except Exception:
    entries = []

for d in entries:
    dp = os.path.join(workspace, d)
    if not os.path.isdir(dp):
        continue
    fp = os.path.join(dp, 'instance.json')
    if not os.path.isfile(fp):
        continue

    # Get Linux file owner of the instance directory
    owner = ''
    try:
        st = os.stat(dp)
        owner = pwd.getpwuid(st.st_uid).pw_name
    except Exception:
        try:
            owner = str(st.st_uid)
        except Exception:
            pass

    # Read dedicated Ludus rangeID from our tracking file (.goad_range_id)
    goad_range_id = ''
    range_id_path = os.path.join(dp, '.goad_range_id')
    if os.path.isfile(range_id_path):
        try:
            with open(range_id_path) as rf:
                goad_range_id = rf.read().strip()
        except Exception:
            pass

    try:
        with open(fp) as f:
            data = json.load(f)
        data['__owner__']         = owner
        data['__dir__']           = d
        data['__goad_range_id__'] = goad_range_id
        results.append(data)
    except Exception:
        pass

print(json.dumps(results))
`

/**
 * Read all GOAD workspace instances over a SINGLE SSH connection.
 *
 * Previous approach opened one SSH connection per instance.json which caused
 * sshd rate-limits / connection-count exhaustion → random "no instances" errors.
 *
 * Now a small Python script is base64-encoded, piped to Python on the remote
 * host (just like discoverGoadCatalog), and returns all instances + ownership
 * data in one round-trip.
 */
export async function listGoadInstances(creds?: SSHCreds): Promise<GoadInstance[]> {
  try {
    const goadPath = getSettings().goadPath || "/opt/GOAD";
    const encoded = Buffer.from(LIST_INSTANCES_PY).toString("base64");
    const cmd = `echo '${encoded}' | base64 -d | python3 - '${goadPath}'`;

    const { stdout, code } = await sshExec(cmd, creds);

    if (code !== 0 || !stdout.trim()) {
      return [];
    }

    let parsed: Array<Record<string, unknown>>;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      console.error("listGoadInstances: failed to parse Python output:", stdout.slice(0, 200));
      return [];
    }

    const instances: GoadInstance[] = []
    for (const data of parsed) {
      const instanceId = (data.id as string) || (data.__dir__ as string) || ""
      if (!instanceId) continue
      // ludusRangeId: prefer our .goad_range_id file (explicit tracking),
      // fall back to range_id/ludus_range_id that GOAD itself may write to instance.json.
      const ludusRangeId =
        (data.__goad_range_id__ as string) ||
        (data.range_id         as string) ||
        (data.ludus_range_id   as string) ||
        ""

      instances.push({
        instanceId,
        lab:          ((data.lab         as string) || "") as import("./types").GoadLabType,
        provider:     (data.provider    as string) || "",
        provisioner:  (data.provisioner as string) || "",
        ipRange:      (data.ip_range    as string) || "",
        status:       ((data.status      as string) || "CREATED") as import("./types").GoadInstanceStatus,
        isDefault:    Boolean(data.is_default),
        extensions:   ((data.extensions as string[]) || []) as import("./types").GoadExtension[],
        ownerUserId:  (data.__owner__   as string) || "",
        ludusRangeId: ludusRangeId || undefined,
      })
    }

    instances.sort((a, b) => a.instanceId.localeCompare(b.instanceId));
    return instances;
  } catch (err) {
    console.error("Error listing GOAD instances:", err);
    return [];
  }
}

// ── Catalog discovery ─────────────────────────────────────────────────────────

// Python script that discovers labs and extensions from the GOAD directory.
// Passed to the server via base64 to avoid any shell-quoting issues.
const DISCOVER_PY = `
import json, os, sys, re

def clean_description(text):
    """Return first substantive plain-text line from README content."""
    skip = re.compile(r'^(<|!\\[|\\[|#|\\|)', re.I)
    for line in text.splitlines():
        line = line.strip().lstrip('- ').strip()
        if len(line) < 10:
            continue
        if skip.match(line):
            continue
        # Strip markdown bold/italic
        line = re.sub(r'[*_]+', '', line).strip()
        if len(line) >= 10:
            return line
    return ""

def read_readme_description(lab_dir):
    for fname in ("README.md", "readme.md"):
        readme = os.path.join(lab_dir, fname)
        if os.path.isfile(readme):
            try:
                with open(readme) as f:
                    return clean_description(f.read())
            except Exception:
                pass
    return ""

def extract_templates_from_yaml_file(path):
    """Scan any YAML file for template/packer_template field values.
    Uses a line-regex approach — no PyYAML dependency required.
    Handles any indentation depth and both 'template:' and 'packer_template:' keys."""
    templates = set()
    if not os.path.isfile(path):
        return templates
    try:
        with open(path) as f:
            for line in f:
                # Match:  template: some-value  OR  packer_template: some-value
                # at any indentation level.  Template names in GOAD Ludus configs
                # are always bare identifiers (win2019-server-x64, etc.) so we
                # match word chars, dots, slashes, and dashes — no quote handling
                # needed, which also avoids JS-template-literal escape issues.
                m = re.match(r'^\\s+(?:packer_)?template:\\s+([\\w][\\w./-]*)', line)
                if m:
                    templates.add(m.group(1).strip())
    except Exception:
        pass
    return templates

def extract_templates_from_json(path):
    """Scan data/config.json host entries for template / packer_template fields."""
    templates = set()
    if not os.path.isfile(path):
        return templates
    try:
        with open(path) as f:
            data = json.load(f)
        hosts = data.get("lab", {}).get("hosts", {})
        for h in hosts.values():
            for key in ("template", "packer_template", "ludus_template"):
                val = h.get(key, "")
                if val and isinstance(val, str):
                    templates.add(val.strip())
    except Exception:
        pass
    return templates

def get_required_templates(base_dir):
    """Collect required Ludus packer template names for a lab or extension.

    Priority order:
      1. Any *.yml / *.yaml under providers/ludus/   (direct Ludus config)
      2. data/config.json host entries                (fallback for labs without a
                                                       dedicated Ludus provider dir)
    """
    templates = set()

    # 1. Scan every YAML file under providers/ludus/
    ludus_dir = os.path.join(base_dir, "providers", "ludus")
    if os.path.isdir(ludus_dir):
        for fname in os.listdir(ludus_dir):
            if fname.endswith((".yml", ".yaml")):
                templates |= extract_templates_from_yaml_file(
                    os.path.join(ludus_dir, fname)
                )

    # 2. Fall back to data/config.json when no Ludus provider dir exists
    if not templates:
        templates |= extract_templates_from_json(
            os.path.join(base_dir, "data", "config.json")
        )

    return sorted(templates)

def discover(goad_path):
    result = {"labs": [], "extensions": []}

    ad_path = os.path.join(goad_path, "ad")
    if os.path.isdir(ad_path):
        for lab_name in sorted(os.listdir(ad_path)):
            if lab_name in ("TEMPLATE",):
                continue
            lab_dir = os.path.join(ad_path, lab_name)
            if not os.path.isdir(lab_dir):
                continue
            config_file = os.path.join(lab_dir, "data", "config.json")
            vm_count = 0
            domain_count = 0
            if os.path.isfile(config_file):
                try:
                    with open(config_file) as f:
                        config = json.load(f)
                    hosts = config.get("lab", {}).get("hosts", {})
                    vm_count = len(hosts)
                    domains = set()
                    for h in hosts.values():
                        if h.get("domain"):
                            domains.add(h["domain"])
                    domain_count = len(domains)
                except Exception:
                    pass
            description = read_readme_description(lab_dir)
            required_templates = get_required_templates(lab_dir)
            ludus_dir = os.path.join(lab_dir, "providers", "ludus")
            ludus_supported = os.path.isdir(ludus_dir)
            result["labs"].append({
                "name": lab_name,
                "description": description,
                "vmCount": vm_count,
                "domains": domain_count,
                "requiredTemplates": required_templates,
                "ludusSupported": ludus_supported,
            })

    ext_path = os.path.join(goad_path, "extensions")
    if os.path.isdir(ext_path):
        for ext_name in sorted(os.listdir(ext_path)):
            ext_dir = os.path.join(ext_path, ext_name)
            if not os.path.isdir(ext_dir):
                continue
            cfg_file = None
            for fname in ("extension.json", "config.json"):
                candidate = os.path.join(ext_dir, fname)
                if os.path.isfile(candidate):
                    cfg_file = candidate
                    break
            if cfg_file:
                try:
                    with open(cfg_file) as f:
                        cfg = json.load(f)
                    required_templates = get_required_templates(ext_dir)
                    machines = cfg.get("machines") or []
                    if not machines and isinstance(cfg.get("lab"), dict):
                        hosts = cfg["lab"].get("hosts") or {}
                        if isinstance(hosts, dict):
                            machines = list(hosts.keys())
                    result["extensions"].append({
                        "name": ext_name,
                        "description": cfg.get("description", ""),
                        "machines": machines,
                        "compatibility": cfg.get("compatibility", ["*"]),
                        "impact": cfg.get("impact", ""),
                        "requiredTemplates": required_templates,
                    })
                except Exception:
                    pass

    result["capabilities"] = {
        "provisionOnlyExtensions": probe_provision_only_extensions(goad_path),
    }

    print(json.dumps(result))

def probe_provision_only_extensions(goad_path):
    """True when GOAD install_extension skips ludus deploy for machines=[] extensions."""
    goad_py = os.path.join(goad_path, "goad.py")
    ext_py = os.path.join(goad_path, "goad", "extension.py")
    if not os.path.isfile(goad_py) or not os.path.isfile(ext_py):
        return False
    try:
        with open(goad_py, encoding="utf-8", errors="ignore") as f:
            goad_src = f.read()
        with open(ext_py, encoding="utf-8", errors="ignore") as f:
            ext_src = f.read()
    except Exception:
        return False
    install_skip = (
        "extension.machines" in goad_src
        and (
            "adds no provider VMs" in goad_src
            or "skipping install()" in goad_src.lower()
        )
    )
    machines_field = "self.machines" in ext_src and "machines" in ext_src
    return install_skip and machines_field

discover(sys.argv[1])
`

// The catalog (lab/extension definitions) is shared across all users and read-only,
// so we cache it globally. The cache key includes goadPath to handle path changes.
interface CacheEntry { data: GoadCatalog; expiry: number; goadPath: string }
let catalogCache: CacheEntry | null = null
const CATALOG_TTL_MS = 5 * 60 * 1000 // 5 minutes

export async function discoverGoadCatalog(creds?: SSHCreds): Promise<GoadCatalog> {
  const goadPath = getSettings().goadPath || "/opt/GOAD";

  if (catalogCache && Date.now() < catalogCache.expiry && catalogCache.goadPath === goadPath) {
    return catalogCache.data;
  }

  const encoded = Buffer.from(DISCOVER_PY).toString("base64");
  const cmd = `echo '${encoded}' | base64 -d | python3 - '${goadPath}'`;

  const { stdout, code } = await sshExec(cmd, creds);
  if (code !== 0 || !stdout.trim()) {
    return { configured: true, goadPath, labs: [], extensions: [] };
  }

  try {
    const parsed = JSON.parse(stdout.trim());
    const catalog: GoadCatalog = {
      configured: true,
      goadPath,
      labs: parsed.labs || [],
      extensions: parsed.extensions || [],
      capabilities: {
        provisionOnlyExtensions: parsed.capabilities?.provisionOnlyExtensions === true,
      },
    };
    catalogCache = { data: catalog, expiry: Date.now() + CATALOG_TTL_MS, goadPath };
    return catalog;
  } catch {
    return { configured: true, goadPath, labs: [], extensions: [] };
  }
}

/** Invalidate the catalog cache (call after GOAD path setting changes). */
export function invalidateCatalogCache(): void {
  catalogCache = null;
}

/**
 * Read the lab config.json from the GOAD directory.
 */
export async function getGoadLabConfig(
  labName: string,
  creds?: SSHCreds
): Promise<Record<string, unknown> | null> {
  try {
    const goadPath = getSettings().goadPath || "/opt/GOAD";
    const configPath = `${goadPath}/ad/${labName}/data/config.json`;
    const { stdout, code } = await sshExec(`cat "${configPath}" 2>/dev/null`, creds);
    if (code !== 0 || !stdout.trim()) return null;
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/** Single inventory file in the workspace (base or extension). */
export interface InstanceInventoryFile {
  name: string
  path: string
  content: string
}

// Python script: list *inventory* files in workspace/<instance_id>/ and return name, path, content as JSON.
const LIST_INVENTORIES_PY = `
import os, json, sys

goad_path = sys.argv[1]
instance_id = sys.argv[2]
workspace_dir = os.path.join(goad_path, "workspace", instance_id)

results = []
if not os.path.isdir(workspace_dir):
    print(json.dumps(results))
    sys.exit(0)

for f in sorted(os.listdir(workspace_dir)):
    if "inventory" not in f.lower():
        continue
    fp = os.path.join(workspace_dir, f)
    if not os.path.isfile(fp):
        continue
    try:
        with open(fp, "r", encoding="utf-8", errors="replace") as fh:
            content = fh.read()
        results.append({"name": f, "path": fp, "content": content})
    except Exception:
        results.append({"name": f, "path": fp, "content": "(read error)"})

print(json.dumps(results))
`

/**
 * Return all compiled inventory files for a GOAD instance (base + extension inventories).
 * Path on server: <goadPath>/workspace/<instanceId>/inventory, .../adfs_inventory, etc.
 */
export async function getInstanceInventories(
  instanceId: string,
  creds?: SSHCreds
): Promise<InstanceInventoryFile[]> {
  try {
    const goadPath = getSettings().goadPath || "/opt/GOAD";
    const encoded = Buffer.from(LIST_INVENTORIES_PY).toString("base64");
    const cmd = `echo '${encoded}' | base64 -d | python3 - '${goadPath}' '${instanceId.replace(/'/g, "'\\''")}'`;
    const { stdout, code } = await sshExec(cmd, creds);
    if (code !== 0 || !stdout.trim()) return [];
    const parsed = JSON.parse(stdout.trim());
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Change the OS-level owner of a GOAD instance workspace directory.
 * Runs `chown -R <targetUser>:<targetUser> <workspace>/<instanceId>` as root.
 * Used when re-assigning a GOAD instance from one Ludus user to another.
 */
export async function chownGoadInstance(
  instanceId: string,
  targetUser: string,
  creds?: SSHCreds,
): Promise<void> {
  const goadPath = getSettings().goadPath || "/opt/GOAD";
  const safePath = `${goadPath}/workspace/${instanceId.replace(/'/g, "'\\''")}`
  const safeUser = targetUser.replace(/'/g, "'\\''")
  const cmd = `chown -R '${safeUser}':'${safeUser}' '${safePath}'`
  const { code, stderr } = await sshExec(cmd, creds)
  if (code !== 0) {
    throw new Error(`chown failed (exit ${code}): ${stderr.trim() || "unknown error"}`)
  }
}
