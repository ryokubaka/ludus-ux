// Call the GitLab API from a pipeline. The token stays in the request header.
// GITLAB_TOKEN is a project access token (PRIVATE-TOKEN). Otherwise CI_JOB_TOKEN
// is sent as JOB-TOKEN, which can read this project but cannot edit merge requests.
// Exit 4: rejected token. Exit 5: 404. Exit 6: 409 already exists.

import { closeSync, fstatSync, openSync, readFileSync, realpathSync } from "node:fs"
import path from "node:path"

const [method, apiPath, bodyFile] = process.argv.slice(2)
const base = (process.env.CI_API_V4_URL || "").replace(/\/$/, "")

if (!base || !method || !apiPath?.startsWith("/")) {
  console.error("usage: gitlab-api.mjs METHOD /projects/... [body.json]")
  process.exit(1)
}

const headers = { Accept: "application/json" }
if (process.env.GITLAB_TOKEN) {
  headers["PRIVATE-TOKEN"] = process.env.GITLAB_TOKEN
} else if (process.env.CI_JOB_TOKEN) {
  headers["JOB-TOKEN"] = process.env.CI_JOB_TOKEN
} else {
  console.error("Set GITLAB_TOKEN, or run this inside a GitLab pipeline.")
  process.exit(1)
}

function readBodyFile(file) {
  const cwd = realpathSync(process.cwd())
  let resolved
  try {
    resolved = realpathSync(path.resolve(cwd, file))
  } catch {
    console.error("GitLab API body file could not be read")
    process.exit(1)
  }
  const relative = path.relative(cwd, resolved)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    console.error("GitLab API body file must stay inside the working directory")
    process.exit(1)
  }
  const fd = openSync(resolved, "r")
  try {
    if (!fstatSync(fd).isFile()) {
      console.error("GitLab API body must be a regular file")
      process.exit(1)
    }
    return readFileSync(fd)
  } finally {
    closeSync(fd)
  }
}

let body
if (bodyFile) {
  body = readBodyFile(bodyFile)
  headers["Content-Type"] = "application/json"
}

let response
try {
  // codeql[js/file-access-to-http]
  response = await fetch(base + apiPath, { method, headers, body, redirect: "manual" })
} catch (err) {
  const cause = err instanceof Error ? err.cause : undefined
  const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : ""
  const detail = cause instanceof Error ? cause.message : err instanceof Error ? err.message : "fetch failed"
  console.error(`GitLab API request failed: ${detail}`)
  if (
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT"
  ) {
    if (process.env.NODE_EXTRA_CA_CERTS) {
      console.error("NODE_EXTRA_CA_CERTS is set, and this certificate was still rejected. The file must be the CA that signed this GitLab.")
    } else {
      console.error("The job image does not trust the CA that signed this GitLab. Add a CI/CD variable of type File named NODE_EXTRA_CA_CERTS, and paste that CA certificate (PEM) as the value. Leave it unprotected. Do not mask it: masked variables cannot contain the PEM line breaks.")
    }
  }
  process.exit(1)
}
const text = await response.text()

if (response.status >= 300 && response.status < 400) {
  console.error(`GitLab API redirected ${method} ${apiPath} (${response.status}). Refusing to follow.`)
  process.exit(1)
}
if (response.status === 404) process.exit(5)
if (response.status === 409) process.exit(6)
if (response.status === 401 || response.status === 403) {
  console.error(`GitLab API ${response.status} on ${method} ${apiPath}`)
  process.stderr.write(text.slice(0, 400) + "\n")
  if (process.env.GITLAB_TOKEN) {
    console.error("GITLAB_TOKEN was rejected. Use a Maintainer project access token with the api scope. Do not mark the variable protected, or merge request pipelines on unprotected branches cannot read it.")
  } else {
    console.error("Set GITLAB_TOKEN to a Maintainer project access token with the api scope. Mask it, and leave it unprotected so merge request pipelines can read it.")
  }
  process.exit(4)
}
if (!response.ok) {
  console.error(`GitLab API ${response.status} on ${method} ${apiPath}`)
  process.stderr.write(text.slice(0, 800) + "\n")
  process.exit(1)
}

process.stdout.write(text)
