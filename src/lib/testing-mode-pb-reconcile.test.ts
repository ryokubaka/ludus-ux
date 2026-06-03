import { describe, expect, it } from "vitest"
import {
  inferCompletedTestingToggleFromLog,
  logIndicatesTestingStartComplete,
  logIndicatesTestingStopComplete,
  sliceCappedLogSinceMarkerForTest,
  testingOpLogSliceProvesComplete,
  type TestingOpLogMarker,
} from "./testing-mode-pb-reconcile"

const TESTING_START_LOG_TAIL = `
PLAY [Take a snapshot of all VMs where testing undefined or snapshot is true] ***
TASK [Create new clean snapshot] ***********************************************
changed: [localhost] => (item=136)
PLAY [Block VMs from accessing the internet when testing undefined or block_internet is true] ***
TASK [Remove the default external rule] ****************************************
changed: [smeowden-GOAD-Mini-router-debian11-x64]
TASK [Flush the LUDUS_TESTING table to remove any user defined rules now that testing is done] ***
skipping: [smeowden-GOAD-Mini-router-debian11-x64]
PLAY RECAP *********************************************************************
localhost                  : ok=14   changed=3    unreachable=0    failed=0    skipped=3    rescued=0    ignored=1
smeowden-GOAD-Mini-router-debian11-x64 : ok=12   changed=4    unreachable=0    failed=0    skipped=27   rescued=0    ignored=0
`

const TESTING_STOP_LOG_TAIL = `
PLAY [Revert to a snapshot for all test-range VMs] *****************************
TASK [Revert VM to snapshot] ***************************************************
changed: [localhost] => (item=151)
PLAY RECAP *********************************************************************
localhost                  : ok=8   changed=2    unreachable=0    failed=0    skipped=0    rescued=0    ignored=0
`

const TESTING_STOP_MULTihost_LOG = `
PLAY [Revert VMs to ludus_automated_clean_snapshot] ****************************
PLAY RECAP *********************************************************************
despacito-GOAD-DC01 : ok=6   changed=0    unreachable=0    failed=0    skipped=0    rescued=0    ignored=0
despacito-router-debian11-x64 : ok=4   changed=0    unreachable=0    failed=0    skipped=0    rescued=0    ignored=0
`

/** GOAD-style stop: allow subnet + filtering rules, no explicit Revert VM task line. */
const GOAD_STOP_ALLOW_SUBNET_LOG = `
PLAY [Allow the test range subnet to access the internet] **********************
TASK [Set filtering rules (now without the domain)] ****************************
changed: [despacito-router-debian11-x64]
PLAY RECAP *********************************************************************
despacito-router-debian11-x64 : ok=4   changed=1    unreachable=0    failed=0    skipped=0    rescued=0    ignored=0
localhost                  : ok=2   changed=0    unreachable=0    failed=0    skipped=0    rescued=0    ignored=0
`

describe("testing-mode op log detection", () => {
  it("detects successful testing start", () => {
    expect(logIndicatesTestingStartComplete(TESTING_START_LOG_TAIL)).toBe(true)
    expect(logIndicatesTestingStopComplete(TESTING_START_LOG_TAIL)).toBe(false)
    expect(inferCompletedTestingToggleFromLog(TESTING_START_LOG_TAIL)).toBe("start")
    expect(testingOpLogSliceProvesComplete("testing_start", TESTING_START_LOG_TAIL)).toBe(true)
  })

  it("detects successful testing stop", () => {
    expect(logIndicatesTestingStopComplete(TESTING_STOP_LOG_TAIL)).toBe(true)
    expect(testingOpLogSliceProvesComplete("testing_stop", TESTING_STOP_LOG_TAIL)).toBe(true)
  })

  it("detects GOAD stop via allow-subnet play", () => {
    expect(logIndicatesTestingStopComplete(GOAD_STOP_ALLOW_SUBNET_LOG)).toBe(true)
    expect(testingOpLogSliceProvesComplete("testing_stop", GOAD_STOP_ALLOW_SUBNET_LOG)).toBe(true)
  })

  it("detects multi-host revert stop", () => {
    expect(logIndicatesTestingStopComplete(TESTING_STOP_MULTihost_LOG)).toBe(true)
  })

  it("stop recap wins when appended after start in same tail", () => {
    const log = `${TESTING_START_LOG_TAIL}\n${TESTING_STOP_MULTihost_LOG}`
    expect(logIndicatesTestingStopComplete(log)).toBe(true)
    expect(logIndicatesTestingStartComplete(log)).toBe(false)
  })

  it("rejects PLAY RECAP with failures", () => {
    const bad = `
PLAY [Block VMs from accessing the internet when testing undefined or block_internet is true] ***
PLAY [Take a snapshot of all VMs where testing undefined or snapshot is true] ***
PLAY RECAP *********************************************************************
localhost : ok=1 changed=0 unreachable=0 failed=1 skipped=0 rescued=0 ignored=0
`
    expect(logIndicatesTestingStartComplete(bad)).toBe(false)
  })

  it("slices op log via tail anchor", () => {
    const beforeOp = `${"y".repeat(200)}${TESTING_STOP_LOG_TAIL}`
    const marker: TestingOpLogMarker = {
      cappedLength: beforeOp.length,
      sshFileBytes: null,
      tailAnchor: beforeOp.slice(-8192),
    }
    const afterOp = `${beforeOp}\n${TESTING_START_LOG_TAIL.trim()}`
    const slice = sliceCappedLogSinceMarkerForTest(afterOp, marker)
    expect(testingOpLogSliceProvesComplete("testing_start", slice)).toBe(true)
  })

  it("ignores pre-op start recap in empty slice", () => {
    const staleFullLog = `${"x".repeat(500)}${TESTING_START_LOG_TAIL}`
    const marker: TestingOpLogMarker = {
      cappedLength: staleFullLog.length,
      sshFileBytes: null,
      tailAnchor: "",
    }
    expect(testingOpLogSliceProvesComplete("testing_start", sliceCappedLogSinceMarkerForTest(staleFullLog, marker))).toBe(false)
  })
})
