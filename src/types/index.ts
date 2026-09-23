export type TaxType = 'exclusive' | 'inclusive';

export interface Client {
  id: string;
  company_name: string | null;
  representative_name: string | null;
  contact_person_name: string | null;
  postal_code: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  representative_email: string | null;
  contact_person_email: string | null;
  tax_rate: number;
  tax_type: TaxType;
  google_calendar_color_id: number | null;
  created_at: string;
}

export function clientName(client?: Pick<Client, 'company_name' | 'representative_name'> | null): string {
  return client?.company_name?.trim() || client?.representative_name?.trim() || '';
}

export function compareCreatedAt(a: { created_at?: string | null }, b: { created_at?: string | null }) {
  return (a.created_at || '').localeCompare(b.created_at || '');
}

export const DEFAULT_APP_NAME = 'Stagecrew';
export const DEFAULT_APP_TAGLINE = '業務管理';
export const DEFAULT_APP_FOOTER = 'スケジュール・請求書管理システム';
/** 画面表示。Docker タグは alpha_2.0.0（タグに α は使えない）。 */
export const APP_VERSION_LABEL = 'ver α_2.0.0';

export interface GoogleIntegrationSettings {
  id: number;
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
}

export function displayAppName(settings: Pick<GoogleIntegrationSettings, 'app_name'>) {
  return settings.app_name?.trim() || DEFAULT_APP_NAME;
}

export function displayAppTagline(settings: Pick<GoogleIntegrationSettings, 'app_tagline'>) {
  return settings.app_tagline == null ? DEFAULT_APP_TAGLINE : settings.app_tagline.trim();
}

export function displayAppFooter(settings: Pick<GoogleIntegrationSettings, 'app_footer'>) {
  return settings.app_footer == null ? DEFAULT_APP_FOOTER : settings.app_footer;
}

export function spreadsheetIdFromInput(raw: string | null | undefined) {
  const value = (raw || '').trim();
  if (!value) return '';
  const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(value)) return value;
  return '';
}

export function spreadsheetUrlFromId(id: string) {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

export const GOOGLE_CALENDAR_COLORS: { id: number; label: string; color: string }[] = [
  { id: 1, label: 'ラベンダー', color: '#7986CB' },
  { id: 2, label: 'セージ', color: '#33B679' },
  { id: 3, label: 'ブドウ', color: '#8E24AA' },
  { id: 4, label: 'フラミンゴ', color: '#E67C73' },
  { id: 5, label: 'バナナ', color: '#F6BF26' },
  { id: 6, label: 'ミカン', color: '#F4511E' },
  { id: 7, label: 'ピーコック', color: '#039BE5' },
  { id: 8, label: 'グラファイト', color: '#616161' },
  { id: 9, label: 'ブルーベリー', color: '#3F51B5' },
  { id: 10, label: 'バジル', color: '#0B8043' },
  { id: 11, label: 'トマト', color: '#D50000' },
];

export interface Project {
  id: string;
  project_name: string;
  artist_name: string | null;
  event_name: string | null;
  client_id: string | null;
  status: ProjectStatus;
  created_at: string;
  client?: Client | null;
}

export type ProjectStatus = 'in_progress' | 'completed' | 'cancelled';

export type TimeType = 'all_day' | 'time_limited' | 'multi_day';

export interface Task {
  id: string;
  project_id: string;
  date: string | null;
  is_cancelled: boolean;
  is_deleted: boolean;
  task_type: string;
  time_type: TimeType;
  start_date: string | null;
  start_time: string | null;
  end_date: string | null;
  end_time: string | null;
  area: string | null;
  location: string | null;
  position: string | null;
  is_domestic: boolean;
  venue_size: VenueSize | null;
  notes: string | null;
  billing_status: BillingStatus;
  google_event_id: string | null;
  created_at: string;
  project?: Project | null;
}

export type VenueSize = 'アリーナ' | 'ホール' | 'その他';

export type BillingStatus = 'unbilled' | 'draft' | 'billed' | 'paid';

export interface UnitPrice {
  id: string;
  client_id: string;
  is_domestic: boolean;
  position: string;
  venue_size: VenueSize | null;
  task_type: string;
  price: number;
  tax_rate: number;
  tax_type: TaxType;
  sort_order: number | null;
  created_at: string;
  client?: Client | null;
}

export interface Invoice {
  id: string;
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
  total_amount: number;
  notes: string | null;
  created_at: string;
  client?: Client | null;
  invoice_items?: InvoiceItem[];
}

export type InvoiceStatus = 'draft' | 'issued' | 'paid';

export const TAX_TYPE_LABELS: Record<TaxType, string> = {
  exclusive: '外税',
  inclusive: '内税',
};

export function normalizeTaxType(value: unknown): TaxType {
  return value === 'inclusive' || value === '内税' || value === '税込み' || value === '税込'
    ? 'inclusive'
    : 'exclusive';
}

export function taxSettingLabel(taxRate: number, taxType?: TaxType | null) {
  if (normalizeTaxType(taxType) === 'inclusive') {
    return taxRate > 0 ? `税込み ${taxRate}%` : '税込み';
  }
  return `消費税 ${taxRate}%`;
}

export function invoiceTotals(lineSum: number, taxRate: number, taxType: TaxType) {
  const rate = Number.isFinite(taxRate) ? Math.max(0, taxRate) : 0;
  const base = Math.max(0, Math.round(lineSum));
  if (taxType === 'inclusive') {
    const taxAmount = Math.floor((base * rate) / (100 + rate));
    return { subtotal: base - taxAmount, taxAmount, total: base };
  }
  const taxAmount = Math.floor((base * rate) / 100);
  return { subtotal: base, taxAmount, total: base + taxAmount };
}

export const INVOICE_PLACEHOLDERS = [
  { label: 'クライアント名', token: '{{クライアント名}}', note: '会社名' },
  { label: '代表者名', token: '{{代表者名}}', note: 'クライアントの代表者名' },
  { label: '発行日', token: '{{発行日}}', note: 'yyyy/m/d' },
  { label: '請求書No.', token: '{{請求書No}}', note: '' },
  { label: '件名', token: '{{件名}}', note: '' },
  { label: '税込みのトータル請求金額', token: '{{税込請求金額}}', note: '合計金額と同じ税込額' },
  { label: '支払日', token: '{{支払日}}', note: 'YYYY年M月D日' },
  { label: '品目', token: '{{品目}}', note: '明細行' },
  { label: '数量', token: '{{数量}}', note: '明細行' },
  { label: '単位', token: '{{単位}}', note: '明細行' },
  { label: '単価', token: '{{単価}}', note: '明細行。数値' },
  { label: '金額', token: '{{金額}}', note: '明細行。数値' },
  { label: '小計', token: '{{小計}}', note: '数値' },
  { label: '消費税額', token: '{{消費税額}}', note: '数値。端数は切り捨て' },
  { label: '消費税率', token: '{{消費税率}}', note: '10%' },
  { label: '合計金額', token: '{{合計金額}}', note: '税込。数値' },
  { label: '備考', token: '{{備考}}', note: '' },
] as const;

export type QuantityUnit = '日' | '式';

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  task_id: string | null;
  description: string;
  quantity?: number;
  quantity_unit?: QuantityUnit | null;
  unit_price?: number;
  amount: number;
  sort_order?: number | null;
  price_manual?: boolean | null;
  created_at: string;
}

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  in_progress: '進行中',
  completed: '完了',
  cancelled: 'キャンセル',
};

export const PROJECT_STATUS_COLORS: Record<ProjectStatus, string> = {
  in_progress: 'bg-blue-100 text-blue-700 border-blue-200',
  completed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  cancelled: 'bg-red-100 text-red-700 border-red-200',
};

export const BILLING_STATUS_LABELS: Record<BillingStatus, string> = {
  unbilled: '未請求',
  draft: '下書き',
  billed: '請求済',
  paid: '入金済',
};

export const BILLING_STATUS_COLORS: Record<BillingStatus, string> = {
  unbilled: 'bg-amber-100 text-amber-700 border-amber-200',
  draft: 'bg-gray-100 text-gray-700 border-gray-200',
  billed: 'bg-blue-100 text-blue-700 border-blue-200',
  paid: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: '下書き',
  issued: '発行済',
  paid: '入金済',
};

export const INVOICE_STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft: 'bg-gray-100 text-gray-700 border-gray-200',
  issued: 'bg-blue-100 text-blue-700 border-blue-200',
  paid: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

export const TIME_TYPE_LABELS: Record<TimeType, string> = {
  all_day: '終日',
  time_limited: '時間限定',
  multi_day: '複数日',
};

export type CalendarTimeSnapshot = {
  time_type: string;
  start_date: string | null;
  start_time: string | null;
  end_date: string | null;
  end_time: string | null;
};

export type CalendarConflict = {
  taskId: string;
  scheduleName: string;
  billingStatus: string;
  app: CalendarTimeSnapshot;
  google: CalendarTimeSnapshot;
};

export type CalendarSyncState = {
  error: string | null;
  conflicts: CalendarConflict[];
  pulling?: boolean;
  lastPullAt?: string | null;
  lastPullSummary?: string | null;
};

export function formatCalendarTime(snapshot: CalendarTimeSnapshot): string {
  const fmt = (d: string | null) => {
    if (!d) return '';
    const [year, month, day] = d.split('-').map(Number);
    if (!year || !month || !day) return d;
    return `${month}/${day}`;
  };
  const fmtTime = (t: string | null) => (t ? t.slice(0, 5) : '');
  if (snapshot.time_type === 'time_limited') {
    const start = `${fmt(snapshot.start_date)}${snapshot.start_time ? ` ${fmtTime(snapshot.start_time)}` : ''}`;
    const end = `${fmt(snapshot.end_date)}${snapshot.end_time ? ` ${fmtTime(snapshot.end_time)}` : ''}`;
    return `${start}〜${end}`;
  }
  if (snapshot.time_type === 'multi_day') {
    return `${fmt(snapshot.start_date)}〜${fmt(snapshot.end_date)}`;
  }
  return fmt(snapshot.start_date);
}

export const DEFAULT_TASK_TYPE = '仕込み/本番';

export const TASK_TYPES: string[] = [
  '仕込み/本番',
  '本番',
  '仕込み',
  'バラシ',
  'RH',
  'GP',
  'プレビズ',
  '仮組',
  '打込み',
  '修正',
  '引継ぎ',
  '打ち合わせ',
  'その他',
];

export const TASK_TYPE_ALIASES: Record<string, string> = {
  打ち込み: '打込み',
};

export function canonicalTaskType(name: string) {
  const trimmed = (name || '').trim();
  return TASK_TYPE_ALIASES[trimmed] || trimmed;
}

export const POSITIONS: string[] = ['卓', 'テック', 'その他'];

export function parseOptionList(raw: string | null | undefined) {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean);
  } catch {
    /* comma-separated */
  }
  return raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function serializeOptionList(items: string[]) {
  return JSON.stringify(items);
}

export function mergeOptions(base: string[], extra: string[] | null | undefined) {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const item of [...base, ...(extra || [])]) {
    const name = item.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    next.push(name);
  }
  return next;
}

export function resolveCatalogOptions(base: string[], storedRaw: string | null | undefined) {
  const stored = parseOptionList(storedRaw).map(canonicalTaskType).filter(Boolean);
  const uniqueStored = [...new Set(stored)];
  const baseNames = [...new Set(base.map(canonicalTaskType))];
  const hasBuiltins = uniqueStored.some((item) => baseNames.includes(item));
  if (!uniqueStored.length || !hasBuiltins) return mergeOptions(baseNames, uniqueStored);

  const remainingBase = [...baseNames];
  const seen = new Set<string>();
  const next: string[] = [];
  for (const name of uniqueStored) {
    if (seen.has(name)) continue;
    const idx = remainingBase.indexOf(name);
    if (idx >= 0) {
      for (const before of remainingBase.slice(0, idx)) {
        if (!seen.has(before)) {
          seen.add(before);
          next.push(before);
        }
      }
      remainingBase.splice(0, idx + 1);
    }
    seen.add(name);
    next.push(name);
  }
  for (const name of remainingBase) {
    if (!seen.has(name)) {
      seen.add(name);
      next.push(name);
    }
  }
  return next;
}

export function compareCatalogOrder(a: string, b: string, order: string[]) {
  const canonA = canonicalTaskType(a);
  const canonB = canonicalTaskType(b);
  const canonOrder = order.map(canonicalTaskType);
  const indexA = canonOrder.indexOf(canonA);
  const indexB = canonOrder.indexOf(canonB);
  const rankA = indexA < 0 ? canonOrder.length : indexA;
  const rankB = indexB < 0 ? canonOrder.length : indexB;
  if (rankA !== rankB) return rankA - rankB;
  return canonA.localeCompare(canonB, 'ja');
}

export function compareUnitPriceOrder(
  a: { sort_order?: number | null; created_at?: string | null },
  b: { sort_order?: number | null; created_at?: string | null }
) {
  const orderA = a.sort_order;
  const orderB = b.sort_order;
  if (orderA != null && orderB != null && orderA !== orderB) return orderA - orderB;
  if (orderA != null && orderB == null) return -1;
  if (orderA == null && orderB != null) return 1;
  return compareCreatedAt(a, b);
}

export const VENUE_SIZES: VenueSize[] = ['アリーナ', 'ホール', 'その他'];

export function makeProjectName(artist: string, event: string): string {
  if (!event.trim()) return artist;
  return `${artist}_${event}`;
}

export const VENUE_TASK_TYPES = ['仕込み/本番', '本番', '仕込み', 'バラシ', 'GP', '仮組'];

export function getTaskSubtitle(task: Task): string {
  if (VENUE_TASK_TYPES.includes(task.task_type)) {
    const parts = [task.area, task.location].map((value) => (value || '').trim()).filter(Boolean);
    if (parts.length > 0) return parts.join(' / ');
  }
  return task.task_type;
}

export function getScheduleName(task: Task): string {
  const projectName = task.project?.project_name || '';
  const subtitle = getTaskSubtitle(task);
  if (projectName && subtitle) return `${projectName} (${subtitle})`;
  return projectName || subtitle || task.task_type;
}

export function getTaskDayCount(task: Task): number {
  const range = taskDateRange(task);
  if (!range) return 1;
  return inclusiveDayCount(range.start, range.end);
}

export function taskDateRange(task: {
  start_date: string | null;
  date?: string | null;
  end_date: string | null;
}): { start: string; end: string } | null {
  const start = (task.start_date || task.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  let end = (task.end_date || start).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) end = start;
  return { start, end };
}

export function inclusiveDayCount(start: string, end: string): number {
  const toUtc = (value: string) => {
    const [y, m, d] = value.split('-').map(Number);
    return Date.UTC(y, (m || 1) - 1, d || 1);
  };
  return Math.max(1, Math.round((toUtc(end) - toUtc(start)) / 86400000) + 1);
}

export function eachMonth(start: string, end: string): string[] {
  const months: string[] = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  const endKey = end.slice(0, 7);
  let guard = 0;
  while (`${year}-${String(month).padStart(2, '0')}` <= endKey && guard < 36) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    guard += 1;
  }
  return months;
}

export function taskMonthKeys(task: {
  start_date: string | null;
  date?: string | null;
  end_date: string | null;
}): string[] {
  const range = taskDateRange(task);
  if (!range) return [];
  return eachMonth(range.start, range.end);
}

export function monthBounds(billingMonth: string): { start: string; end: string; endExclusive: string } {
  const [year, month] = billingMonth.split('-').map(Number);
  const start = `${billingMonth}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const endExclusive = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(year, month, 0));
  const end = `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, '0')}-${String(last.getUTCDate()).padStart(2, '0')}`;
  return { start, end, endExclusive };
}

export function clipToMonth(
  start: string,
  end: string,
  billingMonth: string
): { start: string; end: string } | null {
  const bounds = monthBounds(billingMonth);
  const clipStart = start > bounds.start ? start : bounds.start;
  const clipEnd = end < bounds.end ? end : bounds.end;
  if (clipStart > clipEnd) return null;
  return { start: clipStart, end: clipEnd };
}

export function formatDateSuffix(start: string, end: string): string {
  const startMonth = Number(start.slice(5, 7));
  const startDay = Number(start.slice(8, 10));
  const endMonth = Number(end.slice(5, 7));
  const endDay = Number(end.slice(8, 10));
  if (start === end) return `(${startMonth}/${startDay})`;
  if (startMonth === endMonth) return `(${startMonth}/${startDay}～${endDay})`;
  return `(${startMonth}/${startDay}～${endMonth}/${endDay})`;
}

export function monthBillingLabel(billingMonth: string): string {
  return `${Number(billingMonth.slice(5, 7))}月請求`;
}

export function billingFromInvoiceStatus(status: string | null | undefined): BillingStatus | null {
  if (status === 'paid') return 'paid';
  if (status === 'issued') return 'billed';
  if (status === 'draft') return 'draft';
  return null;
}

export function strongerBilling(current: BillingStatus, next: BillingStatus): BillingStatus {
  const rank: Record<BillingStatus, number> = { unbilled: 0, draft: 1, billed: 2, paid: 3 };
  return rank[next] > rank[current] ? next : current;
}

export function summarizeBilling(statuses: BillingStatus[]): BillingStatus {
  if (statuses.length === 0) return 'unbilled';
  if (statuses.every((status) => status === 'paid')) return 'paid';
  if (statuses.every((status) => status === 'billed' || status === 'paid')) return 'billed';
  if (statuses.every((status) => status === 'draft')) return 'draft';
  return 'unbilled';
}

export function monthBillingStatus(
  task: { start_date: string | null; date?: string | null; end_date: string | null; billing_status: BillingStatus },
  billingMonth: string,
  billedMonths?: Record<string, BillingStatus>
): BillingStatus {
  // When billedMonths is provided it is the source of truth from invoices.
  // Months not present must be unbilled (e.g. after the related invoice is deleted).
  if (billedMonths) {
    return billedMonths[billingMonth] ?? 'unbilled';
  }
  if (taskMonthKeys(task).length <= 1) return task.billing_status;
  return 'unbilled';
}

export function formatTaskDateRange(task: Task): string {
  const fmt = (d: string | null) => {
    if (!d) return '';
    const dt = new Date(d);
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
  };
  const fmtTime = (t: string | null) => {
    if (!t) return '';
    return t.slice(0, 5);
  };

  if (task.time_type === 'time_limited') {
    const start = `${fmt(task.start_date)}${task.start_time ? ` ${fmtTime(task.start_time)}` : ''}`;
    const end = `${fmt(task.end_date)}${task.end_time ? ` ${fmtTime(task.end_time)}` : ''}`;
    return `${start}〜${end}`;
  }
  if (task.time_type === 'multi_day') {
    return `${fmt(task.start_date)}〜${fmt(task.end_date)}`;
  }
  // all_day
  return fmt(task.start_date);
}
