import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import { SHEETS, SHEET_BY_KEY, type Column, type SheetKey } from './schema';
import type { Row } from './sheet-values';

type Env = Record<string, string>;

const require = createRequire(import.meta.url);

let db: Database | null = null;
let dbPath = '';
let sqlReady: Promise<void> | null = null;

function sqlType(column: Column) {
  if (column.type === 'number') return 'REAL';
  if (column.type === 'boolean' || column.type === 'domestic') return 'INTEGER';
  return 'TEXT';
}

function createTableSql(key: SheetKey, tableName = key) {
  const spec = SHEET_BY_KEY[key];
  const cols = spec.columns
    .map((column) => {
      if (column.key === 'id') return 'id TEXT PRIMARY KEY NOT NULL';
      return `"${column.key}" ${sqlType(column)}`;
    })
    .join(', ');
  return `CREATE TABLE IF NOT EXISTS "${tableName}" (${cols})`;
}

function toSqlValue(column: Column, value: unknown): SqlValue {
  if (value == null || value === '') {
    if (column.type === 'boolean' || column.type === 'domestic') {
      return column.fallback === false || column.fallback === 0 ? 0 : column.type === 'boolean' ? 0 : 1;
    }
    if (column.fallback !== undefined && column.fallback !== null && column.fallback !== '') {
      if (typeof column.fallback === 'boolean') return column.fallback ? 1 : 0;
      return column.fallback as SqlValue;
    }
    return null;
  }
  if (column.type === 'boolean' || column.type === 'domestic') return value ? 1 : 0;
  if (column.type === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return String(value);
}

function fromSqlValue(column: Column, value: SqlValue): string | number | boolean | null {
  if (value == null) {
    if (column.fallback !== undefined) return column.fallback as string | number | boolean | null;
    return null;
  }
  if (column.type === 'boolean' || column.type === 'domestic') return Boolean(value);
  if (column.type === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : ((column.fallback as number | null) ?? null);
  }
  return String(value);
}

function persist() {
  if (!db || !dbPath) return;
  mkdirSync(dirname(dbPath), { recursive: true });
  writeFileSync(dbPath, Buffer.from(db.export()));
}

function tableColumnNames(database: Database, tableName: string): string[] {
  const info = database.exec(`PRAGMA table_info("${tableName}")`);
  return (info[0]?.values || []).map((row) => String(row[1]));
}

/** ALTER TABLE で末尾に付いた列を、schema.ts の定義順に並べ替える */
function reorderTableIfNeeded(database: Database, key: SheetKey) {
  const expected = SHEET_BY_KEY[key].columns.map((column) => column.key);
  const actual = tableColumnNames(database, key);
  if (actual.length === expected.length && actual.every((name, index) => name === expected[index])) {
    return;
  }

  const temp = `${key}__reorder`;
  database.run(`DROP TABLE IF EXISTS "${temp}"`);
  database.run(createTableSql(key, temp).replace('CREATE TABLE IF NOT EXISTS', 'CREATE TABLE'));

  const existing = new Set(actual);
  const destCols = expected.map((name) => `"${name}"`).join(', ');
  const selectCols = expected
    .map((name) => (existing.has(name) ? `"${name}"` : 'NULL'))
    .join(', ');
  database.run(`INSERT INTO "${temp}" (${destCols}) SELECT ${selectCols} FROM "${key}"`);
  database.run(`DROP TABLE "${key}"`);
  database.run(`ALTER TABLE "${temp}" RENAME TO "${key}"`);
}

function migrate(database: Database) {
  database.run('PRAGMA foreign_keys = OFF');
  for (const sheet of SHEETS) {
    database.run(createTableSql(sheet.key));
    const existing = new Set(tableColumnNames(database, sheet.key));
    for (const column of sheet.columns) {
      if (existing.has(column.key)) continue;
      database.run(`ALTER TABLE "${sheet.key}" ADD COLUMN "${column.key}" ${sqlType(column)}`);
    }
    reorderTableIfNeeded(database, sheet.key);
  }
  database.run('CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id)');
  database.run('CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)');
  database.run('CREATE INDEX IF NOT EXISTS idx_unit_prices_client ON unit_prices(client_id)');
  database.run('CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id)');
  database.run('CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id)');
  database.run('CREATE INDEX IF NOT EXISTS idx_invoice_items_task ON invoice_items(task_id)');
  // 請求しないのに未請求のまま残っている行を請求対象外へ寄せる
  database.run(
    `UPDATE tasks SET billing_status = 'not_billable' WHERE is_billable = 0 AND (billing_status IS NULL OR billing_status = '' OR billing_status = 'unbilled')`
  );
  backfillSortOrder(database, 'clients');
  database.run('PRAGMA foreign_keys = ON');
}

function backfillSortOrder(database: Database, table: string) {
  const missing = database.exec(
    `SELECT id FROM "${table}" WHERE sort_order IS NULL ORDER BY created_at, id`
  );
  const ids = (missing[0]?.values || []).map((row) => String(row[0]));
  if (ids.length === 0) return;
  const maxInfo = database.exec(`SELECT MAX(sort_order) FROM "${table}"`);
  const maxValue = maxInfo[0]?.values?.[0]?.[0];
  let next = typeof maxValue === 'number' ? maxValue + 1 : 0;
  for (const id of ids) {
    database.run(`UPDATE "${table}" SET sort_order = ? WHERE id = ?`, [next, id]);
    next += 1;
  }
}

export function databasePath(env: Env) {
  return resolve(env.DATABASE_PATH || resolve(process.cwd(), 'data', 'stagecrew.sqlite'));
}

export async function openDatabase(env: Env) {
  if (db) return db;
  if (!sqlReady) {
    sqlReady = (async () => {
      const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
      const SQL = await initSqlJs({ locateFile: () => wasmPath });
      dbPath = databasePath(env);
      mkdirSync(dirname(dbPath), { recursive: true });
      if (existsSync(dbPath)) {
        db = new SQL.Database(readFileSync(dbPath));
      } else {
        db = new SQL.Database();
      }
      migrate(db);
      persist();
    })();
  }
  await sqlReady;
  return db!;
}

export function getDatabase() {
  if (!db) throw new Error('データベースが初期化されていません。');
  return db;
}

function normalizeRow(key: SheetKey, input: Row, options?: { keepCreatedAt?: string | null }) {
  const spec = SHEET_BY_KEY[key];
  const now = new Date().toISOString();
  const row: Row = {};
  for (const column of spec.columns) {
    const value = input[column.key];
    if (column.key === 'id') {
      row.id = String(value || randomUUID());
      continue;
    }
    if (column.key === 'created_at') {
      row.created_at = String(options?.keepCreatedAt || value || now);
      continue;
    }
    if (value === undefined) {
      row[column.key] = column.fallback === undefined ? null : (column.fallback as string | number | boolean | null);
    } else {
      row[column.key] = value as string | number | boolean | null;
    }
  }
  return row;
}

function rowFromDb(key: SheetKey, columns: string[], values: SqlValue[]): Row {
  const spec = SHEET_BY_KEY[key];
  const byKey = Object.fromEntries(spec.columns.map((column) => [column.key, column]));
  const row: Row = {};
  columns.forEach((name, index) => {
    const column = byKey[name];
    if (!column) return;
    row[name] = fromSqlValue(column, values[index]);
  });
  return row;
}

export function listRows(key: SheetKey): Row[] {
  const database = getDatabase();
  const result = database.exec(`SELECT * FROM "${key}"`);
  if (!result[0]) return [];
  return result[0].values.map((values) => rowFromDb(key, result[0].columns, values));
}

export function getRow(key: SheetKey, id: string): Row | null {
  const database = getDatabase();
  const stmt = database.prepare(`SELECT * FROM "${key}" WHERE id = ?`);
  stmt.bind([id]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const columns = stmt.getColumnNames();
  const values = stmt.get();
  stmt.free();
  return rowFromDb(key, columns, values);
}

function insertRow(key: SheetKey, row: Row) {
  const spec = SHEET_BY_KEY[key];
  const cols = spec.columns.map((column) => `"${column.key}"`).join(', ');
  const placeholders = spec.columns.map(() => '?').join(', ');
  const values = spec.columns.map((column) => toSqlValue(column, row[column.key]));
  getDatabase().run(`INSERT INTO "${key}" (${cols}) VALUES (${placeholders})`, values);
}

function updateRowSql(key: SheetKey, id: string, row: Row) {
  const spec = SHEET_BY_KEY[key];
  const assignments = spec.columns
    .filter((column) => column.key !== 'id' && column.key !== 'created_at')
    .map((column) => `"${column.key}" = ?`)
    .join(', ');
  const values = spec.columns
    .filter((column) => column.key !== 'id' && column.key !== 'created_at')
    .map((column) => toSqlValue(column, row[column.key]));
  getDatabase().run(`UPDATE "${key}" SET ${assignments} WHERE id = ?`, [...values, id]);
}

export function createRow(key: SheetKey, input: Row): Row {
  const row = normalizeRow(key, input);
  insertRow(key, row);
  persist();
  return row;
}

export function updateRow(key: SheetKey, id: string, patch: Row): Row {
  const existing = getRow(key, id);
  if (!existing) throw new Error('対象の行が見つかりません。');
  const next = normalizeRow(key, { ...existing, ...patch, id }, { keepCreatedAt: String(existing.created_at || '') });
  updateRowSql(key, id, next);
  persist();
  return next;
}

function selectFirstColumn(sql: string, params: SqlValue[]) {
  const stmt = getDatabase().prepare(sql);
  stmt.bind(params);
  const values: string[] = [];
  while (stmt.step()) values.push(String(stmt.get()[0] ?? ''));
  stmt.free();
  return values.filter(Boolean);
}

function parseInvoiceTaskIds(raw: unknown): string[] {
  return String(raw || '')
    .split(/[,，]/)
    .map((id) => id.trim())
    .filter(Boolean);
}

export function deleteRow(key: SheetKey, id: string) {
  const database = getDatabase();
  if (key === 'clients') {
    database.run('DELETE FROM unit_prices WHERE client_id = ?', [id]);
    for (const invoiceId of selectFirstColumn('SELECT id FROM invoices WHERE client_id = ?', [id])) {
      database.run('DELETE FROM invoice_items WHERE invoice_id = ?', [invoiceId]);
    }
    database.run('DELETE FROM invoices WHERE client_id = ?', [id]);
    database.run('UPDATE projects SET client_id = NULL WHERE client_id = ?', [id]);
  }
  if (key === 'projects') {
    for (const taskId of selectFirstColumn('SELECT id FROM tasks WHERE project_id = ?', [id])) {
      for (const item of listRows('invoice_items')) {
        const ids = parseInvoiceTaskIds(item.task_id);
        if (!ids.includes(String(taskId))) continue;
        const next = ids.filter((value) => value !== String(taskId));
        database.run('UPDATE invoice_items SET task_id = ? WHERE id = ?', [
          next.length ? next.join(',') : null,
          String(item.id),
        ]);
      }
    }
    database.run('DELETE FROM tasks WHERE project_id = ?', [id]);
  }
  if (key === 'invoices') {
    database.run('DELETE FROM invoice_items WHERE invoice_id = ?', [id]);
  }
  database.run(`DELETE FROM "${key}" WHERE id = ?`, [id]);
  persist();
}

export function replaceInvoiceItems(invoiceId: string, items: Row[]) {
  const database = getDatabase();
  database.run('DELETE FROM invoice_items WHERE invoice_id = ?', [invoiceId]);
  for (const item of items) {
    const row = normalizeRow('invoice_items', { ...item, invoice_id: invoiceId });
    insertRow('invoice_items', row);
  }
  persist();
}

function reorderSheet(key: 'clients' | 'unit_prices', ids: string[]) {
  const database = getDatabase();
  ids.forEach((id, index) => {
    database.run(`UPDATE "${key}" SET sort_order = ? WHERE id = ?`, [index, id]);
  });
  persist();
  return { ok: true as const };
}

export function reorderUnitPrices(ids: string[]) {
  return reorderSheet('unit_prices', ids);
}

export function reorderClients(ids: string[]) {
  return reorderSheet('clients', ids);
}

export function clearTable(key: SheetKey) {
  getDatabase().run(`DELETE FROM "${key}"`);
}

export type UpsertSummary = {
  key: SheetKey;
  inserted: number;
  updated: number;
  skipped: number;
  warnings: string[];
};

export function upsertRows(key: SheetKey, rows: Row[]): UpsertSummary {
  const summary: UpsertSummary = { key, inserted: 0, updated: 0, skipped: 0, warnings: [] };
  const prepared = rows.map((input) => {
    const id = String(input.id || '').trim() || randomUUID();
    return { ...input, id };
  });
  const seen = new Map<string, number>();
  prepared.forEach((row, index) => {
    const id = String(row.id);
    if (seen.has(id)) {
      summary.warnings.push(`${SHEET_BY_KEY[key].title}: 同じIDが複数行あります（${id}）。後の行を採用します。`);
    }
    seen.set(id, index);
  });

  for (const index of seen.values()) {
    const input = prepared[index];
    const id = String(input.id);
    const existing = getRow(key, id);
    if (existing) {
      const next = normalizeRow(key, { ...existing, ...input, id }, { keepCreatedAt: String(existing.created_at || '') });
      updateRowSql(key, id, next);
      summary.updated += 1;
    } else {
      const next = normalizeRow(key, { ...input, id });
      insertRow(key, next);
      summary.inserted += 1;
    }
  }
  persist();
  return summary;
}

export function replaceAllRows(key: SheetKey, rows: Row[]): UpsertSummary {
  clearTable(key);
  const prepared = rows.map((input) => {
    const id = String(input.id || '').trim() || randomUUID();
    return normalizeRow(key, { ...input, id });
  });
  const seen = new Map<string, Row>();
  const warnings: string[] = [];
  for (const row of prepared) {
    const id = String(row.id);
    if (seen.has(id)) {
      warnings.push(`${SHEET_BY_KEY[key].title}: 同じIDが複数行あります（${id}）。後の行を採用します。`);
    }
    seen.set(id, row);
  }
  for (const row of seen.values()) insertRow(key, row);
  persist();
  return { key, inserted: seen.size, updated: 0, skipped: 0, warnings };
}

export function validateForeignKeys(): string[] {
  const warnings: string[] = [];
  const clients = new Set(listRows('clients').map((row) => String(row.id)));
  const projects = new Set(listRows('projects').map((row) => String(row.id)));
  const tasks = new Set(listRows('tasks').map((row) => String(row.id)));
  const invoices = new Set(listRows('invoices').map((row) => String(row.id)));

  for (const row of listRows('projects')) {
    const clientId = String(row.client_id || '');
    if (clientId && !clients.has(clientId)) {
      warnings.push(`プロジェクト「${row.project_name || row.id}」のクライアントIDが見つかりません。`);
    }
  }
  for (const row of listRows('tasks')) {
    const projectId = String(row.project_id || '');
    if (projectId && !projects.has(projectId)) {
      warnings.push(`スケジュール（${row.id}）のプロジェクトIDが見つかりません。`);
    }
  }
  for (const row of listRows('unit_prices')) {
    const clientId = String(row.client_id || '');
    if (clientId && !clients.has(clientId)) {
      warnings.push(`単価（${row.id}）のクライアントIDが見つかりません。`);
    }
  }
  for (const row of listRows('invoices')) {
    const clientId = String(row.client_id || '');
    if (clientId && !clients.has(clientId)) {
      warnings.push(`請求書（${row.invoice_number || row.id}）のクライアントIDが見つかりません。`);
    }
  }
  for (const row of listRows('invoice_items')) {
    const invoiceId = String(row.invoice_id || '');
    const taskIds = String(row.task_id || '')
      .split(/[,，]/)
      .map((id) => id.trim())
      .filter(Boolean);
    if (invoiceId && !invoices.has(invoiceId)) {
      warnings.push(`請求明細（${row.id}）の請求書IDが見つかりません。`);
    }
    for (const taskId of taskIds) {
      if (!tasks.has(taskId)) {
        warnings.push(`請求明細（${row.id}）のスケジュールIDが見つかりません: ${taskId}`);
      }
    }
  }

  const companyCounts = new Map<string, number>();
  for (const row of listRows('clients')) {
    const name = String(row.company_name || '').trim();
    if (!name) continue;
    companyCounts.set(name, (companyCounts.get(name) || 0) + 1);
  }
  for (const [name, count] of companyCounts) {
    if (count > 1) warnings.push(`同じ会社名が${count}件あります: ${name}`);
  }
  return warnings;
}

export function databaseReady() {
  return Boolean(db);
}
