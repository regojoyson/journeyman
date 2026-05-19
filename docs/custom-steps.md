# Custom Steps

## Overview

Custom steps let you define your own AI-powered flow nodes beyond the built-in catalog. Each custom step has a name, description, a prompt template with artifact variable interpolation, a list of allowed tools, and an optional model override. Once defined, custom steps appear in the flow editor palette alongside built-in steps and behave identically to them — they can be connected to other nodes, consume artifacts as inputs, and produce artifacts as outputs.

## Creating Custom Steps

### Via UI

- Personal steps: `/me/custom-steps`
- Org-wide steps: `/admin/custom-steps`

### Step Definition Fields

| Field | Description |
|---|---|
| `name` | Display name shown in the palette and on the canvas node |
| `description` | Short description shown in the palette |
| `promptTemplate` | Handlebars-style template; use `{{artifact.fieldName}}` to interpolate flow artifacts |
| `allowedTools` | List of tool names the AI agent can use (e.g. `["Bash", "Read", "Write"]`) |
| `modelOverride` | Optional: override the flow's default AI model for this step only |

### API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/me/custom-steps` | List your personal custom steps |
| `POST` | `/me/custom-steps` | Create a personal custom step |
| `PUT` | `/me/custom-steps/:id` | Update a personal custom step |
| `DELETE` | `/me/custom-steps/:id` | Delete a personal custom step |
| `GET` | `/orgs/:orgId/custom-steps` | List org-wide custom steps |
| `POST` | `/orgs/:orgId/custom-steps` | Create an org-wide custom step |
| `PUT` | `/orgs/:orgId/custom-steps/:id` | Update an org-wide custom step |
| `DELETE` | `/orgs/:orgId/custom-steps/:id` | Delete an org-wide custom step |
| `GET` | `/custom-steps/visible` | List all custom steps visible to the current user (personal + org merged) |

## Using Custom Steps in Flows

Custom steps appear in the flow editor palette under a **Custom** category. Drag them onto the canvas exactly like any built-in step. Their input and output schema is inferred from the prompt template — artifact variables referenced in the template become required inputs; any artifacts written by the AI agent during execution become outputs.

Custom step nodes support all the same properties as built-in step nodes: MCP instance attachment, skill package attachment, retryable flag, and timeout configuration.

## Prompt Templates

Prompts use a Handlebars-style syntax. Reference any artifact produced earlier in the flow with `{{artifact.fieldName}}`.

**Example:**

```
Analyze the following cloned repositories and identify security vulnerabilities:

{{artifact.clonedRepos}}

Focus on: dependency issues, hardcoded secrets, and insecure API calls.
```

At runtime, `renderPrompt` in `@journeyman/custom-steps` resolves each template variable against the current artifact bag before passing the prompt to the AI agent. If a referenced artifact field is missing, `renderPrompt` surfaces a clear error rather than silently passing an empty string.

### Change Detection

`diffCustomStep` compares two versions of a custom step definition and returns a structured diff. This is used by the UI to warn when an in-use step has been edited in a way that changes its input/output schema.

## Scope and Promotion

| Scope | Visibility | Managed at |
|---|---|---|
| Personal | Your flows only | `/me/custom-steps` |
| Org-wide | All org members | `/admin/custom-steps` |

The `/custom-steps/visible` endpoint merges both scopes so the flow editor palette always shows everything available to the current user. Promotion from personal to org scope follows the same pattern as MCP instances and skill packages (see [docs/mcp.md](./mcp.md)).

## Package Reference

| Export | Source file | Description |
|---|---|---|
| `renderPrompt` | `prompt-renderer.ts` | Resolve template variables against the artifact bag |
| `diffCustomStep` | `schema-diff.ts` | Detect schema-breaking changes between two step versions |
| `userCustomStepsRoutes` | `routes/user-custom-steps.ts` | Express router for `/me/custom-steps` CRUD |
| `orgCustomStepsRoutes` | `routes/org-custom-steps.ts` | Express router for `/orgs/:orgId/custom-steps` CRUD |
| `visibleRoutes` | `routes/visible.ts` | Router for `GET /custom-steps/visible` |
| Catalog helpers | `catalog.ts` | Utilities for listing and filtering registered custom steps |
| DB helpers | `db.ts` | Low-level database access for custom step records |
