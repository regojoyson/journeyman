# Custom Phases

## Overview

Custom phases let you define your own AI-powered flow nodes beyond the built-in catalog. Each custom phase has a name, description, a prompt template with artifact variable interpolation, a list of allowed tools, and an optional model override. Once defined, custom phases appear in the flow editor palette alongside built-in phases and behave identically to them — they can be connected to other nodes, consume artifacts as inputs, and produce artifacts as outputs.

## Creating Custom Phases

### Via UI

- Personal phases: `/me/custom-phases`
- Org-wide phases: `/admin/custom-phases`

### Phase Definition Fields

| Field | Description |
|---|---|
| `name` | Display name shown in the palette and on the canvas node |
| `description` | Short description shown in the palette |
| `promptTemplate` | Handlebars-style template; use `{{artifact.fieldName}}` to interpolate flow artifacts |
| `allowedTools` | List of tool names the AI agent can use (e.g. `["Bash", "Read", "Write"]`) |
| `modelOverride` | Optional: override the flow's default AI model for this phase only |

### API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/me/custom-phases` | List your personal custom phases |
| `POST` | `/me/custom-phases` | Create a personal custom phase |
| `PUT` | `/me/custom-phases/:id` | Update a personal custom phase |
| `DELETE` | `/me/custom-phases/:id` | Delete a personal custom phase |
| `GET` | `/orgs/:orgId/custom-phases` | List org-wide custom phases |
| `POST` | `/orgs/:orgId/custom-phases` | Create an org-wide custom phase |
| `PUT` | `/orgs/:orgId/custom-phases/:id` | Update an org-wide custom phase |
| `DELETE` | `/orgs/:orgId/custom-phases/:id` | Delete an org-wide custom phase |
| `GET` | `/custom-phases/visible` | List all custom phases visible to the current user (personal + org merged) |

## Using Custom Phases in Flows

Custom phases appear in the flow editor palette under a **Custom** category. Drag them onto the canvas exactly like any built-in phase. Their input and output schema is inferred from the prompt template — artifact variables referenced in the template become required inputs; any artifacts written by the AI agent during execution become outputs.

Custom phase nodes support all the same properties as built-in phase nodes: MCP instance attachment, skill package attachment, retryable flag, and timeout configuration.

## Prompt Templates

Prompts use a Handlebars-style syntax. Reference any artifact produced earlier in the flow with `{{artifact.fieldName}}`.

**Example:**

```
Analyze the following cloned repositories and identify security vulnerabilities:

{{artifact.clonedRepos}}

Focus on: dependency issues, hardcoded secrets, and insecure API calls.
```

At runtime, `renderPrompt` in `@journeyman/custom-phases` resolves each template variable against the current artifact bag before passing the prompt to the AI agent. If a referenced artifact field is missing, `renderPrompt` surfaces a clear error rather than silently passing an empty string.

### Change Detection

`diffCustomPhase` compares two versions of a custom phase definition and returns a structured diff. This is used by the UI to warn when an in-use phase has been edited in a way that changes its input/output schema.

## Scope and Promotion

| Scope | Visibility | Managed at |
|---|---|---|
| Personal | Your flows only | `/me/custom-phases` |
| Org-wide | All org members | `/admin/custom-phases` |

The `/custom-phases/visible` endpoint merges both scopes so the flow editor palette always shows everything available to the current user. Promotion from personal to org scope follows the same pattern as MCP instances and skill packages (see [docs/mcp.md](./mcp.md)).

## Package Reference

| Export | Source file | Description |
|---|---|---|
| `renderPrompt` | `prompt-renderer.ts` | Resolve template variables against the artifact bag |
| `diffCustomPhase` | `schema-diff.ts` | Detect schema-breaking changes between two phase versions |
| `userCustomPhasesRoutes` | `routes/user-custom-phases.ts` | Express router for `/me/custom-phases` CRUD |
| `orgCustomPhasesRoutes` | `routes/org-custom-phases.ts` | Express router for `/orgs/:orgId/custom-phases` CRUD |
| `visibleRoutes` | `routes/visible.ts` | Router for `GET /custom-phases/visible` |
| Catalog helpers | `catalog.ts` | Utilities for listing and filtering registered custom phases |
| DB helpers | `db.ts` | Low-level database access for custom phase records |
