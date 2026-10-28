import { afterEach, describe, expect, it } from "vitest"
import { applyNodeTlsFromLudusEnv, isLudusTlsInsecure } from "./tls-insecure-env"

describe("tls insecure scope", () => {
  const previous = process.env.LUDUS_TLS_INSECURE
  const previousReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED

  afterEach(() => {
    if (previous === undefined) delete process.env.LUDUS_TLS_INSECURE
    else process.env.LUDUS_TLS_INSECURE = previous
    if (previousReject === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousReject
  })

  it("does not disable certificate checks for the whole process", () => {
    process.env.LUDUS_TLS_INSECURE = "true"
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
    expect(isLudusTlsInsecure()).toBe(true)
    applyNodeTlsFromLudusEnv()
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined()
  })
})
