/**
 * Shared Tailwind preset for Journeyman.
 *
 * Registers two layers of color names:
 *   1. Semantic tokens (bg-surface, text-default, etc.) — preferred going forward.
 *   2. Slate-shade remap — Tailwind's `slate` palette for the in-use shades is
 *      overridden to resolve to the same variables, so existing classes like
 *      `bg-slate-900` keep working and become themeable for free. Replace these
 *      with semantic names gradually (see packages/theme/MIGRATION.md).
 */

const withAlpha = (cssVar) => `rgb(var(${cssVar}) / <alpha-value>)`;

const semantic = {
  bg: withAlpha("--color-bg"),
  surface: withAlpha("--color-surface"),
  "surface-raised": withAlpha("--color-surface-raised"),
  "surface-hover": withAlpha("--color-surface-hover"),
  "surface-active": withAlpha("--color-surface-active"),
  default: withAlpha("--color-text"),
  muted: withAlpha("--color-text-muted"),
  subtle: withAlpha("--color-text-subtle"),
  accent: withAlpha("--color-accent"),
  "accent-hover": withAlpha("--color-accent-hover"),
  success: withAlpha("--color-success"),
  warning: withAlpha("--color-warning"),
  danger: withAlpha("--color-danger"),
  info: withAlpha("--color-info"),
  "info-muted": withAlpha("--color-info-muted"),
  canvas: withAlpha("--color-canvas"),
  "canvas-dot": withAlpha("--color-canvas-dot"),
  overlay: "var(--color-overlay)",
};

const slateRemap = {
  100: withAlpha("--color-text"),
  200: withAlpha("--color-text"),
  300: withAlpha("--color-text-muted"),
  400: withAlpha("--color-text-muted"),
  500: withAlpha("--color-text-subtle"),
  600: withAlpha("--color-border-strong"),
  700: withAlpha("--color-border"),
  800: withAlpha("--color-surface-raised"),
  900: withAlpha("--color-surface"),
};

export default {
  theme: {
    extend: {
      colors: {
        ...semantic,
        slate: slateRemap,
      },
      backgroundColor: {
        DEFAULT: withAlpha("--color-bg"),
      },
      textColor: {
        DEFAULT: withAlpha("--color-text"),
      },
      borderColor: {
        DEFAULT: withAlpha("--color-border"),
        strong: withAlpha("--color-border-strong"),
      },
    },
  },
};
