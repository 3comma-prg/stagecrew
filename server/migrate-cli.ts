import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JWT } from 'google-auth-library';
import { openDatabase, upsertRows, validateForeignKeys, listRows, databasePath } from './db';
import { readSheetRows } from './google-sheets-io';
import { SHEETS, type SheetKey } from './schema';
import { readAppSettings } from './app-settings';

type Env = Record<string, string>;

const IMPORT_ORDER: SheetKey[] = ['clients', 'projects', 'tasks', 'unit_prices', 'invoices', 'invoice_items'];

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
];

function loadDotEnv(): Env {
  const env: Env = { ...process.env } as Env;
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (env[key] == null || env[key] === '') env[key] = value;
  }
  return env;
}

function parseSpreadsheetId(raw: string) {
  const value = raw.trim();
  if (!value) return '';
  const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(value)) return value;
  return '';
}

function serviceAccount(env: Env) {
  const jsonValue = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  let email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() || '';
  let privateKey = (env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (jsonValue) {
    const parsed = jsonValue.startsWith('{')
      ? JSON.parse(jsonValue)
      : JSON.parse(readFileSync(jsonValue, 'utf8'));
    email = parsed.client_email || email;
    privateKey = parsed.private_key || privateKey;
  }
  if (!email || !privateKey) {
    throw new Error('サービスアカウントが設定されていません。.env を確認してください。');
  }
  return { email, privateKey };
}

async function main() {
  const env = loadDotEnv();
  const argId = parseSpreadsheetId(process.argv[2] || '');
  const settingsId = parseSpreadsheetId(readAppSettings(env).settings.data_spreadsheet_url || '');
  const spreadsheetId = argId || settingsId || env.GOOGLE_SPREADSHEET_ID?.trim() || '';
  if (!spreadsheetId) {
    throw new Error(
      '移行元スプレッドシートがありません。引数でID/URLを渡すか、設定・GOOGLE_SPREADSHEET_ID を指定してください。'
    );
  }

  console.log('[migrate] database:', databasePath(env));
  console.log('[migrate] spreadsheet:', spreadsheetId);
  await openDatabase(env);

  const sa = serviceAccount(env);
  const auth = new JWT({ email: sa.email, key: sa.privateKey, scopes: SCOPES });
  const access = await auth.getAccessToken();
  if (!access.token) throw new Error('アクセストークンを取得できませんでした。');

  let inserted = 0;
  let updated = 0;
  const warnings: string[] = [];
  for (const key of IMPORT_ORDER) {
    const rows = await readSheetRows(spreadsheetId, access.token, key);
    const summary = upsertRows(key, rows);
    inserted += summary.inserted;
    updated += summary.updated;
    warnings.push(...summary.warnings);
    console.log(
      `[migrate] ${SHEETS.find((sheet) => sheet.key === key)?.title || key}: read ${rows.length}, inserted ${summary.inserted}, updated ${summary.updated}`
    );
  }
  warnings.push(...validateForeignKeys());
  console.log('[migrate] totals:', { inserted, updated });
  for (const key of IMPORT_ORDER) {
    console.log(`[migrate] db count ${key}:`, listRows(key).length);
  }
  if (warnings.length) {
    console.log('[migrate] warnings:');
    for (const warning of warnings) console.log(' -', warning);
  }
  console.log('[migrate] done (idempotent upsert). Re-run safely anytime.');
}

main().catch((error) => {
  console.error('[migrate] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
