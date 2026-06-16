import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";

export * from "./types.ts";

/** Absolute path to the .proto (resolved from this module; build copies it next to the bundle). */
export const PROTO_PATH = fileURLToPath(new URL("./journeyman-agent.proto", import.meta.url));

export function loadAgentPackage(): grpc.GrpcObject {
  const def = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
  });
  return grpc.loadPackageDefinition(def);
}

/** The service constructor — used to addService (server) and to build a client. */
export function agentServiceDef(): grpc.ServiceClientConstructor {
  const pkg = loadAgentPackage() as unknown as {
    journeyman: { agent: { JourneymanAgent: grpc.ServiceClientConstructor } };
  };
  return pkg.journeyman.agent.JourneymanAgent;
}
