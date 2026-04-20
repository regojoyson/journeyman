# @journeyman/pipeline

## What it is

`@journeyman/pipeline` is a configurable, phase-based pipeline runner for automating ticket → PR workflows using the Journeyman adapter ecosystem (Claude, GitHub, Jira, Slack, etc.). Define flows in YAML, manage state and artifacts, and orchestrate complex multi-step engineering processes at scale.

## Install

```bash
npm install @journeyman/pipeline
```

This is a workspace package; refer to the repo root `package.json` for setup instructions.

## 5-Minute Quickstart

1. **Create `config/pipeline.yaml`:**
   ```yaml
   products:
     - id: edgereg
       repos:
         - owner: edgereg-org
           name: edgereg-api
   # Claude auths via ~/.claude/ session (run `claude login`) or
   # ANTHROPIC_API_KEY env var — no config needed.
   ```

2. **Create `config/flows/default.yaml`:**
   ```yaml
   id: default
   phases:
     - name: getTicket
       phase: GetTicket
     - name: analyze
       phase: AnalyzeCode
     - name: addComment
       phase: AddComment
   ```

3. **Set environment variables:**
   ```bash
   export GITHUB_ACCESS_TOKEN=ghp_...
   # ANTHROPIC_API_KEY only needed if NOT logged in via `claude login`
   ```

4. **Run:**
   ```bash
   npm run run-once -- --product edgereg --ticket "edgereg-org/edgereg-api#42"
   ```

## Exports

| Export | Purpose |
|---|---|
| `Pipeline` | Main orchestrator for flow execution |
| `PhaseRegistry` | Registry of available phases |
| `ProviderRegistry` | Registry of initialized adapters |
| `FileStateStore` | Persistent artifact/context storage |
| `FileTraceLogger` | Execution trace logging |
| `FileArtifactStore` | Artifact persistence |
| `EventBus` | Phase lifecycle events |
| **Built-in phases** | `GetTicket`, `AnalyzeCode`, `CreateBranch`, `CloneRepo`, `PlanCode`, `ImplementCode`, `RunTests`, `CreatePR`, `AddComment`, `ResolveTicket`, `CleanupBranch`, `Notify` |
| `YamlFlowConfigSource` | YAML flow config loader |
| `ConfigFlowResolver` | Flow selector by product/phase |
| `FlowValidator` | YAML schema validation |
| `loadPipelineConfig` | Load `pipeline.yaml` + flows |
| `SemaphorePool` | Concurrency control |
| `installShutdownHandler` | Graceful shutdown on SIGINT |
| `BasePhase` | Abstract phase base class |
| `unwrap`/`unwrapField` | Result unwrappers for adapters |
| `AdapterError` | Adapter exception type |

## CLI Commands

```bash
# Run a flow for a ticket
npm run run-once -- --product <id> --ticket <org/repo#num>

# Validate config YAML
npm run validate

# Sweep stale artifacts (cleanup)
npm run sweep
```

## Documentation

Full reference docs:

- [Configuration reference](./configuration.md) — `pipeline.yaml` schema, adapters, secrets
- [Flows reference](./flows.md) — flow definition, phase ordering, conditionals
- [Phases catalog](./phases.md) — all built-in phases, inputs/outputs, examples
- [Products guide](./products.md) — product config, repo mapping, multi-tenant
- [Artifacts model](./artifacts.md) — state, context, results, TTL
- [Security](./security.md) — secret handling, RBAC, audit
- [Troubleshooting](./troubleshooting.md) — common issues, debug mode, logs
