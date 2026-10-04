<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# LUX agent guide

LUX is the web UI for a Ludus cyber range. The browser talks to this Next.js app. The app talks to the Ludus API and, over SSH, to the Ludus/Proxmox host. VMs, Packer, and Ansible run on that host, not in the LUX container.

`docs/architecture.md` still says Next.js 15. The app is Next.js 16 (`package.json`, `config/next.config.cjs`). Read the Next.js block above before changing framework code.

## Read this, then the one doc you need

| Question | File |
|---|---|
| What a feature does | `docs/features.md`, `docs/workflows.md` |
| Install, upgrade, env | `docs/getting-started.md`, `docs/environment.md`, `.env.example` |
| SSH, lux-host, consoles | `docs/ssh-and-auth.md` |
| HTTP routes | `docs/openapi.yaml` |
| Local dev and Playwright | `docs/development.md` |

Leave product docs and `CHANGELOG.md` updated when behavior a user can see changes.

## Layout

- `src/app/` — App Router pages and `src/app/api/` route handlers
- `src/components/` — UI. Range log UI is `src/components/range/`
- `src/lib/` — server logic, Ludus client, SSH, SQLite, prefetch
- `src/proxy.ts` — session gate and security headers. Next.js 16 uses this file, not `middleware.ts`
- `config/` — Next, Vitest, Playwright
- `docker/` — image and nginx. TLS is on nginx `:443`; the app listens on HTTP `:3000`
- `e2e/` — Playwright

SQLite is `./data/ludus-ux.db` (container `/app/data`). `./ssh` and `.env` are host state. Do not commit them.

## Running a change

The Compose app does not bind-mount this repo. A UI or server change is invisible at https://localhost until:

```bash
docker compose up -d --build ludus-ux
```

Wait until `docker inspect ludus-ux` reports `healthy` (`/api/health`). nginx is `ludus-ux-web`.

Host `npm run dev` is for local work without nginx. Unset `TRUST_PROXY_TLS` there so cookies match plain HTTP. Compose sets `DISABLE_HTTPS=true` and `TRUST_PROXY_TLS=true`.

`npm run build` and `npm run dev` pass `--webpack` because of `ssh2` and Monaco. Unit tests: `npm run test:unit`. End-to-end: `PLAYWRIGHT_BASE_URL=https://localhost npm run test:e2e` (`PW_CHANNEL=chrome` when bundled Chromium is missing).

After a UI change, exercise the flow in the browser (click, type, submit). A screenshot of the first paint is not enough. Check the other pages that read the same state.

## Next.js 16

`cacheComponents: true`. A server page that touches the session calls `markRouteDynamic()` inside `getLayoutSession()`.

Data-heavy pages prefetch on the server and hydrate the client:

```tsx
export default async function SomePage() {
  const { resolved } = await getLayoutSession()
  const dehydratedState = await prefetchSomeData(resolved)
  return (
    <HydrationBoundary state={dehydratedState}>
      <SomePageClient />
    </HydrationBoundary>
  )
}
```

Prefetch lives in `src/lib/server-prefetch.ts`. Query keys include `effectiveScopeTag` (`login|view`) so an impersonation session does not reuse another user's cache.

Ludus list payloads are wrapped (`{ result }`, `{ groups }`, …). Parse them with `extractArray` or `parseLudusGroupList` from `src/lib/utils.ts`.

Cache invalidation after a successful `/api/proxy` mutation goes through `ludus-cache-revalidate.ts`. Do not pass a raw API key into a `"use cache"` function. Partition with `ludusCachePartition()` and scope tags.

## Host SSH

Server-side SSH uses `getSettings()` and `src/lib/proxmox-ssh.ts`. Root may run a host command directly. Any other account may run only `sudo -n /usr/local/sbin/lux-host <operation> <args>`. The helper's operations are fixed in `scripts/lux-host/lux-host`. It does not run a shell string. A normal shell `sudo` is denied. Quote the full remote path. `shellQuote(dir) + "/file"` breaks on spaces.

`/opt/ludus` playbooks and `group_vars` belong to Ludus. LUX does not install files there. User range files live at `/opt/ludus/ranges/<id>/range-config.yml`. Syncing a source blueprint does not rewrite that file. VM `ansible_groups` are stored on the Proxmox description at clone time and stay until the VM is cloned again.

Do not print SSH passwords, API keys, or `APP_SECRET`. Settings secrets in SQLite are `enc:v2:` (AES-GCM, PBKDF2 salt `ludus-ux-settings-salt-v1`).

## Logs

Deploy logs are an SSE stream from `src/app/api/logs/stream/route.ts` into `src/lib/deploy-log-context.tsx`. Ansible prints a blank line between tasks. Drop those blanks before they are stamped or shown (`isBlankDeployLogLine`). Prefer `LogViewerCompound` (`Root`, `Toolbar`, `Search`, `Body`) for new log panes.

## GOAD instance page

`src/app/goad/[id]/goad-instance/goad-instance-page.tsx` owns streams and deep links. Actions live in `src/hooks/use-goad-run-action.ts` and `use-goad-instance-action-handlers.ts`. Tabs take typed props from `src/components/goad/goad-instance-tabs/`. Do not introduce a shared React context for those tabs.

## Changelog and pull requests

User-facing notes go under `## Unreleased` in `CHANGELOG.md`, with one tag: `[Add]`, `[Fix]`, `[Improve]`, `[Perf]`, `[Security]`, `[Docs]`, `[Remove]`, or `[Breaking]`. Do not add a `## [X.Y.Z]` heading unless the user asked to cut a release. `.github/workflows/release.yml` publishes the newest versioned section when a PR merges to `main`.

Pull request bodies use only these sections, in order:

1. **Intent** — one short paragraph. No decision log.
2. **What Changed** — a few bullets of behavior.
3. **Risk Assessment** — one line.
4. **Pipeline** — leave the no-mistakes attestation comment in place.

No **Testing** section, screenshots, or command logs.

## Leave it alone

- Secrets, `.env`, and keys under `./ssh` or `./data`
- The Next.js agent block between the `BEGIN` and `END` comments
- Ludus-owned files under `/opt/ludus` other than a user's own range config when the task is to change that range
