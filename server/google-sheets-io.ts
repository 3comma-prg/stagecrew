import { SHEETS, SHEET_BY_KEY, type SheetKey, type SheetSpec } from './schema';
import { formatCell, mapHeaders, parseCell, rowFromCells, type Row } from './sheet-values';

function quoteTitle(title: string) {
  return `'${title.replace(/'/g, "''")}'`;
}

async function sheetsFetch(
  spreadsheetId: string,
  token: string,
  path: string,
  init: RequestInit = {}
) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 403 || response.status === 404) {
      throw new Error(
        'スプレッドシートを開けません。URLを確認し、サービスアカウントのメールアドレスに編集者権限を共有してください。'
      );
    }
    if (response.status === 429) {
      throw new Error('Google Sheets APIの利用上限に達しました。しばらく待ってから再試行してください。');
    }
    throw new Error(`Google Sheets API error (${response.status}): ${detail.slice(0, 300)}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function loadSheetIds(spreadsheetId: string, token: string) {
  const meta = (await sheetsFetch(spreadsheetId, token, '?fields=sheets.properties')) as {
    sheets?: { properties: { sheetId: number; title: string } }[];
  };
  const map = new Map<string, number>();
  for (const sheet of meta.sheets || []) {
    map.set(sheet.properties.title, sheet.properties.sheetId);
  }
  return map;
}

async function ensureSheet(spreadsheetId: string, token: string, spec: SheetSpec, sheetIds: Map<string, number>) {
  if (sheetIds.has(spec.title)) return sheetIds;
  await sheetsFetch(spreadsheetId, token, ':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: spec.title } } }] }),
  });
  return loadSheetIds(spreadsheetId, token);
}

export async function readSheetRows(
  spreadsheetId: string,
  token: string,
  key: SheetKey
): Promise<Row[]> {
  const spec = SHEET_BY_KEY[key];
  const range = encodeURIComponent(`${quoteTitle(spec.title)}!A:ZZ`);
  let data: { values?: unknown[][] };
  try {
    data = (await sheetsFetch(
      spreadsheetId,
      token,
      `/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`
    )) as { values?: unknown[][] };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('Unable to parse range') || message.includes('not found')) return [];
    throw error;
  }
  const values = data.values || [];
  if (values.length === 0) return [];
  const headers = (values[0] || []).map((cell) => String(cell || '').trim());
  const indexes = mapHeaders(headers, spec.columns);
  if (headers.length === 0 || indexes.every((column) => !column)) return [];

  const rows: Row[] = [];
  for (const cells of values.slice(1)) {
    const row = rowFromCells(indexes, cells, spec.columns);
    const hasData = spec.columns.some((column) => {
      if (column.key === 'id' || column.key === 'created_at') return false;
      const value = row[column.key];
      if (value == null || value === '' || value === column.fallback) return false;
      if (column.type === 'boolean' || column.type === 'domestic') return false;
      return true;
    });
    if (!hasData && !row.id) continue;
    rows.push(row);
  }
  return rows;
}

export async function writeSheetRows(
  spreadsheetId: string,
  token: string,
  key: SheetKey,
  rows: Row[]
) {
  const spec = SHEET_BY_KEY[key];
  let sheetIds = await loadSheetIds(spreadsheetId, token);
  sheetIds = await ensureSheet(spreadsheetId, token, spec, sheetIds);
  const headers = spec.columns.map((column) => column.header);
  const values = [
    headers,
    ...rows.map((row) => spec.columns.map((column) => formatCell(column, row[column.key]))),
  ];
  const range = encodeURIComponent(`${quoteTitle(spec.title)}!A1`);
  await sheetsFetch(spreadsheetId, token, `/values/${range}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values }),
  });
  const clearFrom = values.length + 1;
  try {
    await sheetsFetch(
      spreadsheetId,
      token,
      `/values/${encodeURIComponent(`${quoteTitle(spec.title)}!A${clearFrom}:ZZ`)}:clear`,
      { method: 'POST', body: '{}' }
    );
  } catch {
    // Older leftover rows may already be empty.
  }
}

export async function prepareWorkspaceSheets(spreadsheetId: string, token: string) {
  let sheetIds = await loadSheetIds(spreadsheetId, token);
  for (const spec of SHEETS) {
    sheetIds = await ensureSheet(spreadsheetId, token, spec, sheetIds);
    const headers = spec.columns.map((column) => column.header);
    await sheetsFetch(
      spreadsheetId,
      token,
      `/values/${encodeURIComponent(`${quoteTitle(spec.title)}!A1`)}?valueInputOption=RAW`,
      {
        method: 'PUT',
        body: JSON.stringify({ values: [headers] }),
      }
    );
  }
  const leftover = [...sheetIds.entries()].filter(([title]) => title === 'Sheet1' || title === 'シート1');
  const unused: number[] = [];
  for (const [title, sheetId] of leftover) {
    const data = (await sheetsFetch(
      spreadsheetId,
      token,
      `/values/${encodeURIComponent(`${quoteTitle(title)}!A:ZZ`)}?valueRenderOption=UNFORMATTED_VALUE`
    )) as { values?: unknown[][] };
    const hasContent = (data.values || []).some(
      (row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim())
    );
    if (!hasContent) unused.push(sheetId);
  }
  if (unused.length > 0 && unused.length < sheetIds.size) {
    await sheetsFetch(spreadsheetId, token, ':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: unused.map((sheetId) => ({ deleteSheet: { sheetId } })),
      }),
    });
  }
  return {
    spreadsheetId,
    sheets: SHEETS.map((spec) => spec.title),
  };
}

export { parseCell, formatCell };
