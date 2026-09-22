import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';

export type InvoicePdfItem = {
  description?: string;
  quantity?: number;
  quantity_unit?: string;
  unit_price?: number;
  amount?: number;
};

export type InvoicePdfRequest = {
  templateUrl?: string;
  detailTemplateUrl?: string | null;
  filename?: string;
  clientName?: string;
  representativeName?: string;
  issueDate?: string | null;
  invoiceNumber?: string | null;
  subject?: string | null;
  dueDate?: string | null;
  taxRate?: number;
  subtotal?: number;
  taxAmount?: number;
  totalAmount?: number;
  notes?: string | null;
  items?: InvoicePdfItem[];
  saveToDrive?: boolean;
  driveFolderUrl?: string | null;
};

type Line = {
  description: string;
  quantity: number;
  quantity_unit: string;
  unit_price: number;
  amount: number;
};

type ScalarMap = Record<string, string | number>;

type CellWrite = { row: number; column: number; value: string | number };

type FillPlan = {
  insertAt: number;
  insertCount: number;
  formatSourceRow: number;
  writes: CellWrite[];
  lastRow: number;
  lastColumn: number;
};

type CellFont = {
  family: string;
  size: number | null;
};

type SourceSheet = {
  sheetId: number;
  title: string;
  hidden: boolean;
  columnCount: number;
  exportEndColumn: number;
  values: unknown[][];
  fonts: (CellFont | null)[][];
};

type WorkingSheet = {
  sheetId: number;
  title: string;
  columnCount: number;
  exportEndColumn: number;
  values: unknown[][];
};

type HideState = {
  unhide: number[];
  deleteSheets: number[];
};

const SCALAR_TOKENS = [
  '{{クライアント名}}',
  '{{代表者名}}',
  '{{発行日}}',
  '{{請求書No}}',
  '{{件名}}',
  '{{税込請求金額}}',
  '{{支払日}}',
  '{{小計}}',
  '{{消費税額}}',
  '{{消費税率}}',
  '{{合計金額}}',
  '{{備考}}',
] as const;

const LINE_TOKENS = ['{{品目}}', '{{数量}}', '{{単位}}', '{{単価}}', '{{金額}}'] as const;
const ALL_TOKENS = [...SCALAR_TOKENS, ...LINE_TOKENS];
const NUMERIC_TOKENS = new Set([
  '{{税込請求金額}}',
  '{{小計}}',
  '{{消費税額}}',
  '{{合計金額}}',
  '{{単価}}',
  '{{金額}}',
  '{{数量}}',
]);

const INVOICE_BODY_LINES = 15;
const DETAIL_BODY_LINES = 30;
const STALE_MS = 15 * 60 * 1000;
const MAX_ITEMS = DETAIL_BODY_LINES;
const MAX_COLUMNS = 40;

function quoteTitle(title: string) {
  return `'${title.replace(/'/g, "''")}'`;
}

function columnLetter(index: number) {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function cellText(value: unknown) {
  if (value == null) return '';
  return String(value);
}

function hasToken(text: string) {
  return ALL_TOKENS.some((token) => text.includes(token));
}

function clearTokens(text: string) {
  return ALL_TOKENS.reduce((next, token) => next.split(token).join(''), text);
}

function asMoney(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function formatGrouped(value: number) {
  return Math.round(value).toLocaleString('ja-JP');
}

function formatRate(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return '0%';
  const trimmed = Number(number.toFixed(2).replace(/\.?0+$/, ''));
  return `${trimmed}%`;
}

function formatIssueDate(value: string | null | undefined) {
  const match = (value || '').match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return '';
  return `${match[1]}/${Number(match[2])}/${Number(match[3])}`;
}

function formatDueDate(value: string | null | undefined) {
  const text = (value || '').trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return text;
  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
}

function spreadsheetIdFromUrl(url: string) {
  const match = url.trim().match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(url.trim())) return url.trim();
  throw new Error('テンプレートURLからスプレッドシートIDを読み取れません。設定のURLを確認してください。');
}

function safeFilename(name: string) {
  const cleaned = name.replace(/[\\/:*?"<>|\r\n]/g, '_').replace(/\s+/g, ' ').trim();
  const base = cleaned || '請求書.pdf';
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

function googleMessage(status: number, body: string, email: string) {
  let message = body.slice(0, 400);
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    message = parsed.error?.message || message;
  } catch {
    message = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
  }
  if (/has not been used in project|accessNotConfigured|Drive API/i.test(message)) {
    return 'Google Drive API が無効です。Google Cloud のプロジェクトで Drive API を有効にしてから、もう一度試してください。';
  }
  if (status === 401 || status === 403 || status === 404 || /permission|not found|Forbidden/i.test(message)) {
    return `スプレッドシートを開けません。テンプレートは閲覧者、データ用は編集者で、サービスアカウント（${email || '設定済みのアカウント'}）に共有してください。`;
  }
  if (/merged/i.test(message)) {
    return '明細の雛形行が複数行に結合されているため、行を増やせません。明細のプレースホルダーは1行に置いてください。';
  }
  return `PDFの作成に失敗しました。（${status}）${message.slice(0, 240)}`;
}

function linesFrom(items: InvoicePdfItem[] | undefined): Line[] {
  return (items || []).slice(0, MAX_ITEMS).map((item) => ({
    description: String(item.description || ''),
    quantity: asMoney(item.quantity ?? 1),
    quantity_unit: item.quantity_unit === '式' ? '式' : item.quantity_unit || '日',
    unit_price: asMoney(item.unit_price),
    amount: asMoney(item.amount),
  }));
}

function scalarsFrom(input: InvoicePdfRequest): ScalarMap {
  const total = asMoney(input.totalAmount);
  return {
    '{{クライアント名}}': input.clientName?.trim() || '',
    '{{代表者名}}': input.representativeName?.trim() || '',
    '{{発行日}}': formatIssueDate(input.issueDate),
    '{{請求書No}}': input.invoiceNumber?.trim() || '',
    '{{件名}}': input.subject?.trim() || '',
    '{{税込請求金額}}': total,
    '{{支払日}}': formatDueDate(input.dueDate),
    '{{小計}}': asMoney(input.subtotal),
    '{{消費税額}}': asMoney(input.taxAmount),
    '{{消費税率}}': formatRate(input.taxRate),
    '{{合計金額}}': total,
    '{{備考}}': input.notes?.trim() || '',
  };
}

function numericValue(token: string, item: Line | null, scalars: ScalarMap) {
  if (token === '{{数量}}') return item?.quantity ?? 0;
  if (token === '{{単価}}') return item?.unit_price ?? 0;
  if (token === '{{金額}}') return item?.amount ?? 0;
  const value = scalars[token];
  return typeof value === 'number' ? value : 0;
}

function renderCell(text: string, item: Line | null, scalars: ScalarMap): string | number {
  const trimmed = text.trim();
  if (NUMERIC_TOKENS.has(trimmed)) return numericValue(trimmed, item, scalars);
  let next = text;
  for (const token of SCALAR_TOKENS) {
    if (!next.includes(token)) continue;
    const value = scalars[token];
    next = next.split(token).join(typeof value === 'number' ? formatGrouped(value) : value || '');
  }
  next = next.split('{{品目}}').join(item?.description ?? '');
  next = next.split('{{数量}}').join(item ? String(item.quantity) : '');
  next = next.split('{{単位}}').join(item?.quantity_unit ?? '');
  next = next.split('{{単価}}').join(item ? formatGrouped(item.unit_price) : '');
  next = next.split('{{金額}}').join(item ? formatGrouped(item.amount) : '');
  return next;
}

function hasLineToken(cells: unknown[] | undefined) {
  return (cells || []).some((cell) => LINE_TOKENS.some((token) => cellText(cell).includes(token)));
}

function rowStopsItemBlock(cells: unknown[] | undefined) {
  return (cells || []).some((cell) => {
    const text = cellText(cell);
    if (!text.trim()) return false;
    if (SCALAR_TOKENS.some((token) => text.includes(token))) return true;
    const stripped = LINE_TOKENS.reduce((next, token) => next.split(token).join(''), text).trim();
    return Boolean(stripped) && !/^[¥￥\s]+$/.test(stripped);
  });
}

function fixedItemRows(values: unknown[][], maxLines = INVOICE_BODY_LINES) {
  const start = values.findIndex((cells) => hasLineToken(cells));
  if (start < 0) return [];
  const rows = [start];
  for (let row = start + 1; row < values.length && rows.length < maxLines; row += 1) {
    if (rowStopsItemBlock(values[row])) break;
    rows.push(row);
  }
  return rows;
}

function visualLastColumn(
  values: unknown[][],
  merges: { endColumnIndex?: number }[]
) {
  let last = 0;
  values.forEach((cells) => {
    (cells || []).forEach((cell, column) => {
      if (cellText(cell)) last = Math.max(last, column);
    });
  });
  for (const merge of merges) {
    if (merge.endColumnIndex) last = Math.max(last, merge.endColumnIndex - 1);
  }
  return last;
}

function slotRows(values: unknown[][]) {
  const rows: number[] = [];
  values.forEach((cells, row) => {
    if ((cells || []).some((cell) => LINE_TOKENS.some((token) => cellText(cell).includes(token)))) {
      rows.push(row);
    }
  });
  return rows;
}

function rememberExtent(lastRow: number, lastColumn: number, row: number, column: number) {
  return { lastRow: Math.max(lastRow, row), lastColumn: Math.max(lastColumn, column) };
}

function writePrototypeColumns(
  values: unknown[][],
  row: number,
  prototypeRow: number,
  valueFor: (source: string) => string | number,
  writes: CellWrite[]
) {
  const prototype = values[prototypeRow] || [];
  prototype.forEach((cell, column) => {
    const protoText = cellText(cell);
    if (!LINE_TOKENS.some((token) => protoText.includes(token))) return;
    const current = cellText((values[row] || [])[column]);
    const source = LINE_TOKENS.some((token) => current.includes(token)) ? current : protoText;
    writes.push({ row, column, value: valueFor(source) });
  });
}

function planFixedInvoice(values: unknown[][], items: Line[] | null, scalars: ScalarMap): FillPlan {
  const slots = fixedItemRows(values, INVOICE_BODY_LINES);
  if (slots.length < INVOICE_BODY_LINES) {
    throw new Error(
      '請求書の明細欄は15行固定です。{{品目}}の行から{{小計}}の手前まで、空行も含めて15行にしてください。行は増やしません。'
    );
  }
  const useSlots = slots.slice(0, INVOICE_BODY_LINES);
  const prototypeRow = useSlots[0];
  const writes: CellWrite[] = [];
  let lastRow = 0;
  let lastColumn = 0;

  values.forEach((cells, row) => {
    (cells || []).forEach((cell, column) => {
      const text = cellText(cell);
      if (text) ({ lastRow, lastColumn } = rememberExtent(lastRow, lastColumn, row, column));
      if (!SCALAR_TOKENS.some((token) => text.includes(token))) return;
      writes.push({ row, column, value: renderCell(text, null, scalars) });
    });
  });

  useSlots.forEach((row, index) => {
    const item = items && index < items.length ? items[index] : null;
    writePrototypeColumns(
      values,
      row,
      prototypeRow,
      (source) => {
        if (!item) {
          if (items == null && index === 0 && (source.includes('{{品目}}') || source.trim() === '{{品目}}')) {
            return LINE_TOKENS.reduce((next, token) => next.split(token).join(''), source.split('{{品目}}').join('別紙明細書のとおり'));
          }
          return clearTokens(source);
        }
        return renderCell(source, item, scalars);
      },
      writes
    );
    ({ lastRow, lastColumn } = rememberExtent(lastRow, lastColumn, row, Math.max(lastColumn, 0)));
  });

  for (const write of writes) ({ lastRow, lastColumn } = rememberExtent(lastRow, lastColumn, write.row, write.column));
  return { insertAt: 0, insertCount: 0, formatSourceRow: prototypeRow, writes, lastRow, lastColumn };
}

function planFixedDetail(values: unknown[][], items: Line[], scalars: ScalarMap): FillPlan {
  const slots = fixedItemRows(values, DETAIL_BODY_LINES);
  if (slots.length < DETAIL_BODY_LINES) {
    throw new Error(
      '明細書の明細欄は30行固定です。{{品目}}の行から合計欄の手前まで、空行も含めて30行にしてください。行は増やしません。'
    );
  }
  if (items.length > DETAIL_BODY_LINES) {
    throw new Error(`明細は明細書の${DETAIL_BODY_LINES}行までに収めてください。`);
  }
  const useSlots = slots.slice(0, DETAIL_BODY_LINES);
  const prototypeRow = useSlots[0];
  const writes: CellWrite[] = [];
  let lastRow = 0;
  let lastColumn = 0;

  values.forEach((cells, row) => {
    (cells || []).forEach((cell, column) => {
      const text = cellText(cell);
      if (text) ({ lastRow, lastColumn } = rememberExtent(lastRow, lastColumn, row, column));
      if (!SCALAR_TOKENS.some((token) => text.includes(token))) return;
      writes.push({ row, column, value: renderCell(text, null, scalars) });
    });
  });

  useSlots.forEach((row, index) => {
    const item = index < items.length ? items[index] : null;
    writePrototypeColumns(
      values,
      row,
      prototypeRow,
      (source) => (item ? renderCell(source, item, scalars) : clearTokens(source)),
      writes
    );
    ({ lastRow, lastColumn } = rememberExtent(lastRow, lastColumn, row, Math.max(lastColumn, 0)));
  });

  for (const write of writes) ({ lastRow, lastColumn } = rememberExtent(lastRow, lastColumn, write.row, write.column));
  return { insertAt: 0, insertCount: 0, formatSourceRow: prototypeRow, writes, lastRow, lastColumn };
}

function planScalarsOnly(values: unknown[][], scalars: ScalarMap): FillPlan {
  return planFills(values, [], scalars);
}

function planFills(values: unknown[][], items: Line[], scalars: ScalarMap): FillPlan {
  const slots = slotRows(values);
  const extra = slots.length ? Math.max(0, items.length - slots.length) : 0;
  const insertAt = slots.length ? slots[slots.length - 1] + 1 : 0;
  const shifted = (row: number) => (extra > 0 && row >= insertAt ? row + extra : row);
  const slotIndex = new Map(slots.map((row, index) => [row, index]));
  const writes: CellWrite[] = [];
  let lastRow = 0;
  let lastColumn = 0;

  values.forEach((cells, row) => {
    (cells || []).forEach((cell, column) => {
      const text = cellText(cell);
      if (text) {
        lastRow = Math.max(lastRow, shifted(row));
        lastColumn = Math.max(lastColumn, column);
      }
      if (!hasToken(text)) return;
      const index = slotIndex.get(row);
      const unusedSlot = index != null && index >= items.length;
      const item = index != null && index < items.length ? items[index] : null;
      writes.push({
        row: shifted(row),
        column,
        value: unusedSlot ? clearTokens(text) : renderCell(text, item, scalars),
      });
    });
  });

  if (extra > 0) {
    const prototype = values[slots[0]] || [];
    for (let offset = 0; offset < extra; offset += 1) {
      const item = items[slots.length + offset];
      prototype.forEach((cell, column) => {
        const text = cellText(cell);
        if (!hasToken(text)) return;
        const row = insertAt + offset;
        writes.push({ row, column, value: renderCell(text, item, scalars) });
        lastRow = Math.max(lastRow, row);
        lastColumn = Math.max(lastColumn, column);
      });
    }
  }

  for (const write of writes) {
    lastRow = Math.max(lastRow, write.row);
    lastColumn = Math.max(lastColumn, write.column);
  }

  return {
    insertAt,
    insertCount: extra,
    formatSourceRow: slots[0] ?? 0,
    writes,
    lastRow,
    lastColumn,
  };
}

async function googleFetch(url: string, token: string, init: RequestInit = {}) {
  const run = () =>
    fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
    });
  let response = await run();
  if (response.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    response = await run();
  }
  return response;
}

async function sheetsJson<T>(
  spreadsheetId: string,
  path: string,
  token: string,
  email: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}${path}`, token, init);
  if (!response.ok) {
    throw new Error(googleMessage(response.status, await response.text(), email));
  }
  if (response.status === 204) return null as T;
  return (await response.json()) as T;
}

function cellFont(cell: {
  effectiveFormat?: { textFormat?: { fontFamily?: string; fontSize?: number } };
} | undefined): CellFont | null {
  const format = cell?.effectiveFormat?.textFormat;
  const family = format?.fontFamily?.trim();
  if (!family) return null;
  const size = format?.fontSize;
  return { family, size: typeof size === 'number' && size > 0 ? size : null };
}

function fontGrid(
  grid: {
    startRow?: number;
    startColumn?: number;
    rowData?: { values?: { effectiveFormat?: { textFormat?: { fontFamily?: string; fontSize?: number } } }[] }[];
  } | undefined
) {
  const startRow = grid?.startRow || 0;
  const startColumn = grid?.startColumn || 0;
  const rows: (CellFont | null)[][] = Array.from({ length: startRow }, () => []);
  for (const row of grid?.rowData || []) {
    const cells: (CellFont | null)[] = Array.from({ length: startColumn }, () => null);
    for (const cell of row.values || []) cells.push(cellFont(cell));
    rows.push(cells);
  }
  return rows;
}

async function loadTemplate(spreadsheetId: string, token: string, email: string): Promise<SourceSheet[]> {
  const meta = await sheetsJson<{
    sheets?: {
      properties: { sheetId: number; title: string; hidden?: boolean; gridProperties?: { columnCount?: number } };
      merges?: { endColumnIndex?: number }[];
    }[];
  }>(spreadsheetId, '?fields=sheets(properties,merges)', token, email);
  const sheets: SourceSheet[] = [];
  const fontFields = encodeURIComponent('sheets.data.rowData.values.effectiveFormat.textFormat(fontFamily,fontSize)');
  for (const sheet of meta.sheets || []) {
    const properties = sheet.properties;
    const columnCount = Math.min(Math.max(properties.gridProperties?.columnCount || 26, 1), MAX_COLUMNS);
    const range = encodeURIComponent(`${quoteTitle(properties.title)}!A:AN`);
    const data = await sheetsJson<{ values?: unknown[][] }>(
      spreadsheetId,
      `/values/${range}?valueRenderOption=FORMULA`,
      token,
      email
    );
    const styled = await sheetsJson<{
      sheets?: {
        data?: {
          startRow?: number;
          startColumn?: number;
          rowData?: { values?: { effectiveFormat?: { textFormat?: { fontFamily?: string; fontSize?: number } } }[] }[];
        }[];
      }[];
    }>(spreadsheetId, `?ranges=${range}&includeGridData=true&fields=${fontFields}`, token, email);
    const values = data.values || [];
    sheets.push({
      sheetId: properties.sheetId,
      title: properties.title,
      hidden: Boolean(properties.hidden),
      columnCount,
      exportEndColumn: Math.min(columnCount - 1, visualLastColumn(values, sheet.merges || [])),
      values,
      fonts: fontGrid(styled.sheets?.[0]?.data?.[0]),
    });
  }
  return sheets;
}

async function copySheet(
  sourceId: string,
  sheetId: number,
  destinationId: string,
  title: string,
  token: string,
  email: string
) {
  const copied = await sheetsJson<{ sheetId: number }>(
    sourceId,
    `/sheets/${sheetId}:copyTo`,
    token,
    email,
    {
      method: 'POST',
      body: JSON.stringify({ destinationSpreadsheetId: destinationId }),
    }
  );
  await sheetsJson(
    destinationId,
    ':batchUpdate',
    token,
    email,
    {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId: copied.sheetId, title, hidden: false },
              fields: 'title,hidden',
            },
          },
        ],
      }),
    }
  );
  return copied.sheetId;
}

function fontPinRequests(sheetId: number, fonts: (CellFont | null)[][]) {
  const requests: unknown[] = [];
  fonts.forEach((row, rowIndex) => {
    let column = 0;
    while (column < row.length) {
      const font = row[column];
      if (!font) {
        column += 1;
        continue;
      }
      let end = column + 1;
      while (end < row.length && row[end]?.family === font.family && row[end]?.size === font.size) end += 1;
      const textFormat: { fontFamily: string; fontSize?: number } = { fontFamily: font.family };
      let fields = 'userEnteredFormat.textFormat.fontFamily';
      if (font.size) {
        textFormat.fontSize = font.size;
        fields += ',userEnteredFormat.textFormat.fontSize';
      }
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: rowIndex,
            endRowIndex: rowIndex + 1,
            startColumnIndex: column,
            endColumnIndex: end,
          },
          cell: { userEnteredFormat: { textFormat } },
          fields,
        },
      });
      column = end;
    }
  });
  return requests;
}

async function pinSourceFonts(
  spreadsheetId: string,
  sheetId: number,
  fonts: (CellFont | null)[][],
  token: string,
  email: string
) {
  const requests = fontPinRequests(sheetId, fonts);
  for (let index = 0; index < requests.length; index += 80) {
    await sheetsJson(spreadsheetId, ':batchUpdate', token, email, {
      method: 'POST',
      body: JSON.stringify({ requests: requests.slice(index, index + 80) }),
    });
  }
}

function statePath(spreadsheetId: string) {
  return join(tmpdir(), `stagecrew-pdf-${spreadsheetId}.json`);
}

function writeHideState(spreadsheetId: string, state: HideState) {
  writeFileSync(statePath(spreadsheetId), JSON.stringify(state));
}

function readHideState(spreadsheetId: string): HideState | null {
  const path = statePath(spreadsheetId);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as HideState;
    return {
      unhide: Array.isArray(parsed.unhide) ? parsed.unhide.filter((id) => Number.isFinite(id)) : [],
      deleteSheets: Array.isArray(parsed.deleteSheets) ? parsed.deleteSheets.filter((id) => Number.isFinite(id)) : [],
    };
  } catch {
    return null;
  }
}

function clearHideState(spreadsheetId: string) {
  const path = statePath(spreadsheetId);
  if (existsSync(path)) unlinkSync(path);
}

async function setHidden(spreadsheetId: string, sheetIds: number[], hidden: boolean, token: string, email: string) {
  const unique = [...new Set(sheetIds)];
  if (unique.length === 0) return;
  await sheetsJson(spreadsheetId, ':batchUpdate', token, email, {
    method: 'POST',
    body: JSON.stringify({
      requests: unique.map((sheetId) => ({
        updateSheetProperties: { properties: { sheetId, hidden }, fields: 'hidden' },
      })),
    }),
  });
}

async function showOnly(spreadsheetId: string, visibleId: number, allIds: number[], token: string, email: string) {
  await sheetsJson(spreadsheetId, ':batchUpdate', token, email, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        { updateSheetProperties: { properties: { sheetId: visibleId, hidden: false }, fields: 'hidden' } },
        ...allIds
          .filter((sheetId) => sheetId !== visibleId)
          .map((sheetId) => ({
            updateSheetProperties: { properties: { sheetId, hidden: true }, fields: 'hidden' },
          })),
      ],
    }),
  });
}

async function listSheetIds(spreadsheetId: string, token: string, email: string) {
  const meta = await sheetsJson<{ sheets?: { properties: { sheetId: number; hidden?: boolean } }[] }>(
    spreadsheetId,
    '?fields=sheets.properties(sheetId,hidden)',
    token,
    email
  );
  return meta.sheets || [];
}

export async function recoverInvoicePdfSheets(options: {
  getToken: () => Promise<string>;
  destinationSpreadsheetId: string;
  serviceAccountEmail: string;
}) {
  const state = readHideState(options.destinationSpreadsheetId);
  if (!state || (state.unhide.length === 0 && state.deleteSheets.length === 0)) {
    if (state) clearHideState(options.destinationSpreadsheetId);
    return;
  }
  const token = await options.getToken();
  if (state.unhide.length > 0) {
    await setHidden(options.destinationSpreadsheetId, state.unhide, false, token, options.serviceAccountEmail);
  }
  await deleteSheets(options.destinationSpreadsheetId, state.deleteSheets, token, options.serviceAccountEmail);
  clearHideState(options.destinationSpreadsheetId);
}

async function deleteSheets(spreadsheetId: string, sheetIds: number[], token: string, email: string) {
  const unique = [...new Set(sheetIds)];
  if (unique.length === 0) return;
  try {
    await sheetsJson(spreadsheetId, ':batchUpdate', token, email, {
      method: 'POST',
      body: JSON.stringify({ requests: unique.map((sheetId) => ({ deleteSheet: { sheetId } })) }),
    });
  } catch {
    for (const sheetId of unique) {
      try {
        await sheetsJson(spreadsheetId, ':batchUpdate', token, email, {
          method: 'POST',
          body: JSON.stringify({ requests: [{ deleteSheet: { sheetId } }] }),
        });
      } catch {
        // A leftover sheet is cleaned up on the next export.
      }
    }
  }
}

async function sweepStale(spreadsheetId: string, token: string, email: string) {
  const meta = await sheetsJson<{ sheets?: { properties: { sheetId: number; title: string } }[] }>(
    spreadsheetId,
    '?fields=sheets.properties(sheetId,title)',
    token,
    email
  );
  const stale = (meta.sheets || [])
    .filter((sheet) => {
      const match = sheet.properties.title.match(/^__pdf_(\d+)_/);
      if (!match) return false;
      const created = Number(match[1]);
      return Number.isFinite(created) && Date.now() - created > STALE_MS;
    })
    .map((sheet) => sheet.properties.sheetId);
  await deleteSheets(spreadsheetId, stale, token, email);
}

async function applyPlan(
  spreadsheetId: string,
  sheet: WorkingSheet,
  plan: FillPlan,
  token: string,
  email: string
) {
  if (plan.insertCount > 0) {
    const requests: unknown[] = [
      {
        insertDimension: {
          range: {
            sheetId: sheet.sheetId,
            dimension: 'ROWS',
            startIndex: plan.insertAt,
            endIndex: plan.insertAt + plan.insertCount,
          },
          inheritFromBefore: true,
        },
      },
    ];
    for (let offset = 0; offset < plan.insertCount; offset += 1) {
      requests.push({
        copyPaste: {
          source: {
            sheetId: sheet.sheetId,
            startRowIndex: plan.formatSourceRow,
            endRowIndex: plan.formatSourceRow + 1,
            startColumnIndex: 0,
            endColumnIndex: sheet.columnCount,
          },
          destination: {
            sheetId: sheet.sheetId,
            startRowIndex: plan.insertAt + offset,
            endRowIndex: plan.insertAt + offset + 1,
            startColumnIndex: 0,
            endColumnIndex: sheet.columnCount,
          },
          pasteType: 'PASTE_FORMAT',
          pasteOrientation: 'NORMAL',
        },
      });
    }
    await sheetsJson(spreadsheetId, ':batchUpdate', token, email, {
      method: 'POST',
      body: JSON.stringify({ requests }),
    });
  }

  for (let index = 0; index < plan.writes.length; index += 80) {
    const chunk = plan.writes.slice(index, index + 80);
    await sheetsJson(spreadsheetId, '/values:batchUpdate', token, email, {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: chunk.map((write) => ({
          range: `${quoteTitle(sheet.title)}!${columnLetter(write.column)}${write.row + 1}`,
          values: [[write.value]],
        })),
      }),
    });
  }
}

async function fetchPdf(url: string, token: string, email: string, sendAuth = true) {
  let current = url;
  let auth = sendAuth;
  for (let hop = 0; hop < 5; hop += 1) {
    const headers: Record<string, string> = {};
    if (auth) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(current, { headers, redirect: 'manual', signal: AbortSignal.timeout(90000) }).catch((error) => {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error('PDFの書き出しが時間内に終わりませんでした。もう一度試してください。');
      }
      throw error;
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('PDFの書き出し先が不正です。');
      current = new URL(location, current).toString();
      const host = new URL(current).hostname;
      auth = host.endsWith('.google.com') || host === 'google.com' || host.endsWith('.googleapis.com');
      continue;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (response.ok && bytes.subarray(0, 5).toString('utf8') === '%PDF-') return bytes;
    throw new Error(googleMessage(response.status, bytes.toString('utf8'), email));
  }
  throw new Error('PDFの書き出しが完了しませんでした。少し待ってからもう一度試してください。');
}

async function downloadSheetPdf(
  spreadsheetId: string,
  gid: number,
  token: string,
  email: string,
  fitPage: boolean
) {
  // Google's own PDF export keeps the spreadsheet layout. Local HTML printing does not.
  const params = new URLSearchParams({
    format: 'pdf',
    gid: String(gid),
    single: 'true',
    size: 'A4',
    portrait: 'true',
    scale: fitPage ? '4' : '2',
    fitw: 'true',
    gridlines: 'false',
    printtitle: 'false',
    sheetnames: 'false',
    printnotes: 'false',
    pagenum: 'UNDEFINED',
    fzr: 'false',
    fzc: 'false',
    attachment: 'false',
    horizontal_alignment: 'CENTER',
    vertical_alignment: 'TOP',
  });
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?${params}`;
  try {
    return await fetchPdf(url, token, email);
  } catch (error) {
    const withToken = `${url}&access_token=${encodeURIComponent(token)}`;
    try {
      return await fetchPdf(withToken, token, email, false);
    } catch {
      throw error;
    }
  }
}

async function mergePdfs(parts: Buffer[]) {
  if (parts.length === 1) return parts[0];
  const merged = await PDFDocument.create();
  for (const part of parts) {
    const doc = await PDFDocument.load(part);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  return Buffer.from(await merged.save());
}

async function materialize(
  sourceId: string,
  destinationId: string,
  stamp: string,
  token: string,
  email: string,
  created: number[]
) {
  const source = await loadTemplate(sourceId, token, email);
  const visible = source.filter((sheet) => !sheet.hidden);
  if (visible.length === 0) throw new Error('テンプレートに表示されているシートがありません。');
  const working: WorkingSheet[] = [];
  for (let index = 0; index < visible.length; index += 1) {
    const sheet = visible[index];
    const title = `__pdf_${stamp}_${index}`;
    const sheetId = await copySheet(sourceId, sheet.sheetId, destinationId, title, token, email);
    created.push(sheetId);
    // copyTo keeps explicit fonts, but theme fonts follow the destination spreadsheet.
    // Pin the source font on each cell so the PDF does not pick up the data sheet theme.
    await pinSourceFonts(destinationId, sheetId, sheet.fonts, token, email);
    working.push({
      sheetId,
      title,
      columnCount: sheet.columnCount,
      exportEndColumn: sheet.exportEndColumn,
      values: sheet.values,
    });
  }
  return working;
}

export async function renderInvoicePdf(options: {
  getToken: () => Promise<string>;
  destinationSpreadsheetId: string;
  serviceAccountEmail: string;
  input: InvoicePdfRequest;
}) {
  const input = options.input || {};
  const templateUrl = input.templateUrl?.trim() || '';
  const detailUrl = input.detailTemplateUrl?.trim() || '';
  const items = linesFrom(input.items);
  if ((input.items || []).length > MAX_ITEMS) {
    throw new Error(`明細は${MAX_ITEMS}行までです。`);
  }
  const useDetail = items.length > INVOICE_BODY_LINES;
  if (useDetail) {
    if (!detailUrl) {
      throw new Error('明細が16行以上です。請求書＋明細書（2シート）のテンプレートURLを設定してください。');
    }
  } else if (!templateUrl) {
    throw new Error('請求書テンプレートのURLがありません。設定で登録してください。');
  }

  const sourceUrl = useDetail ? detailUrl : templateUrl;
  const sourceId = spreadsheetIdFromUrl(sourceUrl);
  if (sourceId === options.destinationSpreadsheetId) {
    throw new Error('請求書テンプレートは、データ用スプレッドシートとは別のファイルにしてください。');
  }
  const scalars = scalarsFrom(input);
  const filename = safeFilename(
    input.filename || `請求書_${(input.invoiceNumber || 'invoice').trim() || 'invoice'}`
  );
  const email = options.serviceAccountEmail;
  const destinationId = options.destinationSpreadsheetId;
  const created: number[] = [];
  let pending: HideState | null = null;

  const remember = (unhide: number[]) => {
    pending = { unhide, deleteSheets: [...created] };
    writeHideState(destinationId, pending);
  };

  try {
    const token = await options.getToken();
    await sweepStale(destinationId, token, email);
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const sheets = await materialize(sourceId, destinationId, stamp, token, email, created);
    remember([]);

    if (items.length > 0 && !sheets.some((sheet) => slotRows(sheet.values).length > 0)) {
      throw new Error(
        useDetail
          ? 'テンプレートに明細行がありません。請求書シートは15行、明細書シートは30行のプレースホルダーを置いてください。'
          : 'テンプレートに明細行がありません。{{品目}} などのプレースホルダーを15行分置いてください。'
      );
    }

    const invoiceIds = new Set<number>();
    const exportSheets: WorkingSheet[] = [];

    if (useDetail) {
      const scored = sheets.map((sheet) => ({
        sheet,
        slots: fixedItemRows(sheet.values, DETAIL_BODY_LINES).length,
      }));
      const detailCandidates = scored.filter((entry) => entry.slots > INVOICE_BODY_LINES);
      if (detailCandidates.length === 0) {
        throw new Error(
          '明細書シートが見つかりません。2シート目に、空行も含めて30行の明細プレースホルダーを置いてください。'
        );
      }
      const detailEntry = detailCandidates.reduce((best, current) =>
        current.slots >= best.slots ? current : best
      );
      const detailId = detailEntry.sheet.sheetId;

      for (const { sheet, slots } of scored) {
        if (sheet.sheetId === detailId) {
          const plan = planFixedDetail(sheet.values, items, scalars);
          await applyPlan(destinationId, sheet, plan, token, email);
          exportSheets.push(sheet);
          continue;
        }
        if (slots > 0) {
          const plan = planFixedInvoice(sheet.values, null, scalars);
          await applyPlan(destinationId, sheet, plan, token, email);
          invoiceIds.add(sheet.sheetId);
          exportSheets.push(sheet);
          continue;
        }
        const plan = planScalarsOnly(sheet.values, scalars);
        await applyPlan(destinationId, sheet, plan, token, email);
        exportSheets.push(sheet);
      }

      // Export invoice sheet(s) first, then the detail sheet.
      exportSheets.sort((a, b) => {
        const aDetail = a.sheetId === detailId ? 1 : 0;
        const bDetail = b.sheetId === detailId ? 1 : 0;
        return aDetail - bDetail;
      });
    } else {
      for (const sheet of sheets) {
        const plan = slotRows(sheet.values).length
          ? planFixedInvoice(sheet.values, items, scalars)
          : planScalarsOnly(sheet.values, scalars);
        await applyPlan(destinationId, sheet, plan, token, email);
        if (slotRows(sheet.values).length) invoiceIds.add(sheet.sheetId);
        exportSheets.push(sheet);
      }
    }

    remember([]);
    const snapshot = await listSheetIds(destinationId, token, email);
    const originallyVisible = snapshot.filter((sheet) => !sheet.properties.hidden).map((sheet) => sheet.properties.sheetId);
    const allIds = snapshot.map((sheet) => sheet.properties.sheetId);
    remember(originallyVisible);

    await new Promise((resolve) => setTimeout(resolve, 800));
    const exportToken = await options.getToken();
    const pdfs: Buffer[] = [];
    for (const sheet of exportSheets) {
      await showOnly(destinationId, sheet.sheetId, allIds, exportToken, email);
      pdfs.push(
        await downloadSheetPdf(destinationId, sheet.sheetId, exportToken, email, invoiceIds.has(sheet.sheetId))
      );
    }
    const bytes = await mergePdfs(pdfs);
    if (pending) {
      await setHidden(destinationId, pending.unhide, false, exportToken, email);
      await deleteSheets(destinationId, pending.deleteSheets, exportToken, email);
      clearHideState(destinationId);
      pending = null;
      created.length = 0;
    }
    return { filename, bytes };
  } finally {
    // Do not return from here. A return in finally replaces the PDF result with undefined.
    if (pending || created.length > 0) {
      try {
        const token = await options.getToken();
        if (pending && pending.unhide.length > 0) {
          await setHidden(destinationId, pending.unhide, false, token, email);
        }
        await deleteSheets(destinationId, pending?.deleteSheets.length ? pending.deleteSheets : created, token, email);
        if (pending) clearHideState(destinationId);
      } catch {
        // The next request restores hidden sheets from the saved state.
      }
    }
  }
}

function driveFolderId(url: string) {
  const text = url.trim();
  const folder = text.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folder) return folder[1];
  const query = text.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (query) return query[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(text)) return text;
  throw new Error('GoogleドライブのフォルダURLからIDを読み取れません。設定のURLを確認してください。');
}

async function driveFetch(url: string, token: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(60000),
  });
  return response;
}

function driveErrorMessage(status: number, body: string, email: string) {
  let message = body.slice(0, 400);
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; errors?: { reason?: string }[] } };
    message = parsed.error?.message || message;
  } catch {
    message = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
  }
  if (/has not been used in project|accessNotConfigured|Drive API/i.test(message)) {
    return 'Google Drive API が無効です。Google Cloud のプロジェクトで Drive API を有効にしてから、もう一度試してください。';
  }
  if (/storageQuotaExceeded|Service Accounts do not have storage quota|do not have storage quota/i.test(message)) {
    return `サービスアカウントには保存容量がありません。マイドライブ上の共有フォルダでは保存できないことがあります。共有ドライブ（Shared Drive）にフォルダを作り、サービスアカウント（${email || '設定済みのアカウント'}）をメンバー（コンテンツ管理者または編集者）として追加してから、そのフォルダURLを設定してください。`;
  }
  if (/insufficientPermissions|Insufficient Permission|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(message)) {
    return 'Googleドライブへの保存権限が不足しています。開発サーバーを再起動し、フォルダをサービスアカウントに編集者として共有し直してください。';
  }
  if (status === 401 || status === 403 || status === 404) {
    return `Googleドライブのフォルダに保存できません。フォルダURLを確認し、サービスアカウント（${email || '設定済みのアカウント'}）に編集者として共有してください。`;
  }
  return `Googleドライブへの保存に失敗しました。（${status}）${message.slice(0, 240)}`;
}

async function findDriveFile(folderId: string, filename: string, token: string, email: string) {
  const escaped = filename.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const query = `name = '${escaped}' and '${folderId}' in parents and trashed = false`;
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}` +
    '&fields=files(id)&pageSize=5&supportsAllDrives=true&includeItemsFromAllDrives=true';
  const response = await driveFetch(url, token, { method: 'GET' });
  const text = await response.text();
  if (!response.ok) throw new Error(driveErrorMessage(response.status, text, email));
  const parsed = JSON.parse(text) as { files?: { id?: string }[] };
  return parsed.files?.[0]?.id || '';
}

async function createDriveFile(folderId: string, filename: string, bytes: Buffer, token: string, email: string) {
  const boundary = `stagecrew-${Date.now()}`;
  const metadata = JSON.stringify({
    name: filename,
    mimeType: 'application/pdf',
    parents: [folderId],
  });
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
    'utf8'
  );
  const tail = Buffer.from(`\r\n--${boundary}--`, 'utf8');
  const body = Buffer.concat([head, bytes, tail]);
  const response = await driveFetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,parents',
    token,
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
    }
  );
  const text = await response.text();
  if (!response.ok) throw new Error(driveErrorMessage(response.status, text, email));
  const parsed = JSON.parse(text) as { id?: string };
  if (!parsed.id) throw new Error('Googleドライブへの保存に失敗しました。');
  return parsed.id;
}

async function replaceDriveFile(fileId: string, bytes: Buffer, token: string, email: string) {
  const response = await driveFetch(
    `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&supportsAllDrives=true`,
    token,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.length),
      },
      body: bytes,
    }
  );
  const text = await response.text();
  if (!response.ok) throw new Error(driveErrorMessage(response.status, text, email));
}

export async function findDriveFileInFolder(options: {
  getToken: () => Promise<string>;
  folderUrl: string;
  filename: string;
  serviceAccountEmail: string;
}) {
  const token = await options.getToken();
  const folderId = driveFolderId(options.folderUrl);
  const email = options.serviceAccountEmail;
  const filename = safeFilename(options.filename);

  const metaUrl =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}` +
    '?fields=id,name,mimeType,driveId&supportsAllDrives=true';
  const metaResponse = await driveFetch(metaUrl, token, { method: 'GET' });
  const metaText = await metaResponse.text();
  if (!metaResponse.ok) throw new Error(driveErrorMessage(metaResponse.status, metaText, email));
  const meta = JSON.parse(metaText) as { mimeType?: string };
  if (meta.mimeType && meta.mimeType !== 'application/vnd.google-apps.folder') {
    throw new Error('指定されたURLはフォルダではありません。GoogleドライブのフォルダURLを設定してください。');
  }

  const existingId = await findDriveFile(folderId, filename, token, email);
  return { folderId, filename, existingId };
}

export async function saveInvoicePdfToDrive(options: {
  getToken: () => Promise<string>;
  folderUrl: string;
  filename: string;
  bytes: Buffer;
  serviceAccountEmail: string;
  mode?: 'create' | 'overwrite';
}) {
  const token = await options.getToken();
  const email = options.serviceAccountEmail;
  const mode = options.mode || 'create';
  const checked = await findDriveFileInFolder({
    getToken: async () => token,
    folderUrl: options.folderUrl,
    filename: options.filename,
    serviceAccountEmail: email,
  });
  const { folderId, filename, existingId } = checked;

  if (existingId) {
    if (mode !== 'overwrite') {
      const error = new Error(`同じ名前のファイルが既にあります。（${filename}）`);
      (error as Error & { code?: string; fileId?: string }).code = 'FILE_EXISTS';
      (error as Error & { code?: string; fileId?: string }).fileId = existingId;
      throw error;
    }
    await replaceDriveFile(existingId, options.bytes, token, email);
    return existingId;
  }
  return createDriveFile(folderId, filename, options.bytes, token, email);
}
