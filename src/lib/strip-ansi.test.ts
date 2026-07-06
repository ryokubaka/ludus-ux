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

  it("keeps a trailing carriage return line intact", () => {
    // Regression: anchored regex used to delete the whole line, dropping it.
    expect(stripAnsi("downloading...\r")).toBe("downloading...")
  })

  it("does not strip bracketed text starting with 'm' (bare [m)", () => {
    expect(stripAnsi("TASK [main : Do X]")).toBe("TASK [main : Do X]")
    expect(stripAnsi("ok: [myhost]")).toBe("ok: [myhost]")
    expect(stripAnsi("[microsoft.ad.membership : task]")).toBe(
      "[microsoft.ad.membership : task]",
    )
  })

  it("still strips real literal SGR codes", () => {
    expect(stripAnsi("[0mplain")).toBe("plain")
    expect(stripAnsi("[1;32mgreen[0m")).toBe("green")
    expect(stripAnsi("[0;32mok[0m")).toBe("ok")
  })

  it("strips OSC sequences", () => {
    expect(stripAnsi("\x1b]0;window title\x07visible")).toBe("visible")
    expect(stripAnsi("\x1b]8;;https://example.com\x1b\\link")).toBe("link")
  })

  it("keeps intentional interior blank lines but trims trailing blanks", () => {
    expect(splitLogText("phase one\n\nphase two\n")).toEqual([
      "phase one",
      "",
      "phase two",
    ])
  })
})
