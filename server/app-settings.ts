import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type AppSettingsRecord = {
  google_calendar_id: string | null;
  invoice_template_ext_tax_url: string | null;
  invoice_template_int_tax_url: string | null;
  invoice_template_detail_ext_tax_url: string | null;
  invoice_template_detail_int_tax_url: string | null;
  invoice_pdf_drive_folder_url: string | null;
  gmail_sender_email: string | null;
  data_spreadsheet_url: string | null;
  app_name: string | null;
  app_tagline: string | null;
  app_footer: string | null;
  custom_task_types: string | null;
  custom_positions: string | null;
  created_at: string;
  updated_at: string;
};

const SETTING_KEYS: (keyof AppSettingsRecord)[] = [
  'google_calendar_id',
  'invoice_template_ext_tax_url',
  'invoice_template_int_tax_url',
  'invoice_template_detail_ext_tax_url',
  'invoice_template_detail_int_tax_url',
  'invoice_pdf_drive_folder_url',
  'gmail_sender_email',
  'data_spreadsheet_url',
  'app_name',
  'app_tagline',
  'app_footer',
  'custom_task_types',
  'custom_positions',
  'created_at',
  'updated_at',
];

function emptySettings(): AppSettingsRecord {
  const now = new Date().toISOString();
  return {
    google_calendar_id: null,
    invoice_template_ext_tax_url: null,
    invoice_template_int_tax_url: null,
    invoice_template_detail_ext_tax_url: null,
    invoice_template_detail_int_tax_url: null,
    invoice_pdf_drive_folder_url: null,
    gmail_sender_email: null,
    data_spreadsheet_url: null,
    app_name: null,
    app_tagline: null,
    app_footer: null,
    custom_task_types: null,
    custom_positions: null,
    created_at: now,
    updated_at: now,
  };
}

function hereDir() {
  return dirname(fileURLToPath(import.meta.url));
}

function settingsPath(env: Record<string, string>) {
  return resolve(env.SETTINGS_FILE || resolve(process.cwd(), 'data', 'app-settings.json'));
}

function defaultSettingsCandidates(env: Record<string, string>) {
  const here = hereDir();
  return [
    env.SETTINGS_DEFAULTS_FILE,
    resolve(process.cwd(), 'defaults', 'app-settings.json'),
    resolve(here, 'app-settings.default.json'),
    resolve(here, '..', 'defaults', 'app-settings.json'),
  ].filter((value): value is string => Boolean(value));
}

function asText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value);
  return text.length ? text : null;
}

function calendarIdFromInput(raw: string | null): string | null {
  const value = (raw || '').trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    const cid = url.searchParams.get('cid') || url.searchParams.get('src');
    return cid ? decodeURIComponent(cid) : value;
  } catch {
    return value;
  }
}

function parseSpreadsheetId(raw: string | null | undefined) {
  const value = (raw || '').trim();
  if (!value) return '';
  const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(value)) return value;
  return '';
}

function spreadsheetUrlFromId(id: string) {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

function pickSettings(raw: unknown, fallback: AppSettingsRecord): AppSettingsRecord {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const next = { ...fallback };
  for (const key of SETTING_KEYS) {
    if (key === 'created_at' || key === 'updated_at') {
      if (typeof source[key] === 'string' && source[key]) next[key] = source[key] as string;
      continue;
    }
    if (key in source) next[key] = asText(source[key]);
  }
  if (!next.google_calendar_id) {
    next.google_calendar_id = calendarIdFromInput(asText(source.google_calendar_url));
  } else {
    next.google_calendar_id = calendarIdFromInput(next.google_calendar_id);
  }
  return next;
}

function hasSharedValues(settings: AppSettingsRecord) {
  return Boolean(
    settings.data_spreadsheet_url ||
      settings.google_calendar_id ||
      settings.invoice_template_ext_tax_url ||
      settings.invoice_template_int_tax_url ||
      settings.invoice_template_detail_ext_tax_url ||
      settings.invoice_template_detail_int_tax_url ||
      settings.invoice_pdf_drive_folder_url ||
      settings.gmail_sender_email ||
      settings.custom_task_types ||
      settings.custom_positions ||
      settings.app_name ||
      settings.app_tagline ||
      settings.app_footer
  );
}

function readJsonFile(filePath: string): unknown | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function applyEnvFallback(settings: AppSettingsRecord, env: Record<string, string>) {
  if (settings.data_spreadsheet_url) return settings;
  const id = parseSpreadsheetId(env.GOOGLE_SPREADSHEET_ID);
  if (id) settings.data_spreadsheet_url = spreadsheetUrlFromId(id);
  return settings;
}

function loadDefaultSettings(env: Record<string, string>): AppSettingsRecord | null {
  for (const candidate of defaultSettingsCandidates(env)) {
    const parsed = readJsonFile(candidate);
    if (parsed) return pickSettings(parsed, emptySettings());
  }
  return null;
}

function persistSettings(filePath: string, settings: AppSettingsRecord) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

export function readAppSettings(env: Record<string, string>): { persisted: boolean; settings: AppSettingsRecord } {
  const filePath = settingsPath(env);
  const stored = readJsonFile(filePath);
  let settings = stored ? pickSettings(stored, emptySettings()) : emptySettings();
  let persisted = Boolean(stored) && hasSharedValues(settings);

  if (!persisted) {
    const seeded = loadDefaultSettings(env);
    if (seeded && hasSharedValues(seeded)) {
      const now = new Date().toISOString();
      settings = {
        ...seeded,
        created_at: settings.created_at || seeded.created_at || now,
        updated_at: settings.updated_at || seeded.updated_at || now,
      };
      persistSettings(filePath, settings);
      persisted = true;
    }
  }

  settings = applyEnvFallback(settings, env);
  return { persisted, settings };
}

export function writeAppSettings(env: Record<string, string>, patch: unknown): AppSettingsRecord {
  const current = readAppSettings(env);
  const now = new Date().toISOString();
  const next = pickSettings(patch, {
    ...current.settings,
    created_at: current.settings.created_at || now,
    updated_at: now,
  });
  next.updated_at = now;
  if (!current.persisted) next.created_at = now;
  persistSettings(settingsPath(env), next);
  return next;
}
