import { describe, expect, it } from "vitest"
import { getAnsibleLineClass } from "./ansible-colors"

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
})
