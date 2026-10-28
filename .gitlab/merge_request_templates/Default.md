<!-- lux-pr-summary -->
<!-- The summary above is filled from CHANGELOG.md when the merge request pipeline runs. Keep the checklist below. -->

## Summary

<!-- What changed, as in the CHANGELOG.md entries for this version. -->

## Security checklist

See `docs/security-testing.md`. Tick each item or say why it does not apply.

- [ ] Every new or changed API route gates on the server session (`requireSession`, `requireAdmin`, or `resolveSession` plus a 401/403).
- [ ] Routes that act on a GOAD instance or task check the owner (`assertGoadInstanceAccess`, `assertGoadTaskAccess`), never a username prefix.
- [ ] Ids from the URL or body that become paths are a single segment (`assertSafeInstanceId` or equivalent).
- [ ] No secret goes into a command line; secrets go on stdin or into a 0600 file.
- [ ] `GET` handlers change no state.
- [ ] Mutating requests still pass the origin check.
- [ ] A finding fixed here has a test in `src/security/regressions.test.ts` or a focused test it names.
- [ ] `CHANGELOG.md` has one entry per change, under the right tag.
- [ ] `bash scripts/ci/live-security.sh` passed on this commit (the `security-gate/live` status, or the `security-live` job).
