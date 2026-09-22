import type { ReactNode } from 'react';
import { Ban } from 'lucide-react';

export function cancelledCardClass(isCancelled: boolean) {
  return isCancelled ? 'border-slate-400 bg-slate-100 ring-1 ring-inset ring-slate-300' : '';
}

export function CancelledBanner({ compact = false }: { compact?: boolean }) {
  return (
    <div className="mb-2 inline-flex max-w-full items-center gap-1.5 rounded-md bg-slate-800 px-2 py-1 text-xs font-bold text-white">
      <Ban className="h-3.5 w-3.5 shrink-0" />
      <span className="leading-tight">
        {compact ? 'キャンセル済み' : 'キャンセル済み — 予定は残しています。カレンダーではグレー表示です'}
      </span>
    </div>
  );
}

export function CancelledTitle({ children }: { children: ReactNode }) {
  return <span className="text-slate-500 line-through decoration-slate-500 decoration-2">{children}</span>;
}
