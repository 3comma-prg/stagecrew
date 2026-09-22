import type { CalendarConflict, CalendarSyncState, GoogleIntegrationSettings } from '@/types';
import {
  clearDeferredConflict,
  deferCalendarConflict as persistDeferredConflict,
  isDeferredConflict,
  loadCalendarSyncMeta,
  loadSettings,
  saveCalendarSyncMeta,
} from '@/lib/local-store';
import { spreadsheetRequestHeaders } from '@/lib/spreadsheet';

const CALENDAR_FIELDS = new Set([
  'date',
  'is_cancelled',
  'is_deleted',
  'task_type',
  'time_type',
  'start_date',
  'start_time',
  'end_date',
  'end_time',
  'area',
  'location',
  'position',
  'is_domestic',
  'venue_size',
  'notes',
]);

type Listener = (state: CalendarSyncState) => void;

let state: CalendarSyncState = {
  error: null,
  conflicts: [],
  pulling: false,
  lastPullAt: null,
  lastPullSummary: null,
};
const listeners = new Set<Listener>();

function emit(next: CalendarSyncState) {
  state = next;
  listeners.forEach((listener) => listener(state));
}

export function dismissCalendarError() {
  emit({ ...state, error: null });
}

export function dismissPullSummary() {
  emit({ ...state, lastPullSummary: null });
}

export function removeCalendarConflict(taskId: string) {
  clearDeferredConflict(taskId);
  emit({ ...state, conflicts: state.conflicts.filter((item) => item.taskId !== taskId) });
}

export function deferCalendarConflict(conflict: CalendarConflict) {
  persistDeferredConflict(conflict.taskId, conflict.google);
  emit({ ...state, conflicts: state.conflicts.filter((item) => item.taskId !== conflict.taskId) });
}

function filterConflicts(conflicts: CalendarConflict[]) {
  return conflicts.filter((item) => !isDeferredConflict(item.taskId, item.google));
}

function pullSummary(result: {
  applied?: { deleted: number; updated: number };
  conflicts?: CalendarConflict[];
  skipped?: boolean;
  error?: string;
}) {
  if (result.error) return null;
  if (result.skipped) return 'カレンダーIDが未設定です。設定から登録してください。';
  const parts: string[] = [];
  if (result.applied?.updated) parts.push(`日時を${result.applied.updated}件取り込みました`);
  if (result.applied?.deleted) parts.push(`削除を${result.applied.deleted}件反映しました`);
  const remaining = filterConflicts(result.conflicts || []);
  if (remaining.length) parts.push(`反映できない変更が${remaining.length}件あります`);
  return parts.length ? parts.join(' / ') : 'カレンダーに新しい変更はありませんでした。';
}

export function getCalendarSyncState() {
  return state;
}

export function subscribeCalendarSync(listener: Listener) {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

export function resolveCalendarId(
  settings: Pick<GoogleIntegrationSettings, 'google_calendar_id'> = loadSettings()
) {
  const direct = settings.google_calendar_id?.trim();
  if (!direct) return '';
  return extractCalendarId(direct) || direct;
}

function extractCalendarId(raw: string) {
  const value = raw.trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    const cid = url.searchParams.get('cid') || url.searchParams.get('src');
    if (!cid) return '';
    const decodedParam = decodeURIComponent(cid);
    try {
      const normalized = decodedParam.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
      const decoded = atob(padded);
      if (decoded.includes('@') || decoded.includes('calendar')) return decoded;
    } catch {
      /* use decodedParam */
    }
    return decodedParam;
  } catch {
    return '';
  }
}

export function shouldPushTaskToCalendar(payload: Record<string, unknown>, isCreate: boolean) {
  if (isCreate) return true;
  return Object.keys(payload).some((key) => CALENDAR_FIELDS.has(key));
}

async function request<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...spreadsheetRequestHeaders() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new Error('Googleカレンダーとの通信が時間切れになりました。');
    }
    throw error;
  }
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || 'Googleカレンダーとの通信に失敗しました。');
  return data;
}

type PullResult = {
  skipped?: boolean;
  applied: { deleted: number; updated: number };
  conflicts: CalendarConflict[];
  error?: string;
};

let pullInflight: Promise<PullResult> | null = null;

export async function pushTaskToCalendar(taskId: string, options?: { deleteEvent?: boolean }) {
  const calendarId = resolveCalendarId();
  if (!calendarId || !taskId) return { skipped: true as const };
  try {
    const result = await request<{
      skipped?: boolean;
      ok?: boolean;
      deleted?: boolean;
      google_event_id?: string | null;
      error?: string;
    }>('/api/calendar/push', {
      calendarId,
      taskId,
      deleteEvent: Boolean(options?.deleteEvent),
    });
    if (result.error) {
      emit({ ...state, error: result.error });
    } else if (state.error) {
      emit({ ...state, error: null });
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Googleカレンダーとの同期に失敗しました。';
    emit({ ...state, error: message });
    return { error: message };
  }
}

export async function pullGoogleCalendar(options?: { manual?: boolean }) {
  if (pullInflight) return pullInflight;
  emit({ ...state, pulling: true });
  pullInflight = doPullGoogleCalendar(Boolean(options?.manual)).finally(() => {
    pullInflight = null;
  });
  return pullInflight;
}

async function doPullGoogleCalendar(manual: boolean): Promise<PullResult> {
  const calendarId = resolveCalendarId();
  if (!calendarId) {
    const skipped = { skipped: true as const, conflicts: state.conflicts, applied: { deleted: 0, updated: 0 } };
    emit({
      ...state,
      pulling: false,
      lastPullAt: new Date().toISOString(),
      lastPullSummary: manual ? pullSummary(skipped) : state.lastPullSummary,
    });
    return skipped;
  }

  const meta = loadCalendarSyncMeta();
  const syncToken = meta.calendarId === calendarId ? meta.syncToken : null;

  try {
    const result = await request<{
      skipped?: boolean;
      ok?: boolean;
      syncToken?: string | null;
      applied?: { deleted: number; updated: number };
      conflicts?: CalendarConflict[];
      error?: string;
    }>('/api/calendar/pull', { calendarId, syncToken });

    if (result.syncToken) saveCalendarSyncMeta(calendarId, result.syncToken);
    else if (!syncToken) saveCalendarSyncMeta(calendarId, null);

    const conflicts = filterConflicts(result.conflicts || []);
    emit({
      error: result.error || null,
      conflicts,
      pulling: false,
      lastPullAt: new Date().toISOString(),
      lastPullSummary: manual ? pullSummary({ ...result, conflicts }) : null,
    });
    return {
      skipped: Boolean(result.skipped),
      applied: result.applied || { deleted: 0, updated: 0 },
      conflicts,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Googleカレンダーとの同期に失敗しました。';
    emit({ ...state, error: message, pulling: false });
    return { error: message, applied: { deleted: 0, updated: 0 }, conflicts: state.conflicts };
  }
}

export async function checkGoogleCalendar() {
  const calendarId = resolveCalendarId();
  if (!calendarId) {
    const message = '設定にカレンダーIDがありません。';
    emit({ ...state, error: message });
    return { error: message };
  }
  try {
    const result = await request<{
      ok?: boolean;
      error?: string;
      summary?: string | null;
      accessRole?: string | null;
      serviceAccountEmail?: string;
    }>('/api/calendar/status', { calendarId });
    if (result.error) {
      emit({ ...state, error: result.error });
      return result;
    }
    emit({ ...state, error: null });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'カレンダーの確認に失敗しました。';
    emit({ ...state, error: message });
    return { error: message };
  }
}
