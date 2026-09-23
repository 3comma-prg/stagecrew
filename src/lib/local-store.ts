import type { GoogleIntegrationSettings } from '@/types';
import { DEFAULT_APP_FOOTER, DEFAULT_APP_NAME, DEFAULT_APP_TAGLINE } from '@/types';

const SETTINGS_KEY = 'stagecrew.settings';
const LEGACY_SETTINGS_KEY = 'stage-light.settings';
const CALENDAR_SYNC_META_KEY = 'stagecrew.calendar-sync-meta';
const LEGACY_CALENDAR_SYNC_META_KEY = 'stage-light.calendar-sync-meta';
const DEFERRED_CONFLICTS_KEY = 'stagecrew.calendar-deferred';
const LEGACY_DEFERRED_CONFLICTS_KEY = 'stage-light.calendar-deferred';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

const emptySettings = (): GoogleIntegrationSettings => ({
  id: 1,
  google_calendar_id: null,
  invoice_template_ext_tax_url: null,
  invoice_template_int_tax_url: null,
  invoice_template_ext_nontax_url: null,
  invoice_template_detail_ext_tax_url: null,
  invoice_template_detail_int_tax_url: null,
  invoice_template_detail_ext_nontax_url: null,
  invoice_pdf_drive_folder_url: null,
  gmail_sender_email: null,
  data_spreadsheet_url: null,
  app_name: DEFAULT_APP_NAME,
  app_tagline: DEFAULT_APP_TAGLINE,
  app_footer: DEFAULT_APP_FOOTER,
  custom_task_types: null,
  custom_positions: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

const settingsListeners = new Set<() => void>();
let settingsCache: GoogleIntegrationSettings | null = null;

export function subscribeSettings(listener: () => void) {
  settingsListeners.add(listener);
  return () => {
    settingsListeners.delete(listener);
  };
}

function notifySettings() {
  settingsListeners.forEach((listener) => listener());
}

function normalizeAppName(name: string | null | undefined): string | null {
  const trimmed = name?.trim() || '';
  if (!trimmed || ['Stage Light', 'StageCrew', 'Stage Crew'].includes(trimmed)) return DEFAULT_APP_NAME;
  return name ?? DEFAULT_APP_NAME;
}

function calendarIdFromLegacy(partial: Partial<GoogleIntegrationSettings> & { google_calendar_url?: string | null }) {
  const direct = partial.google_calendar_id?.trim();
  if (direct) return direct;
  return partial.google_calendar_url?.trim() || null;
}

function mergeSettings(partial: Partial<GoogleIntegrationSettings> | null | undefined): GoogleIntegrationSettings {
  const source = (partial || {}) as Partial<GoogleIntegrationSettings> & { google_calendar_url?: string | null };
  const { google_calendar_url: _legacyUrl, ...rest } = source;
  const merged = { ...emptySettings(), ...rest, google_calendar_id: calendarIdFromLegacy(source) };
  merged.app_name = normalizeAppName(merged.app_name);
  return merged;
}

function cacheSettings(next: GoogleIntegrationSettings) {
  settingsCache = next;
  writeJson(SETTINGS_KEY, next);
}

function readLocalSettings(): GoogleIntegrationSettings {
  const current = readJson<Partial<GoogleIntegrationSettings> | null>(SETTINGS_KEY, null);
  if (current) return mergeSettings(current);
  return mergeSettings(readJson<Partial<GoogleIntegrationSettings> | null>(LEGACY_SETTINGS_KEY, null));
}

export function loadSettings(): GoogleIntegrationSettings {
  if (settingsCache) return settingsCache;
  settingsCache = readLocalSettings();
  return settingsCache;
}

async function requestSettings(method: 'GET' | 'PUT', body?: GoogleIntegrationSettings) {
  const response = await fetch('/api/settings', {
    method,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    persisted?: boolean;
    settings?: Partial<GoogleIntegrationSettings>;
  };
  if (!response.ok) throw new Error(data.error || '設定の保存に失敗しました。');
  return data;
}

export async function hydrateSettings(): Promise<GoogleIntegrationSettings> {
  try {
    const remote = await requestSettings('GET');
    if (remote.settings) {
      cacheSettings(mergeSettings(remote.settings));
      notifySettings();
      return loadSettings();
    }
  } catch {
    /* サーバー未起動時は端末のキャッシュを使う */
  }
  return loadSettings();
}

export async function saveSettings(patch: Partial<GoogleIntegrationSettings>): Promise<GoogleIntegrationSettings> {
  const current = loadSettings();
  const next = {
    ...current,
    ...patch,
    id: 1,
    updated_at: new Date().toISOString(),
  };
  cacheSettings(next);
  notifySettings();
  try {
    const saved = await requestSettings('PUT', next);
    cacheSettings(mergeSettings(saved.settings));
    notifySettings();
  } catch (error) {
    throw error instanceof Error ? error : new Error('設定の保存に失敗しました。');
  }
  return loadSettings();
}

type CalendarSyncMeta = {
  calendarId: string;
  syncToken: string | null;
};

export function loadCalendarSyncMeta(): CalendarSyncMeta {
  const current = readJson<CalendarSyncMeta | null>(CALENDAR_SYNC_META_KEY, null);
  if (current) return current;
  return readJson<CalendarSyncMeta>(LEGACY_CALENDAR_SYNC_META_KEY, { calendarId: '', syncToken: null });
}

export function saveCalendarSyncMeta(calendarId: string, syncToken: string | null) {
  writeJson(CALENDAR_SYNC_META_KEY, { calendarId, syncToken });
}

type DeferredConflict = {
  taskId: string;
  googleKey: string;
};

function googleKey(snapshot: import('@/types').CalendarTimeSnapshot) {
  return JSON.stringify(snapshot);
}

export function loadDeferredConflicts(): DeferredConflict[] {
  const current = readJson<DeferredConflict[] | null>(DEFERRED_CONFLICTS_KEY, null);
  if (current) return current;
  return readJson<DeferredConflict[]>(LEGACY_DEFERRED_CONFLICTS_KEY, []);
}

export function deferCalendarConflict(taskId: string, google: import('@/types').CalendarTimeSnapshot) {
  const next = loadDeferredConflicts().filter((item) => item.taskId !== taskId);
  next.push({ taskId, googleKey: googleKey(google) });
  writeJson(DEFERRED_CONFLICTS_KEY, next);
}

export function clearDeferredConflict(taskId: string) {
  writeJson(
    DEFERRED_CONFLICTS_KEY,
    loadDeferredConflicts().filter((item) => item.taskId !== taskId)
  );
}

export function isDeferredConflict(taskId: string, google: import('@/types').CalendarTimeSnapshot) {
  const key = googleKey(google);
  return loadDeferredConflicts().some((item) => item.taskId === taskId && item.googleKey === key);
}
