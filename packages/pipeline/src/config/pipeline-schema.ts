/**
 * @file pipeline-schema.ts
 * Zod schema for the top-level pipeline.yaml config file.
 *
 * Covers: defaultFlow, stateStorage backend, server settings (port, bearer token,
 * webhook secrets), workspace lifecycle policy, and the per-product block that
 * maps a product to a flow, workspace root, repos, provider credentials, and
 * ticket-workflow status labels.
 */

import { z } from "zod";

export const PipelineConfigSchema = z.object({
  defaultFlow: z.string().min(1),
  /** Where pipeline run state, traces, and artifacts are persisted.
   *  Discriminated by `type` so future backends (postgres, redis, ...) slot in. */
  stateStorage: z.object({
    type: z.literal("file"),
    directory: z.string().min(1).optional(),
  }).optional(),
  products: z.record(z.object({
    flow: z.string().min(1),
    workspace: z.string().min(1),
    repos: z.array(z.object({
      providerId: z.enum(["github", "gitlab"]),
      owner: z.string().min(1),
      repo: z.string().min(1),
      url: z.string().min(1),
      defaultBranch: z.string().min(1),
    })).min(1),
    providerConfig: z.object({
      ticket: z.record(z.unknown()).optional(),
      git: z.record(z.unknown()).optional(),
      coding: z.record(z.unknown()).optional(),
      notification: z.record(z.unknown()).optional(),
    }).optional(),
    ticketWorkflow: z.object({
      trigger: z.object({
        matchLabels: z.array(z.string()).optional(),
        matchStatus: z.array(z.string()).optional(),
      }).optional(),
      statuses: z.record(z.string()),
    }).optional(),
    webhookSecrets: z.record(z.string()).optional(),
    concurrency: z.number().int().min(1).optional(),
  })),
  server: z.object({
    port: z.number().int(),
    bearerTokenEnv: z.string().min(1),
    webhooks: z.object({
      github: z.object({ secretEnv: z.string(), path: z.string().optional() }).optional(),
      gitlab: z.object({ secretEnv: z.string(), path: z.string().optional() }).optional(),
      jira:   z.object({ secretEnv: z.string(), path: z.string().optional() }).optional(),
    }),
  }),
  workspaces: z.object({
    cleanupOn: z.array(z.enum([
      "queued", "running", "blocked", "completed", "failed", "cancelling", "cancelled",
    ])).optional(),
    retentionDays: z.number().int().min(0).optional(),
    keepFailed: z.boolean().optional(),
  }).optional(),
});
