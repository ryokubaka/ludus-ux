import { existsSync } from "node:fs"
import { expect, test as teardown } from "@playwright/test"
import { STATE_FILE, adminProxyHeaders, loginAdmin, readState, removeState } from "./helpers"

// Runs after the security project even when it fails: removes every snapshot
// the suite stored, then the throwaway user and its default range.
teardown("delete the throwaway user and everything the suite wrote", async () => {
  teardown.setTimeout(8 * 60_000)
  if (!existsSync(STATE_FILE)) return
  const state = readState()
  const admin = await loginAdmin()

  for (const id of state.syntheticIds) {
    await admin.delete(`/api/goad/instances/${id}/pending-network`).catch(() => undefined)
  }

  await admin.post("/api/users/purge-pocketbase-logs", { data: { userId: state.userId } }).catch(() => undefined)
  const removed = await admin.delete(`/api/proxy/user/${encodeURIComponent(state.userId)}?deleteDefaultRange=true`, {
    headers: adminProxyHeaders,
    timeout: 6 * 60_000,
  })
  const gone = removed.ok() || removed.status() === 404
  if (gone) removeState()
  await admin.dispose()
  expect(gone, `delete ${state.userId}: HTTP ${removed.status()}. Remove it on the Users page.`).toBe(true)
})
