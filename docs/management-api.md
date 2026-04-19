# Journeyman Pipeline Management API Reference

The Journeyman management API provides REST and Server-Sent Events (SSE) interfaces for triggering, monitoring, and controlling automated code analysis and implementation pipelines.

## Authentication

All `/api/*` routes require bearer token authentication **except** `/api/health`.

```
Authorization: Bearer <JOURNEYMAN_API_TOKEN>
```

The same bearer token is used for both REST endpoints and SSE streams.

## Response Format

All responses are JSON. Errors follow a standard format:

```json
{
  "error": "Human-readable error description"
}
```

Appropriate HTTP status codes are returned with error responses (see [Status Codes](#status-codes) section).

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/trigger/:productId` | Trigger a new pipeline run |
| `GET` | `/api/runs/:sessionId` | Fetch a single run by ID |
| `GET` | `/api/runs` | List runs with filtering |
| `GET` | `/api/runs/:sessionId/logs` | Retrieve step logs |
| `GET` | `/api/runs/:sessionId/stream` | SSE stream of run events |
| `POST` | `/api/runs/:sessionId/cancel` | Initiate cooperative cancellation |
| `POST` | `/api/runs/:sessionId/resume` | Resume a blocked run |
| `GET` | `/api/runs/:sessionId/artifacts/:key` | Download artifact |
| `GET` | `/api/flows` | List available flows |
| `GET` | `/api/providers` | List available providers |
| `GET` | `/api/health` | Health check (no auth) |

## Per-Endpoint Reference

### POST /api/trigger/:productId

Trigger a new pipeline run for the specified product.

**Request body:**
```json
{
  "ticketKey": "PROJ-123",
  "ticketShortKey": "123",
  "flowName": "analyze-and-implement"
}
```

**Parameters:**
- `ticketKey` (required, string): Full issue key (e.g., `PROJ-123`)
- `ticketShortKey` (optional, string): Short form key (e.g., `123`)
- `flowName` (optional, string): Name of the flow to execute. If omitted, uses default flow.

**Response (202 Accepted):**
```json
{
  "accepted": true,
  "sessionId": "run-abc123def456",
  "runUrl": "/api/runs/run-abc123def456"
}
```

**Example (curl):**
```bash
curl -X POST \
  https://api.example.com/api/trigger/product-1 \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ticketKey": "PROJ-123",
    "flowName": "analyze-and-implement"
  }'
```

---

### GET /api/runs/:sessionId

Fetch the full state of a pipeline run.

**Response (200 OK):**
```json
{
  "sessionId": "run-abc123def456",
  "productId": "product-1",
  "flowName": "analyze-and-implement",
  "ticketKey": "PROJ-123",
  "status": "running",
  "startedAt": "2026-04-18T14:30:00Z",
  "updatedAt": "2026-04-18T14:35:20Z",
  "endedAt": null,
  "steps": [
    {
      "stepId": "analyze",
      "name": "Analyze Repository",
      "status": "completed",
      "startedAt": "2026-04-18T14:30:00Z",
      "endedAt": "2026-04-18T14:32:15Z",
      "duration": 135,
      "logLines": 42
    },
    {
      "stepId": "plan",
      "name": "Plan Implementation",
      "status": "running",
      "startedAt": "2026-04-18T14:32:15Z",
      "endedAt": null,
      "duration": null,
      "logLines": 18
    }
  ],
  "artifacts": [
    {
      "key": "analysis-report",
      "type": "json",
      "size": 2048,
      "createdAt": "2026-04-18T14:32:15Z"
    }
  ]
}
```

**Response (404 Not Found):**
```json
{
  "error": "Run not found: run-abc123def456"
}
```

**Example (curl):**
```bash
curl -X GET \
  https://api.example.com/api/runs/run-abc123def456 \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

---

### GET /api/runs

List pipeline runs with optional filtering.

**Query parameters (all optional):**
- `product` - Filter by product ID
- `ticket` - Filter by ticket key
- `status` - Filter by status (running, completed, failed, blocked, cancelled)
- `limit` - Maximum results (default: 20, max: 100)
- `offset` - Pagination offset (default: 0)

**Response (200 OK):**
```json
{
  "runs": [
    {
      "sessionId": "run-abc123def456",
      "productId": "product-1",
      "flowName": "analyze-and-implement",
      "ticketKey": "PROJ-123",
      "status": "running",
      "startedAt": "2026-04-18T14:30:00Z",
      "updatedAt": "2026-04-18T14:35:20Z",
      "endedAt": null
    },
    {
      "sessionId": "run-def789ghi012",
      "productId": "product-2",
      "flowName": "analyze",
      "ticketKey": "PROJ-456",
      "status": "completed",
      "startedAt": "2026-04-18T13:00:00Z",
      "updatedAt": "2026-04-18T13:15:00Z",
      "endedAt": "2026-04-18T13:15:00Z"
    }
  ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

**Example (curl):**
```bash
curl -X GET \
  'https://api.example.com/api/runs?product=product-1&status=running&limit=10' \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

---

### GET /api/runs/:sessionId/logs

Retrieve logs for a specific run, optionally filtered by step.

**Query parameters (all optional):**
- `stepId` - Filter logs to a specific step
- `tail` - Return last N lines (default: all)

**Response (200 OK):**
```json
{
  "sessionId": "run-abc123def456",
  "stepId": "analyze",
  "lines": [
    {
      "id": "line-001",
      "timestamp": "2026-04-18T14:30:05Z",
      "level": "info",
      "message": "Starting repository analysis",
      "source": "analyze-task"
    },
    {
      "id": "line-002",
      "timestamp": "2026-04-18T14:30:10Z",
      "level": "debug",
      "message": "Cloning repository from github.com/user/repo.git",
      "source": "analyze-task"
    },
    {
      "id": "line-003",
      "timestamp": "2026-04-18T14:32:15Z",
      "level": "info",
      "message": "Analysis complete: 42 files, 5000 LOC",
      "source": "analyze-task"
    }
  ]
}
```

**Example (curl):**
```bash
curl -X GET \
  'https://api.example.com/api/runs/run-abc123def456/logs?stepId=analyze&tail=20' \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

---

### GET /api/runs/:sessionId/stream

Open a Server-Sent Events (SSE) stream for real-time run events. The stream replays buffered events from the run's history, then continues streaming new events as they occur.

**Query parameters (optional):**
- `fromEventId` - Resume stream from a specific event ID (for reconnection)

**Response (200 OK, Content-Type: text/event-stream):**

The stream emits events with the following types:

#### Event: `runStarted`
```
event: runStarted
id: evt-001
data: {
  "type": "runStarted",
  "sessionId": "run-abc123def456",
  "productId": "product-1",
  "flowName": "analyze-and-implement",
  "ticketKey": "PROJ-123",
  "startedAt": "2026-04-18T14:30:00Z"
}
```

#### Event: `stepStarted`
```
event: stepStarted
id: evt-002
data: {
  "type": "stepStarted",
  "sessionId": "run-abc123def456",
  "stepId": "analyze",
  "stepName": "Analyze Repository",
  "startedAt": "2026-04-18T14:30:00Z"
}
```

#### Event: `stepEnded`
```
event: stepEnded
id: evt-003
data: {
  "type": "stepEnded",
  "sessionId": "run-abc123def456",
  "stepId": "analyze",
  "stepName": "Analyze Repository",
  "status": "completed",
  "endedAt": "2026-04-18T14:32:15Z",
  "duration": 135
}
```

#### Event: `logLine`
```
event: logLine
id: evt-004
data: {
  "type": "logLine",
  "sessionId": "run-abc123def456",
  "stepId": "analyze",
  "lineId": "line-001",
  "timestamp": "2026-04-18T14:30:05Z",
  "level": "info",
  "message": "Starting repository analysis",
  "source": "analyze-task"
}
```

#### Event: `statusChanged`
```
event: statusChanged
id: evt-005
data: {
  "type": "statusChanged",
  "sessionId": "run-abc123def456",
  "status": "running",
  "previousStatus": "pending",
  "timestamp": "2026-04-18T14:30:00Z"
}
```

#### Event: `runEnded`
```
event: runEnded
id: evt-006
data: {
  "type": "runEnded",
  "sessionId": "run-abc123def456",
  "status": "completed",
  "endedAt": "2026-04-18T14:35:00Z",
  "totalDuration": 300
}
```

**Reconnection:**

If your connection drops, reconnect with the `Last-Event-ID` header to resume from where you left off:

```bash
curl -X GET \
  'https://api.example.com/api/runs/run-abc123def456/stream' \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Last-Event-ID: evt-005"
```

The server will replay all events since `evt-005` and continue streaming new events.

**Example (curl):**
```bash
curl -X GET \
  https://api.example.com/api/runs/run-abc123def456/stream \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -N
```

(Use `-N` flag to disable buffering.)

---

### POST /api/runs/:sessionId/cancel

Initiate cooperative cancellation of a running pipeline. The run will attempt to gracefully shut down currently executing steps.

**Request body:** (empty or omitted)

**Response (200 OK):**
```json
{
  "sessionId": "run-abc123def456",
  "status": "cancelling",
  "cancelledAt": "2026-04-18T14:35:30Z"
}
```

**Response (409 Conflict):**
```json
{
  "error": "Cannot cancel run with status: completed"
}
```

**Example (curl):**
```bash
curl -X POST \
  https://api.example.com/api/runs/run-abc123def456/cancel \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

---

### POST /api/runs/:sessionId/resume

Resume a pipeline run that is currently in the `blocked` status. Used to advance a run that is waiting for external input or approval.

**Request body:** (empty or omitted)

**Response (200 OK):**
```json
{
  "sessionId": "run-abc123def456",
  "status": "running",
  "resumedAt": "2026-04-18T14:36:00Z"
}
```

**Response (409 Conflict):**
```json
{
  "error": "Run status must be 'blocked' to resume, current status: running"
}
```

**Response (404 Not Found):**
```json
{
  "error": "Run not found: run-abc123def456"
}
```

**Example (curl):**
```bash
curl -X POST \
  https://api.example.com/api/runs/run-abc123def456/resume \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

---

### GET /api/runs/:sessionId/artifacts/:key

Download an artifact generated during the pipeline run. Returns the raw bytes with the appropriate Content-Type from the artifact metadata.

**Response (200 OK):**
- Content-Type determined by artifact type (e.g., `application/json`, `text/plain`, `application/octet-stream`)
- Raw artifact bytes

**Response (404 Not Found):**
```json
{
  "error": "Artifact not found: analysis-report"
}
```

**Example (curl):**
```bash
curl -X GET \
  https://api.example.com/api/runs/run-abc123def456/artifacts/analysis-report \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -o analysis-report.json
```

---

### GET /api/flows

List all available pipeline flows in the system.

**Response (200 OK):**
```json
[
  {
    "name": "analyze",
    "description": "Analyze repository structure and code",
    "providers": ["coding-cli"],
    "steps": ["analyze"],
    "estimatedDuration": 300
  },
  {
    "name": "analyze-and-plan",
    "description": "Analyze and create implementation plan",
    "providers": ["coding-cli"],
    "steps": ["analyze", "plan"],
    "estimatedDuration": 600
  },
  {
    "name": "analyze-and-implement",
    "description": "Full pipeline: analyze, plan, and implement",
    "providers": ["coding-cli", "git"],
    "steps": ["analyze", "plan", "implement", "push"],
    "estimatedDuration": 1800
  }
]
```

**Example (curl):**
```bash
curl -X GET \
  https://api.example.com/api/flows \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

---

### GET /api/providers

List all available providers registered in the system, organized by category.

**Response (200 OK):**
```json
{
  "coding-cli": [
    {
      "name": "claude",
      "displayName": "Claude (Anthropic)",
      "version": "1.0.0",
      "capabilities": ["cloneRepos", "scanRepos", "resetRepos", "commitPushRepos", "cleanupRepos"],
      "status": "ready"
    }
  ],
  "git": [
    {
      "name": "github",
      "displayName": "GitHub",
      "version": "1.0.0",
      "capabilities": ["getRepo", "createPR"],
      "status": "ready"
    },
    {
      "name": "gitlab",
      "displayName": "GitLab",
      "version": "1.0.0",
      "capabilities": ["getRepo", "createMR"],
      "status": "stub"
    }
  ],
  "ticket": [
    {
      "name": "jira",
      "displayName": "Jira Cloud",
      "version": "1.0.0",
      "capabilities": ["getIssue", "updateIssue", "addComment"],
      "status": "stub"
    }
  ],
  "notification": [
    {
      "name": "slack",
      "displayName": "Slack",
      "version": "1.0.0",
      "capabilities": ["sendMessage"],
      "status": "stub"
    }
  ]
}
```

**Example (curl):**
```bash
curl -X GET \
  https://api.example.com/api/providers \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

---

### GET /api/health

Health check endpoint. No authentication required. Returns system status and registry health.

**Response (200 OK):**
```json
{
  "status": "healthy",
  "timestamp": "2026-04-18T14:35:00Z",
  "uptime": 86400,
  "registries": {
    "phases": {
      "healthy": true,
      "registered": 8
    },
    "flows": {
      "healthy": true,
      "registered": 3
    },
    "coding": {
      "healthy": true,
      "registered": 1,
      "active": 1
    },
    "git": {
      "healthy": true,
      "registered": 2,
      "active": 1
    },
    "ticket": {
      "healthy": true,
      "registered": 3,
      "active": 0
    },
    "notification": {
      "healthy": true,
      "registered": 1,
      "active": 0
    }
  }
}
```

**Response (503 Service Unavailable):**
```json
{
  "status": "degraded",
  "timestamp": "2026-04-18T14:35:00Z",
  "error": "Database connection failed",
  "registries": {
    "phases": {
      "healthy": false,
      "error": "Cannot reach registry"
    }
  }
}
```

**Example (curl):**
```bash
curl -X GET https://api.example.com/api/health
```

---

## Status Codes

| Code | Meaning | Typical Scenario |
|------|---------|------------------|
| `200` | OK | Successful read or status check |
| `202` | Accepted | Trigger request accepted, run queued |
| `400` | Bad Request | Invalid request body or query parameters |
| `401` | Unauthorized | Missing or invalid API token |
| `404` | Not Found | Run, artifact, or resource does not exist |
| `409` | Conflict | Action cannot be performed in current state (e.g., cancel a completed run, resume a running run) |
| `500` | Internal Server Error | Unexpected server error |
| `503` | Service Unavailable | System degraded or database offline |

---

## Error Responses

All error responses follow this format:

```json
{
  "error": "Description of what went wrong"
}
```

Common error scenarios:

**Missing Authentication:**
```json
{
  "error": "Missing or invalid Authorization header"
}
```

**Invalid Request Body:**
```json
{
  "error": "Request body must contain ticketKey (string)"
}
```

**Resource Not Found:**
```json
{
  "error": "Run not found: run-abc123def456"
}
```

**State Conflict:**
```json
{
  "error": "Run status must be 'blocked' to resume, current status: running"
}
```

---

## Rate Limiting

The API does not enforce per-token rate limits. However, individual runs are queued and processed sequentially per product. Extremely high trigger rates may result in queueing delays.

## Pagination

List endpoints (`/api/runs`) support pagination via `limit` and `offset` query parameters. The response includes `total`, `limit`, and `offset` fields for navigation.

```bash
# Get the next 20 runs after the first 20
curl 'https://api.example.com/api/runs?limit=20&offset=20' \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

## Event Replay and Reconnection

The `/api/runs/:sessionId/stream` endpoint stores recent events in a buffer. If your SSE connection drops, you can reconnect and replay events using the `Last-Event-ID` header:

```bash
# Reconnect from a specific event
curl 'https://api.example.com/api/runs/run-abc123def456/stream' \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Last-Event-ID: evt-015"
```

The server will emit all buffered events from `evt-015` onward, then continue streaming live events. This ensures no events are missed during brief disconnections.

## Artifact Handling

Artifacts are immutable files generated during pipeline execution. Common artifact types include:

- `analysis-report.json` — JSON analysis output from the analyze phase
- `implementation-plan.md` — Markdown implementation plan
- `code-diff.patch` — Unified diff of code changes
- `logs.tar.gz` — Compressed full logs archive

Use the `GET /api/runs/:sessionId/artifacts/:key` endpoint to download. The Content-Type header reflects the artifact's true type.

## Examples

### Example: Trigger and Monitor a Run

```bash
# 1. Trigger a new run
TRIGGER_RESPONSE=$(curl -s -X POST \
  https://api.example.com/api/trigger/product-1 \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ticketKey": "PROJ-123",
    "flowName": "analyze-and-implement"
  }')

SESSION_ID=$(echo $TRIGGER_RESPONSE | jq -r '.sessionId')
echo "Run started: $SESSION_ID"

# 2. Stream events in real-time
curl -X GET \
  https://api.example.com/api/runs/$SESSION_ID/stream \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -N

# 3. After run completes, fetch final state
curl -X GET \
  https://api.example.com/api/runs/$SESSION_ID \
  -H "Authorization: Bearer YOUR_API_TOKEN" | jq '.'

# 4. Download artifacts
curl -X GET \
  https://api.example.com/api/runs/$SESSION_ID/artifacts/analysis-report \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -o analysis-report.json
```

### Example: List and Filter Runs

```bash
# Get all runs for product-1 that are currently running
curl -X GET \
  'https://api.example.com/api/runs?product=product-1&status=running' \
  -H "Authorization: Bearer YOUR_API_TOKEN" | jq '.'

# Get the last 10 runs
curl -X GET \
  'https://api.example.com/api/runs?limit=10&offset=0' \
  -H "Authorization: Bearer YOUR_API_TOKEN" | jq '.runs'
```

### Example: Cancel and Resume

```bash
# Cancel a running run
curl -X POST \
  https://api.example.com/api/runs/run-abc123def456/cancel \
  -H "Authorization: Bearer YOUR_API_TOKEN"

# Wait for the run to stabilize in 'blocked' state, then resume
curl -X POST \
  https://api.example.com/api/runs/run-abc123def456/resume \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

---

**Last updated:** 2026-04-18
