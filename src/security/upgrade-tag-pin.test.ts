/**
 * A signed upgrade must verify the tag in a keyring that holds only the
 * configured public key. git verify-tag on the default keyring accepts any
 * key already imported there.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const upgrade = readFileSync(path.join(root, "scripts", "upgrade.sh"), "utf8")
const verifier = readFileSync(path.join(root, "scripts", "lux-verify-tag.sh"), "utf8")

describe("signed upgrade tags", () => {
  it("verifies a tag only in a keyring that holds the trusted key", () => {
    expect(upgrade).toContain("lux-verify-tag.sh")
    expect(upgrade).toContain("lux_verify_signed_tag")
    expect(upgrade).not.toMatch(/gpg --batch --import "\$LUX_UPGRADE_TRUSTED_KEY"/)
    expect(verifier).toContain('echo "Error: LUX_UPGRADE_TRUSTED_KEY must be a public key file."')
    expect(verifier).toContain('GNUPGHOME="$home" gpg --batch --quiet --import')
    expect(verifier).toContain('GNUPGHOME="$home" git verify-tag --raw')
    expect(verifier).not.toMatch(/^[^#\n]*\bgit verify-tag\b(?! --raw)/m)
    expect(verifier).toContain("VALIDSIG")
  })
})
