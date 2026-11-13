// Map security-checklist items to the tests that prove them, and tick those
// boxes on the open pull request or merge request when the tests pass.
// The live item follows the security-gate/live commit status.

import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

export const CHECKLIST = [
  {
    id: "session",
    text: "Every new or changed API route gates on the server session (`requireSession`, `requireAdmin`, or `resolveSession` plus a 401/403).",
    tests: [
      "gates every handler on the server session, or lists why it is public",
      "runs the gate first, on every path through the handler",
    ],
  },
  {
    id: "owner",
    text: "Routes that act on a GOAD instance or task check the owner (`assertGoadInstanceAccess`, `assertGoadTaskAccess`), never a username prefix.",
    tests: [
      "checks ownership in every route that acts on a GOAD instance or task",
      "never treats a username prefix in an instance id as ownership",
    ],
  },
  {
    id: "path",
    text: "Ids from the URL or body that become paths are a single segment (`assertSafeInstanceId` or equivalent).",
    tests: ["keeps request ids out of filesystem paths until they are one segment"],
  },
  {
    id: "secret",
    text: "No secret goes into a command line; secrets go on stdin or into a 0600 file.",
    tests: [
      "builds no shell command that interpolates a secret",
      "passes no secret as a shell argument in the bundled scripts",
    ],
  },
  {
    id: "get",
    text: "`GET` handlers change no state.",
    tests: ["changes no state in a GET handler"],
  },
  {
    id: "origin",
    text: "Mutating requests still pass the origin check.",
    tests: ["the proxy rejects a mutating cross-site request before the session gate"],
  },
  {
    id: "finding",
    text: "A finding fixed here has a test in `src/security/regressions.test.ts` or a focused test it names.",
    tests: ["a security changelog entry in this change has a regression test"],
  },
  {
    id: "changelog",
    text: "`CHANGELOG.md` has one entry per change, under the right tag.",
    tests: [],
  },
  {
    id: "live",
    text: "`bash scripts/ci/live-security.sh` passed on this commit (the `security-gate/live` status, or the GitLab `security-live` job).",
    tests: [],
  },
]

const LIVE_CONTEXT = "security-gate/live"

export function itemText(line) {
  return line.replace(/^\s*- \[[ xX]\]\s*/, "").trim()
}

/**
 * @param {{ testResults?: { assertionResults?: { title?: string, status?: string }[] }[] } | null | undefined} report
 * @returns {Record<string, "pass" | "fail">}
 */
export function resultsFromVitest(report) {
  const titles = new Map()
  for (const file of report?.testResults ?? []) {
    for (const test of file.assertionResults ?? []) {
      titles.set(test.title, test.status)
    }
  }
  /** @type {Record<string, "pass" | "fail">} */
  const out = {}
  for (const item of CHECKLIST) {
    if (item.tests.length === 0) continue
    const missing = item.tests.filter((title) => titles.get(title) !== "passed")
    out[item.id] = missing.length === 0 ? "pass" : "fail"
  }
  return out
}

function matchesItem(item, line) {
  const text = itemText(line)
  if (!/^-\s+\[[ xX]\]\s+/.test(line.trim())) return false
  if (text === item.text) return true
  return item.id === "live" && text.startsWith("`bash scripts/ci/live-security.sh` passed on this commit")
}

export function applyChecklist(body, states) {
  const normalized = body.replace(/\r\n/g, "\n")
  const lines = normalized.split("\n")
  if (!lines.some((line) => line.trim() === "## Security checklist")) {
    return { body: normalized, changed: false, missing: true }
  }
  for (const item of CHECKLIST) {
    if (!Object.prototype.hasOwnProperty.call(states, item.id)) continue
    const mark = states[item.id] === "pass" ? "x" : " "
    const next = `- [${mark}] ${item.text}`
    const at = lines.findIndex((line) => matchesItem(item, line))
    if (at === -1) lines.push(next)
    else lines[at] = next
  }
  const nextBody = `${lines.join("\n").replace(/\n*$/, "\n")}`
  const prev = `${normalized.replace(/\n*$/, "\n")}`
  return { body: nextBody, changed: nextBody !== prev, missing: false }
}

function ghEnv() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ""
  return { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token }
}

function run(cmd, args, { input } = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", input, env: ghEnv(), cwd: root })
}

function githubRepo() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY
  const remote = run("git", ["remote", "get-url", "origin"])
  const match = (remote.stdout || "").match(/github\.com[:/]([^/]+\/[^/.]+)/)
  return match ? match[1] : ""
}

function commitSha() {
  return process.env.LUX_COMMIT_SHA || process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA || run("git", ["rev-parse", "HEAD"]).stdout.trim()
}

function liveFromGithub(repo, sha) {
  if (!repo || !sha || !(process.env.GH_TOKEN || process.env.GITHUB_TOKEN)) return "pending"
  const res = run("gh", ["api", `repos/${repo}/commits/${sha}/status`])
  if (res.status !== 0) return "pending"
  let payload
  try {
    payload = JSON.parse(res.stdout || "{}")
  } catch {
    return "pending"
  }
  const status = (payload.statuses ?? []).find((row) => row.context === LIVE_CONTEXT)
  if (!status) return "pending"
  if (status.state === "success") return "pass"
  if (status.state === "failure" || status.state === "error") return "fail"
  return "pending"
}

function gitlab(method, apiPath, bodyFile) {
  const args = ["scripts/ci/gitlab-api.mjs", method, apiPath]
  if (bodyFile) args.push(bodyFile)
  const res = run("node", args)
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || "GitLab API failed").trim()
    throw new Error(detail)
  }
  return res.stdout
}

function liveFromGitlab(sha) {
  if (!process.env.CI_API_V4_URL || !process.env.CI_PROJECT_ID || !sha) return "pending"
  let payload
  try {
    payload = JSON.parse(gitlab("GET", `/projects/${process.env.CI_PROJECT_ID}/repository/commits/${sha}/statuses`))
  } catch {
    return "pending"
  }
  const rows = Array.isArray(payload) ? payload : []
  const status = rows.find((row) => row.name === LIVE_CONTEXT)
  if (!status) return "pending"
  if (status.status === "success") return "pass"
  if (status.status === "failed" || status.status === "canceled") return "fail"
  return "pending"
}

function changelogFromGitlab() {
  if (process.env.LUX_CHANGELOG_RESULT) return process.env.LUX_CHANGELOG_RESULT === "success" ? "pass" : "fail"
  if (!process.env.CI_PIPELINE_ID || !process.env.CI_PROJECT_ID) return "fail"
  const payload = JSON.parse(gitlab("GET", `/projects/${process.env.CI_PROJECT_ID}/pipelines/${process.env.CI_PIPELINE_ID}/jobs?per_page=100`))
  const jobs = Array.isArray(payload) ? payload : []
  const job = jobs.find((row) => row.name === "changelog")
  return job?.status === "success" ? "pass" : "fail"
}

function loadSecurityResults() {
  const file = process.env.LUX_CHECKLIST_PART || path.join(root, "security-checklist-part.json")
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, "utf8"))
}

export function checklistStates({ security, changelog, live }) {
  const states = {}
  for (const item of CHECKLIST) {
    if (item.id === "changelog") states.changelog = changelog
    else if (item.id === "live") states.live = live
    else states[item.id] = security?.[item.id] === "pass" ? "pass" : "fail"
  }
  return states
}

function requiredFailed(states) {
  return CHECKLIST.filter((item) => item.id !== "live" && states[item.id] !== "pass").map((item) => item.id)
}

function printStates(states) {
  for (const item of CHECKLIST) console.log(`${item.id.padEnd(12)} ${states[item.id]}`)
}

function writeBody(file, body) {
  writeFileSync(file, body.endsWith("\n") ? body : `${body}\n`)
}

function githubBody(number) {
  const res = run("gh", ["pr", "view", String(number), "--json", "body"])
  if (res.status !== 0) throw new Error((res.stderr || "could not read the pull request").trim())
  return JSON.parse(res.stdout || "{}").body ?? ""
}

function saveGithubBody(number, body) {
  const dir = mkdtempSync(path.join(tmpdir(), "lux-checklist-"))
  const file = path.join(dir, "body.md")
  writeBody(file, body)
  const res = run("gh", ["pr", "edit", String(number), "--body-file", file])
  if (res.status !== 0) throw new Error((res.stderr || "could not update the pull request").trim())
}

function gitlabBody() {
  const payload = JSON.parse(gitlab("GET", `/projects/${process.env.CI_PROJECT_ID}/merge_requests/${process.env.CI_MERGE_REQUEST_IID}`))
  return payload.description ?? ""
}

function saveGitlabBody(body) {
  const file = path.join(root, ".security-checklist-body.json")
  writeFileSync(file, JSON.stringify({ description: body.endsWith("\n") ? body : `${body}\n` }))
  try {
    gitlab("PUT", `/projects/${process.env.CI_PROJECT_ID}/merge_requests/${process.env.CI_MERGE_REQUEST_IID}`, file)
  } finally {
    spawnSync("rm", ["-f", file], { cwd: root })
  }
}

function updateBody(current, states) {
  if (!current.includes("## Security checklist") && !current.includes("lux-pr-summary")) {
    console.log("Description has no security checklist; leaving it")
    return false
  }
  const applied = applyChecklist(current, states)
  if (applied.missing) {
    const template = readFileSync(path.join(root, ".github/pull_request_template.md"), "utf8")
    const section = template.slice(template.indexOf("## Security checklist")).trimEnd()
    const withSection = `${current.replace(/\s*$/, "")}\n\n${section}\n`
    const again = applyChecklist(withSection, states)
    return commitBody(again.body)
  }
  if (!applied.changed) return false
  return commitBody(applied.body)
}

function commitBody(body) {
  if (process.env.CI_MERGE_REQUEST_IID) {
    saveGitlabBody(body)
    console.log(`Updated merge request !${process.env.CI_MERGE_REQUEST_IID}`)
    return true
  }
  if (process.env.PR_NUMBER) {
    saveGithubBody(process.env.PR_NUMBER, body)
    console.log(`Updated pull request #${process.env.PR_NUMBER}`)
    return true
  }
  return false
}

function currentBody() {
  if (process.env.CI_MERGE_REQUEST_IID) return gitlabBody()
  if (process.env.PR_NUMBER) return githubBody(process.env.PR_NUMBER)
  return ""
}

function openPullRequests(repo, sha) {
  if (!repo || !sha) return []
  const res = run("gh", ["api", `repos/${repo}/commits/${sha}/pulls`, "-H", "Accept: application/vnd.github+json"])
  if (res.status !== 0) return []
  try {
    return JSON.parse(res.stdout || "[]").filter((pr) => pr.state === "open")
  } catch {
    return []
  }
}

function markLive(state) {
  const sha = commitSha()
  if (process.env.CI_MERGE_REQUEST_IID) {
    const applied = applyChecklist(gitlabBody(), { live: state })
    if (applied.changed) saveGitlabBody(applied.body)
    return
  }
  const repo = githubRepo()
  const numbers = process.env.PR_NUMBER
    ? [process.env.PR_NUMBER]
    : openPullRequests(repo, sha).map((pr) => String(pr.number))
  for (const number of numbers) {
    process.env.PR_NUMBER = number
    const applied = applyChecklist(githubBody(number), { live: state })
    if (applied.changed) saveGithubBody(number, applied.body)
  }
}

function sync() {
  const security = loadSecurityResults()
  const changelog = process.env.CI_MERGE_REQUEST_IID && !process.env.LUX_CHANGELOG_RESULT
    ? changelogFromGitlab()
    : process.env.LUX_CHANGELOG_RESULT === "success" ? "pass" : "fail"
  const sha = commitSha()
  const live = process.env.CI_MERGE_REQUEST_IID ? liveFromGitlab(sha) : liveFromGithub(githubRepo(), sha)
  const states = checklistStates({ security, changelog, live })
  printStates(states)
  try {
    const body = currentBody()
    if (body) updateBody(body, states)
  } catch (err) {
    console.error(err instanceof Error ? err.message : "could not update the checklist")
    process.exit(1)
  }
  const failed = requiredFailed(states)
  if (failed.length > 0) {
    console.error(`Security checklist failed: ${failed.join(", ")}`)
    process.exit(1)
  }
}

function fromVitest(file) {
  let report = {}
  if (file && existsSync(file)) {
    try {
      report = JSON.parse(readFileSync(file, "utf8"))
    } catch {
      report = {}
    }
  }
  const results = resultsFromVitest(report)
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) {
  const cmd = process.argv[2]
  if (cmd === "from-vitest") fromVitest(process.argv[3])
  else if (cmd === "mark-live") markLive(process.argv[3] === "pass" || process.argv[3] === "success" ? "pass" : "fail")
  else if (cmd === "sync") sync()
  else {
    console.error("usage: security-checklist.mjs from-vitest <report.json> | sync | mark-live pass|fail")
    process.exit(1)
  }
}
