import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Markdown } from "@/components/luxai/markdown"
import { presentCommandOutput, renderStructured } from "@/lib/luxai/command-output"
import { clipText } from "@/lib/luxai/redact"

const table = [
  "   Id ProcessName                                   CPU WorkingSet",
  "   -- -----------                                   --- ----------",
  " 3064 blnsvr                                    0.03125    7307264",
  "10200 conhost                                 12.640625   17600512",
].join("\r\n")

describe("command output", () => {
  it("renders an Ansible debug table as Markdown and keeps every row", () => {
    const raw = [
      "PLAY [smeowden-GOAD-Mini-49UF6C-GOAD-DC01] *************************************",
      "",
      "TASK [luxai guest output] ******************************************************",
      `ok: [smeowden-GOAD-Mini-49UF6C-GOAD-DC01] => ${JSON.stringify({ msg: table })}`,
    ].join("\n")
    const shown = presentCommandOutput(raw)
    expect(shown).toContain("## smeowden-GOAD-Mini-49UF6C-GOAD-DC01")
    expect(shown).toContain("| Id | ProcessName | CPU | WorkingSet |")
    expect(shown).toContain("| 3064 | blnsvr | 0.03125 | 7307264 |")
    expect(shown).toContain("| 10200 | conhost | 12.640625 | 17600512 |")
    expect(shown).not.toContain("\\r\\n")
    expect(shown).not.toContain("…[truncated]")
  })

  it("renders a JSON array and a YAML mapping", () => {
    expect(renderStructured(JSON.stringify([
      { name: "dc01", vlan: 10 },
      { name: "ws01", vlan: 21 },
    ]))).toBe([
      "| name | vlan |",
      "| --- | --- |",
      "| dc01 | 10 |",
      "| ws01 | 21 |",
    ].join("\n"))
    expect(renderStructured("fqdn: meow.local\nrole: primary-dc\n")).toContain("**fqdn**: meow.local")
    expect(renderStructured("**fqdn**: meow.local")).toBeNull()
  })

  it("escapes a backslash before a pipe in a table cell", () => {
    const shown = presentCommandOutput(JSON.stringify([{ name: "a|b\\c" }]))
    expect(shown).toContain("| a\\|b\\\\c |")
    const html = renderToStaticMarkup(createElement(Markdown, { text: shown }))
    expect(html).toContain("a|b\\c")
    expect(html.match(/<td/g)).toHaveLength(1)
  })

  it("clips at a line and says how much was omitted", () => {
    const text = `${"a".repeat(20)}\n${"b".repeat(20)}\n${"9".repeat(20)}`
    const clipped = clipText(text, 30)
    expect(clipped.endsWith("characters omitted]")).toBe(true)
    expect(clipped).not.toContain("9")
    expect(clipText("short", 30)).toBe("short")
  })
})
