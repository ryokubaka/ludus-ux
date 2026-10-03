import { describe, expect, it } from "vitest"
import { githubRawFileUrl } from "@/lib/template-repo-client"

describe("githubRawFileUrl", () => {
  it("encodes a branch name that contains slashes", () => {
    expect(
      githubRawFileUrl(
        "https://api.github.com/repos/ryokubaka/ludus-source-meow",
        "ansible/roles/ludus_so_elastic_agent/meta/version.yml",
        "feat/securityonion-3.3.0",
      ),
    ).toBe(
      "https://raw.githubusercontent.com/ryokubaka/ludus-source-meow/feat/securityonion-3.3.0/ansible/roles/ludus_so_elastic_agent/meta/version.yml",
    )
  })
})
