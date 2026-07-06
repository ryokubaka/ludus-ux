import { describe, expect, it } from "vitest"
import { getAnsibleLineClass, ansibleClassForTheme } from "./ansible-colors"

describe("getAnsibleLineClass", () => {
  it("colors changed lines yellow even when JSON contains failed false", () => {
    const line =
      'changed: [dc03] => {"changed": true, "failed": false, "warnings": ["x"]}'
    expect(getAnsibleLineClass(line)).toBe("text-status-warning")
  })

  it("does not paint benign JSON debug lines red", () => {
    const line =
      'ok: [srv02] => {"changed": false, "exists": false, "failed": false, "failed_when_result": false}'
    expect(getAnsibleLineClass(line)).toBe("text-status-success")
  })

  it("still marks explicit JSON failure", () => {
    expect(getAnsibleLineClass('fatal: [h] => {"failed": true}')).toBe("text-status-error font-bold")
    expect(getAnsibleLineClass('ok: [h] => {"msg": "x", "failed": true}')).toBe("text-status-success")
    // "failed": true with ok: prefix — ok wins (task returned structured ok with failure flag)
    const fatalJson = '"failed": true'
    expect(getAnsibleLineClass(`some line ${fatalJson}`)).toBe("text-status-error")
  })

  it("marks Ansible FAILED! and fatal", () => {
    expect(getAnsibleLineClass("fatal: [x]: FAILED! => {}")).toBe("text-status-error font-bold")
  })

  it("PLAY RECAP stats lines use dedicated parser elsewhere", () => {
    expect(getAnsibleLineClass("host : ok=1 changed=0 unreachable=0 failed=0")).toBe("text-foreground")
  })

  it("maps the Packer arrow compound class to a light-theme equivalent", () => {
    // Bug #2: light theme lacked an entry for "text-status-success font-semibold".
    expect(
      ansibleClassForTheme("text-status-success font-semibold", "light"),
    ).toBe("text-green-800 font-semibold")
    // dark theme is a passthrough
    expect(
      ansibleClassForTheme("text-status-success font-semibold", "dark"),
    ).toBe("text-status-success font-semibold")
  })

  it("colors Packer ==> lines with the light compound class in light theme", () => {
    expect(getAnsibleLineClass("==> proxmox-iso.win11: Provisioning", "light")).toBe(
      "text-green-800 font-semibold",
    )
    expect(getAnsibleLineClass("==> proxmox-iso.win11: Provisioning", "dark")).toBe(
      "text-status-success font-semibold",
    )
  })
})
