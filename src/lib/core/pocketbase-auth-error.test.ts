import { afterEach, describe, expect, it, vi } from "vitest"
import {
  explainPocketBaseAuthFailure,
  resetPocketBaseAuthWarningForTests,
  warnPocketBaseAuthFailure,
} from "@/lib/core/pocketbase-auth-error"

describe("explainPocketBaseAuthFailure", () => {
  it("names an empty key and a rejected superuser password separately", () => {
    expect(explainPocketBaseAuthFailure([], false)).toMatch(/LUDUS_ROOT_API_KEY is empty/)
    expect(
      explainPocketBaseAuthFailure(
        [
          { endpoint: "/api/collections/_superusers/auth-with-password", status: 400 },
          { endpoint: "/api/admins/auth-with-password", status: 404 },
        ],
        true,
      ),
    ).toMatch(/rejected LUDUS_ROOT_API_KEY/)
  })

  it("names a certificate failure instead of the API key", () => {
    expect(
      explainPocketBaseAuthFailure(
        [{ endpoint: "/api/collections/_superusers/auth-with-password", error: "unable to verify the first certificate" }],
        true,
      ),
    ).toMatch(/LUDUS_TLS_INSECURE=true/)
  })
})

describe("warnPocketBaseAuthFailure", () => {
  afterEach(() => {
    resetPocketBaseAuthWarningForTests()
    vi.restoreAllMocks()
  })

  it("logs a repeated failure once per interval", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    warnPocketBaseAuthFailure("same", 0)
    warnPocketBaseAuthFailure("same", 1_000)
    warnPocketBaseAuthFailure("same", 10 * 60_000)
    expect(warn).toHaveBeenCalledTimes(2)
  })
})
