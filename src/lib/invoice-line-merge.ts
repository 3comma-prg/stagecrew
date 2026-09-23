import {
  formatDateSuffix,
  getScheduleName,
  getTaskSubtitle,
  inclusiveDayCount,
  taskDateRange,
  type QuantityUnit,
  type Task,
} from '@/types';
import { isShowTaskType } from '@/lib/billing-policy';

/** 明細の task_id は複数スケジュールをカンマ区切りで持てる */
export function parseInvoiceTaskIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return String(raw)
    .split(/[,，]/)
    .map((id) => id.trim())
    .filter(Boolean);
}

export function serializeInvoiceTaskIds(ids: (string | null | undefined)[]): string | null {
  const unique = [...new Set(ids.filter((id): id is string => !!id && String(id).trim().length > 0))];
  return unique.length ? unique.join(',') : null;
}

export function primaryInvoiceTaskId(raw: string | null | undefined): string | null {
  return parseInvoiceTaskIds(raw)[0] || null;
}

export function invoiceItemHasTaskId(raw: string | null | undefined, taskId: string): boolean {
  return parseInvoiceTaskIds(raw).includes(taskId);
}

/** 品目末尾の日付括弧（連続 ～ / 飛び ・ 両対応） */
export const INVOICE_DATE_SUFFIX =
  /\s*\(\d{1,2}\/\d{1,2}(?:[～・]\d{1,2}(?:\/\d{1,2})?)*\)$/;

export function stripInvoiceDateSuffix(description: string): string {
  return description.replace(INVOICE_DATE_SUFFIX, '').trim();
}

function toUtcDay(value: string): number {
  const [y, m, d] = value.split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

function addUtcDays(iso: string, days: number): string {
  const ms = toUtcDay(iso) + days * 86400000;
  const date = new Date(ms);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export type DateRange = { start: string; end: string };

/** 重なり・翌日連続を1期間にまとめる */
export function mergeContiguousRanges(ranges: DateRange[]): DateRange[] {
  const sorted = [...ranges]
    .filter((r) => r.start && r.end)
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  if (sorted.length === 0) return [];

  const out: DateRange[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = out[out.length - 1];
    const next = sorted[i];
    if (next.start <= addUtcDays(prev.end, 1)) {
      if (next.end > prev.end) prev.end = next.end;
    } else {
      out.push({ ...next });
    }
  }
  return out;
}

function formatDayPart(iso: string, withMonth: boolean): string {
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return withMonth ? `${month}/${day}` : String(day);
}

/**
 * 複数期間を請求品目用に整形。
 * 例: 1/1 と 1/3 → (1/1・3) / 2/1～2 と 2/5 → (2/1～2・5)
 */
export function formatMergedDateSuffix(ranges: DateRange[]): string {
  const merged = mergeContiguousRanges(ranges);
  if (merged.length === 0) return '';
  if (merged.length === 1) return formatDateSuffix(merged[0].start, merged[0].end);

  const firstMonth = merged[0].start.slice(5, 7);
  const allSameMonth = merged.every(
    (r) => r.start.slice(5, 7) === firstMonth && r.end.slice(5, 7) === firstMonth
  );

  if (allSameMonth) {
    const parts = merged.map((r, index) => {
      if (r.start === r.end) return formatDayPart(r.start, index === 0);
      if (index === 0) {
        return `${formatDayPart(r.start, true)}～${formatDayPart(r.end, false)}`;
      }
      return `${formatDayPart(r.start, false)}～${formatDayPart(r.end, false)}`;
    });
    return `(${parts.join('・')})`;
  }

  const parts = merged.map((r) => {
    if (r.start === r.end) return formatDayPart(r.start, true);
    const sm = Number(r.start.slice(5, 7));
    const sd = Number(r.start.slice(8, 10));
    const em = Number(r.end.slice(5, 7));
    const ed = Number(r.end.slice(8, 10));
    if (sm === em) return `${sm}/${sd}～${ed}`;
    return `${sm}/${sd}～${em}/${ed}`;
  });
  return `(${parts.join('・')})`;
}

export type MergeableLine = {
  key: string;
  description: string;
  quantity: number;
  quantity_unit: QuantityUnit;
  unit_price: number;
  amount: number;
  task_id: string | null;
  task?: Task | null;
  period?: DateRange | null;
  price_manual?: boolean;
  tax_exempt?: boolean;
  id?: string | null;
  sort_order?: number | null;
};

function periodOf(line: MergeableLine): DateRange | null {
  if (line.period?.start && line.period?.end) return line.period;
  if (line.task) return taskDateRange(line.task);
  return null;
}

export function lineMergeKey(line: MergeableLine): string | null {
  const task = line.task;
  if (!task || !isShowTaskType(task.task_type)) return null;
  const subtitle = getTaskSubtitle(task);
  return [task.project_id, subtitle, String(line.unit_price || 0), line.quantity_unit || '日'].join('\u0001');
}

export function canMergeLines(lines: MergeableLine[]): { ok: true } | { ok: false; reason: string } {
  if (lines.length < 2) return { ok: false, reason: '2件以上選択してください。' };
  const unit = lines[0].quantity_unit || '日';
  const price = lines[0].unit_price || 0;
  if (lines.some((line) => (line.quantity_unit || '日') !== unit)) {
    return { ok: false, reason: '単位が異なる項目はまとめられません。' };
  }
  if (lines.some((line) => (line.unit_price || 0) !== price)) {
    return { ok: false, reason: '単価が異なる項目はまとめられません。' };
  }
  return { ok: true };
}

function baseDescription(line: MergeableLine): string {
  const stripped = stripInvoiceDateSuffix(line.description);
  if (stripped) return stripped;
  if (line.task) return getScheduleName(line.task);
  return line.description.trim() || '品目';
}

export function mergeLinesIntoOne<T extends MergeableLine>(
  lines: T[],
  newKey: () => string
): T {
  const sorted = [...lines].sort((a, b) => {
    const pa = periodOf(a);
    const pb = periodOf(b);
    const sa = pa?.start || '9999-12-31';
    const sb = pb?.start || '9999-12-31';
    if (sa !== sb) return sa.localeCompare(sb);
    return (a.task?.id || a.key).localeCompare(b.task?.id || b.key);
  });
  const first = sorted[0];
  const ranges = sorted.map(periodOf).filter((r): r is DateRange => !!r);
  const quantity = sorted.reduce((sum, line) => sum + (line.quantity || 0), 0);
  const unitPrice = first.unit_price || 0;
  const allTaskIds = sorted.flatMap((line) => parseInvoiceTaskIds(line.task_id));
  const dateSuffix = ranges.length ? ` ${formatMergedDateSuffix(ranges)}` : '';
  const mergedPeriod =
    ranges.length > 0
      ? {
          start: mergeContiguousRanges(ranges)[0]?.start || ranges[0].start,
          end: mergeContiguousRanges(ranges).reduce((end, r) => (r.end > end ? r.end : end), ranges[0].end),
        }
      : first.period || null;

  return {
    ...first,
    key: newKey(),
    id: null,
    description: `${baseDescription(first)}${dateSuffix}`,
    quantity: quantity || 1,
    quantity_unit: first.quantity_unit || '日',
    unit_price: unitPrice,
    amount: (quantity || 1) * unitPrice,
    task_id: serializeInvoiceTaskIds(allTaskIds),
    task: first.task,
    period: mergedPeriod,
    price_manual: sorted.some((line) => line.price_manual) || !allTaskIds.length,
    tax_exempt: sorted.every((line) => Boolean(line.tax_exempt)),
    sort_order: first.sort_order ?? null,
  };
}

/** 同プロジェクト・同会場（サブタイトル）・同単価の本番行をまとめる */
export function mergeSameVenueShowLines<T extends MergeableLine>(
  lines: T[],
  newKey: () => string
): T[] {
  const byKey = new Map<string, T[]>();
  const firstIndex = new Map<string, number>();
  const placed = new Map<number, T>();

  lines.forEach((line, index) => {
    const key = lineMergeKey(line);
    if (!key) {
      placed.set(index, line);
      return;
    }
    if (!byKey.has(key)) {
      byKey.set(key, []);
      firstIndex.set(key, index);
    }
    byKey.get(key)!.push(line);
  });

  for (const [key, group] of byKey) {
    const index = firstIndex.get(key)!;
    placed.set(index, group.length === 1 ? group[0] : mergeLinesIntoOne(group, newKey));
  }

  return [...placed.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, item]) => item);
}

export function totalQuantityFromRanges(ranges: DateRange[]): number {
  return mergeContiguousRanges(ranges).reduce(
    (sum, r) => sum + inclusiveDayCount(r.start, r.end),
    0
  );
}
