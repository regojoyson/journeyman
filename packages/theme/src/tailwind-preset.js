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

const shadcn = {
  background: withAlpha("--background"),
  foreground: withAlpha("--foreground"),
  card: withAlpha("--card"),
  "card-foreground": withAlpha("--card-foreground"),
  popover: withAlpha("--popover"),
  "popover-foreground": withAlpha("--popover-foreground"),
  primary: withAlpha("--primary"),
  "primary-foreground": withAlpha("--primary-foreground"),
  secondary: withAlpha("--secondary"),
  "secondary-foreground": withAlpha("--secondary-foreground"),
  muted: withAlpha("--muted"),
  "muted-foreground": withAlpha("--muted-foreground"),
  // `accent` is redefined here to shadcn's subtle-gray (--accent), OVERRIDING
  // the earlier semantic `accent` (which was --color-accent -> primary). This is
  // correct for shadcn (accent = subtle hover/active gray); standalone
  // `text-accent` usages get migrated to `text-foreground` in a later task.
  accent: withAlpha("--accent"),
  "accent-foreground": withAlpha("--accent-foreground"),
  destructive: withAlpha("--destructive"),
  "destructive-foreground": withAlpha("--destructive-foreground"),
  border: withAlpha("--border"),
  input: withAlpha("--input"),
  ring: withAlpha("--ring"),
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
        ...shadcn,
        slate: slateRemap,
      },
      borderRadius: {
        sm: "calc(var(--radius) - 4px)",
        md: "calc(var(--radius) - 2px)",
        lg: "var(--radius)",
        xl: "calc(var(--radius) + 4px)",
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
      // Named, theme-aware elevation. Does not override Tailwind's default
      // `shadow-*` scale — use `shadow-card`, `shadow-card-sm`, `shadow-card-lg`.
      boxShadow: {
        "card-sm": "var(--shadow-sm)",
        card: "var(--shadow-md)",
        "card-lg": "var(--shadow-lg)",
      },
    },
  },
};
