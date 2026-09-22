import type { CalendarConflict, Client, Invoice, InvoiceItem, InvoiceStatus, Project, QuantityUnit, Task, TaxType, UnitPrice } from '@/types';
import { compareCreatedAt, compareUnitPriceOrder, invoiceTotals } from '@/types';
import { findUnitPriceAmount, isManualInvoicePrice } from '@/lib/unit-price-match';
import {
  deferCalendarConflict,
  pullGoogleCalendar,
  pushTaskToCalendar,
  removeCalendarConflict,
  shouldPushTaskToCalendar,
} from '@/lib/calendar-sync';
import { spreadsheetRequestHeaders } from '@/lib/spreadsheet';
import { spreadsheetIdFromInput, spreadsheetUrlFromId } from '@/types';

type SheetKey = 'clients' | 'projects' | 'tasks' | 'unit_prices' | 'invoices' | 'invoice_items';
type Row = Record<string, unknown>;

type RawCache = {
  clients: Client[];
  projects: Project[];
  tasks: Task[];
  unitPrices: UnitPrice[];
  invoices: Invoice[];
  invoiceItems: InvoiceItem[];
};

const LOCAL_INVOICES_KEY = 'stagecrew.invoices';
const LEGACY_LOCAL_INVOICES_KEY = 'stage-light.invoices';

let raw: RawCache | null = null;
let inflight: Promise<RawCache> | null = null;
const dataListeners = new Set<() => void>();

export function subscribeData(listener: () => void) {
  dataListeners.add(listener);
  return () => {
    dataListeners.delete(listener);
  };
}

function notifyData() {
  dataListeners.forEach((listener) => listener());
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...spreadsheetRequestHeaders(), ...(init?.headers || {}) },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error || 'Googleスプレッドシートとの通信に失敗しました。');
  return body as T;
}

async function fetchSheet<T>(key: SheetKey): Promise<T[]> {
  return request<T[]>(`/api/sheets/${key}`);
}

async function loadRaw(): Promise<RawCache> {
  const [clients, projects, tasks, unitPrices, invoices, invoiceItems] = await Promise.all([
    fetchSheet<Client>('clients'),
    fetchSheet<Project>('projects'),
    fetchSheet<Task>('tasks'),
    fetchSheet<UnitPrice>('unit_prices'),
    fetchSheet<Invoice>('invoices'),
    fetchSheet<InvoiceItem>('invoice_items'),
  ]);
  return { clients, projects, tasks, unitPrices, invoices, invoiceItems };
}

async function migrateLocalInvoices(existingIds: Set<string>) {
  const raw = localStorage.getItem(LOCAL_INVOICES_KEY) || localStorage.getItem(LEGACY_LOCAL_INVOICES_KEY);
  if (!raw) return false;
  const stored = JSON.parse(raw) as (Invoice & { invoice_items?: InvoiceItem[] })[];
  if (!Array.isArray(stored) || stored.length === 0) {
    localStorage.removeItem(LOCAL_INVOICES_KEY);
    return false;
  }
  let changed = false;
  for (const invoice of stored) {
    if (!invoice?.id || existingIds.has(invoice.id)) continue;
    await createRow<Invoice>('invoices', {
      id: invoice.id,
      client_id: invoice.client_id,
      billing_month: invoice.billing_month,
      status: invoice.status,
      total_amount: invoice.total_amount,
      notes: invoice.notes,
      created_at: invoice.created_at,
    });
    if (invoice.invoice_items?.length) {
      await request('/api/sheets/invoice_items/replace', {
        method: 'POST',
        body: JSON.stringify({
          invoice_id: invoice.id,
          items: invoice.invoice_items.map((item, index) => ({
            id: item.id,
            task_id: item.task_id,
            description: item.description,
            quantity: item.quantity,
            quantity_unit: item.quantity_unit,
            unit_price: item.unit_price,
            amount: item.amount,
            sort_order: item.sort_order ?? index,
            created_at: item.created_at,
          })),
        }),
      });
    }
    changed = true;
  }
  localStorage.removeItem(LOCAL_INVOICES_KEY);
  localStorage.removeItem(LEGACY_LOCAL_INVOICES_KEY);
  return changed;
}

export function resetSheetsCache() {
  raw = null;
  inflight = null;
  notifyData();
}

export async function initializeDataSpreadsheet() {
  const data = await request<{ spreadsheetId?: string; url?: string; sheets?: string[]; error?: string }>(
    '/api/sheets/create',
    { method: 'POST', body: '{}' }
  );
  const id = data.spreadsheetId || spreadsheetIdFromInput(data.url);
  if (!id) throw new Error(data.error || 'シートと項目名を作成できませんでした。');
  return { spreadsheetId: id, url: data.url || spreadsheetUrlFromId(id), sheets: data.sheets || [] };
}

export function preloadSheets() {
  if (!inflight) {
    inflight = loadRaw()
      .then(async (data) => {
        try {
          const migrated = await migrateLocalInvoices(new Set(data.invoices.map((invoice) => invoice.id)));
          raw = migrated ? await loadRaw() : data;
        } catch (error) {
          console.error('Error migrating local invoices:', error);
          raw = data;
        }
        notifyData();
        return raw;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

async function ensure() {
  if (raw) return raw;
  return preloadSheets();
}

async function refresh(keys: SheetKey[]) {
  const current = raw || (await ensure());
  const next = { ...current };
  await Promise.all(
    keys.map(async (key) => {
      if (key === 'clients') next.clients = await fetchSheet<Client>('clients');
      if (key === 'projects') next.projects = await fetchSheet<Project>('projects');
      if (key === 'tasks') next.tasks = await fetchSheet<Task>('tasks');
      if (key === 'unit_prices') next.unitPrices = await fetchSheet<UnitPrice>('unit_prices');
      if (key === 'invoices') next.invoices = await fetchSheet<Invoice>('invoices');
      if (key === 'invoice_items') next.invoiceItems = await fetchSheet<InvoiceItem>('invoice_items');
    })
  );
  raw = next;
  notifyData();
}

function clientMap(clients: Client[]) {
  return new Map(clients.map((client) => [client.id, client]));
}

function projectMap(projects: Project[], clients: Client[]) {
  const clientsById = clientMap(clients);
  return new Map(
    projects.map((project) => [project.id, { ...project, client: clientsById.get(project.client_id || '') ?? null }])
  );
}

export async function listClients() {
  const data = await ensure();
  return [...data.clients].sort(compareCreatedAt);
}

export async function listProjects() {
  const data = await ensure();
  const clients = clientMap(data.clients);
  return [...data.projects]
    .map((project) => ({ ...project, client: clients.get(project.client_id || '') ?? null }))
    .sort(compareCreatedAt);
}

export async function listTasks(options?: { includeDeleted?: boolean }) {
  const data = await ensure();
  const projects = projectMap(data.projects, data.clients);
  return data.tasks
    .filter((task) => options?.includeDeleted || !task.is_deleted)
    .map((task) => ({ ...task, project: projects.get(task.project_id) ?? null }))
    .sort(compareCreatedAt);
}

export async function listUnitPrices() {
  const data = await ensure();
  const clients = clientMap(data.clients);
  return [...data.unitPrices]
    .map((price) => ({ ...price, client: clients.get(price.client_id) ?? null }))
    .sort(compareUnitPriceOrder);
}

async function createRow<T>(key: SheetKey, payload: Row) {
  return request<T>(`/api/sheets/${key}`, { method: 'POST', body: JSON.stringify(payload) });
}

async function updateRow<T>(key: SheetKey, id: string, payload: Row) {
  return request<T>(`/api/sheets/${key}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

async function deleteRow(key: SheetKey, id: string) {
  await request(`/api/sheets/${key}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function saveClient(payload: Record<string, unknown>, id?: string) {
  const saved = id
    ? await updateRow<Client>('clients', id, payload)
    : await createRow<Client>('clients', payload);
  await refresh(['clients']);
  return saved;
}

export async function deleteClient(id: string) {
  await deleteRow('clients', id);
  await refresh(['clients', 'projects', 'unit_prices', 'invoices', 'invoice_items']);
}

export async function saveProject(payload: Record<string, unknown>, id?: string) {
  const saved = id
    ? await updateRow<Project>('projects', id, payload)
    : await createRow<Project>('projects', payload);
  await refresh(['projects']);
  return saved;
}

export async function deleteProject(id: string) {
  const data = await ensure();
  const related = data.tasks.filter((task) => task.project_id === id);
  for (const task of related) {
    if (task.google_event_id) await pushTaskToCalendar(task.id, { deleteEvent: true });
  }
  await deleteRow('projects', id);
  await refresh(['projects', 'tasks', 'invoice_items']);
}

export async function saveTask(payload: Record<string, unknown>, id?: string) {
  const saved = id ? await updateRow<Task>('tasks', id, payload) : await createRow<Task>('tasks', payload);
  await refresh(['tasks']);
  if (shouldPushTaskToCalendar(payload, !id)) {
    const calendar = await pushTaskToCalendar(saved.id);
    if (!calendar || !('skipped' in calendar && calendar.skipped)) {
      await refresh(['tasks']);
    }
  }
  return saved;
}

export async function updateTask(id: string, payload: Record<string, unknown>) {
  return saveTask(payload, id);
}

export async function syncGoogleCalendarFromRemote(options?: { manual?: boolean }) {
  const result = await pullGoogleCalendar(options);
  if ((result.applied?.deleted || 0) + (result.applied?.updated || 0) > 0) {
    await refresh(['tasks']);
  }
  return result;
}

export async function resolveCalendarConflict(
  conflict: CalendarConflict,
  action: 'keep_app' | 'keep_google' | 'defer'
) {
  if (action === 'defer') {
    deferCalendarConflict(conflict);
    return { ok: true as const };
  }
  if (action === 'keep_app') {
    const result = await pushTaskToCalendar(conflict.taskId);
    if (result && 'error' in result && result.error) return { error: result.error };
    removeCalendarConflict(conflict.taskId);
    return { ok: true as const };
  }
  await saveTask(
    {
      time_type: conflict.google.time_type,
      start_date: conflict.google.start_date,
      date: conflict.google.start_date,
      start_time: conflict.google.start_time,
      end_date: conflict.google.end_date,
      end_time: conflict.google.end_time,
    },
    conflict.taskId
  );
  removeCalendarConflict(conflict.taskId);
  return { ok: true as const };
}

export async function saveUnitPrice(payload: Record<string, unknown>, id?: string) {
  let body = payload;
  if (!id && payload.sort_order == null) {
    const current = await listUnitPrices();
    const max = current.reduce((highest, item) => Math.max(highest, item.sort_order ?? -1), -1);
    body = { ...payload, sort_order: max + 1 };
  }
  const saved = id
    ? await updateRow<UnitPrice>('unit_prices', id, body)
    : await createRow<UnitPrice>('unit_prices', body);
  await refresh(['unit_prices']);
  return saved;
}

export async function reorderUnitPrices(ids: string[]) {
  await request('/api/sheets/unit_prices/reorder', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
  const current = raw;
  if (!current) {
    await refresh(['unit_prices']);
    return;
  }
  const byId = new Map(current.unitPrices.map((item) => [item.id, item]));
  const seen = new Set(ids);
  const ordered: UnitPrice[] = [];
  ids.forEach((id, index) => {
    const item = byId.get(id);
    if (item) ordered.push({ ...item, sort_order: index });
  });
  const rest = current.unitPrices
    .filter((item) => !seen.has(item.id))
    .map((item, index) => ({ ...item, sort_order: ordered.length + index }));
  raw = { ...current, unitPrices: [...ordered, ...rest] };
  notifyData();
}

export async function deleteUnitPrice(id: string) {
  await deleteRow('unit_prices', id);
  await refresh(['unit_prices']);
}

export async function listInvoices() {
  const data = await ensure();
  const clients = clientMap(data.clients);
  const itemsByInvoice = new Map<string, InvoiceItem[]>();
  for (const item of data.invoiceItems) {
    const list = itemsByInvoice.get(item.invoice_id) || [];
    list.push(item);
    itemsByInvoice.set(item.invoice_id, list);
  }
  return [...data.invoices]
    .map((invoice) => ({
      ...invoice,
      client: clients.get(invoice.client_id) ?? null,
      invoice_items: (itemsByInvoice.get(invoice.id) || []).sort(
        (a, b) => (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER)
      ),
    }))
    .sort(compareCreatedAt);
}

export async function listInvoiceItems() {
  const data = await ensure();
  const invoices = new Map(data.invoices.map((invoice) => [invoice.id, invoice]));
  return data.invoiceItems.map((item) => {
    const invoice = invoices.get(item.invoice_id);
    return {
      ...item,
      invoice: invoice
        ? { billing_month: invoice.billing_month, status: invoice.status as InvoiceStatus }
        : null,
    };
  });
}

export async function createInvoice(input: {
  client_id: string;
  billing_month: string;
  invoice_number: string | null;
  subject: string | null;
  issue_date: string | null;
  due_date: string | null;
  tax_type: TaxType;
  tax_rate: number;
  subtotal: number;
  tax_amount: number;
  status: InvoiceStatus;
  notes: string | null;
  total_amount: number;
}) {
  const saved = await createRow<Invoice>('invoices', input);
  await refresh(['invoices']);
  return { ...saved, invoice_items: [] as InvoiceItem[] };
}

export async function updateInvoice(
  id: string,
  patch: Partial<
    Pick<
      Invoice,
      | 'client_id'
      | 'billing_month'
      | 'invoice_number'
      | 'subject'
      | 'issue_date'
      | 'due_date'
      | 'tax_type'
      | 'tax_rate'
      | 'subtotal'
      | 'tax_amount'
      | 'status'
      | 'notes'
      | 'total_amount'
    >
  >
) {
  const saved = await updateRow<Invoice>('invoices', id, patch);
  await refresh(['invoices']);
  return saved;
}

export async function deleteInvoice(id: string) {
  await deleteRow('invoices', id);
  await refresh(['invoices', 'invoice_items']);
}

export async function replaceInvoiceItems(
  invoiceId: string,
  items: {
    task_id: string | null;
    description: string;
    quantity: number;
    quantity_unit: QuantityUnit;
    unit_price: number;
    amount: number;
    sort_order: number;
    price_manual?: boolean;
  }[]
) {
  await request('/api/sheets/invoice_items/replace', {
    method: 'POST',
    body: JSON.stringify({ invoice_id: invoiceId, items }),
  });
  await refresh(['invoice_items', 'invoices']);
}

export async function updateInvoiceItem(
  id: string,
  patch: Partial<Pick<InvoiceItem, 'description' | 'quantity' | 'unit_price' | 'amount' | 'price_manual'>>
) {
  await updateRow<InvoiceItem>('invoice_items', id, patch);
  await refresh(['invoice_items']);
}

export async function applyCatalogPricesToDraftInvoices(options?: { skipInvoiceId?: string }) {
  const [invoices, items, tasks, prices] = await Promise.all([
    listInvoices(),
    listInvoiceItems(),
    listTasks({ includeDeleted: true }),
    listUnitPrices(),
  ]);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  let invoiceCount = 0;
  let itemCount = 0;

  for (const invoice of invoices) {
    if (invoice.status !== 'draft') continue;
    if (options?.skipInvoiceId && invoice.id === options.skipInvoiceId) continue;
    const clientPrices = prices.filter((price) => price.client_id === invoice.client_id);
    const lines = items.filter((item) => item.invoice_id === invoice.id);
    let changed = false;
    const nextLines = [...lines];

    for (let index = 0; index < nextLines.length; index += 1) {
      const line = nextLines[index];
      if (isManualInvoicePrice(line) || !line.task_id) continue;
      const task = taskById.get(line.task_id);
      if (!task) continue;
      const catalog = findUnitPriceAmount(clientPrices, task);
      if (catalog <= 0 || catalog === (line.unit_price || 0)) continue;
      const quantity = line.quantity || 1;
      const amount = quantity * catalog;
      await updateInvoiceItem(line.id, {
        unit_price: catalog,
        amount,
        price_manual: false,
      });
      nextLines[index] = { ...line, unit_price: catalog, amount, price_manual: false };
      changed = true;
      itemCount += 1;
    }

    if (!changed) continue;
    const lineSum = nextLines.reduce((sum, line) => sum + (line.amount || 0), 0);
    const totals = invoiceTotals(lineSum, invoice.tax_rate || 0, invoice.tax_type === 'inclusive' ? 'inclusive' : 'exclusive');
    await updateInvoice(invoice.id, {
      subtotal: totals.subtotal,
      tax_amount: totals.taxAmount,
      total_amount: totals.total,
    });
    invoiceCount += 1;
  }

  return { invoices: invoiceCount, items: itemCount };
}
