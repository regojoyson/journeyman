# Artifact Model and Storage

## Overview

`ctx.artifacts` is a shared bag that grows step-by-step as the pipeline executes. Each phase writes one or more top-level keys named after what it produced. Artifacts can be structured data (objects, arrays) or file references (via `ArtifactHandle`). The artifact store provides durable, queryable storage separate from ephemeral run logs.

## Conventions

### One-Object-Per-Phase

Each pipeline phase populates the artifacts with a key matching its logical output:

- `analysis` — result of analysis phase
- `plan` — result of planning phase
- `implementation` — result of implementation phase
- `commit` — result of commit/push phase
- `pr` — pull request metadata
- `ticket` — ticket object (Jira, Linear, Monday, etc.)
- `ticketMd` — rendered ticket description as markdown string

### Accumulated Collections

Some keys accumulate across multiple phases:

- `statusHistory: StatusEntry[]` — timeline of phase transitions
- `commentIds: Record<stepId, commentId>` — map of step IDs to comment/activity IDs
- `repoPaths: string[]` — list of all cloned repository paths
- `repoRefs: ProductRepo[]` — list of repository references with metadata

## ArtifactHandle Shape

When a phase produces a file artifact (report, code diff, etc.), it stores the file via `IArtifactStore` and receives an `ArtifactHandle`:

```typescript
type ArtifactHandle = {
  kind: "artifact";
  sessionId: string;      // Pipeline execution session ID
  key: string;            // Artifact key (e.g., "analyze-report", "plan-changes")
  size: number;           // File size in bytes
  contentType?: string;   // MIME type (e.g., "text/markdown", "application/json")
  uri: string;            // Storage URI ("file://...", "s3://...", etc.)
  sha256?: string;        // Optional content hash for integrity/deduplication
};
```

Handles are embedded directly in phase output objects:

```typescript
interface AnalyzeResult {
  summary: string;
  issues: Issue[];
  reportHandle?: ArtifactHandle;  // Optional file report
}
```

## Disk Layout

Artifacts are stored in a directory tree separate from ephemeral run logs:

```
workspaces/
├── <productId>/
│   ├── artifacts/
│   │   ├── <sessionId>/
│   │   │   ├── analysis.md
│   │   │   ├── plan.md
│   │   │   ├── implementation-diff.patch
│   │   │   ├── commit-details.json
│   │   │   └── ...
│   │   └── <other-sessionId>/
│   │       └── ...
│   └── runs/
│       ├── <sessionId>/
│       │   ├── state.json
│       │   ├── events.jsonl
│       │   └── ...
│       └── ...
```

The `artifacts/` directory survives `workspaces.cleanupOn` deletions (which only remove `runs/`), allowing long-term retention of important outputs.

## How Phases Write Handles

A phase that generates file output calls `ctx.artifactStore.putPath()`:

```typescript
const handle = await ctx.artifactStore.putPath(
  sessionId,
  "analyze-report",           // artifact key
  "/tmp/analysis-output.md",  // absolute file path
  {
    contentType: "text/markdown",
    sha256: computedHash,     // optional
  }
);

// Attach handle to phase output
return {
  summary: "...",
  issues: [...],
  reportHandle: handle,       // Stored in artifacts
};
```

The artifact store:
1. Reads the file from the given path
2. Computes/verifies the hash if requested
3. Stores it in `workspaces/<productId>/artifacts/<sessionId>/analyze-report.md`
4. Returns an `ArtifactHandle` with the computed `uri` and metadata
5. Deletes the temporary file (caller responsibility to preserve if needed)

## Fetching Artifact Content

### Via Management API

Retrieve artifact content through the management API:

```bash
GET /api/runs/:sessionId/artifacts/:key

# Example
curl https://api.example.com/api/runs/sess-abc123/artifacts/analyze-report
```

The endpoint returns the artifact file with appropriate `Content-Type` header.

### Via Disk

For local access, read directly from the artifact store:

```bash
cat workspaces/<productId>/artifacts/<sessionId>/<key>.<ext>
```

Use file extension conventions: `.md` for markdown, `.json` for JSON, `.patch` for diffs, etc.

## Finding Handles in State

To locate all artifact handles in a session's state file:

```bash
jq '.artifacts | .. | select(type=="object" and .kind=="artifact")' \
  workspaces/<productId>/runs/<sessionId>/state.json
```

This query recursively searches the entire `artifacts` object for any nested handles.

To extract a specific artifact's handle:

```bash
jq '.artifacts.analysis.reportHandle' \
  workspaces/<productId>/runs/<sessionId>/state.json
```

## Catalog of Default Artifact Keys

Built-in phases populate these standard keys:

| Key | Type | Source | Description |
|-----|------|--------|-------------|
| `ticket` | `Ticket` | Ticket provider | Parsed ticket object (Jira, Linear, Monday) |
| `ticketMd` | `string` | Ticket provider | Rendered ticket description as markdown |
| `repoPaths` | `string[]` | Git provider | Absolute paths to cloned repositories |
| `primaryRepoPath` | `string` | Git provider | Path to the primary (first) repository |
| `repoRefs` | `ProductRepo[]` | Git provider | Repository references with metadata |
| `analysis` | `AnalyzeResult + reportHandle` | Analysis phase | Code analysis with optional file report |
| `plan` | `PlanResult + reportHandle` | Planning phase | Implementation plan with optional file report |
| `implementation` | `ImplementResult + reportHandle` | Implementation phase | Code changes with optional file report |
| `commit` | `CommitPushResult` | Commit phase | Commit metadata (sha, branch, title, files) |
| `pr` | `{ id, url, number }` | PR phase | Pull request metadata |
| `commentIds` | `Record<stepId, commentId>` | Feedback/comment phases | Map of step IDs to comment IDs |
| `statusHistory` | `StatusEntry[]` | Pipeline controller | Chronological phase transitions |

## Future Backends

`IArtifactStore` is a swappable interface. Current implementation uses the local filesystem, but future backends can support:

- **S3**: `s3://bucket-name/product-id/session-id/key`
- **PostgreSQL Large Objects**: Embedded in run state or referenced by OID
- **Encrypted-at-rest**: Transparent encryption of artifact data
- **Cloud Storage**: Google Cloud Storage, Azure Blob, etc.

The `ArtifactHandle` shape remains consistent across backends; only the `uri` scheme changes:

```typescript
// Local filesystem
uri: "file:///workspaces/prod-1/artifacts/sess-123/report.md"

// S3
uri: "s3://my-bucket/artifacts/sess-123/report.md"

// Cloud Storage with encryption
uri: "gcs://my-bucket/artifacts/sess-123/report.md?encrypted=true"
```

State and queries remain unchanged; the artifact store abstracts implementation details.

## Retention and Cleanup

### Automatic Cleanup

The `workspaces.cleanupOn` policy deletes only the `runs/<sessionId>/` directory (ephemeral execution logs). Artifacts survive:

```bash
# Removes run logs but preserves artifacts
workspaces cleanup --session <sessionId>
```

### Manual Artifact Pruning

Prune artifacts separately using a cron job or manual command:

```bash
# Scan and remove artifacts older than 90 days
find workspaces/*/artifacts -type d -mtime +90 -exec rm -rf {} \;
```

Or via a dedicated cleanup command:

```bash
journeyman sweep --artifacts-older-than 90d
```

### Session-Based Cleanup

To cleanly remove a session and its artifacts:

```bash
journeyman cleanup --session <sessionId> --include-artifacts
```

This removes both `runs/<sessionId>/` and `artifacts/<sessionId>/`.
