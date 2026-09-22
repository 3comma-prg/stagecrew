import { useEffect, useState } from 'react';
import { AlertTriangle, BookOpen, X } from 'lucide-react';
import { BILLING_STATUS_LABELS, formatCalendarTime, type BillingStatus, type CalendarConflict, type CalendarSyncState } from '@/types';
import { dismissCalendarError, dismissPullSummary, getCalendarSyncState, subscribeCalendarSync } from '@/lib/calendar-sync';
import { resolveCalendarConflict } from '@/lib/db';
import type { PageKey } from '@/components/Layout';

type Props = {
  onNavigate: (page: PageKey) => void;
};

export function CalendarSyncBanner({ onNavigate }: Props) {
  const [state, setState] = useState<CalendarSyncState>(getCalendarSyncState);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => subscribeCalendarSync(setState), []);

  if (!state.error && state.conflicts.length === 0 && !state.lastPullSummary) return null;

  const handleResolve = async (conflict: CalendarConflict, action: 'keep_app' | 'keep_google' | 'defer') => {
    setBusyId(`${conflict.taskId}:${action}`);
    try {
      const result = await resolveCalendarConflict(conflict, action);
      if (result && 'error' in result && result.error) {
        return;
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="sticky top-0 z-20 mb-4 space-y-3">
      {state.lastPullSummary && !state.error && state.conflicts.length === 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-sm">
          <p className="flex-1">{state.lastPullSummary}</p>
          <button type="button" onClick={dismissPullSummary} className="btn-icon shrink-0 text-emerald-600 hover:bg-emerald-100" title="閉じる">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {state.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <p className="flex-1">{state.error}</p>
            <button
              type="button"
              onClick={dismissCalendarError}
              className="btn-icon shrink-0 text-red-500 hover:bg-red-100 hover:text-red-700"
              title="閉じる"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      {state.conflicts.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 font-medium">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p>請求に使っているスケジュールのため、カレンダーの日時変更は自動ではアプリに入れていません。どうするか選んでください。</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('calendar_help')}
              className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-amber-800 hover:underline"
            >
              <BookOpen className="h-3.5 w-3.5" />
              説明
            </button>
          </div>
          <ul className="space-y-3">
            {state.conflicts.map((conflict) => {
              const busy = busyId?.startsWith(`${conflict.taskId}:`);
              return (
                <li key={conflict.taskId} className="rounded-lg border border-amber-200 bg-white/70 p-3">
                  <p className="font-medium">{conflict.scheduleName}</p>
                  <p className="mt-1 text-xs text-amber-800">
                    請求状態: {BILLING_STATUS_LABELS[(conflict.billingStatus as BillingStatus) || 'unbilled'] || conflict.billingStatus}
                  </p>
                  <p className="mt-1 text-xs text-amber-800">アプリ: {formatCalendarTime(conflict.app)}</p>
                  <p className="text-xs text-amber-800">カレンダー: {formatCalendarTime(conflict.google)}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleResolve(conflict, 'keep_app')}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {busyId === `${conflict.taskId}:keep_app` ? '処理中...' : '1. アプリ側に合わせる'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleResolve(conflict, 'keep_google')}
                      className="rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-50"
                    >
                      {busyId === `${conflict.taskId}:keep_google` ? '処理中...' : '2. カレンダー側に合わせる'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleResolve(conflict, 'defer')}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                    >
                      3. あとで決める
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-amber-700">
                    1はカレンダーをアプリの日時で上書きします。2はアプリの日時だけ変えます（請求書は変わりません）。3は今は何も変えません。
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
