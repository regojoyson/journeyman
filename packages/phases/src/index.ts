// packages/phases/src/index.ts
//
// React-aware barrel — pulls in PhaseDefinition forms (.tsx). Only the web app
// should import from here. Backend (api-server, orchestrator) must use the
// React-free "@journeyman/phases/catalog" subpath instead.
export { builtInPhases } from "./registry.ts";
