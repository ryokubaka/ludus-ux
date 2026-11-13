import { describe, expect, it, vi, beforeEach } from "vitest"

const { revalidateTag, revalidateLudusResource, revalidateLudusScopeResource, revalidateLudusAdminMutation } =
  vi.hoisted(() => ({
    revalidateTag: vi.fn(),
    revalidateLudusResource: vi.fn(),
    revalidateLudusScopeResource: vi.fn(),
    revalidateLudusAdminMutation: vi.fn(),
  }))

vi.mock("next/cache", () => ({ revalidateTag }))
vi.mock("@/lib/ludus/ludus-cache-revalidate", () => ({
  revalidateLudusResource,
  revalidateLudusScopeResource,
  revalidateLudusAdminMutation,
}))
vi.mock("@/lib/ludus/ludus-swr-invalidate", () => ({
  invalidateInProcessLudusCachesAfterMutation: vi.fn(),
}))

import { revalidateAfterLudusProxyMutation } from "@/lib/ludus/ludus-proxy-cache-invalidate"
import { ludusRangeCacheTag, ludusRangeIdCacheTag } from "@/lib/ludus/ludus-cache-tags"

const session = {
  username: "alice",
  impersonationUserId: undefined,
  apiKey: "test-key",
  impersonationApiKey: undefined,
}

describe("revalidateAfterLudusProxyMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("ignores GET", () => {
    revalidateAfterLudusProxyMutation("GET", "/groups", session)
    expect(revalidateLudusResource).not.toHaveBeenCalled()
  })

  it("revalidates groups globally and in the acting scope on POST /groups", () => {
    revalidateAfterLudusProxyMutation("POST", "/groups/foo", session)
    expect(revalidateLudusResource).toHaveBeenCalledWith("groups")
    expect(revalidateLudusScopeResource).toHaveBeenCalledWith("alice|self", "groups")
  })

  it("revalidates blueprints globally and in the acting scope on PATCH", () => {
    revalidateAfterLudusProxyMutation("PATCH", "/blueprints/1", session)
    expect(revalidateLudusResource).toHaveBeenCalledWith("blueprints")
    expect(revalidateLudusScopeResource).toHaveBeenCalledWith("alice|self", "blueprints")
    expect(revalidateTag).not.toHaveBeenCalled()
  })

  it("busts that range's config cache when a blueprint is applied", () => {
    revalidateAfterLudusProxyMutation("POST", "/blueprints/goad/apply", session, "alice-RANGE-1234")
    expect(revalidateLudusResource).toHaveBeenCalledWith("blueprints")
    expect(revalidateTag).toHaveBeenCalledWith(
      ludusRangeIdCacheTag("alice|self", "rangeConfig", "alice-RANGE-1234"),
      "max",
    )
  })

  it("revalidates templates on DELETE /templates/…", () => {
    revalidateAfterLudusProxyMutation("DELETE", "/templates/x", session)
    expect(revalidateLudusResource).toHaveBeenCalledWith("templates")
  })

  it("revalidates templates on DELETE /template/… (Ludus singular)", () => {
    revalidateAfterLudusProxyMutation("DELETE", "/template/debian10", session)
    expect(revalidateLudusResource).toHaveBeenCalledWith("templates")
  })

  it("busts only the mutated range when the range ID is known", () => {
    revalidateAfterLudusProxyMutation("POST", "/range/deploy", session, "alice-RANGE-1234")

    expect(revalidateLudusScopeResource).toHaveBeenCalledWith("alice|self", "ranges")
    expect(revalidateTag).toHaveBeenCalledWith(
      ludusRangeIdCacheTag("alice|self", "rangeStatus", "alice-RANGE-1234"),
      "max",
    )
    expect(revalidateTag).toHaveBeenCalledWith(
      ludusRangeIdCacheTag("alice|self", "rangeConfig", "alice-RANGE-1234"),
      "max",
    )
    // No scope-wide or global range tag is touched for a known range.
    expect(revalidateTag).not.toHaveBeenCalledWith(
      ludusRangeCacheTag("alice|self", "rangeStatus"),
      "max",
    )
  })

  it("falls back to scope-wide range tags when no range ID is available", () => {
    revalidateAfterLudusProxyMutation("POST", "/range/deploy", session)

    expect(revalidateTag).toHaveBeenCalledWith(
      ludusRangeCacheTag("alice|self", "rangeStatus"),
      "max",
    )
    expect(revalidateTag).toHaveBeenCalledWith(
      ludusRangeCacheTag("alice|self", "snapshots"),
      "max",
    )
    expect(revalidateTag).not.toHaveBeenCalledWith("ludus:rangeStatus", "max")
  })

  it("uses the impersonated scope for range invalidation", () => {
    revalidateAfterLudusProxyMutation(
      "PUT",
      "/range/config",
      { ...session, impersonationUserId: "user-bob" },
      "bob-RANGE-9999",
    )

    expect(revalidateLudusScopeResource).toHaveBeenCalledWith("alice|user-bob", "ranges")
    expect(revalidateTag).toHaveBeenCalledWith(
      ludusRangeIdCacheTag("alice|user-bob", "rangeConfig", "bob-RANGE-9999"),
      "max",
    )
  })

  it("revalidates range slices on /testing mutations", () => {
    revalidateAfterLudusProxyMutation("POST", "/testing/toggle", session, "alice-RANGE-1234")
    expect(revalidateTag).toHaveBeenCalledWith(
      ludusRangeIdCacheTag("alice|self", "rangeStatus", "alice-RANGE-1234"),
      "max",
    )
  })

  it("revalidates users + admin on /user mutation", () => {
    revalidateAfterLudusProxyMutation("PUT", "/user/bob", session)
    expect(revalidateLudusResource).toHaveBeenCalledWith("users")
    expect(revalidateLudusAdminMutation).toHaveBeenCalled()
  })
})
