import { useEffect, useState, useCallback, useRef } from 'react';
import {
  createInvoice,
  deleteInvoice,
  listClients,
  listInvoiceItems,
  listInvoices,
  listTasks,
  listUnitPrices,
  replaceInvoiceItems,
  updateInvoice,
  updateInvoiceItem,
  updateTask,
  applyCatalogPricesToDraftInvoices,
} from '@/lib/db';
import type { BillingStatus, Client, Invoice, InvoiceItem, InvoiceStatus, QuantityUnit, Task, UnitPrice, Project } from '@/types';
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_COLORS,
  billingFromInvoiceStatus,
  clipToMonth,
  formatDateSuffix,
  getScheduleName,
  getTaskDayCount,
  inclusiveDayCount,
  monthBounds,
  monthBillingStatus,
  strongerBilling,
  summarizeBilling,
  taskDateRange,
  taskMonthKeys,
  invoiceTotals,
  TAX_TYPE_LABELS,
  clientName,
  compareCreatedAt,
  normalizeTaxType,
} from '@/types';
import type { TaxType } from '@/types';
import {
  importPeriodForBillingMonth,
  resolveTaskBilling,
} from '@/lib/billing-policy';
import { checkDrivePdfExists, createInvoiceGmailDraft, ensureInvoicePdf, fetchInvoicePdf, invoicePdfFilename, saveInvoicePdfToDriveFolder, suggestRenamedPdfFilename, type InvoicePdfRequest } from '@/lib/invoice-pdf';
import { InvoicePdfPages } from '@/components/InvoicePdfPages';
import { loadSettings } from '@/lib/local-store';
import { useSessionPref } from '@/lib/session-list-prefs';
import { findUnitPriceAmount, findMatchingUnitPrice, isUnsetInvoicePrice, taxTypeForTask } from '@/lib/unit-price-match';
import { Modal } from '@/components/ui/Modal';
import { FormErrorList, FormField, fieldErrorClass, inputClass } from '@/components/ui/FormField';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Plus,
  Pencil,
  Trash2,
  FileText,
  Search,
  Eye,
  Printer,
  Mail,
  ArrowLeft,
  JapaneseYen,
  Calendar,
  Sparkles,
  ArrowUpDown,
  GripVertical,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';

type InvoiceSortKey = 'created_at' | 'billing_month' | 'client_name' | 'amount' | 'status';
type ExportMode = 'pdf' | 'mail' | 'pdf_and_mail';

type View = 'list' | 'preview';

interface InvoiceWithItems extends Invoice {
  invoice_items: (InvoiceItem & { task?: Task | null })[];
}

type EditInvoiceItem = {
  key: string;
  id: string | null;
  description: string;
  quantity: number;
  quantity_unit: QuantityUnit;
  unit_price: number;
  amount: number;
  task_id: string | null;
  task?: Task | null;
  sort_order?: number | null;
  price_manual?: boolean;
};


function newItemKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `item-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function artistName(task?: Task | null): string {
  return task?.project?.artist_name?.trim() || '';
}

function scheduleInstant(task: Task, billingMonth: string): string {
  const range = taskDateRange(task);
  const period = range ? clipToMonth(range.start, range.end, billingMonth) : null;
  const date = period?.start || range?.start || '9999-12-31';
  const time = (task.start_time || '00:00:00').slice(0, 8);
  return `${date}T${time}`;
}

function artistFirstInstant(tasks: Task[], billingMonth: string): Map<string, string> {
  const first = new Map<string, string>();
  for (const task of tasks) {
    const range = taskDateRange(task);
    if (!range || !clipToMonth(range.start, range.end, billingMonth)) continue;
    const artist = artistName(task);
    const instant = scheduleInstant(task, billingMonth);
    const current = first.get(artist);
    if (!current || instant < current) first.set(artist, instant);
  }
  return first;
}

function hasSavedOrder(items: { sort_order?: number | null }[]): boolean {
  return items.some((item) => item.sort_order != null);
}

function compareBySchedule<T extends { task?: Task | null }>(
  a: T,
  b: T,
  billingMonth: string,
  artistFirst: Map<string, string>
): number {
  if (!a.task && !b.task) return 0;
  if (!a.task) return 1;
  if (!b.task) return -1;
  const artistA = artistName(a.task);
  const artistB = artistName(b.task);
  const firstA = artistFirst.get(artistA) || scheduleInstant(a.task, billingMonth);
  const firstB = artistFirst.get(artistB) || scheduleInstant(b.task, billingMonth);
  if (firstA !== firstB) return firstA < firstB ? -1 : 1;
  if (artistA !== artistB) return artistA.localeCompare(artistB, 'ja');
  const scheduleA = scheduleInstant(a.task, billingMonth);
  const scheduleB = scheduleInstant(b.task, billingMonth);
  if (scheduleA !== scheduleB) return scheduleA < scheduleB ? -1 : 1;
  return (a.task.created_at || '').localeCompare(b.task.created_at || '');
}

function orderLineItems<T extends { task?: Task | null; sort_order?: number | null }>(
  items: T[],
  billingMonth: string,
  monthTasks: Task[]
): T[] {
  if (hasSavedOrder(items)) {
    return [...items].sort(
      (a, b) => (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER)
    );
  }
  const artistFirst = artistFirstInstant(
    monthTasks.length > 0 ? monthTasks : items.map((item) => item.task).filter((task): task is Task => !!task),
    billingMonth
  );
  return [...items].sort((a, b) => compareBySchedule(a, b, billingMonth, artistFirst));
}

const QUANTITY_UNITS: QuantityUnit[] = ['日', '式'];
const DATE_SUFFIX = /\s*\(\d{1,2}\/\d{1,2}(?:～\d{1,2}(?:\/\d{1,2})?)?\)$/;

function withItemDate(description: string, task?: Task | null): string {
  const trimmed = description.trim();
  if (DATE_SUFFIX.test(trimmed)) return trimmed;
  const range = task ? taskDateRange(task) : null;
  if (!range) return trimmed;
  return `${trimmed} ${formatDateSuffix(range.start, range.end)}`;
}

function quantityUnitOf(value: string | null | undefined): QuantityUnit {
  return value === '式' ? '式' : '日';
}

function findUnitPrice(priceList: UnitPrice[], task: Task): number {
  return findUnitPriceAmount(priceList, task);
}

function taxLabelForInvoice(taxType: TaxType) {
  return taxType === 'inclusive' ? '税込み' : '外税';
}

function subjectWithTaxType(base: string, taxType: TaxType, split: boolean) {
  const trimmed = base.trim();
  if (!split || !trimmed) return trimmed;
  const label = `（${taxLabelForInvoice(taxType)}）`;
  return trimmed.includes(label) ? trimmed : `${trimmed}${label}`;
}

function dominantTaxRate(items: EditInvoiceItem[], priceList: UnitPrice[], fallback: number) {
  for (const item of items) {
    if (!item.task) continue;
    const match = findMatchingUnitPrice(priceList, item.task);
    if (match && match.tax_rate != null && !Number.isNaN(Number(match.tax_rate))) {
      return Number(match.tax_rate);
    }
  }
  return fallback;
}

function descriptionForPeriod(description: string, task: Task, period: { start: string; end: string }): string {
  const base = description.replace(DATE_SUFFIX, '').trim() || getScheduleName(task);
  return `${base} ${formatDateSuffix(period.start, period.end)}`;
}

function taskExceedsMonth(task: Task, billingMonth: string): boolean {
  const range = taskDateRange(task);
  if (!range) return false;
  const bounds = monthBounds(billingMonth);
  return range.start < bounds.start || range.end > bounds.end;
}

function correctCrossMonthLine(
  item: InvoiceItem & { task?: Task | null },
  billingMonth: string,
  priceList: UnitPrice[],
  allTasks: Task[] = []
): { description: string; quantity: number; quantity_unit: QuantityUnit; unit_price: number; corrected: boolean } {
  const quantityUnit = quantityUnitOf(item.quantity_unit);
  const storedQuantity = item.quantity ?? (item.task ? getTaskDayCount(item.task) : 1);
  const storedUnitPrice =
    item.unit_price && item.unit_price > 0
      ? item.unit_price
      : storedQuantity
        ? Math.round(item.amount / storedQuantity)
        : item.amount;

  if (!item.task || quantityUnit !== '日') {
    return {
      description: withItemDate(item.description, item.task),
      quantity: storedQuantity,
      quantity_unit: quantityUnit,
      unit_price: storedUnitPrice,
      corrected: false,
    };
  }

  const projectTasks =
    allTasks.length > 0
      ? allTasks.filter((task) => task.project_id === item.task!.project_id)
      : [item.task];
  const periodInfo = importPeriodForBillingMonth(
    item.task,
    billingMonth,
    projectTasks,
    item.task.project?.client,
    item.task.project
  );

  if (periodInfo?.wholePeriod) {
    const quantity = inclusiveDayCount(periodInfo.start, periodInfo.end);
    const registered = findUnitPrice(priceList, item.task);
    const unitPrice = item.price_manual ? storedUnitPrice : registered > 0 ? registered : storedUnitPrice;
    const description = descriptionForPeriod(item.description, item.task, periodInfo);
    const corrected = quantity !== storedQuantity || unitPrice !== storedUnitPrice || description !== item.description;
    return {
      description,
      quantity,
      quantity_unit: quantityUnit,
      unit_price: unitPrice,
      corrected,
    };
  }

  if (!taskExceedsMonth(item.task, billingMonth)) {
    return {
      description: withItemDate(item.description, item.task),
      quantity: storedQuantity,
      quantity_unit: quantityUnit,
      unit_price: storedUnitPrice,
      corrected: false,
    };
  }

  const range = taskDateRange(item.task);
  const period = range ? clipToMonth(range.start, range.end, billingMonth) : null;
  const quantity = period ? inclusiveDayCount(period.start, period.end) : storedQuantity;
  const registered = findUnitPrice(priceList, item.task);
  const unitPrice = item.price_manual ? storedUnitPrice : registered > 0 ? registered : storedUnitPrice;
  const description = period
    ? descriptionForPeriod(item.description, item.task, period)
    : withItemDate(item.description, item.task);
  const corrected = quantity !== storedQuantity || unitPrice !== storedUnitPrice || description !== item.description;

  return {
    description,
    quantity,
    quantity_unit: quantityUnit,
    unit_price: unitPrice,
    corrected,
  };
}

function lineFromTask(
  task: Task & { project: Project | null },
  priceList: UnitPrice[],
  period: { start: string; end: string }
): EditInvoiceItem {
  const quantity = inclusiveDayCount(period.start, period.end);
  const unitPrice = findUnitPrice(priceList, task);
  return {
    key: newItemKey(),
    id: null,
    description: `${getScheduleName(task)} ${formatDateSuffix(period.start, period.end)}`,
    quantity,
    quantity_unit: '日',
    unit_price: unitPrice,
    amount: quantity * unitPrice,
    task_id: task.id,
    task,
    price_manual: false,
  };
}

function itemAmount(quantity: number, unitPrice: number): number {
  return (quantity || 0) * (unitPrice || 0);
}

function localDateISO(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatIssueDate(value: string | null | undefined): string {
  const match = (value || '').match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return '';
  return `${match[1]}/${Number(match[2])}/${Number(match[3])}`;
}

function parseIssueDate(value: string): string | null {
  const match = value.trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return value.trim() || null;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function defaultSubject(billingMonth: string, clientLabel: string): string {
  const match = billingMonth.match(/^(\d{4})-(\d{2})$/);
  const name = clientLabel.trim();
  if (!match || !name) return '';
  return `${name}様 ${match[1].slice(2)}年${Number(match[2])}月分`;
}

/** 一覧タイトル用。会社名と請求月のあいだでスマホだけ改行する */
function invoiceTitleParts(
  subject: string | null | undefined,
  client: Parameters<typeof clientName>[0],
  billingMonth: string
) {
  const full = (subject || '').trim() || defaultSubject(billingMonth, clientName(client)) || clientName(client) || '—';
  const match = full.match(/^(.+様)\s+(.+)$/);
  if (match) return { head: match[1], tail: match[2] };
  return { head: full, tail: '' };
}

function defaultDueDate(billingMonth: string): string {
  const match = billingMonth.match(/^(\d{4})-(\d{2})$/);
  if (!match) return '';
  const last = new Date(Number(match[1]), Number(match[2]) + 1, 0);
  const month = String(last.getMonth() + 1).padStart(2, '0');
  const day = String(last.getDate()).padStart(2, '0');
  return `${last.getFullYear()}-${month}-${day}`;
}

function nextInvoiceNumber(
  invoices: { id?: string; billing_month?: string; invoice_number?: string | null }[],
  billingMonth: string,
  excludeId?: string
): string {
  const yyyymm = billingMonth.replace('-', '');
  const inMonth = invoices.filter((invoice) => invoice.billing_month === billingMonth && invoice.id !== excludeId);
  const used = new Set(
    inMonth
      .map((invoice) => (invoice.invoice_number || '').match(/(\d+)$/)?.[1])
      .map((value) => (value ? Number(value) : NaN))
      .filter((value) => Number.isFinite(value))
  );
  let next = inMonth.length + 1;
  while (used.has(next)) next += 1;
  return `${yyyymm}-${String(next).padStart(3, '0')}`;
}

async function fetchMonthTasks(clientId: string, billingMonth: string): Promise<Task[]> {
  const bounds = monthBounds(billingMonth);
  const tasks = await listTasks();
  return tasks.filter((task) => {
    if (task.is_cancelled || task.project?.client_id !== clientId) return false;
    const range = taskDateRange(task);
    if (!range || range.start >= bounds.endExclusive) return false;
    if (range.end < bounds.start) return false;
    return !!clipToMonth(range.start, range.end, billingMonth);
  });
}

async function fetchClientPrices(clientId: string): Promise<UnitPrice[]> {
  const prices = await listUnitPrices();
  return prices.filter((price) => price.client_id === clientId);
}

async function persistCorrectedLines(
  invoiceId: string,
  items: { id: string | null; description: string; quantity: number; unit_price: number }[]
) {
  for (const item of items) {
    if (!item.id) continue;
    await updateInvoiceItem(item.id, {
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      amount: itemAmount(item.quantity, item.unit_price),
    });
  }
  const total = items.reduce((sum, item) => sum + itemAmount(item.quantity, item.unit_price), 0);
  await updateInvoice(invoiceId, { total_amount: total });
}

function asInvoice(value: unknown): { billing_month: string; status: string } | null {
  if (!value) return null;
  if (Array.isArray(value)) return (value[0] as { billing_month: string; status: string } | undefined) ?? null;
  return value as { billing_month: string; status: string };
}

async function syncTaskBillingStatus(taskIds: (string | null | undefined)[]) {
  const ids = [...new Set(taskIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return;

  const tasks = (await listTasks({ includeDeleted: true })).filter((task) => ids.includes(task.id));
  const items = (await listInvoiceItems()).filter((item) => item.task_id && ids.includes(item.task_id));

  const billed = new Map<string, Record<string, BillingStatus>>();
  for (const item of items || []) {
    if (!item.task_id) continue;
    const invoice = asInvoice(item.invoice);
    const status = billingFromInvoiceStatus(invoice?.status);
    if (!invoice?.billing_month || !status) continue;
    const current = billed.get(item.task_id) || {};
    current[invoice.billing_month] = current[invoice.billing_month]
      ? strongerBilling(current[invoice.billing_month], status)
      : status;
    billed.set(item.task_id, current);
  }

  for (const task of tasks || []) {
    const months = taskMonthKeys(task);
    const byMonth = billed.get(task.id) || {};
    const summary = summarizeBilling(
      months.map((month) => monthBillingStatus(task, month, byMonth))
    );
    if (summary !== task.billing_status) {
      try {
        await updateTask(task.id, { billing_status: summary });
      } catch (error) {
        console.error('Error updating task billing status:', error);
      }
    }
  }
}

export function InvoicesPage() {
  const [view, setView] = useState<View>('list');
  const [invoices, setInvoices] = useState<InvoiceWithItems[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [listPrefs, patchListPrefs] = useSessionPref('invoices', {
    clientFilter: 'all',
    monthFilter: 'all',
    sortBy: 'created_at' as InvoiceSortKey,
  });
  const { clientFilter, monthFilter, sortBy } = listPrefs;
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<InvoiceWithItems | null>(null);
  const [previewing, setPreviewing] = useState<InvoiceWithItems | null>(null);
  const [previewPrices, setPreviewPrices] = useState<UnitPrice[]>([]);
  const [templatePreviewBlob, setTemplatePreviewBlob] = useState<Blob | null>(null);
  const [templatePreviewError, setTemplatePreviewError] = useState('');
  const [templatePreviewLoading, setTemplatePreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applyingPrices, setApplyingPrices] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<{ tone: 'info' | 'success' | 'error'; text: string } | null>(null);
  const [driveConflict, setDriveConflict] = useState<{
    folderUrl: string;
    filename: string;
    blob: Blob;
    invoice: InvoiceWithItems;
    mode: ExportMode;
  } | null>(null);
  const [driveRenameOpen, setDriveRenameOpen] = useState(false);
  const [driveRenameValue, setDriveRenameValue] = useState('');
  const [driveSaving, setDriveSaving] = useState(false);
  const [gmailDraftDone, setGmailDraftDone] = useState(false);
  const [busyInvoiceId, setBusyInvoiceId] = useState<string | null>(null);

  const [form, setForm] = useState({
    client_id: '',
    billing_month: '',
    invoice_number: '',
    subject: '',
    issue_date: '',
    due_date: '',
    tax_type: 'exclusive' as TaxType,
    tax_rate: 10,
    status: 'draft' as InvoiceStatus,
    notes: '',
  });

  const [editItems, setEditItems] = useState<EditInvoiceItem[]>([]);
  const [autoImported, setAutoImported] = useState(false);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragFromRef = useRef<number | null>(null);
  const dragOverRef = useRef<number | null>(null);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const [clients, tasks] = await Promise.all([listClients(), listTasks({ includeDeleted: true })]);
      const clientById = new Map(clients.map((client) => [client.id, client]));
      const taskById = new Map(tasks.map((task) => [task.id, task]));
      setInvoices(
        (await listInvoices()).map((inv) => {
          const invoiceItems = (inv.invoice_items || []).map((item) => ({
            ...item,
            task: item.task_id ? taskById.get(item.task_id) ?? null : null,
          }));
          return {
            ...inv,
            client: clientById.get(inv.client_id) ?? null,
            invoice_items: hasSavedOrder(invoiceItems)
              ? orderLineItems(invoiceItems, inv.billing_month, [])
              : invoiceItems,
          };
        })
      );
    } catch (error) {
      console.error('Error fetching invoices:', error);
    }
    setLoading(false);
  }, []);

  const fetchClients = useCallback(async () => {
    try {
      setClients(await listClients());
    } catch (error) {
      console.error('Error fetching clients:', error);
    }
  }, []);

  useEffect(() => {
    fetchInvoices();
    fetchClients();
  }, [fetchInvoices, fetchClients]);

  const openCreate = () => {
    const billingMonth = new Date().toISOString().slice(0, 7);
    setEditing(null);
    setForm({
      client_id: '',
      billing_month: billingMonth,
      invoice_number: nextInvoiceNumber(invoices, billingMonth),
      subject: '',
      issue_date: formatIssueDate(localDateISO()),
      due_date: defaultDueDate(billingMonth),
      tax_type: 'exclusive',
      tax_rate: 10,
      status: 'draft',
      notes: '',
    });
    setEditItems([]);
    setAutoImported(false);
    setFormErrors([]);
    setModalOpen(true);
  };

  const openEdit = async (inv: InvoiceWithItems) => {
    const priceList = await fetchClientPrices(inv.client_id);
    const items = inv.invoice_items.map((item) => {
      const corrected = correctCrossMonthLine(item, inv.billing_month, priceList);
      return {
        key: item.id,
        id: item.id,
        description: corrected.description,
        quantity: corrected.quantity,
        quantity_unit: corrected.quantity_unit,
        unit_price: corrected.unit_price,
        amount: itemAmount(corrected.quantity, corrected.unit_price),
        task_id: item.task_id,
        task: item.task,
        sort_order: item.sort_order,
        price_manual: Boolean(item.price_manual),
      };
    });
    if (items.some((_, index) => correctCrossMonthLine(inv.invoice_items[index], inv.billing_month, priceList).corrected)) {
      await persistCorrectedLines(inv.id, items);
      fetchInvoices();
    }
    const monthTasks = hasSavedOrder(inv.invoice_items)
      ? []
      : await fetchMonthTasks(inv.client_id, inv.billing_month);
    setEditing(inv);
    setForm({
      client_id: inv.client_id,
      billing_month: inv.billing_month,
      invoice_number: inv.invoice_number || nextInvoiceNumber(invoices, inv.billing_month, inv.id),
      subject: inv.subject || defaultSubject(inv.billing_month, clientName(inv.client)),
      issue_date: formatIssueDate(inv.issue_date) || formatIssueDate(localDateISO()),
      due_date: inv.due_date || '',
      tax_type: inv.tax_type === 'inclusive' ? 'inclusive' : 'exclusive',
      tax_rate: inv.tax_rate || 0,
      status: inv.status,
      notes: inv.notes || '',
    });
    setEditItems(orderLineItems(items, inv.billing_month, monthTasks));
    setAutoImported(true);
    setFormErrors([]);
    setModalOpen(true);
  };

  const openPreview = async (inv: InvoiceWithItems) => {
    const priceList = await fetchClientPrices(inv.client_id);
    const items = inv.invoice_items.map((item) => {
      const corrected = correctCrossMonthLine(item, inv.billing_month, priceList);
      return {
        ...item,
        description: corrected.description,
        quantity: corrected.quantity,
        quantity_unit: corrected.quantity_unit,
        unit_price: corrected.unit_price,
        amount: itemAmount(corrected.quantity, corrected.unit_price),
      };
    });
    if (items.some((_, index) => correctCrossMonthLine(inv.invoice_items[index], inv.billing_month, priceList).corrected)) {
      await persistCorrectedLines(inv.id, items);
      fetchInvoices();
    }
    const monthTasks = hasSavedOrder(inv.invoice_items)
      ? []
      : await fetchMonthTasks(inv.client_id, inv.billing_month);
    const ordered = orderLineItems(items, inv.billing_month, monthTasks);
    const lineSum = ordered.reduce((sum, item) => sum + item.amount, 0);
    const totals = invoiceTotals(lineSum, inv.tax_rate || 0, inv.tax_type === 'inclusive' ? 'inclusive' : 'exclusive');
    setPreviewPrices(priceList);
    setPreviewing({
      ...inv,
      subtotal: totals.subtotal,
      tax_amount: totals.taxAmount,
      total_amount: totals.total,
      invoice_items: ordered,
    });
    setView('preview');
  };

  const handleSave = async () => {
    const errors: string[] = [];
    if (!form.client_id) errors.push('クライアントを選択してください。');
    if (!form.billing_month) errors.push('請求月を入力してください。');
    setFormErrors(errors);
    if (errors.length) return;
    setSaving(true);
    const lineSum = editItems.reduce((sum, item) => sum + itemAmount(item.quantity, item.unit_price), 0);
    const totals = invoiceTotals(lineSum, form.tax_rate, form.tax_type);
    const invoiceFields = {
      client_id: form.client_id,
      billing_month: form.billing_month,
      invoice_number: form.invoice_number.trim() || nextInvoiceNumber(invoices, form.billing_month),
      subject: form.subject.trim() || null,
      issue_date: parseIssueDate(form.issue_date),
      due_date: form.due_date || null,
      tax_type: form.tax_type,
      tax_rate: form.tax_rate || 0,
      subtotal: totals.subtotal,
      tax_amount: totals.taxAmount,
      status: form.status,
      notes: form.notes || null,
      total_amount: totals.total,
    };
    const savedItems = editItems
      .filter((item) => item.description.trim())
      .map((item, index) => ({
        task_id: item.task_id || null,
        description: item.description,
        quantity: item.quantity || 1,
        quantity_unit: item.quantity_unit,
        unit_price: item.unit_price || 0,
        amount: itemAmount(item.quantity, item.unit_price),
        sort_order: index,
        price_manual: Boolean(item.price_manual || !item.task_id),
      }));

    try {
      if (editing) {
        const previousTaskIds = editing.invoice_items.map((item) => item.task_id);
        await updateInvoice(editing.id, invoiceFields);
        await replaceInvoiceItems(editing.id, savedItems);
        await syncTaskBillingStatus([...previousTaskIds, ...editItems.map((item) => item.task_id)]);
      } else {
        const created = await createInvoice(invoiceFields);
        await replaceInvoiceItems(created.id, savedItems);
        await syncTaskBillingStatus(editItems.map((item) => item.task_id));
      }
      setModalOpen(false);
      fetchInvoices();
    } catch (error) {
      setFormErrors([error instanceof Error ? error.message : '請求書を保存できませんでした。']);
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('この請求書を削除しますか？')) return;
    const invoice = invoices.find((item) => item.id === id);
    const taskIds = invoice?.invoice_items.map((item) => item.task_id) || [];
    try {
      await deleteInvoice(id);
      await syncTaskBillingStatus(taskIds);
      fetchInvoices();
    } catch (error) {
      alert(error instanceof Error ? error.message : '請求書の削除に失敗しました。');
    }
  };

  const addItem = () => {
    setEditItems([
      ...editItems,
      { key: newItemKey(), id: null, description: '', quantity: 1, quantity_unit: '日', unit_price: 0, amount: 0, task_id: null, price_manual: true },
    ]);
  };

  const removeItem = (index: number) => {
    setEditItems(editItems.filter((_, i) => i !== index));
  };

  const reorderItems = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    setEditItems((items) => {
      const next = [...items];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const finishDrag = () => {
    const from = dragFromRef.current;
    const to = dragOverRef.current;
    dragFromRef.current = null;
    dragOverRef.current = null;
    setDraggingIndex(null);
    setDragOverIndex(null);
    if (from !== null && to !== null) reorderItems(from, to);
  };

  const updateItem = (index: number, field: keyof EditInvoiceItem, value: string | number | boolean | null) => {
    const updated = [...editItems];
    const next = { ...updated[index], [field]: value };
    if (field === 'unit_price') next.price_manual = true;
    if (field === 'quantity' || field === 'unit_price') {
      next.amount = itemAmount(next.quantity, next.unit_price);
    }
    updated[index] = next;
    setEditItems(updated);
  };

  const handleAutoImport = async () => {
    if (!form.client_id || !form.billing_month) return;

    const tasks = await listTasks();
    const prices = await listUnitPrices();
    const billedItems = (await listInvoiceItems()).filter((item) => item.task_id);
    const selected = clients.find((client) => client.id === form.client_id) || null;
    const fallbackTax = normalizeTaxType(selected?.tax_type ?? form.tax_type);
    const fallbackRate =
      selected?.tax_rate != null && !Number.isNaN(Number(selected.tax_rate))
        ? Number(selected.tax_rate)
        : form.tax_rate || 10;

    const taskList = tasks.filter((task) => {
      if (task.is_cancelled || task.is_deleted) return false;
      return task.project?.client_id === form.client_id;
    });
    const priceList = prices.filter((price) => price.client_id === form.client_id);

    let skippedBilled = 0;
    let skippedNotBillable = 0;
    let skippedWaiting = 0;
    const monthTasks: Task[] = [];
    const exclusiveItems: EditInvoiceItem[] = [];
    const inclusiveItems: EditInvoiceItem[] = [];

    for (const task of taskList) {
      const projectTasks = tasks.filter((row) => row.project_id === task.project_id);
      const client = selected || task.project?.client || null;
      const periodInfo = importPeriodForBillingMonth(
        task,
        form.billing_month,
        projectTasks,
        client,
        task.project
      );
      if (!periodInfo) {
        const resolved = resolveTaskBilling(task, projectTasks, client, task.project);
        if (resolved.kind === 'not_billable') skippedNotBillable += 1;
        else if (resolved.kind === 'waiting_show') skippedWaiting += 1;
        continue;
      }

      monthTasks.push(task);

      const onOtherInvoice = billedItems.some((item) => {
        if (item.task_id !== task.id || item.invoice_id === editing?.id) return false;
        const invoice = asInvoice(item.invoice);
        if (!invoice) return false;
        if (periodInfo.wholePeriod) return true;
        return invoice.billing_month === form.billing_month;
      });
      if (onOtherInvoice) {
        skippedBilled += 1;
        continue;
      }

      const line = lineFromTask(task, priceList, { start: periodInfo.start, end: periodInfo.end });
      const taxType = taxTypeForTask(priceList, task, fallbackTax);
      if (taxType === 'inclusive') inclusiveItems.push(line);
      else exclusiveItems.push(line);
    }

    const skipped = skippedBilled;
    if (exclusiveItems.length === 0 && inclusiveItems.length === 0) {
      const extras: string[] = [];
      if (skippedBilled > 0) extras.push(`請求書済み ${skippedBilled}件`);
      if (skippedNotBillable > 0) extras.push(`請求対象外 ${skippedNotBillable}件`);
      if (skippedWaiting > 0) extras.push(`本番待ち ${skippedWaiting}件`);
      alert(
        extras.length
          ? `取り込むスケジュールがありません。（${extras.join(' / ')}）`
          : '該当するスケジュールが見つかりませんでした。'
      );
      return;
    }

    const applyGroupToForm = (taxType: TaxType, group: EditInvoiceItem[], otherCount: number) => {
      const ordered = orderLineItems(group, form.billing_month, monthTasks);
      setEditItems(ordered);
      setForm((current) => ({
        ...current,
        tax_type: taxType,
        tax_rate: dominantTaxRate(ordered, priceList, fallbackRate),
      }));
      setAutoImported(true);
      const notices: string[] = [];
      if (skippedBilled > 0) {
        notices.push(`${skippedBilled}件はすでに請求書に含まれているため、取り込みませんでした。`);
      }
      if (skippedNotBillable > 0) {
        notices.push(`請求対象外 ${skippedNotBillable}件は取り込みませんでした。`);
      }
      if (skippedWaiting > 0) {
        notices.push(`本番待ち ${skippedWaiting}件は取り込みませんでした。`);
      }
      if (otherCount > 0) {
        const otherLabel = taxLabelForInvoice(taxType === 'inclusive' ? 'exclusive' : 'inclusive');
        notices.push(
          editing
            ? `${otherLabel}のスケジュール ${otherCount}件は、この請求書の税区分と異なるため取り込みませんでした。別の請求書として作成してください。`
            : `${otherLabel}のスケジュール ${otherCount}件は別請求書向けのため、ここでは取り込みませんでした。`
        );
      }
      if (notices.length) alert(notices.join('\n'));
    };

    if (editing) {
      const keep = form.tax_type === 'inclusive' ? inclusiveItems : exclusiveItems;
      const other = form.tax_type === 'inclusive' ? exclusiveItems : inclusiveItems;
      if (keep.length === 0) {
        alert(
          other.length > 0
            ? `この請求書は${taxLabelForInvoice(form.tax_type)}のため、該当するスケジュールがありません（${taxLabelForInvoice(
                form.tax_type === 'inclusive' ? 'exclusive' : 'inclusive'
              )} ${other.length}件）。別の請求書として作成してください。`
            : skipped > 0
              ? 'この月の分は、すでに別の請求書に含まれています。'
              : '該当するスケジュールが見つかりませんでした。'
        );
        return;
      }
      applyGroupToForm(form.tax_type, keep, other.length);
      return;
    }

    if (exclusiveItems.length > 0 && inclusiveItems.length > 0) {
      if (
        !confirm(
          `同月のスケジュールに外税 ${exclusiveItems.length}件・税込み ${inclusiveItems.length}件があります。\n外税用・税込み用の請求書をそれぞれ作成しますか？`
        )
      ) {
        return;
      }
      setSaving(true);
      try {
        const baseSubject =
          form.subject.trim() || defaultSubject(form.billing_month, clientName(selected));
        let known = invoices.map((invoice) => ({
          id: invoice.id,
          billing_month: invoice.billing_month,
          invoice_number: invoice.invoice_number,
        }));
        for (const taxType of ['exclusive', 'inclusive'] as TaxType[]) {
          const group = taxType === 'inclusive' ? inclusiveItems : exclusiveItems;
          const ordered = orderLineItems(group, form.billing_month, monthTasks);
          const taxRate = dominantTaxRate(ordered, priceList, fallbackRate);
          const lineSum = ordered.reduce((sum, item) => sum + itemAmount(item.quantity, item.unit_price), 0);
          const totals = invoiceTotals(lineSum, taxRate, taxType);
          const invoiceNumber = nextInvoiceNumber(known, form.billing_month);
          const created = await createInvoice({
            client_id: form.client_id,
            billing_month: form.billing_month,
            invoice_number: invoiceNumber,
            subject: subjectWithTaxType(baseSubject, taxType, true),
            issue_date: parseIssueDate(form.issue_date),
            due_date: form.due_date || null,
            tax_type: taxType,
            tax_rate: taxRate,
            subtotal: totals.subtotal,
            tax_amount: totals.taxAmount,
            status: form.status,
            notes: form.notes || null,
            total_amount: totals.total,
          });
          await replaceInvoiceItems(
            created.id,
            ordered
              .filter((item) => item.description.trim())
              .map((item, index) => ({
                task_id: item.task_id || null,
                description: item.description,
                quantity: item.quantity || 1,
                quantity_unit: item.quantity_unit,
                unit_price: item.unit_price || 0,
                amount: itemAmount(item.quantity, item.unit_price),
                sort_order: index,
                price_manual: Boolean(item.price_manual || !item.task_id),
              }))
          );
          await syncTaskBillingStatus(ordered.map((item) => item.task_id));
          known = [...known, { id: created.id, billing_month: form.billing_month, invoice_number: invoiceNumber }];
        }
        setModalOpen(false);
        fetchInvoices();
        const notes: string[] = ['外税用・税込み用の請求書を作成しました。'];
        if (skippedBilled > 0) notes.push(`${skippedBilled}件はすでに請求書に含まれているため、取り込みませんでした。`);
        if (skippedNotBillable > 0) notes.push(`請求対象外 ${skippedNotBillable}件は取り込みませんでした。`);
        if (skippedWaiting > 0) notes.push(`本番待ち ${skippedWaiting}件は取り込みませんでした。`);
        alert(notes.join('\n'));
      } catch (error) {
        alert(error instanceof Error ? error.message : '請求書の作成に失敗しました。');
      }
      setSaving(false);
      return;
    }

    const taxType: TaxType = inclusiveItems.length > 0 ? 'inclusive' : 'exclusive';
    applyGroupToForm(taxType, taxType === 'inclusive' ? inclusiveItems : exclusiveItems, 0);
  };

  const handleApplyCatalogPrices = async () => {
    if (!form.client_id) return;
    setApplyingPrices(true);
    try {
      const prices = await fetchClientPrices(form.client_id);
      setEditItems((items) =>
        items.map((item) => {
          if (item.price_manual || !item.task) return item;
          const catalog = findUnitPrice(prices, item.task);
          if (catalog <= 0) return item;
          return { ...item, unit_price: catalog, amount: itemAmount(item.quantity, catalog), price_manual: false };
        })
      );
      const others = await applyCatalogPricesToDraftInvoices({ skipInvoiceId: editing?.id });
      alert(
        others.items > 0
          ? `登録単価を取り込みました。手動入力の単価はそのままです。ほかの下書き請求書 ${others.invoices}件（${others.items}明細）も更新しました。`
          : '登録単価を取り込みました。未設定の項目は単価管理に該当する単価がないためそのままです。手動入力の単価は変更していません。'
      );
      if (others.items > 0) fetchInvoices();
    } catch (error) {
      alert(error instanceof Error ? error.message : '登録単価の取り込みに失敗しました。');
    }
    setApplyingPrices(false);
  };

  const filtered = invoices.filter((inv) => {
    const matchesSearch =
      clientName(inv.client).toLowerCase().includes(search.toLowerCase()) ||
      (inv.invoice_number || '').toLowerCase().includes(search.toLowerCase()) ||
      (inv.subject || '').toLowerCase().includes(search.toLowerCase()) ||
      inv.billing_month.includes(search);
    const matchesClient = clientFilter === 'all' || inv.client_id === clientFilter;
    const matchesMonth = monthFilter === 'all' || inv.billing_month === monthFilter;
    return matchesSearch && matchesClient && matchesMonth;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'created_at') return compareCreatedAt(a, b);
    if (sortBy === 'billing_month') {
      return b.billing_month.localeCompare(a.billing_month);
    }
    if (sortBy === 'client_name') {
      const nameA = (clientName(a.client) || 'zzz').toLowerCase();
      const nameB = (clientName(b.client) || 'zzz').toLowerCase();
      return nameA.localeCompare(nameB, 'ja');
    }
    if (sortBy === 'amount') {
      return b.total_amount - a.total_amount;
    }
    if (sortBy === 'status') {
      const order = { draft: 0, issued: 1, paid: 2 };
      return (order[a.status] ?? 9) - (order[b.status] ?? 9);
    }
    return 0;
  });

  const months = [...new Set(invoices.map((i) => i.billing_month))].sort().reverse();

  const formatYen = (n: number) => `¥${n.toLocaleString()}`;
  const selectedClient = clients.find((client) => client.id === form.client_id) || null;
  const formTotals = invoiceTotals(
    editItems.reduce((sum, item) => sum + itemAmount(item.quantity, item.unit_price), 0),
    form.tax_rate,
    form.tax_type
  );
  const unsetPriceCount = editItems.filter((item) => isUnsetInvoicePrice(item)).length;

  const applyBillingMonth = (billingMonth: string) => {
    setForm((current) => {
      const previousMonth = current.billing_month;
      const next = { ...current, billing_month: billingMonth };
      if (!editing) {
        if (!current.invoice_number || current.invoice_number === nextInvoiceNumber(invoices, previousMonth)) {
          next.invoice_number = nextInvoiceNumber(invoices, billingMonth);
        }
        const clientLabel = clientName(clients.find((client) => client.id === current.client_id));
        if (!current.subject || current.subject === defaultSubject(previousMonth, clientLabel)) {
          next.subject = defaultSubject(billingMonth, clientLabel);
        }
        if (!current.due_date || current.due_date === defaultDueDate(previousMonth)) {
          next.due_date = defaultDueDate(billingMonth);
        }
      }
      return next;
    });
  };

  const buildPdfRequest = useCallback((invoice: InvoiceWithItems, prices: UnitPrice[]): InvoicePdfRequest | null => {
    const settings = loadSettings();
    const inclusive = invoice.tax_type === 'inclusive';
    const templateUrl = inclusive ? settings.invoice_template_int_tax_url : settings.invoice_template_ext_tax_url;
    const detailTemplateUrl = inclusive
      ? settings.invoice_template_detail_int_tax_url
      : settings.invoice_template_detail_ext_tax_url;
    const useDetail = invoice.invoice_items.length > 15;
    if (useDetail ? !detailTemplateUrl : !templateUrl) return null;
    return {
      templateUrl: templateUrl || detailTemplateUrl || '',
      detailTemplateUrl,
      filename: invoicePdfFilename(clientName(invoice.client), invoice.billing_month, invoice.invoice_number),
      clientName: clientName(invoice.client),
      representativeName: invoice.client?.representative_name || '',
      issueDate: invoice.issue_date,
      invoiceNumber: invoice.invoice_number,
      subject: invoice.subject,
      dueDate: invoice.due_date,
      taxRate: invoice.tax_rate || 0,
      subtotal: invoice.subtotal,
      taxAmount: invoice.tax_amount,
      totalAmount: invoice.total_amount,
      notes: invoice.notes,
      items: invoice.invoice_items.map((item) => {
        const line = correctCrossMonthLine(item, invoice.billing_month, prices);
        return {
          description: line.description,
          quantity: line.quantity,
          quantity_unit: line.quantity_unit,
          unit_price: line.unit_price,
          amount: itemAmount(line.quantity, line.unit_price),
        };
      }),
    };
  }, []);

  useEffect(() => {
    if (view !== 'preview' || !previewing) return;
    setExportStatus(null);
    const request = buildPdfRequest(previewing, previewPrices);
    if (!request) {
      setTemplatePreviewBlob(null);
      setTemplatePreviewError(
        previewing.invoice_items.length > 15
          ? previewing.tax_type === 'inclusive'
            ? '設定に明細書（内税）テンプレートのURLを登録してください。'
            : '設定に明細書（外税）テンプレートのURLを登録してください。'
          : previewing.tax_type === 'inclusive'
            ? '設定に内税テンプレートのURLを登録してください。'
            : '設定に外税テンプレートのURLを登録してください。'
      );
      setTemplatePreviewLoading(false);
      return;
    }

    let cancelled = false;
    setTemplatePreviewLoading(true);
    setTemplatePreviewError('');
    setTemplatePreviewBlob(null);
    fetchInvoicePdf(request)
      .then((blob) => {
        if (cancelled) return;
        setTemplatePreviewBlob(blob);
      })
      .catch((error) => {
        if (cancelled) return;
        const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        setTemplatePreviewError(timedOut ? 'プレビューの作成が時間内に終わりませんでした。もう一度開いてください。' : error instanceof Error ? error.message : 'プレビューを作成できませんでした。');
      })
      .finally(() => {
        if (!cancelled) setTemplatePreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [view, previewing, previewPrices, buildPdfRequest]);

  const pdfOnlyDoneMessage = '請求書PDFをGoogleドライブに保存しました';
  const mailOnlyDoneMessage = 'Gmail下書きの作成が完了しました';
  const pdfAndGmailDoneMessage = '請求書PDFの出力およびGmail下書きの作成が完了しました';

  const templateMissingMessage = (invoice: InvoiceWithItems) =>
    invoice.invoice_items.length > 15
      ? invoice.tax_type === 'inclusive'
        ? '設定に明細書（内税）テンプレートのURLを登録してください。'
        : '設定に明細書（外税）テンプレートのURLを登録してください。'
      : invoice.tax_type === 'inclusive'
        ? '設定に内税テンプレートのURLを登録してください。'
        : '設定に外税テンプレートのURLを登録してください。';

  const createGmailDraftForInvoice = async (invoice: InvoiceWithItems, filename: string, blob: Blob) => {
    if (!loadSettings().gmail_sender_email?.trim()) {
      throw new Error('設定画面で送信元メールアドレスを設定してください');
    }
    await createInvoiceGmailDraft({
      filename,
      blob,
      clientName: clientName(invoice.client),
      contactPersonName: invoice.client?.contact_person_name,
      contactPersonEmail: invoice.client?.contact_person_email,
      representativeName: invoice.client?.representative_name,
      representativeEmail: invoice.client?.representative_email || invoice.client?.email,
      issueDate: invoice.issue_date,
      invoiceNumber: invoice.invoice_number,
      totalAmount: invoice.total_amount,
      dueDate: invoice.due_date,
    });
  };

  const markInvoiceIssuedIfDraft = async (invoice: InvoiceWithItems) => {
    if (invoice.status !== 'draft') return;
    try {
      await updateInvoice(invoice.id, { status: 'issued' });
      setPreviewing((current) => (current?.id === invoice.id ? { ...current, status: 'issued' } : current));
      setInvoices((current) =>
        current.map((item) => (item.id === invoice.id ? { ...item, status: 'issued' } : item))
      );
      await syncTaskBillingStatus(invoice.invoice_items.map((item) => item.task_id));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ステータスを更新できませんでした。';
      setExportStatus((current) => ({
        tone: 'error',
        text: `${current?.text || '処理は完了しました。'} 請求済への更新に失敗しました。${message}`,
      }));
    }
  };

  const prepareInvoiceForExport = async (inv: InvoiceWithItems): Promise<{ invoice: InvoiceWithItems; prices: UnitPrice[] }> => {
    if (previewing?.id === inv.id) {
      return { invoice: previewing, prices: previewPrices };
    }
    const priceList = await fetchClientPrices(inv.client_id);
    const items = inv.invoice_items.map((item) => {
      const corrected = correctCrossMonthLine(item, inv.billing_month, priceList);
      return {
        ...item,
        description: corrected.description,
        quantity: corrected.quantity,
        quantity_unit: corrected.quantity_unit,
        unit_price: corrected.unit_price,
        amount: itemAmount(corrected.quantity, corrected.unit_price),
      };
    });
    if (items.some((_, index) => correctCrossMonthLine(inv.invoice_items[index], inv.billing_month, priceList).corrected)) {
      await persistCorrectedLines(inv.id, items);
      fetchInvoices();
    }
    const monthTasks = hasSavedOrder(inv.invoice_items) ? [] : await fetchMonthTasks(inv.client_id, inv.billing_month);
    const ordered = orderLineItems(items, inv.billing_month, monthTasks);
    const lineSum = ordered.reduce((sum, item) => sum + item.amount, 0);
    const totals = invoiceTotals(lineSum, inv.tax_rate || 0, inv.tax_type === 'inclusive' ? 'inclusive' : 'exclusive');
    return {
      prices: priceList,
      invoice: {
        ...inv,
        subtotal: totals.subtotal,
        tax_amount: totals.taxAmount,
        total_amount: totals.total,
        invoice_items: ordered,
      },
    };
  };

  const uploadPdfToDrive = async (options: {
    folderUrl: string;
    filename: string;
    blob: Blob;
    mode: 'create' | 'overwrite';
    invoice: InvoiceWithItems;
    exportMode: ExportMode;
    gmailOk?: boolean;
  }) => {
    const gmailOk = options.gmailOk ?? gmailDraftDone;
    setDriveSaving(true);
    setExportStatus({ tone: 'info', text: 'Googleドライブへ保存しています...' });
    try {
      await saveInvoicePdfToDriveFolder(options);
      setDriveConflict(null);
      setDriveRenameOpen(false);
      const successText =
        options.exportMode === 'pdf_and_mail' && gmailOk
          ? `${pdfAndGmailDoneMessage}（${options.filename}）`
          : `${pdfOnlyDoneMessage}（${options.filename}）`;
      setExportStatus({ tone: 'success', text: successText });
      await markInvoiceIssuedIfDraft(options.invoice);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Googleドライブへの保存に失敗しました。';
      setExportStatus({
        tone: 'error',
        text:
          options.exportMode === 'pdf_and_mail' && gmailOk
            ? `${mailOnlyDoneMessage} Googleドライブへの保存に失敗しました。${message}`
            : `Googleドライブへの保存に失敗しました。${message}`,
      });
    } finally {
      setDriveSaving(false);
    }
  };

  const runInvoiceExport = async (
    source: InvoiceWithItems,
    mode: ExportMode,
    existingBlob?: Blob | null
  ) => {
    if (exporting || driveSaving) return;
    setExporting(true);
    setBusyInvoiceId(source.id);
    setDriveConflict(null);
    setDriveRenameOpen(false);
    setGmailDraftDone(false);
    setExportStatus({
      tone: 'info',
      text: mode === 'mail' ? '請求書PDFを作成し、Gmail下書きを準備しています...' : 'PDFを作成しています...',
    });
    try {
      const prepared = await prepareInvoiceForExport(source);
      const invoice = prepared.invoice;
      const request = buildPdfRequest(invoice, prepared.prices);
      if (!request) {
        setExportStatus({ tone: 'error', text: templateMissingMessage(invoice) });
        return;
      }

      const pdf =
        existingBlob && previewing?.id === invoice.id
          ? await ensureInvoicePdf(request, existingBlob)
          : await ensureInvoicePdf(request);

      let gmailOk = false;
      if (mode === 'mail' || mode === 'pdf_and_mail') {
        try {
          setExportStatus({ tone: 'info', text: 'Gmailの下書きを作成しています...' });
          await createGmailDraftForInvoice(invoice, pdf.filename, pdf.blob);
          gmailOk = true;
          setGmailDraftDone(true);
        } catch (gmailError) {
          const message = gmailError instanceof Error ? gmailError.message : 'Gmail下書きの作成に失敗しました。';
          if (mode === 'mail') {
            setExportStatus({ tone: 'error', text: message });
            return;
          }
          setExportStatus({
            tone: 'error',
            text: `PDFは作成しましたが、Gmail下書きの作成に失敗しました。${message}`,
          });
        }
      }

      if (mode === 'mail') {
        setExportStatus({ tone: 'success', text: mailOnlyDoneMessage });
        await markInvoiceIssuedIfDraft(invoice);
        return;
      }

      const folderUrl = loadSettings().invoice_pdf_drive_folder_url?.trim() || '';
      if (!folderUrl) {
        setExportStatus({
          tone: 'error',
          text: gmailOk
            ? `${mailOnlyDoneMessage} Googleドライブには保存していません。設定画面で「PDFの保存先フォルダURL」を入力して「保存」を押してください。`
            : '設定画面で「PDFの保存先フォルダURL」を入力して「保存」を押してください。',
        });
        if (gmailOk) await markInvoiceIssuedIfDraft(invoice);
        return;
      }

      setExportStatus({ tone: 'info', text: 'Googleドライブ上の同名ファイルを確認しています...' });
      const checked = await checkDrivePdfExists({
        folderUrl,
        filename: pdf.filename,
      });
      if (checked.exists) {
        setDriveConflict({
          folderUrl,
          filename: checked.filename,
          blob: pdf.blob,
          invoice,
          mode,
        });
        setDriveRenameValue(suggestRenamedPdfFilename(checked.filename));
        setExportStatus({
          tone: gmailOk || mode === 'pdf' ? 'info' : 'error',
          text:
            mode === 'pdf_and_mail' && gmailOk
              ? `${mailOnlyDoneMessage} 同じ名前のファイルが既にあるため、Googleドライブの保存方法を選んでください。（${checked.filename}）`
              : `同じ名前のファイルが既にあるため、保存方法を選んでください。（${checked.filename}）`,
        });
        return;
      }

      await uploadPdfToDrive({
        folderUrl,
        filename: pdf.filename,
        blob: pdf.blob,
        mode: 'create',
        invoice,
        exportMode: mode,
        gmailOk,
      });
    } catch (error) {
      setExportStatus({
        tone: 'error',
        text: error instanceof Error ? error.message : '処理に失敗しました。',
      });
    } finally {
      setExporting(false);
      setBusyInvoiceId(null);
    }
  };

  const handleDriveOverwrite = async () => {
    if (!driveConflict || driveSaving) return;
    await uploadPdfToDrive({
      folderUrl: driveConflict.folderUrl,
      filename: driveConflict.filename,
      blob: driveConflict.blob,
      mode: 'overwrite',
      invoice: driveConflict.invoice,
      exportMode: driveConflict.mode,
    });
  };

  const handleDriveCancel = () => {
    const conflict = driveConflict;
    setDriveConflict(null);
    setDriveRenameOpen(false);
    setExportStatus({
      tone: gmailDraftDone ? 'success' : 'info',
      text: gmailDraftDone
        ? `${mailOnlyDoneMessage} Googleドライブへの保存はキャンセルしました。`
        : 'Googleドライブへの保存はキャンセルしました。',
    });
    if (conflict && gmailDraftDone) void markInvoiceIssuedIfDraft(conflict.invoice);
  };

  const handleDriveRenameSave = async () => {
    if (!driveConflict || driveSaving) return;
    const nextName = driveRenameValue.trim();
    if (!nextName) {
      setExportStatus({ tone: 'error', text: '新しいファイル名を入力してください。' });
      return;
    }
    const filename = nextName.toLowerCase().endsWith('.pdf') ? nextName : `${nextName}.pdf`;
    setExportStatus({ tone: 'info', text: '変更後のファイル名を確認しています...' });
    try {
      const checked = await checkDrivePdfExists({
        folderUrl: driveConflict.folderUrl,
        filename,
      });
      if (checked.exists) {
        setDriveConflict({ ...driveConflict, filename: checked.filename });
        setDriveRenameValue(suggestRenamedPdfFilename(checked.filename));
        setDriveRenameOpen(true);
        setExportStatus({
          tone: 'info',
          text: `変更後の名前（${checked.filename}）も既に使われています。別の名前にするか、上書き・キャンセルを選んでください。`,
        });
        return;
      }
      await uploadPdfToDrive({
        folderUrl: driveConflict.folderUrl,
        filename,
        blob: driveConflict.blob,
        mode: 'create',
        invoice: driveConflict.invoice,
        exportMode: driveConflict.mode,
      });
    } catch (error) {
      setExportStatus({
        tone: 'error',
        text: error instanceof Error ? error.message : 'ファイル名の確認に失敗しました。',
      });
    }
  };

  const exportBusy = exporting || driveSaving;

  const ExportActionButtons = ({
    invoice,
    existingBlob,
    compact,
  }: {
    invoice: InvoiceWithItems;
    existingBlob?: Blob | null;
    compact?: boolean;
  }) => {
    const busy = exportBusy && busyInvoiceId === invoice.id;
    const label = (idle: string) => (busy ? '処理中...' : idle);
    return (
      <>
        <button
          type="button"
          onClick={() => void runInvoiceExport(invoice, 'pdf', existingBlob)}
          disabled={exportBusy}
          className="btn-secondary"
          title="PDFをGoogleドライブに保存"
        >
          <Printer className="h-4 w-4" />
          {label('PDF作成')}
        </button>
        <button
          type="button"
          onClick={() => void runInvoiceExport(invoice, 'mail', existingBlob)}
          disabled={exportBusy}
          className="btn-secondary"
          title="PDFを添付したGmail下書きを作成"
        >
          <Mail className="h-4 w-4" />
          {label('メール作成')}
        </button>
        <button
          type="button"
          onClick={() => void runInvoiceExport(invoice, 'pdf_and_mail', existingBlob)}
          disabled={exportBusy}
          className="btn-primary"
          title="PDFをGoogleドライブに保存し、Gmail下書きも作成"
        >
          <FileText className="h-4 w-4" />
          {label(compact ? 'PDF+メール' : 'PDF作成 + メール下書き')}
        </button>
      </>
    );
  };

  if (view === 'preview' && previewing) {
    return (
      <div>
        <div className="page-toolbar no-print">
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                setView('list');
                setPreviewing(null);
              }}
              className="btn-icon"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="page-title">請求書プレビュー</h1>
              <p className="mt-1 text-sm text-slate-500">{previewing.billing_month}の請求書。テンプレートのレイアウトで表示しています</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              onClick={() => {
                setView('list');
                setPreviewing(null);
                openEdit(previewing);
              }}
              className="btn-secondary"
            >
              <Pencil className="h-4 w-4" />
              編集
            </button>
            <ExportActionButtons invoice={previewing} existingBlob={templatePreviewBlob} />
          </div>
        </div>

        {exportStatus && (
          <div
            className={`no-print mb-4 rounded-lg border px-4 py-3 text-sm ${
              exportStatus.tone === 'success'
                ? 'border-teal-200 bg-teal-50 text-teal-900'
                : exportStatus.tone === 'error'
                  ? 'border-rose-200 bg-rose-50 text-rose-900'
                  : 'border-slate-200 bg-slate-50 text-slate-700'
            }`}
          >
            {exportStatus.text}
          </div>
        )}
        {previewing.invoice_items.some((item) => isUnsetInvoicePrice(item)) ? (
          <div className="no-print mb-4 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>単価未設定の明細があります。クライアントに金額を確認するか、編集画面で登録単価を取り込んでください。</p>
          </div>
        ) : null}

        <Modal
          open={Boolean(driveConflict)}
          onClose={driveSaving ? () => undefined : handleDriveCancel}
          title="同じ名前のファイルがあります"
          maxWidth="max-w-md"
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Googleドライブに「{driveConflict?.filename}」が既にあります。どうしますか？
            </p>

            {driveRenameOpen ? (
              <FormField label="新しいファイル名">
                <input
                  type="text"
                  value={driveRenameValue}
                  onChange={(e) => setDriveRenameValue(e.target.value)}
                  className={inputClass}
                  disabled={driveSaving}
                />
              </FormField>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={handleDriveCancel} disabled={driveSaving} className="btn-secondary">
                キャンセル
              </button>
              {!driveRenameOpen ? (
                <button
                  type="button"
                  onClick={() => {
                    if (!driveConflict) return;
                    setDriveRenameValue(suggestRenamedPdfFilename(driveConflict.filename));
                    setDriveRenameOpen(true);
                  }}
                  disabled={driveSaving}
                  className="btn-secondary"
                >
                  ファイル名を変更
                </button>
              ) : (
                <button type="button" onClick={handleDriveRenameSave} disabled={driveSaving} className="btn-primary">
                  {driveSaving ? '保存中...' : 'この名前で保存'}
                </button>
              )}
              <button type="button" onClick={handleDriveOverwrite} disabled={driveSaving} className="btn-primary">
                {driveSaving ? '保存中...' : '上書き'}
              </button>
            </div>
          </div>
        </Modal>

        <div className="print-area mx-auto">
          {templatePreviewLoading && (
            <div className="flex min-h-[24rem] items-center justify-center text-sm text-slate-500">テンプレートからプレビューを作成しています...</div>
          )}
          {!templatePreviewLoading && templatePreviewError && (
            <div className="flex min-h-[24rem] items-center justify-center px-6 text-center text-sm text-slate-600">{templatePreviewError}</div>
          )}
          {!templatePreviewLoading && templatePreviewBlob && <InvoicePdfPages blob={templatePreviewBlob} />}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-toolbar">
        <div>
          <h1 className="page-title">請求書一覧</h1>
          <p className="mt-1 text-sm text-slate-500">月次の請求書を管理・発行します</p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="h-4 w-4" />
          新規請求書
        </button>
      </div>

      {exportStatus && view === 'list' && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            exportStatus.tone === 'success'
              ? 'border-teal-200 bg-teal-50 text-teal-900'
              : exportStatus.tone === 'error'
                ? 'border-rose-200 bg-rose-50 text-rose-900'
                : 'border-slate-200 bg-slate-50 text-slate-700'
          }`}
        >
          {exportStatus.text}
        </div>
      )}

      <Modal
        open={Boolean(driveConflict) && view === 'list'}
        onClose={driveSaving ? () => undefined : handleDriveCancel}
        title="同じ名前のファイルがあります"
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Googleドライブに「{driveConflict?.filename}」が既にあります。どうしますか？
          </p>

          {driveRenameOpen ? (
            <FormField label="新しいファイル名">
              <input
                type="text"
                value={driveRenameValue}
                onChange={(e) => setDriveRenameValue(e.target.value)}
                className={inputClass}
                disabled={driveSaving}
              />
            </FormField>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={handleDriveCancel} disabled={driveSaving} className="btn-secondary">
              キャンセル
            </button>
            {!driveRenameOpen ? (
              <button
                type="button"
                onClick={() => {
                  if (!driveConflict) return;
                  setDriveRenameValue(suggestRenamedPdfFilename(driveConflict.filename));
                  setDriveRenameOpen(true);
                }}
                disabled={driveSaving}
                className="btn-secondary"
              >
                ファイル名を変更
              </button>
            ) : (
              <button type="button" onClick={handleDriveRenameSave} disabled={driveSaving} className="btn-primary">
                {driveSaving ? '保存中...' : 'この名前で保存'}
              </button>
            )}
            <button type="button" onClick={handleDriveOverwrite} disabled={driveSaving} className="btn-primary">
              {driveSaving ? '保存中...' : '上書き'}
            </button>
          </div>
        </div>
      </Modal>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="クライアント名、請求月で検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputClass} pl-10`}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
          <span className="shrink-0 text-xs font-medium text-slate-400">クライアント名</span>
          <select
            value={clientFilter}
            onChange={(e) => patchListPrefs({ clientFilter: e.target.value })}
            className={`${inputClass} w-full sm:w-auto`}
          >
            <option value="all">すべて</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {clientName(c)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
          <span className="shrink-0 text-xs font-medium text-slate-400">請求月</span>
          <select
            value={monthFilter}
            onChange={(e) => patchListPrefs({ monthFilter: e.target.value })}
            className={`${inputClass} w-full sm:w-auto`}
          >
            <option value="all">すべて</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ArrowUpDown className="h-4 w-4 text-slate-400" />
        <span className="text-sm text-slate-500">並び替え:</span>
        {([
          { key: 'created_at', label: '登録順' },
          { key: 'billing_month', label: '請求月' },
          { key: 'client_name', label: 'クライアント名' },
          { key: 'status', label: 'ステータス' },
          { key: 'amount', label: '金額' },
        ] as { key: InvoiceSortKey; label: string }[]).map((s) => (
          <button
            key={s.key}
            onClick={() => patchListPrefs({ sortBy: s.key })}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
              sortBy === s.key
                ? 'bg-teal-100 text-teal-700 border border-teal-200'
                : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<FileText className="h-7 w-7" />}
            title="請求書がありません"
            description="新規請求書ボタンから作成してください"
          />
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((inv) => (
            <div key={inv.id} className="list-card group">
              <div className="list-card-main">
                <div className="list-card-icon">
                  <FileText className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge label={INVOICE_STATUS_LABELS[inv.status]} className={INVOICE_STATUS_COLORS[inv.status]} />
                    {inv.status === 'draft' && inv.invoice_items.some((item) => isUnsetInvoicePrice(item)) ? (
                      <Badge label="単価未設定" className="bg-amber-100 text-amber-800 border-amber-200" />
                    ) : null}
                  </div>
                  {(() => {
                    const title = invoiceTitleParts(inv.subject, inv.client, inv.billing_month);
                    return (
                      <h3 className="mt-1 font-semibold text-slate-900">
                        <span className="block sm:inline">{title.head}</span>
                        {title.tail ? (
                          <span className="block sm:ml-1 sm:inline">{title.tail}</span>
                        ) : null}
                      </h3>
                    );
                  })()}
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-sm text-slate-500">
                    <span>{clientName(inv.client) || '—'}</span>
                    {inv.invoice_number && <span>{inv.invoice_number}</span>}
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {inv.billing_month}
                    </span>
                    <span className="flex items-center gap-1">
                      <JapaneseYen className="h-3.5 w-3.5" />
                      {formatYen(inv.total_amount)}
                    </span>
                    <span>{inv.invoice_items.length}件</span>
                  </div>
                </div>
              </div>
              <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:items-stretch">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => openPreview(inv)} className="btn-secondary">
                    <Eye className="h-4 w-4" />
                    プレビュー
                  </button>
                  <div className="row-actions ml-auto">
                    <button type="button" onClick={() => openEdit(inv)} className="btn-icon">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => handleDelete(inv.id)} className="btn-icon hover:text-red-500">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void runInvoiceExport(inv, 'pdf')}
                    disabled={exportBusy}
                    className="btn-secondary"
                    title="PDFをGoogleドライブに保存"
                  >
                    <Printer className="h-4 w-4" />
                    {exportBusy && busyInvoiceId === inv.id ? '処理中...' : 'PDF作成'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void runInvoiceExport(inv, 'mail')}
                    disabled={exportBusy}
                    className="btn-secondary"
                    title="PDFを添付したGmail下書きを作成"
                  >
                    <Mail className="h-4 w-4" />
                    {exportBusy && busyInvoiceId === inv.id ? '処理中...' : 'メール作成'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void runInvoiceExport(inv, 'pdf_and_mail')}
                    disabled={exportBusy}
                    className="btn-primary"
                    title="PDFをGoogleドライブに保存し、Gmail下書きも作成"
                  >
                    <FileText className="h-4 w-4" />
                    {exportBusy && busyInvoiceId === inv.id ? '処理中...' : 'PDF+メール'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? '請求書編集' : '新規請求書作成'}
        maxWidth="max-w-5xl"
      >
        <div className="space-y-4">
          <FormErrorList errors={formErrors} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="クライアント" required>
              <select
                value={form.client_id}
                onChange={(e) => {
                  const clientId = e.target.value;
                  const client = clients.find((item) => item.id === clientId);
                  const previousLabel = clientName(clients.find((item) => item.id === form.client_id));
                  const nextLabel = clientName(client);
                  const generated = defaultSubject(form.billing_month, nextLabel);
                  setForm({
                    ...form,
                    client_id: clientId,
                    tax_rate: client ? client.tax_rate : form.tax_rate,
                    tax_type: client ? normalizeTaxType(client.tax_type) : form.tax_type,
                    subject: !form.subject || form.subject === defaultSubject(form.billing_month, previousLabel) ? generated : form.subject,
                  });
                }}
                className={`${inputClass} ${fieldErrorClass(formErrors.find((item) => item.includes('クライアント')))}`}
              >
                <option value="">選択してください</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {clientName(c)}
                  </option>
                ))}
              </select>
              {selectedClient?.representative_name && (
                <p className="mt-1 text-xs text-slate-500">代表者名: {selectedClient.representative_name}</p>
              )}
            </FormField>
            <FormField label="請求月" required>
              <input
                type="month"
                value={form.billing_month}
                onChange={(e) => applyBillingMonth(e.target.value)}
                className={`${inputClass} ${fieldErrorClass(formErrors.find((item) => item.includes('請求月')))}`}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="請求書No.">
              <input
                type="text"
                value={form.invoice_number}
                onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
                className={inputClass}
              />
            </FormField>
            <FormField label="件名">
              <input
                type="text"
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                className={inputClass}
                placeholder="株式会社〇〇様 26年9月分"
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="発行日">
              <input
                type="text"
                inputMode="numeric"
                value={form.issue_date}
                onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
                onBlur={() =>
                  setForm((current) => {
                    const formatted = formatIssueDate(current.issue_date);
                    return formatted ? { ...current, issue_date: formatted } : current;
                  })
                }
                className={inputClass}
                placeholder="yyyy/m/d"
              />
            </FormField>
            <FormField label="支払日">
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                className={inputClass}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="税区分">
              <div className="flex gap-2">
                {(['exclusive', 'inclusive'] as TaxType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setForm({ ...form, tax_type: type })}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                      form.tax_type === type
                        ? 'border-teal-500 bg-teal-50 text-teal-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {TAX_TYPE_LABELS[type]}
                  </button>
                ))}
              </div>
            </FormField>
            <FormField label="消費税率（%）">
              <input
                type="number"
                min={0}
                value={form.tax_rate}
                onChange={(e) => setForm({ ...form, tax_rate: parseInt(e.target.value, 10) || 0 })}
                className={inputClass}
              />
            </FormField>
          </div>

          <FormField label="ステータス">
            <div className="flex gap-2">
              {(['draft', 'issued', 'paid'] as InvoiceStatus[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setForm({ ...form, status: s })}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                    form.status === s
                      ? 'border-teal-500 bg-teal-50 text-teal-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {INVOICE_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </FormField>

          <div className="mb-4 flex flex-col gap-3 rounded-lg border border-teal-100 bg-teal-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-teal-700">
              クライアントと請求月を選ぶと、請求するスケジュールを取り込みます。通常は月ごとに分けて計上し、本番まとめの案件は期間全体をその請求月に載せます。請求対象外・本番待ちは含みません。
            </p>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                onClick={handleAutoImport}
                disabled={!form.client_id || !form.billing_month}
                className="btn-primary"
              >
                <Sparkles className="h-4 w-4" />
                スケジュールから自動取込
              </button>
              <button
                type="button"
                onClick={handleApplyCatalogPrices}
                disabled={!form.client_id || applyingPrices || editItems.length === 0}
                className="btn-secondary"
              >
                <RefreshCw className={`h-4 w-4 ${applyingPrices ? 'animate-spin' : ''}`} />
                {applyingPrices ? '取込中...' : '登録単価を取り込む'}
              </button>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <label className="text-sm font-medium text-slate-700">明細項目</label>
                <p className="mt-0.5 text-xs text-slate-400">
                  初期順は、その月に最初に来るスケジュールのアーティスト順、その中はスケジュール順です。左のつまみで並べ替えできます。
                </p>
              </div>
              <button onClick={addItem} className="shrink-0 text-sm font-medium text-teal-600 hover:text-teal-700">
                + 項目追加
              </button>
            </div>
            {unsetPriceCount > 0 ? (
              <div className="mb-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  単価未設定が{unsetPriceCount}件あります。クライアントに金額を確認するか、単価管理で登録して「登録単価を取り込む」を押してください。
                </p>
              </div>
            ) : null}
            {editItems.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 py-4 text-center text-sm text-slate-400">
                項目がありません。「スケジュールから自動取込」または「項目追加」で追加してください
              </p>
            ) : (
              <div
                className="space-y-2"
                onDragOver={(e) => e.preventDefault()}
                onDragLeave={(e) => {
                  const next = e.relatedTarget;
                  if (next instanceof Node && e.currentTarget.contains(next)) return;
                  dragOverRef.current = null;
                  setDragOverIndex(null);
                }}
              >
                {editItems.map((item, i) => (
                  <div
                    key={item.key}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dragOverRef.current !== i) {
                        dragOverRef.current = i;
                        setDragOverIndex(i);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      dragOverRef.current = i;
                      finishDrag();
                    }}
                    className={`rounded-lg border p-3 ${
                      draggingIndex === i
                        ? 'border-teal-300 bg-teal-50/50 opacity-60'
                        : dragOverIndex === i
                          ? 'border-teal-400 bg-teal-50/30'
                          : isUnsetInvoicePrice(item)
                            ? 'border-amber-300 bg-amber-50/40'
                            : 'border-slate-200'
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <button
                          type="button"
                          draggable
                          onDragStart={(e) => {
                            dragFromRef.current = i;
                            dragOverRef.current = i;
                            setDraggingIndex(i);
                            setDragOverIndex(i);
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', String(i));
                          }}
                          onDragEnd={finishDrag}
                          className="btn-icon cursor-grab text-slate-400 hover:text-slate-600 active:cursor-grabbing"
                          aria-label="項目を並べ替え"
                          title="ドラッグして並べ替え"
                        >
                          <GripVertical className="h-4 w-4" />
                        </button>
                        <span className="text-xs font-semibold text-slate-400">項目 {i + 1}</span>
                        {item.task?.project?.artist_name && (
                          <span className="truncate text-xs text-slate-500">{item.task.project.artist_name}</span>
                        )}
                        {isUnsetInvoicePrice(item) ? (
                          <span className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                            単価未設定
                          </span>
                        ) : item.price_manual ? (
                          <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                            手動
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeItem(i)}
                        className="btn-icon hover:text-red-500"
                        aria-label="項目を削除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-500">品目（スケジュール名）</label>
                      <input
                        type="text"
                        value={item.description}
                        onChange={(e) => updateItem(i, 'description', e.target.value)}
                        className={inputClass}
                        placeholder="スケジュール名 (9/1)"
                      />
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_5.5rem_minmax(0,1fr)_minmax(0,1fr)]">
                      <div className="min-w-0">
                        <label className="mb-1 block text-xs font-semibold text-slate-500">数量</label>
                        <input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={(e) => updateItem(i, 'quantity', parseInt(e.target.value) || 0)}
                          className={`${inputClass} min-w-0 text-right`}
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="mb-1 block text-xs font-semibold text-slate-500">単位</label>
                        <select
                          value={item.quantity_unit}
                          onChange={(e) => updateItem(i, 'quantity_unit', e.target.value)}
                          className={`${inputClass} px-2`}
                          aria-label="数量の単位"
                        >
                          {QUANTITY_UNITS.map((unit) => (
                            <option key={unit} value={unit}>
                              {unit}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="min-w-0">
                        <label className="mb-1 block text-xs font-semibold text-slate-500">
                          単価
                          {isUnsetInvoicePrice(item) ? <span className="ml-1 font-medium text-amber-700">未設定</span> : null}
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={isUnsetInvoicePrice(item) ? '' : item.unit_price}
                          onChange={(e) => updateItem(i, 'unit_price', parseInt(e.target.value) || 0)}
                          className={`${inputClass} min-w-0 text-right ${
                            isUnsetInvoicePrice(item) ? 'border-amber-400 bg-amber-50 placeholder:text-amber-700' : ''
                          }`}
                          placeholder="未設定"
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="mb-1 block text-xs font-semibold text-slate-500">金額</label>
                        <div className="flex min-h-11 items-center justify-end rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700 md:min-h-0 md:h-[38px]">
                          {formatYen(itemAmount(item.quantity, item.unit_price))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 space-y-1 text-right text-sm text-slate-500">
              <p>小計: <span className="font-medium text-slate-800">{formatYen(formTotals.subtotal)}</span></p>
              <p>消費税額: <span className="font-medium text-slate-800">{formatYen(formTotals.taxAmount)}</span></p>
              <p>
                合計金額 / 税込請求金額:{' '}
                <span className="font-bold text-teal-700">{formatYen(formTotals.total)}</span>
              </p>
            </div>
          </div>

          <FormField label="備考">
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className={`${inputClass} min-h-[60px] resize-y`}
              placeholder="振込先や注意事項など..."
            />
          </FormField>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setModalOpen(false)} className="btn-secondary">
              キャンセル
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary"
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
