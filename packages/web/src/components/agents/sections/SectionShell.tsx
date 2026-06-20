import type { ReactNode } from "react";
import { Info } from "lucide-react";

export function InfoIcon({ text }: { text: string }) {
  return (
    <span className="relative group/tip cursor-help inline-flex items-center">
      <span className="inline-flex items-center justify-center w-[15px] h-[15px] rounded-full bg-muted text-muted-foreground text-[9px] font-bold italic font-serif group-hover/tip:bg-primary group-hover/tip:text-primary-foreground transition-colors">
        i
      </span>
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 text-xs rounded-md bg-card border border-border shadow-md whitespace-nowrap opacity-0 group-hover/tip:opacity-100 pointer-events-none transition-opacity z-50">
        {text}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-border" />
        <span className="absolute top-[calc(100%-1px)] left-1/2 -translate-x-1/2 border-4 border-transparent border-t-card" />
      </span>
    </span>
  );
}

export function SectionShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h2 className="text-base font-semibold">{title}</h2>
      {description && (
        <div className="mt-2 mb-4 flex gap-2.5 items-start rounded-lg bg-primary/10 px-3 py-2.5">
          <Info className="w-4 h-4 text-primary/70 shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        </div>
      )}
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export function FieldLabel({ children, help }: { children: ReactNode; help?: string }) {
  return (
    <label className="flex items-center gap-1.5 text-sm font-medium mb-1.5">
      {children}
      {help && <InfoIcon text={help} />}
    </label>
  );
}
