import { describe, expect, it } from "vitest"
import { filterSarif, idsCoveringLine } from "../../scripts/ci/codeql-apply-suppressions.mjs"

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
      "src/lib/goad-ssh.ts": [
        "conn.on('ready', () => {",
        "  // codeql[js/command-line-injection]",
        "  conn.exec(execCommand)",
        "})",
      ].join("\n"),
    }
    const doc = {
      runs: [{
        results: [
          result("js/command-line-injection", "src/lib/goad-ssh.ts", 3),
          result("js/request-forgery", "src/lib/goad-ssh.ts", 3),
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
