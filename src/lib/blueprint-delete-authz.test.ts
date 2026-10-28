import { describe, expect, it } from "vitest"
import { canDeleteBlueprint } from "./blueprint-delete-authz"

describe("canDeleteBlueprint", () => {
  const SOURCE_ID = "github.com/ryokubaka/ludus-blueprints/goad"
  const PERSONAL_ID = "my-personal-blueprint"

  it("denies non-admins deleting a source blueprint they do not own", () => {
    expect(canDeleteBlueprint({ isAdmin: false }, SOURCE_ID)).toBe(false)
    expect(canDeleteBlueprint({ isAdmin: false }, SOURCE_ID, { owns: false })).toBe(false)
  })

  it("allows the owner to delete their source blueprint", () => {
    expect(canDeleteBlueprint({ isAdmin: false }, SOURCE_ID, { owns: true })).toBe(true)
  })

  it("allows admins to delete a source-catalog blueprint", () => {
    expect(canDeleteBlueprint({ isAdmin: true }, SOURCE_ID)).toBe(true)
  })

  it("allows any authenticated user to delete a personal blueprint", () => {
    expect(canDeleteBlueprint({ isAdmin: false }, PERSONAL_ID)).toBe(true)
    expect(canDeleteBlueprint({ isAdmin: true }, PERSONAL_ID)).toBe(true)
  })

  it("treats a missing isAdmin flag as non-admin", () => {
    expect(canDeleteBlueprint({}, SOURCE_ID)).toBe(false)
  })
})
