// packages/coding-cli/src/providers/opencode/types.ts

export type McpLocalConfig = {
  type: "local"
  command: Array<string>
  environment?: Record<string, string>
  enabled?: boolean
  timeout?: number
}

export type McpRemoteConfig = {
  type: "remote"
  url: string
  enabled?: boolean
  headers?: Record<string, string>
  timeout?: number
}

export type OpenCodePermission = {
  bash?: "ask" | "allow" | "deny"
  edit?: "ask" | "allow" | "deny"
  webfetch?: "ask" | "allow" | "deny"
}

export type OpenCodeMode =
  | { mode: "managed"; hostname?: string; port?: number; timeout?: number }
  | { mode: "external"; baseUrl?: string }

export type OpenCodeProviderConfig = OpenCodeMode & {
  model: { providerID: string; modelID: string }
  mcp?: Record<string, McpLocalConfig | McpRemoteConfig>
  tools?: Record<string, boolean>
  permission?: OpenCodePermission
}
