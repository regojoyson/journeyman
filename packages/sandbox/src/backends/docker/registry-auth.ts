/** dockerode push/pull auth payload. */
export interface RegistryAuth {
  username: string;
  password: string;
  serveraddress: string;
}

/** Registry host = the prefix up to the first "/". */
export function registryHost(prefix: string): string {
  return prefix.split("/")[0];
}

/**
 * Build a dockerode authconfig from env, or undefined for anonymous (local/open)
 * registries. Auth is keyed on a token being present; username is optional.
 */
export function registryAuthFromEnv(env: Record<string, string | undefined>): RegistryAuth | undefined {
  const token = env.JOURNEYMAN_REGISTRY_TOKEN;
  const prefix = env.JOURNEYMAN_REGISTRY;
  if (!token || !prefix) return undefined;
  return {
    username: env.JOURNEYMAN_REGISTRY_USERNAME ?? "",
    password: token,
    serveraddress: registryHost(prefix),
  };
}
