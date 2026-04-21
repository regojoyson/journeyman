// packages/ui/src/components/shared/EmptyState.tsx
import { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description: string;
  children?: ReactNode;
}

export default function EmptyState({ title, description, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 py-16">
      <Inbox className="mb-3 h-8 w-8 text-slate-300" />
      <h3 className="text-sm font-medium text-slate-500">{title}</h3>
      <p className="mt-1 max-w-xs text-center text-xs text-slate-400">{description}</p>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
