import type { ReactNode } from "react";
import { DEFAULT_CUSTOM_STEP_ICON_ID } from "@journeyman/core";
import { CUSTOM_STEP_ICON_COMPONENTS } from "./custom-step-icons.tsx";

export interface ResolveStepIconOptions {
  /** Pixel size for Lucide or <img> rendering. Default 16. */
  size?: number;
  className?: string;
}

/**
 * Render a step icon value to a ReactNode.
 *
 *   "lucide:<Name>" → a Lucide component (if in the allowlist) else raw text.
 *   "data:image/..." → an <img> tag.
 *   anything else (e.g. "■", "?", "⊞") → rendered as plain text.
 *   null / undefined → DEFAULT_CUSTOM_STEP_ICON_ID.
 */
export function resolveStepIcon(
  icon: string | null | undefined,
  opts: ResolveStepIconOptions = {},
): ReactNode {
  const size = opts.size ?? 16;
  const id = icon ?? DEFAULT_CUSTOM_STEP_ICON_ID;

  if (id.startsWith("lucide:")) {
    const name = id.slice("lucide:".length);
    const Cmp = CUSTOM_STEP_ICON_COMPONENTS[name];
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
