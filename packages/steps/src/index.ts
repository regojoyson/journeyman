// packages/steps/src/index.ts
//
// React-aware barrel — pulls in StepDefinition forms (.tsx). Only the web app
// should import from here. Backend (api-server, orchestrator) must use the
// React-free "@journeyman/steps/catalog" subpath instead.
export { builtInSteps } from "./registry.ts";
