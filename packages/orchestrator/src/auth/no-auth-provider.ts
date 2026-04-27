import type { FastifyRequest } from "fastify";
import type { IAuthProvider, IUserContext } from "@journeyman/core";

export class NoAuthProvider implements IAuthProvider {
  async authenticate(_req: FastifyRequest): Promise<IUserContext> {
    return { userId: null, roles: ["anonymous"] };
  }
}
