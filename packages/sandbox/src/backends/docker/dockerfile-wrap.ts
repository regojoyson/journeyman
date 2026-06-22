/**
 * Append the Journeyman runner bundle + baseline tools to a user Dockerfile.
 * The tool install is best-effort (`|| true`) and covers both apt (Debian/glibc)
 * and apk (Alpine) bases: git, openssh, curl, and Python 3 (+ pip, + a bare
 * `python`). Non-apt/non-apk bases still build; their toolchain must come from
 * the base image. If the base is already journeyman/runner-base, injection is skipped.
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
    "RUN ( (command -v apt-get >/dev/null 2>&1 && apt-get update && " +
      "apt-get install -y --no-install-recommends " +
      "git openssh-client ca-certificates curl python3 python3-pip python-is-python3 && " +
      "rm -rf /var/lib/apt/lists/*) " +
      "|| (command -v apk >/dev/null 2>&1 && " +
      "apk add --no-cache git openssh-client ca-certificates curl python3 py3-pip && " +
      "ln -sf /usr/bin/python3 /usr/bin/python) ) || true",
    `COPY --from=${bundleRef} /opt/journeyman /opt/journeyman`,
    "ENV PATH=/opt/journeyman/bin:$PATH",
    "",
  ].join("\n");
}
