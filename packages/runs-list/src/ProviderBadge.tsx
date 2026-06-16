const COLOURS: Record<string, { bg: string; color: string; border: string }> = {
  jira:    { bg: "rgba(37,99,235,0.18)",   color: "rgb(var(--color-info) / 1)", border: "rgba(37,99,235,0.4)" },
  github:  { bg: "rgba(100,116,139,0.18)", color: "rgb(var(--color-text) / 1)", border: "rgba(100,116,139,0.4)" },
  monday:  { bg: "rgba(22,163,74,0.18)",   color: "rgb(var(--color-success) / 1)", border: "rgba(22,163,74,0.4)" },
  linear:  { bg: "rgba(124,58,237,0.18)",  color: "rgb(var(--color-accent) / 1)", border: "rgba(124,58,237,0.4)" },
  api:     { bg: "rgba(217,119,6,0.18)",   color: "rgb(var(--color-warning) / 1)", border: "rgba(217,119,6,0.4)" },
  manual:  { bg: "rgba(107,114,128,0.18)", color: "rgb(var(--color-text) / 1)", border: "rgba(107,114,128,0.4)" },
  webhook: { bg: "rgba(107,114,128,0.18)", color: "rgb(var(--color-text) / 1)", border: "rgba(107,114,128,0.4)" },
};

const DEFAULT_COLOUR = { bg: "rgba(107,114,128,0.18)", color: "rgb(var(--color-text) / 1)", border: "rgba(107,114,128,0.4)" };

interface ProviderBadgeProps {
  provider: string;
}

export function ProviderBadge({ provider }: ProviderBadgeProps) {
  const c = COLOURS[provider] ?? DEFAULT_COLOUR;
  return (
    <span style={{
      display: "inline-block",
      fontSize: 10,
      fontWeight: 600,
      padding: "2px 7px",
      borderRadius: 3,
      textTransform: "uppercase",
      letterSpacing: "0.04em",
      background: c.bg,
      color: c.color,
      border: `1px solid ${c.border}`,
    }}>
      {provider}
    </span>
  );
}
