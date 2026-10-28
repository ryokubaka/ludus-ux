/**
 * One block per security finding: the advisory (GHSA-3q8g-rm9c-xwxv, the
 * v1.5.0 Security entries) and the review that followed. Each block checks the
 * fix directly where that is cheap, and requires the focused tests that prove
 * it to still exist, so deleting or renaming one fails here by finding.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/goad-ssh", () => ({
  sshExec: vi.fn(),
  isGoadConfigured: vi.fn(() => true),
}))

vi.mock("@/lib/session-admin-check", () => ({
  liveSessionIsAdmin: async (session: { isAdmin?: boolean }) => session.isAdmin === true,
}))

import { sshExec } from "@/lib/goad-ssh"
import { assertSafeInstanceId } from "@/lib/goad-pending-network-fs"
import { canAccessGoadTask } from "@/lib/goad-task-api"
import { goadTargetInstanceIds } from "@/lib/goad-instance-access"
import { probeNeo4jFromHost } from "@/lib/ludushound-ssh"
import { requestOriginAllowed } from "@/lib/request-origin"
import { REPO_REQUEST_TIMEOUT_MS, REPO_RESPONSE_MAX_BYTES } from "@/lib/safe-template-repo-url"
import { isLudusTlsInsecure } from "@/lib/tls-insecure-env"
import type { ResolvedSession } from "@/lib/session"

type Finding = {
  source: "advisory" | "review"
  /** Test file (from the repo root) → test titles that must stay in it. */
  tests: Record<string, string[]>
}

const FINDINGS: Record<string, Finding> = {
  "settings return an allowlist, never secrets": {
    source: "advisory",
    tests: {
      "src/app/api/settings/route.test.ts": [
        "returns only the allowlist for a non-admin",
        "returns set flags for an admin and omits secret strings",
      ],
    },
  },
  "a manual API key login must match the Ludus profile": {
    source: "advisory",
    tests: { "src/lib/login-ludus-check.test.ts": ["returns profile_mismatch when the key belongs to a different user"] },
  },
  "GOAD preview: one lab segment, Jinja sandbox, runs as the user": {
    source: "advisory",
    tests: {
      "src/app/api/goad/preview-config/route.test.ts": [
        "embeds a sandboxed renderer that stays under the GOAD root",
        "rejects absolute and traversal lab names",
        "runs as the session user",
        "returns 503 when the session has no SSH password",
      ],
    },
  },
  "pending network: path segment and owner checks on read, write, handoff, and sink": {
    source: "review",
    tests: {
      "src/app/api/goad/instances/[instanceId]/pending-network/route.test.ts": [
        "rejects traversal instance ids before building a path",
        "lets the owner read and delete, and refuses a second user",
        "refuses another user's store over an owner's snapshot, and the owner keeps it",
        "refuses another user's store on an instance with no snapshot",
      ],
      "src/app/api/goad/deploy-handoff/route.test.ts": [
        "refuses another user's instance before writing anything",
        "refuses a range the caller's Ludus key cannot read",
        "refuses linking another user's handoff",
        "refuses linking a handoff onto another user's task",
      ],
      "src/lib/goad-pending-network-workflow.test.ts": [
        "does not apply another user's rules to the task owner's range",
        "ignores a handoff that belongs to another user",
      ],
    },
  },
  "GOAD instance and task ownership, never a username prefix": {
    source: "review",
    tests: {
      "src/lib/goad-instance-access.test.ts": [
        "trusts a named workspace owner over any task",
        "refuses an unclaimed or unlisted instance unless the caller is claiming it",
        "collects the body instance and every REPL use line",
      ],
      "src/app/api/goad/instances/[instanceId]/force-delete/route.test.ts": [
        "refuses another user's workspace before touching it",
        "lets the owner delete a GOAD id that has no username prefix",
      ],
      "src/app/api/goad/tasks/[taskId]/link-instance/route.test.ts": [
        "refuses linking the caller's task to another user's workspace",
      ],
      "src/security/route-audit.test.ts": [
        "checks ownership in every route that acts on a GOAD instance or task",
        "never treats a username prefix in an instance id as ownership",
      ],
    },
  },
  "the session vault decides, not the cookie": {
    source: "advisory",
    tests: {
      "src/lib/session-layout.test.ts": ["treats a cookie with no vault row as logged out"],
      "src/app/api/settings/route.test.ts": ["returns 401 when the vault session is missing"],
      "src/lib/require-admin.test.ts": ["returns 403 when Ludus says non-admin but cookie says admin"],
      "src/security/route-audit.test.ts": [
        "gates every handler on the server session, or lists why it is public",
        "runs the gate first, on every path through the handler",
      ],
    },
  },
  "mutating requests come from this origin, including other ports": {
    source: "review",
    tests: {
      "src/lib/request-origin.test.ts": [
        "rejects another port on the same host",
        "allows a login on an 8443:443 mapping even when the proxy dropped the port",
        "rejects a cross-site origin and an origin header that lies about a cross-site fetch",
      ],
    },
  },
  "run-as-user refuses privileged accounts": {
    source: "advisory",
    tests: { "src/lib/lux-host-allowlist.test.ts": ["templates, packer files, and source ownership"] },
  },
  "host key pins accept every format ssh prints": {
    source: "review",
    tests: {
      "src/lib/ssh-host-key.test.ts": [
        "rejects a key that does not match LUX_SSH_HOST_KEY",
        "matches a stored fingerprint with or without base64 padding",
        "reads fingerprints, key lines, and known_hosts lines",
        "accepts exactly what ssh-keygen -lf prints for the host key",
      ],
    },
  },
  "TLS is verified unless LUDUS_TLS_INSECURE says otherwise": {
    source: "review",
    tests: {
      "src/lib/tls-insecure-env.test.ts": ["does not disable certificate checks for the whole process"],
      "src/lib/login-ludus-check.test.ts": ["names the old default when an upgraded .env has no LUDUS_TLS_INSECURE"],
    },
  },
  "API keys and passwords stay out of process arguments": {
    source: "review",
    tests: {
      "src/lib/goad-ssh-secrets.test.ts": ["REPL run as the user's own SSH login", "non-REPL run"],
      "src/lib/auth-ssh.test.ts": ["appends the key from stdin, not from the command string"],
      "src/lib/ludushound-ansible-requirements.test.ts": ["reads the key from stdin into LUDUS_API_KEY"],
      "src/security/argv-secrets.test.ts": [
        "builds no shell command that interpolates a secret",
        "passes no secret as a shell argument in the bundled scripts",
      ],
    },
  },
  "revoke clears only a session that is already gone": {
    source: "review",
    tests: {
      "src/app/api/auth/revoke/route.test.ts": [
        "leaves a live session alone when another site sends the browser here",
        "clears a cookie whose vault row is gone",
      ],
    },
  },
  "template repo requests: abort, timeout, size cap": {
    source: "review",
    tests: {
      "src/lib/safe-template-repo-url.test.ts": [
        "gives up on a host that never answers",
        "stops when the caller aborts, and refuses an already aborted signal",
        "returns a small body and rejects one over the cap",
        "does not follow a redirect to a private address",
      ],
    },
  },
  "GET handlers change no state": {
    source: "review",
    tests: { "src/security/route-audit.test.ts": ["changes no state in a GET handler"] },
  },
  "admin branches re-check Ludus instead of the cookie": {
    source: "review",
    tests: {
      "src/security/admin-live-check.test.ts": ["no route trusts the cookie's isAdmin alone"],
    },
  },
  "a signed upgrade accepts only the configured key": {
    source: "review",
    tests: {
      "src/security/upgrade-tag-pin.test.ts": ["verifies a tag only in a keyring that holds the trusted key"],
    },
  },
  "CodeQL sinks from the v1.5.0 scan": {
    source: "review",
    tests: {
      "src/lib/log-safe.test.ts": [
        "strips newlines and percent signs and redacts a password-shaped env value",
      ],
      "src/lib/packer-vm-name.test.ts": ["drops trailing slashes and keeps the directory name"],
      "src/lib/template-repo-client.test.ts": [
        "rejects a URL whose hostname is not github.com",
        "keeps owner and repo on api.github.com and raw.githubusercontent.com",
      ],
      "src/lib/sync-ip-prefix.test.ts": ["escapes an IPv4 prefix for sed and rejects a command suffix"],
      "src/lib/settings-public.test.ts": [
        "matches equal secrets, a one-character difference does not, and empty expected never matches",
      ],
      "src/lib/random-id.test.ts": ["keeps the task id and range uid charset and does not use Math.random"],
      "src/lib/ludus-fetch.test.ts": [
        "rejects file, userinfo, and metadata hosts and still allows a private lab URL",
      ],
      "src/lib/root-ssh-auth.test.ts": ["reads a regular key and a symlink the same way the probe did"],
    },
  },
}

function expectFocusedTests(finding: Finding) {
  for (const [file, titles] of Object.entries(finding.tests)) {
    const source = readFileSync(path.join(process.cwd(), file), "utf8")
    for (const title of titles) {
      expect(source.includes(`"${title}"`), `${file} lost "${title}"`).toBe(true)
    }
  }
}

function session(username: string, isAdmin = false): ResolvedSession {
  return { username, isAdmin } as ResolvedSession
}

function post(headers: Record<string, string>) {
  return { method: "POST", headers: new Headers(headers) }
}

describe.each(Object.entries(FINDINGS))("%s", (_name, finding) => {
  it("keeps its focused tests", () => {
    expectFocusedTests(finding)
  })
})

describe("direct checks", () => {
  beforeEach(() => {
    vi.mocked(sshExec).mockReset()
  })

  it("pending network ids are one path segment", () => {
    expect(() => assertSafeInstanceId("../other/x")).toThrow()
    expect(() => assertSafeInstanceId("a/b")).toThrow()
    expect(assertSafeInstanceId("GOAD-abc123")).toBe("GOAD-abc123")
  })

  it("another user's GOAD task is not visible, an admin's view is", async () => {
    const request = new Request("http://lux.test/") as never
    expect(await canAccessGoadTask(session("bob"), request, { username: "alice" })).toBe(false)
    expect(await canAccessGoadTask(session("alice"), request, { username: "alice" })).toBe(true)
    expect(await canAccessGoadTask(session("root", true), request, { username: "alice" })).toBe(true)
  })

  it("execute checks every instance a REPL script selects", () => {
    expect(goadTargetInstanceIds(`--repl "use victim-1;provision_lab"`, "mine")).toEqual(["mine", "victim-1"])
  })

  it("origin: same-origin passes, another port and another site do not", () => {
    expect(requestOriginAllowed(post({ "sec-fetch-site": "same-origin" }))).toBe(true)
    expect(requestOriginAllowed(post({ "sec-fetch-site": "cross-site", origin: "https://evil.test" }))).toBe(false)
    expect(requestOriginAllowed(post({ origin: "https://lux.test:9443", host: "lux.test:8443" }))).toBe(false)
  })

  it("an unset LUDUS_TLS_INSECURE verifies certificates", () => {
    vi.stubEnv("LUDUS_TLS_INSECURE", "")
    expect(isLudusTlsInsecure()).toBe(false)
    vi.unstubAllEnvs()
  })

  it("repo requests are bounded", () => {
    expect(REPO_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(30_000)
    expect(REPO_RESPONSE_MAX_BYTES).toBeLessThanOrEqual(10 * 1024 * 1024)
  })

  it("the Neo4j probe sends its credentials on stdin, not in curl's argv", async () => {
    vi.mocked(sshExec).mockResolvedValue({ stdout: "200", stderr: "", code: 0 })
    await probeNeo4jFromHost("10.0.0.5", "neo4j", "s3cret-pass", { username: "u", password: "p" })
    const [command, , opts] = vi.mocked(sshExec).mock.calls[0]
    const auth = Buffer.from("neo4j:s3cret-pass").toString("base64")
    expect(String(command)).not.toContain(auth)
    expect(String(command)).not.toContain("s3cret-pass")
    expect(opts?.stdin).toBe(`Authorization: Basic ${auth}\n`)
  })
})
