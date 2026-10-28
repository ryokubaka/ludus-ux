import { describe, expect, it } from "vitest"
import { githubRawFileUrl, gitUrlToRepoApiBase, parseGitHubCloneUrl, rebuildGitHubUrl } from "@/lib/template-repo-client"

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

  it("rejects a URL whose hostname is not github.com", () => {
    expect(parseGitHubCloneUrl("https://evil.example/?github.com/a/b")).toBeNull()
    expect(rebuildGitHubUrl("https://evil.example/?github.com/a/b")).toBeNull()
  })

  it("keeps owner and repo on api.github.com and raw.githubusercontent.com", () => {
    expect(gitUrlToRepoApiBase("https://github.com/badsectorlabs/ludus-source-bsl")).toBe(
      "https://api.github.com/repos/badsectorlabs/ludus-source-bsl",
    )
    expect(
      githubRawFileUrl("https://api.github.com/repos/badsectorlabs/ludus-source-bsl", "README.md", "main"),
    ).toBe("https://raw.githubusercontent.com/badsectorlabs/ludus-source-bsl/main/README.md")
  })
})
