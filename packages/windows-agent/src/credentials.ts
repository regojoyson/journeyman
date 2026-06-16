import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as grpc from "@grpc/grpc-js";

/** Build mTLS server credentials from a folder containing ca.pem / server.pem / server-key.pem. */
export function loadServerCredentials(certDir: string): grpc.ServerCredentials {
  let ca: Buffer, cert: Buffer, key: Buffer;
  try {
    ca = readFileSync(join(certDir, "ca.pem"));
    cert = readFileSync(join(certDir, "server.pem"));
    key = readFileSync(join(certDir, "server-key.pem"));
  } catch (e) {
    throw new Error(`failed to read mTLS certs from ${certDir} (need ca.pem/server.pem/server-key.pem): ${(e as Error).message}`);
  }
  return grpc.ServerCredentials.createSsl(
    ca,
    [{ private_key: key, cert_chain: cert }],
    true, // require + verify the client cert (mutual TLS)
  );
}
