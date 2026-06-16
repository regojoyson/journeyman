import { execFileSync } from "node:child_process";
import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const agentDir = join(root, "packages", "windows-agent");
const dist = join(agentDir, "dist");
mkdirSync(dist, { recursive: true });

// 1. Bundle the agent entrypoint.
execFileSync("npm", ["run", "bundle", "-w", "@journeyman/windows-agent"], { cwd: root, stdio: "inherit" });

// 2. Copy the .proto next to the bundle (proto-loader reads it at runtime).
copyFileSync(
  join(root, "packages", "agent-protocol", "src", "journeyman-agent.proto"),
  join(dist, "journeyman-agent.proto"),
);

// 3. Emit a manifest the operator/installer reads.
writeFileSync(join(dist, "manifest.json"), JSON.stringify({
  artifact: "windows-agent",
  entry: "windows-agent.js",
  externals: ["@grpc/grpc-js", "@grpc/proto-loader", "tar"],
  requires: ["node>=22", "git-for-windows", "runner bundle (runner.js + node_modules)"],
}, null, 2) + "\n");

process.stdout.write(`windows-agent bundle written to ${dist}\n`);
