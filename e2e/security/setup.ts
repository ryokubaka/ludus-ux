import { expect, test as setup } from "@playwright/test"
import { adminProxyHeaders, loginAdmin, loginThrowaway, randomId, randomPassword, writeState } from "./helpers"

// Creates the throwaway non-admin user the way the Users page does: add the
// user, set the SSH password, roll the API key into ~/.bashrc.
setup("create a throwaway non-admin user", async () => {
  setup.setTimeout(8 * 60_000)
  const admin = await loginAdmin()
  const userId = randomId("luxsec")
  const password = randomPassword()

  const added = await admin.post(`/api/proxy/user`, {
    headers: adminProxyHeaders,
    data: { userID: userId, name: userId, isAdmin: false, email: `${userId}@ludus.invalid` },
  })
  expect(added.ok(), `add user: HTTP ${added.status()}`).toBe(true)
  // Saved now, so teardown deletes the user even if a later step fails.
  writeState({ userId, password, apiKey: "", syntheticIds: [] })

  const pw = await admin.post("/api/users/change-password", { data: { userId, newPassword: password } })
  const pwBody = (await pw.json().catch(() => ({}))) as { success?: boolean; error?: string }
  expect(pwBody.success, `set password: ${pwBody.error ?? pw.status()}`).toBe(true)

  const key = await admin.post("/api/users/roll-key", { data: { userId }, timeout: 6 * 60_000 })
  const keyBody = (await key.json().catch(() => ({}))) as { newKey?: string; error?: string }
  expect(keyBody.newKey, `roll key: ${keyBody.error ?? key.status()}`).toBeTruthy()
  writeState({ userId, password, apiKey: keyBody.newKey ?? "", syntheticIds: [] })

  const user = await loginThrowaway()
  const session = await user.get("/api/auth/session")
  expect(session.ok()).toBe(true)
  expect(((await session.json()) as { isAdmin?: boolean }).isAdmin).not.toBe(true)
  await user.dispose()
  await admin.dispose()
})
