import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { getCalendarSyncState, subscribeCalendarSync } from '@/lib/calendar-sync';
import { syncGoogleCalendarFromRemote } from '@/lib/db';

type Props = {
  variant?: 'header' | 'sidebar';
};

export function CalendarRefreshButton({ variant = 'header' }: Props) {
  const [state, setState] = useState(getCalendarSyncState);

  useEffect(() => subscribeCalendarSync(setState), []);

  const handleClick = async () => {
    await syncGoogleCalendarFromRemote({ manual: true });
  };

  if (variant === 'sidebar') {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={state.pulling}
        className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 transition-all hover:bg-slate-800 hover:text-slate-200 disabled:opacity-60"
        title="Googleカレンダーの変更を取り込みます"
      >
        <RefreshCw className={`h-5 w-5 ${state.pulling ? 'animate-spin' : ''}`} />
        {state.pulling ? '更新中...' : 'カレンダーを更新'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state.pulling}
      className="btn-secondary"
      title="Googleカレンダーの変更を取り込みます"
    >
      <RefreshCw className={`h-4 w-4 ${state.pulling ? 'animate-spin' : ''}`} />
      {state.pulling ? '更新中...' : 'カレンダーを更新'}
    </button>
  );
}
