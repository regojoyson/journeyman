#!/usr/bin/env node
// Build the Journeyman "kit" images and PUSH them to a configurable registry.
// Captures each pushed manifest digest and writes <out>/kit.json. No tars.
//
// Required env:
//   JOURNEYMAN_REGISTRY            e.g. localhost:5000 | ghcr.io/acme | registry.gitlab.com/acme/jm
// Optional env:
//   JOURNEYMAN_REGISTRY_USERNAME / JOURNEYMAN_REGISTRY_TOKEN   creds for private registries
//   JOURNEYMAN_BASE_DIR           data root (kit.json goes under <root>/kit)
//   KIT_OUT_DIR                   explicit output dir (wins over base/kit)
//   DOCKER_HOST                   which daemon to build/push on
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { config as loadDotenv } from "dotenv";
import { makeDockerClient, registryAuthFromEnv } from "@journeyman/sandbox";

// ENV_FILE selects the dotenv file (default .env for dev; compose-up.sh sets
// .env.production for the deploy path).
loadDotenv({ path: process.env.ENV_FILE ?? ".env" });

const registry = process.env.JOURNEYMAN_REGISTRY;
if (!registry) {
  console.error("ERROR: JOURNEYMAN_REGISTRY is required (e.g. localhost:5000 or ghcr.io/acme)");
  process.exit(1);
}

const repoRoot = process.cwd();
const base = process.env.JOURNEYMAN_BASE_DIR ?? join(homedir(), ".journeyman");
const argOut = (() => { const i = process.argv.indexOf("--out"); return i !== -1 ? process.argv[i + 1] : undefined; })();
const outDir = argOut ?? process.env.KIT_OUT_DIR ?? join(base, "kit");

const targets = [
  { role: "bundle", repo: `${registry}/runner-bundle`, tag: `${registry}/runner-bundle:dev`, dockerfile: "docker/runner-bundle.Dockerfile" },
  { role: "base",   repo: `${registry}/runner-base`,   tag: `${registry}/runner-base:dev`,   dockerfile: "docker/runner-base.Dockerfile" },
];

function run(cmd, args) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", cwd: repoRoot });
}

// dockerode (used for push) ignores the Docker CLI *context*, so on Rancher
// Desktop / colima / rootless the default /var/run/docker.sock doesn't exist.
// If DOCKER_HOST isn't already set, adopt the active CLI context's endpoint so
// the push targets the same daemon `docker build` just used.
if (!process.env.DOCKER_HOST) {
  try {
    const host = execFileSync(
      "docker",
      ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
      { encoding: "utf8" },
    ).trim();
    if (host) {
      process.env.DOCKER_HOST = host;
      console.log(`(using docker endpoint from CLI context: ${host})`);
    }
  } catch {
    /* fall back to dockerode's default socket */
  }
}

mkdirSync(outDir, { recursive: true });
const client = makeDockerClient();
const auth = registryAuthFromEnv(process.env);
const kit = {};

for (const t of targets) {
  console.log(`\n=== build ${t.tag} (${t.dockerfile}) ===`);
  run("docker", ["build", "-f", t.dockerfile, "-t", t.tag, "."]);
  console.log(`\n=== push ${t.tag} ===`);
  const pinned = await client.pushImage(t.tag, auth);
  console.log(`pushed ${t.role}: ${pinned}`);
  kit[t.role] = pinned;
}

const kitJsonPath = join(outDir, "kit.json");
writeFileSync(kitJsonPath, JSON.stringify(kit, null, 2) + "\n");
console.log(`\n✓ Kit pushed. Digests written to ${kitJsonPath}`);
console.log(`  base:   ${kit.base}`);
console.log(`  bundle: ${kit.bundle}`);
console.log(`\nNext: run 'npm run register-kit' (after the DB is up) to record these in kit_images.`);
