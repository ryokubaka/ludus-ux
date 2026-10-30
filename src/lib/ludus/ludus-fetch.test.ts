import { describe, expect, it } from "vitest"
import { assertLudusFetchUrl } from "@/lib/ludus/ludus-fetch"

describe("assertLudusFetchUrl", () => {
  it("rejects file, userinfo, and metadata hosts and still allows a private lab URL", () => {
    expect(() => assertLudusFetchUrl("file:///etc/passwd")).toThrow(/http or https/)
    expect(() => assertLudusFetchUrl("https://user:pass@10.1.1.1/")).toThrow(/userinfo/)
    expect(() => assertLudusFetchUrl("http://169.254.169.254/latest/meta-data")).toThrow(/metadata/)
    expect(() => assertLudusFetchUrl("http://metadata.google.internal/computeMetadata/v1/")).toThrow(/metadata/)
    expect(assertLudusFetchUrl("https://10.2.0.5:8080/api").hostname).toBe("10.2.0.5")
  })
})
