export type ConnectionCategory = "git" | "notification" | "ticket";

/**
 * A reusable, encrypted credential + config for an external service, classified
 * by category. Git connections power agent repositories; notification connections
 * power agent notifications (delivery lands in a later phase).
 */
export interface Connection {
  id: string;
  workspaceId: string;
  orgId: string;
  category: ConnectionCategory;
  provider: string; // git: "github" | "gitlab" ; notification: "slack" | "console" | "email"
  label: string;
  /** git self-hosted instance URL / slack workspace; defaults applied per provider. */
  baseUrl?: string;
  /** Provider-specific config (e.g. slack method: "token" | "webhook"). The
   *  credential is encrypted at rest and never returned on this object. */
  config?: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type ConnectionCreateInput = Pick<Connection, "category" | "provider" | "label"> &
  Partial<Pick<Connection, "baseUrl" | "config">> & {
    /** Raw credential value; stored encrypted in the vault, referenced by secretRef. */
    credential: string;
  };

export type ConnectionUpdateInput = Partial<Pick<Connection, "label" | "baseUrl" | "config">> & {
  /** When present, rotates the stored credential. */
  credential?: string;
};

/** Decrypted connection handed to a step handler via StepContext.connection. */
export interface ResolvedConnection {
  id: string;
  category: ConnectionCategory;
  provider: string;
  credential: string;
  baseUrl?: string;
  config?: Record<string, unknown>;
}
