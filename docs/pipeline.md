# @journeyman/pipeline

`@journeyman/pipeline` is the core pipeline runner for Journeyman. It loads flow YAML, resolves providers, executes steps in order, manages per-run state and artifacts, and emits lifecycle events. It has no HTTP dependency and can be embedded in a CLI, a job runner, or a test harness.

## Install

```bash
# This is a workspace package — install from the monorepo root.
npm install
```

## Quickstart

**1. Create `config/pipeline.yaml`:**

```yaml
defaultFlow: default

products:
  demo:
    flow: default
    workspace: ./workspaces/demo
    repos:
      - providerId: github
        owner: your-org
        repo: your-repo
        url: "git@github.com:your-org/your-repo.git"
        defaultBranch: main
    ticketWorkflow:
      statuses:
        development-started: "in-development"
        code-review: "code-review"
        done: "done"
        blocked: "blocked"
        failed: "failed"

server:
  port: 3000
  bearerTokenEnv: JOURNEYMAN_API_TOKEN
  webhooks: {}
```

**2. Create `config/flows/default.yaml`:**

```yaml
name: default

providers:
  ticket:       github-issues
  git:          github
  coding:       claude
  notification: console

steps:
  - { id: fetch-ticket,  stepType: getTicket }
  - { id: clone,         stepType: cloneRepos }
  - { id: analyze,       stepType: analyze,         timeoutMs: 900000 }
  - { id: plan,          stepType: plan,            timeoutMs: 900000 }
  - { id: implement,     stepType: implement,       timeoutMs: 1800000 }
  - { id: commit-push,   stepType: commitPushRepos }
  - { id: open-pr,       stepType: createPR }
  - { id: cleanup,       stepType: cleanupRepos,    onFailure: skip }
```

**3. Set environment variables:**

```bash
JOURNEYMAN_API_TOKEN=...      # openssl rand -hex 32
GITHUB_ACCESS_TOKEN=ghp_...   # repo + issues scopes
# ANTHROPIC_API_KEY=sk-ant-.. # only if NOT logged in via `claude login`
```

**4. Run:**

```bash
# One-shot (no server)
npm run run-once -- --product demo --ticket "your-org/your-repo#42"

# Or start the full server
npm start
```

## Key Exports

| Export | Purpose |
|---|---|
| `Pipeline` | Main orchestrator — loads config, runs flows, manages state |
| `StepRegistry` | Registry of available phases; use `register()` to add custom steps |
| `ProviderRegistry` | Registry of adapter instances; use `register()` to add custom providers |
| `FileStateStore` | File-backed run state store |
| `FileTraceLogger` | File-backed per-step trace log writer |
| `FileArtifactStore` | File-backed artifact persistence |
| `EventBus` | Pub/sub lifecycle events (`runStarted`, `stepEnded`, etc.) |
| `BasePhase` | Abstract base class for custom steps |
| `loadPipelineConfig` | Load and validate `pipeline.yaml` + flows |
| `FlowValidator` | Boot-time artifact DAG + status name validator |
| `SemaphorePool` | Per-product concurrency limiter |
| `installShutdownHandler` | Graceful SIGTERM shutdown |
| `AdapterError` | Error type thrown by adapter operations |

## CLI Commands

```bash
npm run validate         # validate config/pipeline.yaml + flows/
npm run run-once -- --product <id> --ticket <owner/repo#num>
npm run sweep            # delete old workspace run directories
```

## Documentation

| Document | Contents |
|---|---|
| [Quickstart](../docs/quickstart.md) | 10-minute minimal setup |
| [Setup guide](../docs/setup.md) | Full installation + multi-product config |
| [Configuration reference](../docs/configuration.md) | Every `pipeline.yaml` field |
| [Flows reference](../docs/flows.md) | Flow YAML authoring + patterns |
| [Phases catalog](../docs/phases.md) | All built-in phases + writing custom steps |
| [Providers reference](../docs/providers.md) | Provider config + env vars |
| [Artifacts](../docs/artifacts.md) | Artifact model and storage layout |
| [Troubleshooting](../docs/troubleshooting.md) | Common failures and fixes |
