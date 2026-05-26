# UNIT_TESTING.md — Test Standards

Linked from [AGENTS.md](../../AGENTS.md).

## Test runner

**Vitest** (`vitest run`) is the test runner in this repo. Packages opt in by declaring a `test` script in their `package.json`. The root `npm test` fans out to all workspaces with `--if-present`.

Currently configured packages: `core`, `custom-steps`, `coding-models`, `notification-provider`. ~445 `*.test.ts` files exist across the repo.

When adding tests to a package that doesn't yet have them:
1. Add `vitest` as a devDependency at the package level (matching the version already used elsewhere).
2. Add `"test": "vitest run"` to the package's `package.json`.
3. Place tests **co-located** as `*.test.ts` next to the file under test, or under `test/` when they span multiple source files.

## Verification commands

```bash
npm run check          # typecheck + import boundaries — always run
npm run typecheck      # types only (all workspaces)
npm run check:boundaries
npm test               # vitest run, per-workspace (only where configured)
```

A change is **not** complete until `npm run check` passes. For changes with behavioral impact, the relevant workspace's `npm test` must also pass.

## What to test

### Always
- Pure functions with non-trivial logic.
- Interface implementations: each public method gets at least one happy-path test.
- Bug fixes: a regression test that fails before the fix and passes after.
- Error paths: at least one test that asserts the documented failure mode.

### Skip
- One-line wrappers around external libraries.
- Generated code or pure type definitions.
- Trivial getters/setters.

## Test quality

1. **One behavior per test.** Test names describe the behavior, not the function name. `creates a PR when the branch has commits ahead of base` beats `test_createPR_1`.
2. **Arrange / Act / Assert.** Visually separate the three. Keep setup minimal and explicit.
3. **No shared mutable state** between tests. Each test sets up what it needs.
4. **Deterministic.** No real time (`new Date()`), no real network, no real filesystem unless in a temp dir. Use Vitest's `vi.useFakeTimers()` and `vi.mock()` for these.
5. **Fast.** A unit suite over a package should complete in seconds.

## Mocking guidance

- Mock at **trust boundaries** (HTTP, DB, child processes), not at internal function boundaries.
- Prefer in-memory implementations of interfaces (e.g. an in-memory `FlowStore`) over a thicket of `vi.fn()` chains.
- Never mock the unit under test.
- For Octokit calls, mock at the `@journeyman/github-api` boundary, not inside individual providers.

## Integration tests

- Mark clearly: file suffix `*.integration.test.ts`, or directory `test/integration/`.
- Bring up infra with `npm run infra:up` if Postgres / Redis / Conductor are required.
- Tear down anything they create. Don't rely on `infra:reset` to recover.

## Failing-test-first

For non-trivial features and **all** bug fixes:
1. Write the test.
2. Run it. Confirm it fails for the expected reason (not a typo, not an import error).
3. Implement.
4. Re-run. Confirm it passes.
5. Run the rest of the suite. Confirm no regressions.

## Coverage

There is no enforced coverage threshold. Optimize for **meaningful** tests over coverage numbers. A 100% covered module with assertion-free tests is worse than 60% with sharp ones.

## What AI agents must not do

- Introduce a second test runner (jest, node:test, mocha) alongside Vitest.
- Add `--reporter` flags, coverage thresholds, or watch-mode defaults at the root without approval.
- Disable or skip tests (`it.skip`, `describe.skip`, `--bail`) to make a commit "pass". Fix the test or the code.
