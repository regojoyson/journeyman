// Public, unauthenticated inbound receiver — POST /webhooks/in/:tenantToken.
// Registered ONLY by the api-webhooks service entrypoint.
export { registerWebhookRoutes } from "./routes/webhooks.ts";

// Authenticated UI management — paths under /api/...; registered by the api-http
// service entrypoint (they share the /api prefix with the rest of the UI API).
export { registerWebhookManagementRoutes } from "./routes/webhooks-management.ts";
export { registerWebhookPresetRoutes } from "./routes/webhook-presets.ts";
