import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { JWT } from 'google-auth-library';
import { recoverInvoicePdfSheets, renderInvoicePdf, saveInvoicePdfToDrive, findDriveFileInFolder, type InvoicePdfRequest } from './invoice-pdf';
import { createInvoiceGmailDraft, MISSING_GMAIL_SENDER_MESSAGE, type InvoiceGmailDraftInput } from './gmail-draft';
import { inspectCalendar, pullCalendarChanges, pushTaskToCalendar } from './calendar';
import { SHEETS, type SheetKey } from './schema';
import { readAppSettings, writeAppSettings } from './app-settings';
import {
  createRow,
  databasePath,
  databaseReady,
  deleteRow,
  listRows,
  openDatabase,
  reorderClients,
  reorderUnitPrices,
  replaceAllRows,
  replaceInvoiceItems,
  updateRow,
  upsertRows,
  validateForeignKeys,
  type UpsertSummary,
} from './db';
import { prepareWorkspaceSheets, readSheetRows, writeSheetRows } from './google-sheets-io';
import type { Row } from './sheet-values';

type Env = Record<string, string>;

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/calendar',
];

const IMPORT_ORDER: SheetKey[] = ['clients', 'projects', 'tasks', 'unit_prices', 'invoices', 'invoice_items'];

function parseSpreadsheetId(raw: string) {
  const value = raw.trim();
  if (!value) return '';
  const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(value)) return value;
  return '';
}

function spreadsheetUrl(id: string) {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
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
    throw new Error(
      'Google APIに接続できません。.env にサービスアカウント（GOOGLE_SERVICE_ACCOUNT_JSON、または GOOGLE_SERVICE_ACCOUNT_EMAIL と GOOGLE_PRIVATE_KEY）を設定してください。'
    );
  }
  return { email, privateKey };
}

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function createSheetsApi(env: Env) {
  let auth: JWT | null = null;
  let accountEmail = '';
  let authScopeKey = '';
  let googleQueue = Promise.resolve();
  let dbBoot: Promise<void> | null = null;

  const ensureDb = async () => {
    if (!dbBoot) dbBoot = openDatabase(env).then(() => undefined);
    await dbBoot;
  };

  const connectAuth = async () => {
    const sa = serviceAccount(env);
    accountEmail = sa.email;
    const scopeKey = SCOPES.join(' ');
    if (auth && authScopeKey === scopeKey) return;
    authScopeKey = scopeKey;
    auth = new JWT({ email: sa.email, key: sa.privateKey, scopes: SCOPES });
  };

  const token = async () => {
    await connectAuth();
    const access = await auth!.getAccessToken();
    if (!access.token) {
      await auth!.authorize();
      const again = await auth!.getAccessToken();
      if (!again.token) throw new Error('Google APIのアクセストークンを取得できませんでした。');
      return again.token;
    }
    return access.token;
  };

  const workspaceSpreadsheetId = (overrideId?: string) => {
    const stored = parseSpreadsheetId(readAppSettings(env).settings.data_spreadsheet_url || '');
    const id = parseSpreadsheetId(overrideId || '') || stored || env.GOOGLE_SPREADSHEET_ID?.trim() || '';
    if (!id) {
      throw new Error(
        '作業用スプレッドシートのURLがありません。設定にスプレッドシートのURLを貼って保存してください。'
      );
    }
    return id;
  };

  const withGoogle = <T>(fn: () => Promise<T>) => {
    const start = async () => {
      await connectAuth();
      return fn();
    };
    const run = googleQueue.then(start, start);
    googleQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };

  const withPdfWorkspace = <T>(overrideId: string | undefined, fn: (spreadsheetId: string) => Promise<T>) =>
    withGoogle(async () => {
      const spreadsheetId = workspaceSpreadsheetId(overrideId);
      await recoverInvoicePdfSheets({
        getToken: token,
        destinationSpreadsheetId: spreadsheetId,
        serviceAccountEmail: accountEmail,
      });
      return fn(spreadsheetId);
    });

  const list = async (key: SheetKey) => {
    await ensureDb();
    return listRows(key);
  };

  const create = async (key: SheetKey, input: Row) => {
    await ensureDb();
    return createRow(key, input);
  };

  const update = async (key: SheetKey, id: string, patch: Row) => {
    await ensureDb();
    return updateRow(key, id, patch);
  };

  const remove = async (key: SheetKey, id: string) => {
    await ensureDb();
    deleteRow(key, id);
  };

  const importFromSheets = async (spreadsheetId: string, mode: 'upsert' | 'replace_all') => {
    await ensureDb();
    const access = await token();
    const summaries: UpsertSummary[] = [];
    for (const key of IMPORT_ORDER) {
      const rows = await readSheetRows(spreadsheetId, access, key);
      summaries.push(mode === 'replace_all' ? replaceAllRows(key, rows) : upsertRows(key, rows));
    }
    const fkWarnings = validateForeignKeys();
    const inserted = summaries.reduce((sum, item) => sum + item.inserted, 0);
    const updated = summaries.reduce((sum, item) => sum + item.updated, 0);
    const skipped = summaries.reduce((sum, item) => sum + item.skipped, 0);
    const warnings = [...summaries.flatMap((item) => item.warnings), ...fkWarnings];
    return { ok: true as const, mode, inserted, updated, skipped, warnings, tables: summaries };
  };

  const exportToSheets = async (spreadsheetId: string) => {
    await ensureDb();
    const access = await token();
    await prepareWorkspaceSheets(spreadsheetId, access);
    for (const key of IMPORT_ORDER) {
      await writeSheetRows(spreadsheetId, access, key, listRows(key));
    }
    return {
      ok: true as const,
      spreadsheetId,
      url: spreadsheetUrl(spreadsheetId),
      sheets: SHEETS.map((sheet) => sheet.title),
      counts: Object.fromEntries(IMPORT_ORDER.map((key) => [key, listRows(key).length])),
    };
  };

  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      next();
      return;
    }

    const requestSheetId = parseSpreadsheetId(String(req.headers['x-spreadsheet-id'] || ''));

    try {
      await ensureDb();

      if (req.method === 'GET' && url.pathname === '/api/health') {
        let googleOk = true;
        let googleError = '';
        try {
          await connectAuth();
        } catch (error) {
          googleOk = false;
          googleError = error instanceof Error ? error.message : 'サービスアカウントに接続できません。';
        }
        const storedSheetId = parseSpreadsheetId(readAppSettings(env).settings.data_spreadsheet_url || '');
        const envId = env.GOOGLE_SPREADSHEET_ID?.trim() || '';
        const id = requestSheetId || storedSheetId || envId;
        send(res, 200, {
          ok: databaseReady(),
          databasePath: databasePath(env),
          serviceAccountEmail: googleOk ? accountEmail : '',
          spreadsheetId: id || null,
          spreadsheetUrl: id ? spreadsheetUrl(id) : null,
          googleOk,
          error: googleOk ? null : googleError,
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/settings') {
        const stored = readAppSettings(env);
        send(res, 200, {
          persisted: true,
          settings: { id: 1, ...stored.settings },
        });
        return;
      }

      if ((req.method === 'PUT' || req.method === 'POST') && url.pathname === '/api/settings') {
        const body = JSON.parse((await readBody(req)) || '{}') as unknown;
        const settings = writeAppSettings(env, body);
        send(res, 200, { persisted: true, settings: { id: 1, ...settings } });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/postal') {
        const zip = (url.searchParams.get('zip') || '').replace(/\D/g, '');
        if (zip.length !== 7) {
          send(res, 400, { error: '郵便番号は7桁で入力してください。' });
          return;
        }
        const response = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`);
        const data = (await response.json()) as {
          status?: number;
          message?: string | null;
          results?: { address1?: string; address2?: string; address3?: string }[] | null;
        };
        const hit = data.results?.[0];
        const address = [hit?.address1, hit?.address2, hit?.address3].filter(Boolean).join('');
        if (!address) {
          send(res, 404, { error: '該当する住所が見つかりません。' });
          return;
        }
        send(res, 200, { address });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/sheets/create') {
        try {
          await readBody(req);
          const spreadsheetId = workspaceSpreadsheetId(requestSheetId);
          const prepared = await withGoogle(async () => prepareWorkspaceSheets(spreadsheetId, await token()));
          send(res, 200, { ...prepared, url: spreadsheetUrl(spreadsheetId) });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'シートと項目名の作成に失敗しました。';
          send(res, 500, { error: message });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/sheets/import') {
        const body = JSON.parse((await readBody(req)) || '{}') as {
          spreadsheetUrl?: string;
          mode?: 'upsert' | 'replace_all';
        };
        const mode = body.mode === 'replace_all' ? 'replace_all' : 'upsert';
        const spreadsheetId =
          parseSpreadsheetId(body.spreadsheetUrl || '') || workspaceSpreadsheetId(requestSheetId);
        try {
          const result = await withGoogle(() => importFromSheets(spreadsheetId, mode));
          send(res, 200, result);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'インポートに失敗しました。';
          send(res, 500, { error: message });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/sheets/export') {
        const body = JSON.parse((await readBody(req)) || '{}') as { spreadsheetUrl?: string };
        const spreadsheetId =
          parseSpreadsheetId(body.spreadsheetUrl || '') || workspaceSpreadsheetId(requestSheetId);
        try {
          const result = await withGoogle(() => exportToSheets(spreadsheetId));
          send(res, 200, result);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'エクスポートに失敗しました。';
          send(res, 500, { error: message });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/invoices/pdf') {
        const body = JSON.parse((await readBody(req)) || '{}') as InvoicePdfRequest;
        const pdf = await withPdfWorkspace(requestSheetId, async (spreadsheetId) =>
          renderInvoicePdf({
            getToken: token,
            destinationSpreadsheetId: spreadsheetId,
            serviceAccountEmail: accountEmail,
            input: body,
          })
        );
        send(res, 200, {
          filename: pdf.filename,
          pdfBase64: pdf.bytes.toString('base64'),
          driveSaved: false,
          driveError: null,
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/invoices/pdf/drive/check') {
        const body = JSON.parse((await readBody(req)) || '{}') as {
          folderUrl?: string;
          filename?: string;
        };
        const folderUrl = body.folderUrl?.trim() || '';
        const filename = body.filename?.trim() || '請求書.pdf';
        if (!folderUrl) {
          send(res, 400, { error: '設定にPDFの保存先フォルダURLがありません。' });
          return;
        }
        try {
          await connectAuth();
          const checked = await findDriveFileInFolder({
            getToken: token,
            folderUrl,
            filename,
            serviceAccountEmail: accountEmail,
          });
          send(res, 200, {
            exists: Boolean(checked.existingId),
            fileId: checked.existingId || null,
            filename: checked.filename,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Googleドライブの確認に失敗しました。';
          send(res, 500, { error: message });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/invoices/pdf/drive') {
        const body = JSON.parse((await readBody(req)) || '{}') as {
          folderUrl?: string;
          filename?: string;
          pdfBase64?: string;
          mode?: 'create' | 'overwrite';
        };
        const folderUrl = body.folderUrl?.trim() || '';
        const filename = body.filename?.trim() || '請求書.pdf';
        const pdfBase64 = body.pdfBase64 || '';
        const mode = body.mode === 'overwrite' ? 'overwrite' : 'create';
        if (!folderUrl) {
          send(res, 400, { error: '設定にPDFの保存先フォルダURLがありません。' });
          return;
        }
        if (!pdfBase64) {
          send(res, 400, { error: '保存するPDFがありません。' });
          return;
        }
        try {
          await connectAuth();
          const bytes = Buffer.from(pdfBase64, 'base64');
          if (!bytes.length) {
            send(res, 400, { error: '保存するPDFがありません。' });
            return;
          }
          const fileId = await saveInvoicePdfToDrive({
            getToken: token,
            folderUrl,
            filename,
            bytes,
            serviceAccountEmail: accountEmail,
            mode,
          });
          console.info('[invoice-pdf-drive] saved', { fileId, filename, folderUrl, mode });
          send(res, 200, { ok: true, fileId, filename });
        } catch (error) {
          const err = error as Error & { code?: string; fileId?: string };
          if (err.code === 'FILE_EXISTS') {
            send(res, 409, { error: err.message, exists: true, fileId: err.fileId || null, filename });
            return;
          }
          const message = error instanceof Error ? error.message : 'Googleドライブへの保存に失敗しました。';
          console.error('[invoice-pdf-drive] failed', message);
          send(res, 500, { error: message });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/invoices/gmail-draft') {
        const body = JSON.parse((await readBody(req)) || '{}') as InvoiceGmailDraftInput;
        const senderEmail = readAppSettings(env).settings.gmail_sender_email?.trim() || '';
        if (!senderEmail) {
          send(res, 400, { error: MISSING_GMAIL_SENDER_MESSAGE });
          return;
        }
        try {
          const sa = serviceAccount(env);
          const created = await createInvoiceGmailDraft({
            serviceAccountEmail: sa.email,
            privateKey: sa.privateKey,
            senderEmail,
            input: body,
          });
          send(res, 200, { ok: true, ...created });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Gmail下書きの作成に失敗しました。';
          const status = message === MISSING_GMAIL_SENDER_MESSAGE ? 400 : 500;
          send(res, status, { error: message });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/calendar/push') {
        const body = JSON.parse((await readBody(req)) || '{}') as {
          calendarId?: string;
          taskId?: string;
          deleteEvent?: boolean;
        };
        const calendarId = body.calendarId?.trim() || '';
        const taskId = body.taskId?.trim() || '';
        if (!calendarId) {
          send(res, 200, { skipped: true });
          return;
        }
        if (!taskId) {
          send(res, 400, { error: 'スケジュールIDがありません。' });
          return;
        }
        try {
          await connectAuth();
          const result = await pushTaskToCalendar(
            {
              getToken: token,
              serviceAccountEmail: accountEmail,
              list,
              update,
            },
            calendarId,
            taskId,
            { deleteEvent: Boolean(body.deleteEvent) }
          );
          send(res, 200, result);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Googleカレンダーとの同期に失敗しました。';
          console.error('[calendar-push]', message);
          send(res, 200, { error: message });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/calendar/status') {
        const body = JSON.parse((await readBody(req)) || '{}') as { calendarId?: string };
        const calendarId = body.calendarId?.trim() || '';
        if (!calendarId) {
          send(res, 200, { error: 'カレンダーIDがありません。' });
          return;
        }
        try {
          await connectAuth();
          const result = await inspectCalendar(
            {
              getToken: token,
              serviceAccountEmail: accountEmail,
              list,
              update,
            },
            calendarId
          );
          send(res, 200, result);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'カレンダーの確認に失敗しました。';
          send(res, 200, { error: message });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/calendar/pull') {
        const body = JSON.parse((await readBody(req)) || '{}') as {
          calendarId?: string;
          syncToken?: string | null;
        };
        const calendarId = body.calendarId?.trim() || '';
        if (!calendarId) {
          send(res, 200, { skipped: true, conflicts: [], applied: { deleted: 0, updated: 0 }, syncToken: null });
          return;
        }
        try {
          await connectAuth();
          const result = await pullCalendarChanges(
            {
              getToken: token,
              serviceAccountEmail: accountEmail,
              list,
              update,
            },
            calendarId,
            body.syncToken || null
          );
          send(res, 200, result);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Googleカレンダーとの同期に失敗しました。';
          console.error('[calendar-pull]', message);
          send(res, 200, { error: message, conflicts: [], applied: { deleted: 0, updated: 0 }, syncToken: null });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/sheets/invoice_items/replace') {
        const body = JSON.parse((await readBody(req)) || '{}') as { invoice_id?: string; items?: Row[] };
        if (!body.invoice_id) {
          send(res, 400, { error: '請求書IDがありません。' });
          return;
        }
        replaceInvoiceItems(body.invoice_id, body.items || []);
        send(res, 200, { ok: true });
        return;
      }

      if (
        req.method === 'POST' &&
        (url.pathname === '/api/sheets/unit_prices/reorder' || url.pathname === '/api/sheets/clients/reorder')
      ) {
        const body = JSON.parse((await readBody(req)) || '{}') as { ids?: string[] };
        if (!Array.isArray(body.ids) || body.ids.length === 0) {
          send(res, 400, { error: '並び順がありません。' });
          return;
        }
        send(
          res,
          200,
          url.pathname.endsWith('/clients/reorder') ? reorderClients(body.ids) : reorderUnitPrices(body.ids)
        );
        return;
      }

      const match = url.pathname.match(
        /^\/api\/sheets\/(clients|projects|tasks|unit_prices|invoices|invoice_items)(?:\/([^/]+))?$/
      );
      if (!match) {
        send(res, 404, { error: 'Not found' });
        return;
      }
      const key = match[1] as SheetKey;
      const id = match[2] ? decodeURIComponent(match[2]) : '';

      if (req.method === 'GET' && !id) {
        send(res, 200, await list(key));
        return;
      }
      if (req.method === 'POST' && !id) {
        const body = JSON.parse((await readBody(req)) || '{}') as Row;
        send(res, 200, await create(key, body));
        return;
      }
      if (req.method === 'PATCH' && id) {
        const body = JSON.parse((await readBody(req)) || '{}') as Row;
        send(res, 200, await update(key, id, body));
        return;
      }
      if (req.method === 'DELETE' && id) {
        await remove(key, id);
        send(res, 200, { ok: true });
        return;
      }
      send(res, 405, { error: 'Method not allowed' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'API error';
      send(res, 500, { error: message });
    }
  };
}
