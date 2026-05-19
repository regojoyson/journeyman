import type { ReactNode } from "react";
import { DEFAULT_CUSTOM_PHASE_ICON_ID } from "@journeyman/core";
import { CUSTOM_PHASE_ICON_COMPONENTS } from "./custom-phase-icons.tsx";

export interface ResolvePhaseIconOptions {
  /** Pixel size for Lucide or <img> rendering. Default 16. */
  size?: number;
  className?: string;
}

/**
 * Render a phase icon value to a ReactNode.
 *
 *   "lucide:<Name>" → a Lucide component (if in the allowlist) else raw text.
 *   "data:image/..." → an <img> tag.
 *   anything else (e.g. "■", "?", "⊞") → rendered as plain text.
 *   null / undefined → DEFAULT_CUSTOM_PHASE_ICON_ID.
 */
export function resolvePhaseIcon(
  icon: string | null | undefined,
  opts: ResolvePhaseIconOptions = {},
): ReactNode {
  const size = opts.size ?? 16;
  const id = icon ?? DEFAULT_CUSTOM_PHASE_ICON_ID;

  if (id.startsWith("lucide:")) {
    const name = id.slice("lucide:".length);
    const Cmp = CUSTOM_PHASE_ICON_COMPONENTS[name];
    if (Cmp) return <Cmp size={size} className={opts.className} />;
    return <>{id}</>;
  }

  if (id.startsWith("data:image/")) {
    return (
      <img
        src={id}
        alt=""
        width={size}
        height={size}
        className={opts.className}
        style={{ objectFit: "contain" }}
      />
    );
  }

  return <>{id}</>;
}
