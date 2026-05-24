# VERSION_MANAGEMENT.md — Versioning, Branching & Releases

Linked from [AGENT.md](AGENT.md).

## Current state

- All 21 workspace packages are locked at version **`0.1.0`** (synchronized, not independent).
- The root workspace is `0.0.0` (private).
- There is **no CI pipeline** and **no automated release process** yet.
- The active development branch at the time of writing is `feat-01`; the integration branch is `master`.

Until automation lands, "release" means *merging to `master`* and (optionally) tagging the commit. Treat version bumps as deliberate, user-authorized changes.

## Semantic versioning

The repository follows [SemVer](https://semver.org/): `MAJOR.MINOR.PATCH`.

| Bump | When |
|---|---|
| MAJOR | Breaking change to a public interface in `@journeyman/core`, an HTTP API contract, or a DB schema that requires a coordinated client update. |
| MINOR | Backwards-compatible new feature, new provider, new step, new optional field. |
| PATCH | Bug fix, internal refactor, docs, dependency bump with no behavior change. |

Pre-release tags: `X.Y.Z-rc.N`, `X.Y.Z-beta.N`.

## Monorepo versioning policy

- **Synchronized versions.** All workspace packages share a single version. Bump them together.
- Bump versions in a dedicated PR titled `chore: release vX.Y.Z`. Do not mix version bumps with feature changes.
- Run `npm run check` and `npm test` (for workspaces that have tests) before tagging.
- The `package-lock.json` must be committed with any version bump.

## Branching model

| Branch | Purpose |
|---|---|
| `master` | Integration branch. Should be releasable. Only fast-forward or squash merges from reviewed PRs. |
| `feat-*` | Feature work. Short-lived. (Current branch follows this pattern: `feat-01`.) |
| `fix-*` | Bug fixes. Short-lived. |
| `chore-*` | Non-functional changes (deps, docs, infra). |
| `release-*` | Optional, for stabilizing a release candidate. |

Rules:
- Branch from `master`. Rebase onto `master` (or merge `master` in) before opening a PR.
- One logical change per branch. Split long-lived branches.
- Never force-push to `master` or `release-*`.

## Commit messages

Conventional commit prefixes are preferred:

```
feat(coding-cli): add Gemini provider scanRepos
fix(coding-cli): handle empty branch list in scanRepos
chore(deps): bump octokit to 22.x
docs(architecture): clarify coding-cli vs git-provider split
```

Body explains **why**, not what. Reference ticket/PR when relevant.

The repo has a series of `bpmn introduction - NN` commits on `feat-01` — that's existing course/branch material and not the convention to follow for new work.

## Tagging & releases (when ready)

1. PR merges to `master`.
2. `npm run check` and `npm test` pass locally (and in CI, once it exists).
3. Bump version in a `chore: release vX.Y.Z` PR across all `packages/*/package.json`.
4. After merge, tag the commit: `git tag vX.Y.Z && git push origin vX.Y.Z`.
5. Write release notes summarizing user-visible changes, grouped by `Added / Changed / Fixed / Removed`.

## Breaking changes

A breaking change requires:
1. MAJOR version bump.
2. Migration guide in release notes (and `docs/` if substantial).
3. Deprecation period when feasible: ship the new API alongside the old, mark the old as deprecated, remove in the **next** MAJOR.

## Hotfixes

1. Branch from the affected release tag: `git checkout -b fix-… vX.Y.Z`.
2. Apply minimal fix. Add a regression test.
3. PR into `master` first, then cherry-pick or back-port to the release branch.
4. Tag `vX.Y.(Z+1)`.

## What AI agents must NOT do

- Bump versions without explicit user request.
- Push tags.
- Force-push to any shared branch.
- Amend or rebase commits that have already been pushed to a shared branch.
- Decouple a package's version from the rest (e.g. bump only `coding-cli` to `0.2.0`) without a documented decision to switch to independent versioning.
- Create release notes or tags speculatively.
