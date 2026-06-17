/**
 * Append the Journeyman runner bundle + baseline tools to a user Dockerfile.
 * v1 targets glibc/apt bases; the apt install is best-effort (`|| true`) so
 * non-apt bases still build (git is then expected from the base image).
 * If the base is already journeyman/runner-base, injection is skipped.
 */
export function wrapDockerfile(userContent: string, bundleRef: string): string {
  if (/^\s*FROM\s+journeyman\/runner-base/im.test(userContent)) {
    return userContent.trimEnd() + "\n";
  }
  return [
    userContent.trimEnd(),
    "",
    "# ── appended by Journeyman (runner bundle + baseline tools) ──",
    "USER root",
    "RUN (command -v apt-get >/dev/null 2>&1 && apt-get update && " +
      "apt-get install -y --no-install-recommends git openssh-client ca-certificates curl && " +
      "rm -rf /var/lib/apt/lists/*) || true",
    `COPY --from=${bundleRef} /opt/journeyman /opt/journeyman`,
    "ENV PATH=/opt/journeyman/bin:$PATH",
    "",
  ].join("\n");
}
