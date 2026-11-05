import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { filterSarif, idsCoveringLine } from "../../../scripts/ci/codeql-apply-suppressions.mjs"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..")

function sourceLines(rel: string): string[] {
  return readFileSync(path.join(root, rel), "utf8").split(/\n/)
}

describe("CodeQL in-source suppressions", () => {
  it("covers the next line from one comment or a run of them, and a trailing comment", () => {
    const lines = [
      "export function run() {",
      "  // codeql[js/command-line-injection] codeql[js/indirect-command-line-injection]",
      "  conn.exec(command)",
      "  // note",
      "  // codeql[js/http-to-file-access]",
      "  fs.appendFileSync(file, line)",
      "  fetch(url) // codeql[js/request-forgery]",
    ]
    expect([...idsCoveringLine(lines, 3)].sort()).toEqual([
      "js/command-line-injection",
      "js/indirect-command-line-injection",
    ])
    expect([...idsCoveringLine(lines, 6)]).toEqual(["js/http-to-file-access"])
    expect([...idsCoveringLine(lines, 7)]).toEqual(["js/request-forgery"])
    expect([...idsCoveringLine(lines, 4)]).toEqual([])
  })

  it("still reads a comment when the file uses CRLF", () => {
    const lines = ["  // codeql[js/request-forgery]\r", "  fetch(url)\r"]
    expect([...idsCoveringLine(lines, 2)]).toEqual(["js/request-forgery"])
  })

  it("covers the payload line code scanning reports, not only the call above it", () => {
    const pending = sourceLines("src/lib/goad/goad-pending-network-fs.ts")
    const payload = pending.findIndex((line) => line.includes("JSON.stringify({"))
    expect(payload).toBeGreaterThan(0)
    expect([...idsCoveringLine(pending, payload + 1)]).toContain("js/http-to-file-access")

    const docker = sourceLines("src/lib/lux/lux-upgrade-docker.ts")
    const options = docker.findIndex((line) => line.includes("socketPath: DOCKER_SOCKET_PATH"))
    expect(options).toBeGreaterThan(0)
    expect([...idsCoveringLine(docker, options)]).toContain("js/file-access-to-http")
  })

  it("stops at an ordinary comment, so a marker above that comment does not cover the code", () => {
    const lines = [
      "  // codeql[js/disabling-certificate-validation]",
      "  // not a marker",
      "  rejectUnauthorized: flag",
    ]
    expect([...idsCoveringLine(lines, 3)]).toEqual([])
  })

  it("removes a SARIF result only when the source comment names that rule", () => {
    const files: Record<string, string> = {
      "src/lib/goad/goad-ssh.ts": [
        "conn.on('ready', () => {",
        "  // codeql[js/command-line-injection]",
        "  conn.exec(execCommand)",
        "})",
      ].join("\n"),
    }
    const doc = {
      runs: [{
        results: [
          result("js/command-line-injection", "src/lib/goad/goad-ssh.ts", 3),
          result("js/request-forgery", "src/lib/goad/goad-ssh.ts", 3),
          result("js/command-line-injection", "src/lib/missing.ts", 3),
        ],
      }],
    }
    expect(filterSarif(doc, (uri) => files[uri] ?? null)).toBe(1)
    expect(doc.runs[0]?.results?.map((item) => item.ruleId)).toEqual([
      "js/request-forgery",
      "js/command-line-injection",
    ])
  })
})

function result(ruleId: string, uri: string, startLine: number) {
  return {
    ruleId,
    locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine } } }],
  }
}
