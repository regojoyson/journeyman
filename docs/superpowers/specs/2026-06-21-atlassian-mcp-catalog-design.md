# Atlassian MCP Catalog Integration

**Date:** 2026-06-21  
**Status:** Approved

## Problem

The previous Jira catalog entry (`mcp-jira-confluence` via `npx`) gave 15 tools. The Atlassian hosted MCP at `https://mcp.atlassian.com/v1/mcp` gives 43 tools (Jira + Confluence + Bitbucket + JSM) over pure HTTP with no extra runtime dependency.

Testing confirmed Basic auth (`Authorization: Basic base64(email:api_token)`) works when the org admin enables API token authentication in Atlassian settings.

## Changes

### 1. Catalog (`packages/mcp/src/routes/catalog.ts`)

- Remove: `jira` entry (`mcp-jira-confluence` via npx)
- Add: `atlassian` entry pointing to `https://mcp.atlassian.com/v1/mcp`, transport `http`, requiring `ATLASSIAN_BASIC_AUTH`

### 2. Header builder (`packages/mcp/src/sdk-adapter.ts`)

Add `ATLASSIAN_BASIC_AUTH` as a second special key in `buildHeaders()`:

```
ATLASSIAN_BASIC_AUTH → Authorization: Basic <value>
AUTHORIZATION        → Authorization: Bearer <value>  (unchanged)
```

## User Setup

1. Compute `base64(email:api_token)` — e.g. `btoa("you@org.com:ATATT3x...")`
2. Store result as a workspace secret (e.g. `ATLASSIAN_BASIC`)
3. Add MCP from catalog → "Atlassian"
4. Bind `ATLASSIAN_BASIC_AUTH` → that secret

## Why Basic over Bearer

Atlassian's personal API tokens use Basic auth (`email:token` base64-encoded). Bearer is for OAuth access tokens or service account API keys. The user has a personal API token, so Basic is correct.
