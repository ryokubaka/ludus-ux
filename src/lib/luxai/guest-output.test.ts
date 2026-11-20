import { describe, expect, it } from "vitest"
import { guestOutputFailed } from "@/lib/luxai/guest-output"

const recap = `
PLAY [smeowden-GOAD-Mini-49UF6C-GOAD-DC01] ************************************
TASK [luxai guest command] ****************************************************
changed: [smeowden-GOAD-Mini-49UF6C-GOAD-DC01]
PLAY RECAP ********************************************************************
smeowden-GOAD-Mini-49UF6C-GOAD-DC01 : ok=1 changed=1 unreachable=0 failed=0 skipped=0 rescued=0 ignored=0
[WARNING]: Invalid characters were found in group names but not replaced
`

describe("guest command output", () => {
  it("treats a clean recap as success even though it contains the word failed", () => {
    expect(guestOutputFailed(recap)).toBe(false)
  })

  it("treats a failed host as a failure", () => {
    expect(guestOutputFailed("host : ok=0 changed=0 unreachable=0 failed=1")).toBe(true)
    expect(guestOutputFailed("fatal: [DC01]: UNREACHABLE")).toBe(true)
  })
})
