# Custom Phase: MCP-Required Flag — Implementation Plan

> Mirror of the skills-required work. Same shape, minus auto-populate.

**Goal:** Add `requiresMcp` boolean to custom phases; validate empty `mcpInstanceIds` on flow nodes when flag is on. No auto-populate (MCPs carry secrets).

**Tasks:**
1. DB migration `023_custom_phase_requires_mcp.sql`
2. Core type — `requiresMcp: boolean` on `CustomAiPhase` + create input
3. DB adapter — read/write `requires_mcp`
4. Routes — accept `requiresMcp` on user POST/PATCH + org PATCH (no new scope-guard work — already covered)
5. Catalog — expose `requiresMcp` on `CustomPhaseCatalogEntry`
6. Validator — extend `CustomPhaseValidationEntry` with `requiresMcp` + `defaultMcpIds`; add rule in `validate-workflow.ts`
7. `useValidationCatalog` — pass `requiresMcp` + `defaultMcpIds` through
8. Admin form — checkbox in Definition tab + soft warning
9. Unit tests for validator rule
10. Final: typecheck + tests
