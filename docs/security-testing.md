# Security testing

Every change to `main` passes the same checks on GitHub and on GitLab. Each check is a script in `scripts/ci/`, so CI and your machine run the same commands:

```bash
bash scripts/ci/<name>.sh
```

The checks exist because [GHSA-3q8g-rm9c-xwxv](https://github.com/ryokubaka/ludus-ux/security/advisories/GHSA-3q8g-rm9c-xwxv) and its follow-up review were all one of a few mistakes: a route with no session check, a write with no owner check, a request value used as a path, a secret in a command line, or a `GET` that changes state.

## The checks

| Job | Script | Fails on |
|-----|--------|----------|
| `unit` | `unit.sh` | Vitest, ESLint, or `tsc` errors |
| `security` | `security.sh` | `npm run test:security` (below) |
| `hygiene` | `hygiene.sh` | A committed symlink out of the repo, lockfile links into `node_modules` or absolute paths, a tracked `.env`, key, or certificate, or a host, private IP, or credential in CI and e2e files |
| `changelog` | `changelog.sh` | A `CHANGELOG.md` bullet without exactly one known tag, tags out of order or a repeated title in the newest release, or a version that differs from `package.json`, `APP_VERSION`, the README badge, or the OpenAPI version |
| `secrets` | `secrets.sh` | gitleaks findings in tracked files and in the commits of the PR or MR (`.gitleaks.toml`) |
| `sast` | `sast.sh` | Semgrep findings: the `p/typescript`, `p/nodejs`, and `p/command-injection` packs plus the repo rules in `.semgrep/` |
| `npm-audit` | `npm-audit.sh` | A dependency advisory of high severity or worse |
| `build-image` | `image.sh` | `docker/Dockerfile` does not build (Kaniko) |
| `smoke` | `smoke.sh` | The Compose stack does not answer `/api/health` |
| `codeql` | GitHub only | CodeQL `security-extended` findings |
| `security-gate/live` | `live-security.sh` | The live suite against a running LUX (below) |

`test:security` runs three suites in `src/security/`:

- `route-audit.test.ts` reads every `src/app/api/**/route.ts`. Each handler must call `requireSession`, `requireAdmin`, or `resolveSession` and return 401 or 403 when it fails. Each route that names a GOAD instance or task must check the owner. No route may treat a username prefix as ownership. No `GET` may write. A route that is public on purpose, or needs no owner check, is listed in the test with its reason.
- `argv-secrets.test.ts` fails when a command string interpolates a secret-named value, or a bundled shell script passes a secret as an argument (`curl -H "…$KEY"`, `sshpass -p`, `env KEY=…`). A command line on the Ludus host is readable by any user with `ps`.
- `regressions.test.ts` has one block per advisory and review finding. It checks the fix directly where it can, and fails when a focused test that proves the fix is removed or renamed.
- `admin-live-check.test.ts` fails when a handler reads the cookie's `isAdmin` without `requireAdmin`, `resolveLudusIsAdmin`, or `liveSessionIsAdmin`. `auth/login` and `auth/session` are the exceptions, each with a reason.
- `upgrade-tag-pin.test.ts` fails when an upgrade verifies a git tag on the default GnuPG keyring instead of a keyring that holds only `LUX_UPGRADE_TRUSTED_KEY`.

The Semgrep rules have test cases next to them: `semgrep --test .semgrep/` (copy the folder somewhere without a leading dot first; Semgrep skips dot-directories).

## Live security suite

`scripts/ci/live-security.sh` runs `unit.sh`, the hygiene check with your deployment's values, and the Playwright `security` project (`e2e/security/`) against a running LUX. It then posts the `security-gate/live` commit status.

As the admin account, setup creates a throwaway non-admin Ludus user (`luxsec` plus random hex) the way the Users page does. Teardown always deletes that user, its default range, and every snapshot the suite stored. The suite only touches synthetic instance ids and objects it creates. It checks:

- Every API route refuses a request without a session, and a cookie replayed after logout.
- `/api/settings` returns no secrets to a non-admin.
- Admin routes refuse the throwaway user.
- The throwaway user cannot read, overwrite, or delete an admin's pending network snapshot, hand it off, force delete, sync, or run GOAD against that instance, or touch an admin's task.
- A cross-site `POST` is refused and a same-origin `POST` gets through. `GET /api/auth/revoke` does not end a live session.
- The admin can still do the same writes, so the gate is not refusing everyone.

### Running it

Put the settings in `.security-gate.env` at the repo root. Git ignores this file and the sync scripts skip it; never commit it.

```bash
E2E_ADMIN_USER=<ludus admin>
E2E_ADMIN_PASSWORD=<password>
# The LUX to test. Leave unset to build and start this checkout with your .env.
PLAYWRIGHT_BASE_URL=https://<lux host>
# Optional: post the commit status
GITHUB_TOKEN=<token with repo:status>
GITLAB_TOKEN=<token with api scope>
GITLAB_URL=https://<gitlab host>
GITLAB_PROJECT=<group/project>
```

Commit first: the script refuses to run on uncommitted changes, because the status would not describe the commit. `SECURITY_GATE_ALLOW_DIRTY=1` runs anyway and posts nothing.

```bash
bash scripts/ci/live-security.sh
```

`SECURITY_GATE_UPGRADE=1` also replays an upgrade. A scratch clone at the previous release tag starts with your `.env` minus `LUDUS_TLS_INSECURE`, then runs that release's `upgrade.sh` to the current branch. The replay checks that the app user can still read the SSH key (directly or through the `/run/lux-ssh` copy) and that a certificate error names the missing `LUDUS_TLS_INSECURE`. The stack uses fixed container names and port 443, so stop any running LUX first.

## GitHub

`.github/workflows/ci.yml` runs every job except the live suite, which public runners cannot reach. Protect `main` and require: `unit`, `security`, `hygiene`, `changelog`, `secrets`, `sast`, `npm-audit`, `codeql`, and `security-gate/live`.

The `codeql` job runs the `security-extended` suite, then drops a result when a `// codeql[js/...]` comment on that line, or on the comment lines immediately above it, names the rule. GitHub code scanning does not read those comments itself. An ordinary comment between the marker and the code breaks the cover.

## GitLab

`.gitlab/ci.yml` runs on merge requests and on the default branch, with the same job names. The root `.gitlab-ci.yml` only includes that file, because GitLab's default config path is the repository root. Protect `main` and turn on **Pipelines must succeed**.

`mr-summary` fills the merge request title and description from `CHANGELOG.md`. `publish-release` tags `vX.Y.Z` and creates the GitLab release when the default branch updates. Both need a masked CI/CD variable `GITLAB_TOKEN`: a project access token with the Maintainer role and the `api` scope. Do not mark it protected, or merge request pipelines on unprotected branches cannot read it. When GitLab is signed by a private CA, the jobs use `CI_SERVER_TLS_CA_FILE` if the pipeline provides it. Otherwise add a File variable `NODE_EXTRA_CA_CERTS` with that CA certificate in PEM form, unprotected and not masked.

Jobs that need more than a plain Docker runner carry a tag and wait until a runner with that tag exists:

- `smoke` (tag `docker`) needs a runner that allows privileged Docker-in-Docker.
- `security-live` (tag `lux-lab`) needs a runner that can reach the lab Ludus server. It runs only when the CI/CD variable `LUX_LIVE_SECURITY` is `1`.

Until a `lux-lab` runner exists, run `live-security.sh` locally with `GITLAB_TOKEN` set and check the `security-gate/live` external status on the merge request.

### Registering the lab runner

On a host that can reach Ludus and the LUX under test:

```bash
gitlab-runner register \
  --url https://<gitlab host> \
  --token <runner authentication token> \
  --executor docker \
  --docker-image node:24
```

Create the runner in **Settings → CI/CD → Runners** with the tag `lux-lab` and **Run untagged jobs** off. Then add protected, masked variables in **Settings → CI/CD → Variables**: `LUX_LIVE_SECURITY=1`, `PLAYWRIGHT_BASE_URL`, `E2E_ADMIN_USER`, `E2E_ADMIN_PASSWORD`, and, to mirror the status to GitHub, `GITHUB_TOKEN`. Once the job passes, make `security-live` required.

## Adding a route

Before you open the PR or MR:

1. Gate the handler on the server session, and return 401 or 403 when it fails.
2. If it acts on a GOAD instance or task, call `assertGoadInstanceAccess` or `assertGoadTaskAccess`.
3. Validate an id used in a path as one segment (`assertSafeInstanceId`).
4. Send secrets on stdin or write them to a 0600 file, never in a command line.
5. Do not change state in a `GET`.
6. Add a test for the fix to the regression catalog when it closes a finding.

The PR and MR templates carry the same checklist.
