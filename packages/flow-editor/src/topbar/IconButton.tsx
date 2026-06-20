import { forwardRef, useId, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name (announced by screen readers, also used as the visible tooltip). */
  label: string;
  /** Optional secondary line shown in the tooltip — e.g. a keyboard shortcut or status. */
  hint?: string;
  /** Icon node. Will be rendered with aria-hidden so the label drives accessibility. */
  icon: ReactNode;
  /** Tooltip placement relative to the button. */
  tooltipPlacement?: "bottom" | "top";
  /** Indicates a long-running action is in progress (sets aria-busy). */
  busy?: boolean;
  /** Optional count rendered as a small badge on the button corner. Hidden when 0/undefined. */
  badge?: number;
}

/**
 * Accessible icon-only button following WAI-ARIA APG tooltip pattern:
 * - aria-label provides the accessible name
 * - Visible tooltip on hover AND keyboard focus (WCAG 2.1.1, 1.4.13)
 * - Tooltip uses role="tooltip" and is wired via aria-describedby
 * - Dismissible with Escape (WCAG 1.4.13)
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, hint, icon, tooltipPlacement = "bottom", busy, badge, className, onKeyDown, ...rest },
  ref,
) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const cls = ["je-icon-btn", className].filter(Boolean).join(" ");

  return (
    <span className="je-icon-btn-wrap">
      <button
        ref={ref}
        type="button"
        className={cls}
        aria-label={label}
        aria-describedby={open ? tipId : undefined}
        aria-busy={busy || undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={e => {
          if (e.key === "Escape" && open) {
            setOpen(false);
          }
          onKeyDown?.(e);
        }}
        {...rest}
      >
        <span aria-hidden="true" className="je-icon-btn__icon">{icon}</span>
      </button>
      {badge ? <span className="je-icon-btn__badge" aria-hidden="true">{badge}</span> : null}
      {open && (
        <span
          id={tipId}
          role="tooltip"
          className={`je-tooltip je-tooltip--${tooltipPlacement}`}
        >
          <span className="je-tooltip__label">{label}</span>
          {hint && <span className="je-tooltip__hint">{hint}</span>}
        </span>
      )}
    </span>
  );
});
