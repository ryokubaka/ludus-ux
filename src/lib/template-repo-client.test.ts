import { describe, expect, it } from "vitest"
import { apiBaseToGitUrl, gitUrlToRepoApiBase } from "@/lib/template-repo-client"

describe("gitUrlToRepoApiBase", () => {
  it("maps GitHub clone URLs", () => {
    expect(gitUrlToRepoApiBase("https://github.com/acme/my-ludus-source.git")).toBe(
      "https://api.github.com/repos/acme/my-ludus-source",
    )
  })

  it("maps GitLab.com clone URLs", () => {
    expect(gitUrlToRepoApiBase("https://gitlab.com/acme/my-ludus-source")).toBe(
      "https://gitlab.com/api/v4/projects/acme%2Fmy-ludus-source/repository",
    )
  })

  it("round-trips GitHub apiBase via apiBaseToGitUrl", () => {
    const api = gitUrlToRepoApiBase("https://github.com/badsectorlabs/ludus-source-bsl")!
    expect(apiBaseToGitUrl(api)).toBe("https://github.com/badsectorlabs/ludus-source-bsl")
  })
})
