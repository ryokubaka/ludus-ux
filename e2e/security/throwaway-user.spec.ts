import { expect, test, type APIRequestContext } from "@playwright/test"
import {
  PUBLIC_HANDLERS,
  adminProxyHeaders,
  apiHandlers,
  expectDenied,
  login,
  loginAdmin,
  loginThrowaway,
  newContext,
  randomId,
  randomPassword,
  readState,
  writeState,
} from "./helpers"

// As the throwaway non-admin user. Every write targets a synthetic instance
// id or a user that does not exist, never a real lab.
test.describe.configure({ mode: "serial" })

let user: APIRequestContext
let admin: APIRequestContext

test.beforeAll(async () => {
  user = await loginThrowaway()
  admin = await loginAdmin()
})

test.afterAll(async () => {
  await user?.dispose()
  await admin?.dispose()
})

test("a cookie replayed after logout is refused", async () => {
  test.setTimeout(5 * 60_000)
  const state = readState()
  const session = await login(state.userId, state.password, state.apiKey)
  const cookies = (await session.storageState()).cookies
  expect((await session.post("/api/auth/logout")).ok()).toBe(true)
  await session.dispose()

  const replay = await newContext()
  const header = cookies.map((c) => `${c.name}=${c.value}`).join("; ")
  const accepted: string[] = []
  for (const h of apiHandlers().filter((x) => x.method === "GET" && !PUBLIC_HANDLERS.has(`${x.route} GET`))) {
    const res = await replay.get(h.url, { headers: { Cookie: header }, maxRedirects: 0, timeout: 20_000 })
    if (![401, 403].includes(res.status())) accepted.push(`GET ${h.url} → ${res.status()}`)
    await res.dispose()
  }
  await replay.dispose()
  expect(accepted, "these accepted a logged-out cookie").toEqual([])
})

test("settings contain no secrets", async () => {
  const res = await user.get("/api/settings")
  expect(res.ok()).toBe(true)
  const leaked: string[] = []
  const walk = (value: unknown, at: string) => {
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, `${at}.${k}`)
    } else if (typeof value === "string" && value && /(password|secret|token|api_?key)$/i.test(at)) {
      leaked.push(at)
    }
  }
  walk(await res.json(), "settings")
  expect(leaked).toEqual([])
})

test("admin routes refuse a non-admin", async () => {
  const nobody = "luxsecnobody"
  const calls: Array<[string, Promise<{ status(): number }>]> = [
    ["GET ssh-host-key", user.get("/api/settings/ssh-host-key")],
    ["DELETE ssh-host-key", user.delete("/api/settings/ssh-host-key", { data: { host: "luxsec.invalid", port: 22 } })],
    ["POST settings", user.post("/api/settings", { data: {} })],
    ["POST test-credentials", user.post("/api/settings/test-credentials", { data: {} })],
    ["POST roll-key", user.post("/api/users/roll-key", { data: { userId: nobody } })],
    ["POST change-password", user.post("/api/users/change-password", { data: { userId: nobody, newPassword: "x" } })],
    ["POST user-role", user.post("/api/admin/user-role", { data: { userId: nobody, isAdmin: true } })],
    ["GET all users", user.get("/api/proxy/user/all", { headers: adminProxyHeaders })],
  ]
  for (const [what, call] of calls) expectDenied((await call).status(), what)
})

test("a GET to revoke does not log out a live session", async () => {
  await user.get("/api/auth/revoke", { maxRedirects: 0 })
  expect((await user.get("/api/auth/session")).ok()).toBe(true)
})

test("another user's GOAD instance is off limits", async () => {
  const state = readState()
  const instanceId = randomId("luxsecsynthetic")
  writeState({ ...state, syntheticIds: [...state.syntheticIds, instanceId] })
  const snapshot = { rules: [{ name: "luxsec", action: "ACCEPT" }], marker: instanceId }

  const stored = await admin.post(`/api/goad/instances/${instanceId}/pending-network`, { data: snapshot })
  expect(stored.ok(), `admin store: HTTP ${stored.status()}`).toBe(true)

  const base = `/api/goad/instances/${instanceId}`
  expectDenied((await user.get(`${base}/pending-network`)).status(), "read snapshot")
  expectDenied((await user.post(`${base}/pending-network`, { data: { rules: [] } })).status(), "overwrite snapshot")
  expectDenied((await user.delete(`${base}/pending-network`)).status(), "delete snapshot")
  expectDenied(
    (await user.post("/api/goad/deploy-handoff", { data: { rangeId: state.userId, instanceId, networkRules: [] } })).status(),
    "deploy handoff",
  )
  expectDenied((await user.post(`${base}/force-delete`, { data: {} })).status(), "force delete")
  for (const sub of ["sync-network", "sync-ips", "refresh-workspace", "init-range"]) {
    expectDenied((await user.post(`${base}/${sub}`, { data: {} })).status(), sub)
  }
  const execute = await user.post("/api/goad/execute", {
    data: { args: `--repl "use ${instanceId}"` },
    timeout: 20_000,
  })
  expectDenied(execute.status(), "execute on another instance")

  const after = await admin.get(`${base}/pending-network`)
  expect(after.ok()).toBe(true)
  expect(JSON.stringify(await after.json())).toContain(instanceId)
})

test("another user's GOAD task is off limits", async () => {
  const adminUser = process.env.E2E_ADMIN_USER ?? ""
  const tasks = (await (await admin.get("/api/goad/tasks")).json()) as { tasks?: Array<{ id: string; username?: string }> }
  const adminTask = tasks.tasks?.find((t) => t.username === adminUser)
  test.skip(!adminTask, "admin has no GOAD task to aim at")
  const taskId = adminTask!.id

  expectDenied((await user.get(`/api/goad/tasks/${taskId}`)).status(), "read admin task", [403, 404])
  expectDenied((await user.post(`/api/goad/tasks/${taskId}/stop`, { data: {} })).status(), "stop admin task", [403, 404])
  expectDenied(
    (await user.post(`/api/goad/tasks/${taskId}/link-instance`, { data: { instanceId: randomId("luxsecsynthetic") } })).status(),
    "relink admin task",
    [403, 404],
  )

  // A handoff the throwaway user owns, moved onto the admin's task.
  const state = readState()
  const handoff = await user.post("/api/goad/deploy-handoff", { data: { rangeId: state.userId } })
  test.skip(!handoff.ok(), "throwaway user has no readable range for a handoff")
  const { handoffId } = (await handoff.json()) as { handoffId: string }
  expectDenied(
    (await user.patch("/api/goad/deploy-handoff", { data: { handoffId, taskId } })).status(),
    "link own handoff onto admin task",
    [403, 404],
  )
})

test("the origin gate lets a same-origin POST through", async () => {
  const res = await user.post("/api/auth/login", {
    headers: { Origin: new URL(process.env.PLAYWRIGHT_BASE_URL || "https://localhost").origin, "Sec-Fetch-Site": "same-origin" },
    data: { username: "luxsecnobody", password: randomPassword() },
  })
  // Past the origin gate, refused by the login itself.
  expect(res.status()).not.toBe(403)
})

test("admin can still do what the throwaway user cannot", async () => {
  const keys = await admin.get("/api/settings/ssh-host-key")
  expect(keys.ok(), `host key list: HTTP ${keys.status()}`).toBe(true)

  const state = readState()
  const instanceId = randomId("luxsecsynthetic")
  writeState({ ...state, syntheticIds: [...state.syntheticIds, instanceId] })
  const base = `/api/goad/instances/${instanceId}/pending-network`
  expect((await admin.post(base, { data: { rules: [] } })).ok()).toBe(true)
  expect((await admin.get(base)).ok()).toBe(true)
  expect((await admin.delete(base)).ok()).toBe(true)
})
