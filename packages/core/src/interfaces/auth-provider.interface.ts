import type { FastifyRequest } from "fastify";

export interface IUserContext {
  userId: string | null;
  roles: string[];
}

export interface IAuthProvider {
  /** Resolve a user from a request. Returns the anonymous user when no auth header. */
  authenticate(req: FastifyRequest): Promise<IUserContext>;
}
