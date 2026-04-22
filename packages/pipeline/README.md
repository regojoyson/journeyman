# @journeyman/pipeline

Configurable, phase-based pipeline runner for Journeyman. Loads flow YAML, resolves providers, executes steps in order, manages per-run state and artifacts, and emits lifecycle events. Has no HTTP dependency — embed in a CLI, a job runner, or a test harness.

## Usage

```bash
# One-shot run (no server)
npm run run-once -- --product <id> --ticket <owner/repo#number>

# Validate config only
npm run validate

# Remove stale workspace run directories
npm run sweep
```

## Key Exports

| Export | Purpose |
|---|---|
| `Pipeline` | Main orchestrator |
| `PhaseRegistry` | Register and resolve phases |
| `ProviderRegistry` | Register and resolve provider adapters |
| `FileStateStore` | File-backed run state |
| `FileTraceLogger` | Per-step trace logging |
| `FileArtifactStore` | Artifact persistence |
| `EventBus` | Lifecycle event pub/sub |
| `BasePhase` | Base class for custom phases |
| `loadPipelineConfig` | Load + validate `pipeline.yaml` + flows |
| `FlowValidator` | Boot-time artifact DAG validation |
| `SemaphorePool` | Per-product concurrency limiting |
| `installShutdownHandler` | Graceful SIGTERM shutdown |
| `AdapterError` | Error type for adapter failures |

## Documentation

Full reference in [`docs/`](../../docs/):

- [Quickstart](../../docs/quickstart.md) — minimal setup in 10 minutes
- [Setup guide](../../docs/setup.md) — full installation + multi-product config
- [Configuration reference](../../docs/configuration.md) — every `pipeline.yaml` field
- [Flows reference](../../docs/flows.md) — flow YAML authoring + patterns
- [Phases catalog](../../docs/phases.md) — all built-in phases + writing custom phases
- [Providers reference](../../docs/providers.md) — provider config + env vars
- [Artifacts](../../docs/artifacts.md) — artifact model and storage layout
- [Troubleshooting](../../docs/troubleshooting.md) — common failures and fixes
