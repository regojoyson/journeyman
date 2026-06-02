# Robust Repos-List Parsing (`parseRepoList`) — Design Spec

**Date:** 2026-06-02
**Author:** Samuel Rego
**Status:** Draft — pending review

---

## 1. Problem

The clone-repos step accepts a repos list from a multi-line textarea (one URL per line, newline-separated). The parsing splits **only on commas** in three copy-pasted places, so newline-separated input is mishandled:

- A single URL keeps its trailing newline → `"https://…/HireIQ.git\n"`, producing folder names like `HireIQ.git\n` and clone failures (now surfaced because clone runs inside the Docker container).
- A multi-line list with no comma is passed through as **one giant URL** containing newlines.

The flawed comma-only snippet is duplicated at:
1. [clone-repos-step-handler.ts:37](../../../packages/orchestrator/src/workers/steps/clone-repos-step-handler.ts) — `includes(",") ? split(",")… : reposRaw` (no-comma case passes raw, untrimmed).
2. [sandbox-git-provider.ts:9](../../../packages/orchestrator/src/sandbox/sandbox-git-provider.ts) `toUrls` — same comma-only logic.
3. [git-provider/.../clone-repos.ts](../../../packages/git-provider/src/providers/github/operations/clone-repos.ts) `normalizeEntries` — no splitting; `repoFolder`/`parseOwnerRepo` then choke on the `\n`.

## 2. Goal

One canonical, well-tested parser that turns any repos-list input into a clean `string[]` of trimmed, non-empty URLs — used at all three sites, removing the duplication and fixing the bug for both the in-process and Docker clone paths.

## 3. Design

### 3.1 New pure util — `@journeyman/core`
`parseRepoList(input: string | string[] | undefined): string[]`
- `string` → split on `/[\n,]+/`, `trim()` each, drop empties.
- `string[]` → apply the same per element and flatten (an array element may itself contain newlines/commas).
- `undefined`/blank → `[]`.
- No URL rewriting (no `.git` stripping, no casing) — single responsibility: clean + split.

Location: `packages/core/src/parse-repo-list.ts`, exported from `packages/core/src/index.ts`.

### 3.2 Use it at the three sites; delete the comma-only logic
- **clone-repos-step-handler.ts** → `const repos = parseRepoList(input.repos as string | string[] | undefined)`. Keep the existing empty check: `parseRepoList` returning `[]` fails the step with the existing "requires repos" message (no silent no-op).
- **sandbox-git-provider.ts `toUrls`** → for `string`/`string[]` use `parseRepoList`; for `RepoEntry[]` (objects) map `.url` and `.trim()`.
- **git-provider `normalizeEntries`** → `.trim()` each entry's `url` (belt-and-suspenders; primary cleaning is upstream).

### 3.3 Defensive trim (kept minimal)
Leave `folderName`/`repoFolder` as-is — once input is clean they're correct. (No change needed; not adding speculative guards.)

## 4. Testing

- **Unit (`parse-repo-list.test.ts`):** trailing newline (`"…HireIQ.git\n"` → `["…HireIQ.git"]`); multi-line (3 lines → 3 urls); comma-separated; mixed newline+comma; surrounding spaces; blank lines interspersed; `""`/`undefined` → `[]`; `string[]` with a multi-line element.
- **Handler/provider:** add a multi-line-input case to the clone-repos handler test and the `SandboxGitProvider` test asserting clean URLs/folder names (no `\n`).

## 5. Out of scope (YAGNI)
- No UI/textarea validation changes; no URL normalization beyond trimming; no `folderName`/`repoFolder` changes.

## 6. Files
- **New:** `packages/core/src/parse-repo-list.ts` (+ export in `index.ts`), `packages/core/src/parse-repo-list.test.ts`.
- **Modified:** `clone-repos-step-handler.ts`, `sandbox-git-provider.ts`, `git-provider/.../clone-repos.ts` (+ touched tests).
