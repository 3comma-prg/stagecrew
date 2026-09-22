import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function CollapsedSection({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100"
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-500">{count}</span>
      </button>
      {open ? children : null}
    </div>
  );
}

export function isClosedProjectStatus(status?: string | null) {
  return status === 'completed' || status === 'cancelled';
}
