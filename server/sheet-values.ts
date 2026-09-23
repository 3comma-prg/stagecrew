import { labelFor, valueFor, type Column } from './schema';

export type Row = Record<string, string | number | boolean | null> & { cells?: unknown[] };

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

export function parseCell(column: Column, value: unknown) {
  if (column.type === 'boolean') return parseBoolean(value, Boolean(column.fallback));
  if (column.type === 'domestic') return parseDomestic(value, column.fallback !== false);
  if (column.type === 'number') return parseNumber(value, (column.fallback as number | null) ?? null);
  if (column.type === 'date') return parseDate(value);
  if (column.type === 'time') return parseTime(value);
  if (value == null || value === '') return column.fallback === undefined ? null : column.fallback;
  const text = String(value).trim();
  return valueFor(column.key, text) || (column.fallback ?? null);
}

export function formatCell(column: Column, value: unknown) {
  if (value == null || value === '') return '';
  if (column.type === 'boolean') return value ? 'はい' : 'いいえ';
  if (column.type === 'domestic') return value ? '国内' : '海外';
  if (column.type === 'number') return value;
  if (column.key === 'status' || column.key === 'time_type' || column.key === 'billing_status' || column.key === 'tax_type' || column.key === 'billing_timing' || column.key === 'show_group_link') {
    return labelFor(column.key, value);
  }
  return String(value);
}

export function rowFromCells(columns: (Column | null)[], cells: unknown[], specColumns: Column[]): Row {
  const row: Row = {};
  columns.forEach((column, cellIndex) => {
    if (!column) return;
    row[column.key] = parseCell(column, cells[cellIndex]);
  });
  for (const column of specColumns) {
    if (row[column.key] === undefined) {
      row[column.key] = parseCell(column, '');
    }
  }
  return row;
}

export function mapHeaders(headers: string[], specColumns: Column[]) {
  const columnByName = new Map<string, Column>();
  for (const column of specColumns) {
    for (const name of [column.header, column.key, ...(column.aliases || [])]) {
      if (!columnByName.has(name)) columnByName.set(name, column);
    }
  }
  const used = new Set<string>();
  return headers.map((header) => {
    const column = columnByName.get(header);
    if (!column || used.has(column.key)) return null;
    used.add(column.key);
    return column;
  });
}
