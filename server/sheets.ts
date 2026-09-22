import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { JWT } from 'google-auth-library';
import { recoverInvoicePdfSheets, renderInvoicePdf, saveInvoicePdfToDrive, findDriveFileInFolder, type InvoicePdfRequest } from './invoice-pdf';
import { createInvoiceGmailDraft, MISSING_GMAIL_SENDER_MESSAGE, type InvoiceGmailDraftInput } from './gmail-draft';
import { inspectCalendar, pullCalendarChanges, pushTaskToCalendar } from './calendar';
import { SHEETS, SHEET_BY_KEY, labelFor, valueFor, type Column, type SheetKey, type SheetSpec } from './schema';
import { readAppSettings, writeAppSettings } from './app-settings';

type Env = Record<string, string>;
type Row = Record<string, string | number | boolean | null> & { cells?: unknown[] };

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/calendar',
];

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
      'Googleスプレッドシートに接続できません。.env にサービスアカウント（GOOGLE_SERVICE_ACCOUNT_JSON、または GOOGLE_SERVICE_ACCOUNT_EMAIL と GOOGLE_PRIVATE_KEY）を設定してください。'
    );
  }
  return { email, privateKey };
}

function credentials(env: Env, overrideId?: string) {
  const sa = serviceAccount(env);
  const spreadsheetId = parseSpreadsheetId(overrideId || '') || env.GOOGLE_SPREADSHEET_ID?.trim() || '';
  if (!spreadsheetId) {
    throw new Error(
      'データ用スプレッドシートのURLがありません。設定に空のスプレッドシートのURLを貼ってから、新規作成してください。'
    );
  }
  return { ...sa, spreadsheetId };
}

function quoteTitle(title: string) {
  return `'${title.replace(/'/g, "''")}'`;
}

function a1Column(index: number) {
  let n = index + 1;
  let label = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

function parseBoolean(value: unknown, fallback: boolean) {
  if (value == null || value === '') return fallback;
  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'はい', 'y'].includes(text)) return true;
  if (['false', '0', 'no', 'いいえ', 'n'].includes(text)) return false;
  return fallback;
}

function parseDomestic(value: unknown, fallback: boolean) {
  if (value == null || value === '') return fallback;
  const text = String(value).trim().toLowerCase();
  if (['国内', 'true', '1', 'yes', 'はい'].includes(text)) return true;
  if (['海外', 'false', '0', 'no', 'いいえ'].includes(text)) return false;
  return fallback;
}

function serialToDate(serial: number) {
  const utc = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
  return new Date(utc).toISOString().slice(0, 10);
}

function serialToTime(serial: number) {
  const minutes = Math.round((serial % 1) * 24 * 60);
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function parseDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return serialToDate(value);
  const text = String(value).trim();
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  return text || null;
}

function parseTime(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return serialToTime(value);
  const text = String(value).trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return text || null;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function parseNumber(value: unknown, fallback: number | null) {
  if (value == null || value === '') return fallback;
  const number = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(number) ? number : fallback;
}

function parseCell(column: Column, value: unknown) {
  if (column.type === 'boolean') return parseBoolean(value, Boolean(column.fallback));
  if (column.type === 'domestic') return parseDomestic(value, column.fallback !== false);
  if (column.type === 'number') return parseNumber(value, (column.fallback as number | null) ?? null);
  if (column.type === 'date') return parseDate(value);
  if (column.type === 'time') return parseTime(value);
  if (value == null || value === '') return column.fallback === undefined ? null : column.fallback;
  const text = String(value).trim();
  return valueFor(column.key, text) || (column.fallback ?? null);
}

function formatCell(column: Column, value: unknown) {
  if (value == null || value === '') return '';
  if (column.type === 'boolean') return value ? 'はい' : 'いいえ';
  if (column.type === 'domestic') return value ? '国内' : '海外';
  if (column.type === 'number') return value;
  if (column.key === 'status' || column.key === 'time_type' || column.key === 'billing_status' || column.key === 'tax_type') {
    return labelFor(column.key, value);
  }
  return String(value);
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
  let spreadsheetId = '';
  let queue = Promise.resolve();
  const sheetIds = new Map<string, number>();

  const locked = <T>(fn: () => Promise<T>, overrideId?: string) => {
    const start = async () => {
      await connect(overrideId);
      await recoverInvoicePdfSheets({
        getToken: token,
        destinationSpreadsheetId: spreadsheetId,
        serviceAccountEmail: accountEmail,
      });
      return fn();
    };
    const run = queue.then(start, start);
    queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };

  let accountEmail = '';
  let authScopeKey = '';
  const connectAuth = async () => {
    const sa = serviceAccount(env);
    accountEmail = sa.email;
    const scopeKey = SCOPES.join(' ');
    if (auth && authScopeKey === scopeKey) return;
    authScopeKey = scopeKey;
    auth = new JWT({ email: sa.email, key: sa.privateKey, scopes: SCOPES });
  };

  const connect = async (overrideId?: string) => {
    const creds = credentials(env, overrideId);
    if (spreadsheetId !== creds.spreadsheetId) {
      spreadsheetId = creds.spreadsheetId;
      sheetIds.clear();
    } else {
      spreadsheetId = creds.spreadsheetId;
    }
    accountEmail = creds.email;
    await connectAuth();
  };

  const token = async () => {
    await connectAuth();
    // Force a fresh access token so Drive write scope is included after server reloads.
    const access = await auth!.getAccessToken();
    if (!access.token) {
      await auth!.authorize();
      const again = await auth!.getAccessToken();
      if (!again.token) throw new Error('Google APIのアクセストークンを取得できませんでした。');
      return again.token;
    }
    return access.token;
  };

  const sheetsFetch = async (path: string, init: RequestInit = {}) => {
    const access = await token();
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${access}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    if (!response.ok) {
      const detail = await response.text();
      if (response.status === 403 || response.status === 404) {
        throw new Error(
          'スプレッドシートを開けません。IDを確認し、サービスアカウントのメールアドレスに編集者権限を共有してください。'
        );
      }
      throw new Error(`Google Sheets API error (${response.status}): ${detail.slice(0, 300)}`);
    }
    if (response.status === 204) return null;
    return response.json();
  };

  const loadSheetIds = async () => {
    const meta = (await sheetsFetch('?fields=sheets.properties')) as {
      sheets?: { properties: { sheetId: number; title: string } }[];
    };
    sheetIds.clear();
    for (const sheet of meta.sheets || []) {
      sheetIds.set(sheet.properties.title, sheet.properties.sheetId);
    }
  };

  const ensureSheet = async (spec: SheetSpec) => {
    if (sheetIds.size === 0) await loadSheetIds();
    if (sheetIds.has(spec.title)) return;
    await sheetsFetch(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: spec.title } } }] }),
    });
    await loadSheetIds();
    const sheetId = sheetIds.get(spec.title);
    if (sheetId == null) return;
    await sheetsFetch(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 1, endRowIndex: 2000, startColumnIndex: 0, endColumnIndex: spec.columns.length },
              cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
              fields: 'userEnteredFormat.numberFormat',
            },
          },
          {
            updateSheetProperties: {
              properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
              fields: 'gridProperties.frozenRowCount',
            },
          },
        ],
      }),
    });
  };

  const readGrid = async (spec: SheetSpec) => {
    await ensureSheet(spec);
    const range = encodeURIComponent(`${quoteTitle(spec.title)}!A:ZZ`);
    const data = (await sheetsFetch(`/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`)) as {
      values?: unknown[][];
    };
    const values = data.values || [];
    const headers = (values[0] || []).map((cell) => String(cell || '').trim());
    const columnByName = new Map<string, Column>();
    for (const column of spec.columns) {
      for (const name of [column.header, column.key, ...(column.aliases || [])]) {
        if (!columnByName.has(name)) columnByName.set(name, column);
      }
    }
    const mapHeaders = (names: string[]) => {
      const used = new Set<string>();
      return names.map((header) => {
        const column = columnByName.get(header);
        if (!column || used.has(column.key)) return null;
        used.add(column.key);
        return column;
      });
    };
    let sheetHeaders = headers;
    let indexes = mapHeaders(headers);
    if (headers.length === 0 || indexes.every((column) => !column)) {
      const nextHeaders = spec.columns.map((column) => column.header);
      await sheetsFetch(`/values/${encodeURIComponent(`${quoteTitle(spec.title)}!A1`)}?valueInputOption=RAW`, {
        method: 'PUT',
        body: JSON.stringify({ values: [nextHeaders] }),
      });
      return { headers: nextHeaders, columns: spec.columns, rows: [] as Row[], sheetRowNumbers: [] as number[] };
    }

    const missing = spec.columns.filter((column) => !indexes.some((current) => current?.key === column.key));
    if (missing.length > 0) {
      sheetHeaders = [...headers, ...missing.map((column) => column.header)];
      indexes = mapHeaders(sheetHeaders);
    }
    const canonical = indexes.map((column, index) => (column ? column.header : sheetHeaders[index] || ''));
    if (canonical.length !== headers.length || canonical.some((header, index) => header !== headers[index])) {
      await sheetsFetch(`/values/${encodeURIComponent(`${quoteTitle(spec.title)}!A1`)}?valueInputOption=RAW`, {
        method: 'PUT',
        body: JSON.stringify({ values: [canonical] }),
      });
    }

    const rows: Row[] = [];
    const sheetRowNumbers: number[] = [];
    const missingIds: { rowNumber: number; row: Row }[] = [];
    values.slice(1).forEach((cells, index) => {
      const row: Row = {};
      indexes.forEach((column, cellIndex) => {
        if (!column) return;
        row[column.key] = parseCell(column, cells[cellIndex]);
      });
      const hasData = spec.columns.some((column) => {
        if (column.key === 'id' || column.key === 'created_at') return false;
        const value = row[column.key];
        if (value == null || value === '' || value === column.fallback) return false;
        if (column.type === 'boolean' || column.type === 'domestic') return false;
        return true;
      });
      if (!hasData && !row.id) return;
      if (!row.id) {
        row.id = crypto.randomUUID();
        row.created_at = row.created_at || new Date().toISOString();
        missingIds.push({ rowNumber: index + 2, row });
      }
      row.cells = cells;
      rows.push(row);
      sheetRowNumbers.push(index + 2);
    });
    for (const pending of missingIds) {
      await writeRow(spec, pending.rowNumber, indexes, pending.row);
    }
    return { headers: indexes.map((column, index) => (column ? column.header : headers[index] || '')), columns: indexes, rows, sheetRowNumbers };
  };

  const rowValues = (columns: (Column | null)[], row: Row) =>
    columns.map((column, index) => (column ? formatCell(column, row[column.key]) : row.cells?.[index] ?? ''));

  const writeRow = async (spec: SheetSpec, rowNumber: number, columns: (Column | null)[], row: Row) => {
    const range = encodeURIComponent(`${quoteTitle(spec.title)}!A${rowNumber}`);
    await sheetsFetch(`/values/${range}?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ values: [rowValues(columns, row)] }),
    });
  };

  const publicRow = (row: Row) => {
    const { cells: _cells, ...rest } = row;
    return rest;
  };

  const list = async (key: SheetKey) => {
    const spec = SHEET_BY_KEY[key];
    if (!spec) throw new Error('不明なシートです。');
    const grid = await readGrid(spec);
    return grid.rows.map(publicRow);
  };

  const create = async (key: SheetKey, input: Row) => {
    const spec = SHEET_BY_KEY[key];
    const grid = await readGrid(spec);
    const now = new Date().toISOString();
    const row: Row = {};
    for (const column of spec.columns) {
      const value = input[column.key];
      row[column.key] = value === undefined ? parseCell(column, '') : value;
    }
    row.id = String(input.id || crypto.randomUUID());
    row.created_at = String(input.created_at || now);
    const nextRow = grid.sheetRowNumbers.length ? grid.sheetRowNumbers[grid.sheetRowNumbers.length - 1] + 1 : 2;
    const range = encodeURIComponent(`${quoteTitle(spec.title)}!A${nextRow}`);
    await sheetsFetch(`/values/${range}?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ values: [rowValues(grid.columns.length ? grid.columns : spec.columns, row)] }),
    });
    return publicRow(row);
  };

  const update = async (key: SheetKey, id: string, patch: Row) => {
    const spec = SHEET_BY_KEY[key];
    const grid = await readGrid(spec);
    const index = grid.rows.findIndex((row) => row.id === id);
    if (index < 0) throw new Error('対象の行が見つかりません。');
    const next = { ...grid.rows[index], ...patch, id, cells: grid.rows[index].cells };
    await writeRow(spec, grid.sheetRowNumbers[index], grid.columns, next);
    return publicRow(next);
  };

  const reorder = async (key: SheetKey, ids: string[]) => {
    const spec = SHEET_BY_KEY[key];
    const grid = await readGrid(spec);
    const columnIndex = grid.columns.findIndex((column) => column?.key === 'sort_order');
    if (columnIndex < 0) throw new Error('並び順の列がありません。');
    const orderById = new Map(ids.map((id, index) => [id, index]));
    const data = grid.rows.flatMap((row, index) => {
      const id = String(row.id || '');
      if (!orderById.has(id)) return [];
      const column = grid.columns[columnIndex];
      const order = orderById.get(id) as number;
      return [
        {
          range: `${quoteTitle(spec.title)}!${a1Column(columnIndex)}${grid.sheetRowNumbers[index]}`,
          values: [[column ? formatCell(column, order) : order]],
        },
      ];
    });
    if (data.length) {
      await sheetsFetch('/values:batchUpdate', {
        method: 'POST',
        body: JSON.stringify({ valueInputOption: 'RAW', data }),
      });
    }
    return { ok: true as const };
  };

  const removeRows = async (spec: SheetSpec, rowNumbers: number[]) => {
    const sheetId = sheetIds.get(spec.title);
    if (sheetId == null || rowNumbers.length === 0) return;
    const requests = [...rowNumbers]
      .sort((a, b) => b - a)
      .map((rowNumber) => ({
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber },
        },
      }));
    await sheetsFetch(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) });
  };

  const remove = async (key: SheetKey, id: string) => {
    if (key === 'clients') {
      const prices = await readGrid(SHEET_BY_KEY.unit_prices);
      await removeRows(
        SHEET_BY_KEY.unit_prices,
        prices.sheetRowNumbers.filter((_, index) => prices.rows[index].client_id === id)
      );
      const projects = await readGrid(SHEET_BY_KEY.projects);
      for (let index = 0; index < projects.rows.length; index += 1) {
        if (projects.rows[index].client_id !== id) continue;
        await writeRow(SHEET_BY_KEY.projects, projects.sheetRowNumbers[index], projects.columns, {
          ...projects.rows[index],
          client_id: null,
        });
      }
    }
    if (key === 'projects') {
      const tasks = await readGrid(SHEET_BY_KEY.tasks);
      const taskIds = new Set(
        tasks.rows.filter((row) => row.project_id === id).map((row) => String(row.id))
      );
      const invoiceItems = await readGrid(SHEET_BY_KEY.invoice_items);
      for (let index = 0; index < invoiceItems.rows.length; index += 1) {
        if (!taskIds.has(String(invoiceItems.rows[index].task_id || ''))) continue;
        await writeRow(SHEET_BY_KEY.invoice_items, invoiceItems.sheetRowNumbers[index], invoiceItems.columns, {
          ...invoiceItems.rows[index],
          task_id: null,
        });
      }
      await removeRows(
        SHEET_BY_KEY.tasks,
        tasks.sheetRowNumbers.filter((_, index) => tasks.rows[index].project_id === id)
      );
    }
    if (key === 'clients') {
      const invoices = await readGrid(SHEET_BY_KEY.invoices);
      const invoiceIds = new Set(
        invoices.rows.filter((row) => row.client_id === id).map((row) => String(row.id))
      );
      const invoiceItems = await readGrid(SHEET_BY_KEY.invoice_items);
      await removeRows(
        SHEET_BY_KEY.invoice_items,
        invoiceItems.sheetRowNumbers.filter((_, index) => invoiceIds.has(String(invoiceItems.rows[index].invoice_id || '')))
      );
      await removeRows(
        SHEET_BY_KEY.invoices,
        invoices.sheetRowNumbers.filter((_, index) => invoices.rows[index].client_id === id)
      );
    }
    if (key === 'invoices') {
      const invoiceItems = await readGrid(SHEET_BY_KEY.invoice_items);
      await removeRows(
        SHEET_BY_KEY.invoice_items,
        invoiceItems.sheetRowNumbers.filter((_, index) => invoiceItems.rows[index].invoice_id === id)
      );
    }
    const spec = SHEET_BY_KEY[key];
    const grid = await readGrid(spec);
    const index = grid.rows.findIndex((row) => row.id === id);
    if (index < 0) return;
    await removeRows(spec, [grid.sheetRowNumbers[index]]);
  };

  const replaceInvoiceItems = async (invoiceId: string, items: Row[]) => {
    const spec = SHEET_BY_KEY.invoice_items;
    const grid = await readGrid(spec);
    await removeRows(
      spec,
      grid.sheetRowNumbers.filter((_, index) => grid.rows[index].invoice_id === invoiceId)
    );
    for (const item of items) {
      await create('invoice_items', { ...item, invoice_id: invoiceId });
    }
  };

  const initializeSchema = async () => {
    await loadSheetIds();
    for (const spec of SHEETS) {
      await ensureSheet(spec);
      await readGrid(spec);
    }
    await loadSheetIds();
    const leftover = [...sheetIds.entries()].filter(([title]) => title === 'Sheet1' || title === 'シート1');
    const unused: [string, number][] = [];
    for (const [title, leftoverId] of leftover) {
      const data = (await sheetsFetch(
        `/values/${encodeURIComponent(`${quoteTitle(title)}!A:ZZ`)}?valueRenderOption=UNFORMATTED_VALUE`
      )) as { values?: unknown[][] };
      const hasContent = (data.values || []).some(
        (row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim())
      );
      if (!hasContent) unused.push([title, leftoverId]);
    }
    if (unused.length > 0 && unused.length < sheetIds.size) {
      await sheetsFetch(':batchUpdate', {
        method: 'POST',
        body: JSON.stringify({
          requests: unused.map(([, leftoverId]) => ({ deleteSheet: { sheetId: leftoverId } })),
        }),
      });
      for (const [title] of unused) sheetIds.delete(title);
    }
    return {
      spreadsheetId,
      url: spreadsheetUrl(spreadsheetId),
      sheets: SHEETS.map((spec) => spec.title),
    };
  };

  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      next();
      return;
    }

    const requestSheetId = parseSpreadsheetId(String(req.headers['x-spreadsheet-id'] || ''));
    const withSheet = <T>(fn: () => Promise<T>) => locked(fn, requestSheetId);

    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        try {
          await connectAuth();
        } catch (error) {
          send(res, 200, {
            ok: false,
            serviceAccountEmail: '',
            spreadsheetId: null,
            spreadsheetUrl: null,
            error: error instanceof Error ? error.message : 'サービスアカウントに接続できません。',
          });
          return;
        }
        const storedSheetId = parseSpreadsheetId(readAppSettings(env).settings.data_spreadsheet_url || '');
        const envId = env.GOOGLE_SPREADSHEET_ID?.trim() || '';
        const id = requestSheetId || storedSheetId || envId;
        if (id) {
          try {
            await withSheet(async () => {
              await loadSheetIds();
            });
          } catch {
            /* 設定画面ではメールとURLの提示を優先します */
          }
        }
        send(res, 200, {
          ok: true,
          serviceAccountEmail: accountEmail,
          spreadsheetId: id || null,
          spreadsheetUrl: id ? spreadsheetUrl(id) : null,
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
          const initialized = await withSheet(() => initializeSchema());
          send(res, 200, initialized);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'シートと項目名の作成に失敗しました。';
          send(res, 500, { error: message });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/invoices/pdf') {
        const body = JSON.parse((await readBody(req)) || '{}') as InvoicePdfRequest;
        const pdf = await withSheet(async () => {
          return renderInvoicePdf({
            getToken: token,
            destinationSpreadsheetId: spreadsheetId,
            serviceAccountEmail: accountEmail,
            input: body,
          });
        });
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
          await connect(requestSheetId);
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
          await connect(requestSheetId);
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
          const result = await withSheet(() =>
            pushTaskToCalendar(
              {
                getToken: token,
                serviceAccountEmail: accountEmail,
                list,
                update,
              },
              calendarId,
              taskId,
              { deleteEvent: Boolean(body.deleteEvent) }
            )
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
          const result = await withSheet(() =>
            inspectCalendar(
              {
                getToken: token,
                serviceAccountEmail: accountEmail,
                list,
                update,
              },
              calendarId
            )
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
          const result = await withSheet(() =>
            pullCalendarChanges(
              {
                getToken: token,
                serviceAccountEmail: accountEmail,
                list,
                update,
              },
              calendarId,
              body.syncToken || null
            )
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
        await withSheet(() => replaceInvoiceItems(body.invoice_id as string, body.items || []));
        send(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/sheets/unit_prices/reorder') {
        const body = JSON.parse((await readBody(req)) || '{}') as { ids?: string[] };
        if (!Array.isArray(body.ids) || body.ids.length === 0) {
          send(res, 400, { error: '並び順がありません。' });
          return;
        }
        await withSheet(() => reorder('unit_prices', body.ids as string[]));
        send(res, 200, { ok: true });
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
        send(res, 200, await withSheet(() => list(key)));
        return;
      }
      if (req.method === 'POST' && !id) {
        const body = JSON.parse((await readBody(req)) || '{}') as Row;
        send(res, 200, await withSheet(() => create(key, body)));
        return;
      }
      if (req.method === 'PATCH' && id) {
        const body = JSON.parse((await readBody(req)) || '{}') as Row;
        send(res, 200, await withSheet(() => update(key, id, body)));
        return;
      }
      if (req.method === 'DELETE' && id) {
        await withSheet(() => remove(key, id));
        send(res, 200, { ok: true });
        return;
      }
      send(res, 405, { error: 'Method not allowed' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sheets API error';
      send(res, 500, { error: message });
    }
  };
}
