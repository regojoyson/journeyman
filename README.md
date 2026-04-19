# Journeyman

Configurable, phase-based pipeline that automates **ticket → PR** by orchestrating pluggable adapters for AI coding CLIs, git hosting, issue trackers, and notification services.

Webhook-driven, per-product configurable. Ships with working adapters for **Claude**, **GitHub (repos + issues)**, and a growing set of stubs for Jira / Linear / GitLab / Slack / Monday / Gemini / Codex.

## What it does

You label an issue. An agent clones the repo, analyses the ticket, drafts a plan, writes the code, runs the tests, opens a PR, and pings you when it's ready for review. The orchestration is entirely driven by YAML flow definitions — the same flow works across products by swapping adapters.

## Repository layout

```
journeyman/
├── packages/
│   ├── core/                    @journeyman/core                   — interfaces + types only
│   ├── coding-cli/              @journeyman/coding-cli             — Claude / Gemini / Codex
│   ├── git-provider/            @journeyman/git-provider           — GitHub / GitLab REST
│   ├── github-mcp/              @journeyman/github-mcp             — shared GitHub MCP client
│   ├── ticket-provider/         @journeyman/ticket-provider        — Jira / Linear / Monday / GitHub Issues / GitHub Projects
│   ├── notification-provider/   @journeyman/notification-provider  — Slack
│   ├── pipeline/                @journeyman/pipeline               — runner + phases + registries + CLI
│   └── pipeline-server/         @journeyman/pipeline-server        — Fastify + webhooks + management API
├── docs/pipeline/               Pipeline documentation
├── config/                      Your pipeline.yaml + flows/
└── workspaces/                  Runtime state + logs + artifacts (one dir per product)
```

## Quick start

See [**Quickstart**](docs/pipeline/quickstart.md) — minimum viable setup in ~10 minutes.

```bash
npm install
# create config/pipeline.yaml + config/flows/default.yaml
# set env vars: JOURNEYMAN_API_TOKEN, GITHUB_ACCESS_TOKEN, ANTHROPIC_API_KEY
npx journeyman validate-config
npx tsx packages/pipeline-server/src/cli-start.ts config/pipeline.yaml
```

Or trigger a single run via CLI without the server:

```bash
npx journeyman run --product edgereg --ticket "edgereg-org/edgereg-api#42"
```

## Documentation

### Getting started
- [**Setup**](docs/pipeline/setup.md) — full installation + configuration guide (instance, default flow, per-product)
- [**Quickstart**](docs/pipeline/quickstart.md) — step-by-step setup and first run

### Reference
- [Configuration](docs/pipeline/configuration.md) — `pipeline.yaml` field reference
- [Flows](docs/pipeline/flows.md) — flow YAML authoring guide
- [Phases](docs/pipeline/phases.md) — built-in phase catalog + writing custom phases
- [Products](docs/pipeline/products.md) — adding and managing products
- [Triggers](docs/pipeline/triggers.md) — webhook setup per source (GitHub, GitLab, Jira, API)
- [Management API](docs/pipeline/management-api.md) — REST + SSE endpoints
- [Artifacts](docs/pipeline/artifacts.md) — artifact model and storage

### Operations
- [Security](docs/pipeline/security.md) — filesystem perms, secret rotation, redaction, encryption options
- [Troubleshooting](docs/pipeline/troubleshooting.md) — known failure modes and fixes

### Package READMEs
- [`@journeyman/pipeline`](packages/pipeline/README.md)
- [`@journeyman/pipeline-server`](packages/pipeline-server/README.md)

## Design principles

- **Interface-first.** Every provider category has an interface in `@journeyman/core`; implementations live in their own package. Swap Claude for Gemini, GitHub for GitLab, Jira for Linear — one line of YAML.
- **Declarative phase contracts.** Every phase declares `reads` / `writes` as static arrays; a boot-time validator walks each flow and proves artifact dependencies before anything runs.
- **Per-product isolation.** One dir per product under `workspaces/<productId>/` — state, logs, artifacts, ephemeral work. `rm -rf workspaces/<product>/` cleans up a whole tenant.
- **Webhook-routed products.** GitHub fires `/webhooks/github/edgereg`; the product id in the path drives flow selection, credential lookup, and workspace isolation.
- **Config-driven status transitions.** Semantic names (`development-started`, `code-review`) in flow YAML map to per-product literal values — one flow file, many tenants.

## Implementation status

| Component | Status |
|---|---|
| `ClaudeProvider` (analyze, plan, implement, clone, commit+push, cleanup) | ✅ |
| `GitHubProvider` (getRepo, createPR, listPRs) | ✅ |
| `GitHubIssuesProvider` (incl. label-based updateStatus) | ✅ |
| `@journeyman/pipeline` + `@journeyman/pipeline-server` | ✅ |
| `GitLabProvider` / `JiraProvider` / `LinearProvider` / `MondayProvider` | Stubs |
| `GeminiProvider` / `CodexProvider` | Stubs |
| `SlackProvider` | Stub |
| Human review loop auto-resume (via PR-comment webhook) | Stub |

## License

Private — internal tooling.
