import { describe, expect, it, vi, beforeEach } from "vitest"

const { revalidateTag, revalidateLudusResource, revalidateLudusScopeResource, revalidateLudusAdminMutation } =
  vi.hoisted(() => ({
    revalidateTag: vi.fn(),
    revalidateLudusResource: vi.fn(),
    revalidateLudusScopeResource: vi.fn(),
    revalidateLudusAdminMutation: vi.fn(),
  }))

vi.mock("next/cache", () => ({ revalidateTag }))
vi.mock("@/lib/ludus-cache-revalidate", () => ({
  revalidateLudusResource,
  revalidateLudusScopeResource,
  revalidateLudusAdminMutation,
}))

import { revalidateAfterLudusProxyMutation } from "@/lib/ludus-proxy-cache-invalidate"

const session = { username: "alice", impersonationUserId: undefined }

describe("revalidateAfterLudusProxyMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("ignores GET", () => {
    revalidateAfterLudusProxyMutation("GET", "/groups", session)
    expect(revalidateLudusResource).not.toHaveBeenCalled()
  })

  it("revalidates groups on POST /groups", () => {
    revalidateAfterLudusProxyMutation("POST", "/groups/foo", session)
    expect(revalidateLudusResource).toHaveBeenCalledWith("groups")
    expect(revalidateLudusScopeResource).toHaveBeenCalledWith("alice|self", "groups")
  })

  it("revalidates blueprints on PATCH", () => {
    revalidateAfterLudusProxyMutation("PATCH", "/blueprints/1", session)
    expect(revalidateLudusResource).toHaveBeenCalledWith("blueprints")
  })

  it("revalidates templates on DELETE", () => {
    revalidateAfterLudusProxyMutation("DELETE", "/templates/x", session)
    expect(revalidateLudusResource).toHaveBeenCalledWith("templates")
  })

  it("revalidates ranges + range slices on /range deploy", () => {
    revalidateAfterLudusProxyMutation("POST", "/range/deploy", session)
    expect(revalidateLudusResource).toHaveBeenCalledWith("ranges")
    expect(revalidateTag).toHaveBeenCalled()
  })

  it("revalidates users + admin on /user mutation", () => {
    revalidateAfterLudusProxyMutation("PUT", "/user/bob", session)
    expect(revalidateLudusResource).toHaveBeenCalledWith("users")
    expect(revalidateLudusAdminMutation).toHaveBeenCalled()
  })
})
