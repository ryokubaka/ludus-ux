import { describe, expect, it } from "vitest"
import { splitLogText, stripAnsi } from "./strip-ansi"

describe("strip-ansi", () => {
  it("strips ESC-based SGR codes", () => {
    const raw = "\x1b[1;32m==> build step\x1b[0m"
    expect(stripAnsi(raw)).toBe("==> build step")
  })

  it("strips literal bracket SGR codes from packer logs", () => {
    const raw =
      "2026/06/29 13:02:06 ui: [1;32m==> proxmox-iso.win11: Retrieving ISO[0m"
    expect(stripAnsi(raw)).toBe(
      "2026/06/29 13:02:06 ui: ==> proxmox-iso.win11: Retrieving ISO",
    )
  })

  it("handles nested green ui lines and plugin prefixes", () => {
    const raw =
      "[0;32m    proxmox-iso.win11: ok: [default][0m\n[1;32m==> proxmox-iso.win11: Provisioning[0m"
    expect(splitLogText(raw)).toEqual([
      "    proxmox-iso.win11: ok: [default]",
      "==> proxmox-iso.win11: Provisioning",
    ])
  })

  it("keeps carriage-return overwrite last segment", () => {
    expect(stripAnsi("line one\rline two")).toBe("line two")
  })
})
