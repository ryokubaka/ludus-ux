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

import { Client as SSHClient, ConnectConfig } from "ssh2"
import type { GoadInstance, GoadCatalog } from "./types"
import { getSettings } from "./settings-store"
import { readPrivateKey, getSshKeyPassphrase } from "./root-ssh-auth"

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
  rangeId?: string
): Promise<() => void> {
  const conn = new SSHClient();
  // Impersonation: use the target user's API key; connect as root (creds ignored).
  const effectiveCreds = impersonateAs ? undefined : creds;
  const ludusApiKey = impersonateAs?.apiKey || apiKey || process.env.LUDUS_API_KEY || "";
  const goadPath = getSettings().goadPath || "/opt/GOAD";

  // --repl "cmd1;cmd2" → pipe semicolon-separated commands to goad.py via stdin
  let command: string;
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
  const pyEnvParts = [
    "PYTHONUNBUFFERED=1",
    "LUDUS_VERSION=2",
    ...(ludusApiKey ? [`LUDUS_API_KEY='${ludusApiKey.replace(/'/g, "'\\''")}'`] : []),
    ...(safeRangeId ? [`LUDUS_RANGE_ID='${safeRangeId}'`] : []),
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
  // The await adds ~1-2 s of setup latency, which is negligible for a 30-90 min
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
  // The wrapper intercepts `ludus …` calls and rewrites them to
  // `ludus --range $LUDUS_RANGE_ID …` unless --range/-r was already supplied.
  // $LUDUS_RANGE_ID is evaluated at wrapper-execution time (from the inherited
  // env), so the wrapper file itself is range-agnostic and safe to reuse.
  // Written as a single inline string so that `then` is never followed by `;`
  // (bash treats `then;` as a syntax error — only `fi;`, `done;`, etc. are valid).
  // The two nested `if` guards are spelled out in one expression with each
  // `then` followed directly by the next command (space-separated, no `;`).
  const ludusWrapSetup = safeRangeId
    ? `_LUDUS_REAL=$(command -v ludus 2>/dev/null || true);` +
      ` if [ -n "$_LUDUS_REAL" ]; then` +
      ` _LUDUS_WRAP=$(mktemp -d 2>/dev/null || true);` +
      ` if [ -n "$_LUDUS_WRAP" ]; then` +
      // printf %s embeds the real binary path at wrapper-creation time.
      // $LUDUS_RANGE_ID is evaluated at wrapper-execution time from the env.
      ` printf '#!/bin/sh\\n_R="%s"\\nfor _a in "$@"; do case "$_a" in --range|-r) exec "$_R" "$@";; esac; done\\nexec "$_R" --range "$LUDUS_RANGE_ID" "$@"\\n' "$_LUDUS_REAL" > "$_LUDUS_WRAP/ludus" 2>/dev/null &&` +
      ` chmod +x "$_LUDUS_WRAP/ludus" 2>/dev/null &&` +
      ` export PATH="$_LUDUS_WRAP:$PATH";` +
      ` fi; fi`
    : "";

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
  // 4. ludus wrapper — prepends a range-scoping shim to $PATH (only when
  //    a dedicated rangeId is known for this operation).
  const pythonEnvSetup =
    `if [ -f "$HOME/.goad/.venv/bin/activate" ]; then . "$HOME/.goad/.venv/bin/activate"; fi`

  const setupPreamble = [
    `grep -qxF 'export LUDUS_VERSION=2' ~/.bashrc 2>/dev/null || echo 'export LUDUS_VERSION=2' >> ~/.bashrc 2>/dev/null || true`,
    `if [ ! -d '${GOAD_WORKSPACE}' ] || [ ! -w '${GOAD_WORKSPACE}' ]; then echo "[-] GOAD workspace '${GOAD_WORKSPACE}' is not writable by $(whoami). Set PROXMOX_SSH_PASSWORD or mount a root SSH key (./ssh) for workspace setup."; exit 1; fi`,
    pythonEnvSetup,
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
  let innerCommand: string;
  if (goadArgs.startsWith("--repl ")) {
    const rawCmds = goadArgs.slice(7).replace(/^"|"$/g, "");
    const stdinCmds = rawCmds.split(";").join("\n");
    const escaped = stdinCmds.replace(/'/g, "'\\''");
    innerCommand = [
      setupPreamble,
      pyEnvExports,
      `cd ${goadPath}`,
      `printf '${escaped}\nexit\n' | bash '${goadPath}/goad.sh'`,
    ].join("; ");
  } else {
    innerCommand = `${setupPreamble}; cd ${goadPath} && ${pyEnv} bash '${goadPath}/goad.sh' ${goadArgs}`;
  }

  if (impersonateAs) {
    // Wrap with sudo so the command runs in the target user's context.
    // -H  sets HOME to the target user's home directory.
    // -u  specifies the target username.
    // We single-quote the inner command and escape any embedded single-quotes.
    const safeInner = innerCommand.replace(/'/g, "'\\''");
    command = `sudo -H -u '${impersonateAs.username}' bash -c '${safeInner}'`;
  } else {
    command = innerCommand;
  }

  // Captured once the exec channel is open; used to send Ctrl+C on abort.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let channelStream: any = null;

  conn.on("ready", () => {
    // Use a wide PTY so goad.py's Rich library renders full-width tables
    // without truncating cell content with '…' at 80 columns.
    conn.exec(command, { pty: { term: "xterm-256color", rows: 50, cols: 220, width: 0, height: 0 } }, (err, stream) => {
      if (err) {
        conn.end();
        onError(err);
        return;
      }
      channelStream = stream;

      // Accumulate partial lines across data chunks.
      // SSH TCP segments don't align with newlines; without this, long ansible JSON
      // lines (1 000+ chars) arrive as multiple fragments each emitted as a broken
      // "line". We buffer until we see a newline, then flush complete lines.
      // Empty lines are preserved — they are the task separators in ansible output.
      let lineBuffer = "";

      function flushBuffer(raw: string, isFinal = false) {
        // Auto-answer interactive yes/no prompts (handles both "(y/N) " and "(y/N): " formats)
        const trimmed = raw.trim();
        if (/\([yY]\/[nN]\)[:\s]*$/.test(trimmed) || /\bDo you want to continue\?\s*$/i.test(trimmed)) {
          try { stream.write("y\n"); } catch {}
        }
        const text = stripAnsi(lineBuffer + raw);
        const parts = text.split(/\r?\n/);
        if (isFinal) {
          lineBuffer = "";
          for (const line of parts) {
            if (line.trim()) onData(line);
          }
        } else {
          // Keep the last (potentially incomplete) segment in the buffer
          lineBuffer = parts.pop() ?? "";
          for (const line of parts) {
            // Emit complete lines; preserve blank lines (they separate ansible tasks)
            onData(line);
          }
        }
      }

      stream.on("close", (code: number) => {
        // Flush anything remaining in the buffer
        if (lineBuffer.trim()) onData(lineBuffer);
        lineBuffer = "";
        conn.end();
        onClose(code ?? 0);
      });

      stream.on("data", (data: Buffer) => {
        flushBuffer(data.toString());
      });

      // stderr merges into the same terminal view (PTY combines them, but handle just in case)
      stream.stderr.on("data", (data: Buffer) => {
        flushBuffer(data.toString());
      });
    });
  });

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
                    result["extensions"].append({
                        "name": cfg.get("name", ext_name),
                        "description": cfg.get("description", ""),
                        "machines": cfg.get("machines", []),
                        "compatibility": cfg.get("compatibility", ["*"]),
                        "impact": cfg.get("impact", ""),
                        "requiredTemplates": required_templates,
                    })
                except Exception:
                    pass

    print(json.dumps(result))

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
