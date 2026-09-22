import type { Task, TaxType, UnitPrice } from '@/types';
import { normalizeTaxType } from '@/types';

export function findMatchingUnitPrice(priceList: UnitPrice[], task: Task): UnitPrice | null {
  const candidates = priceList.filter(
    (price) =>
      price.task_type === task.task_type &&
      price.is_domestic === task.is_domestic &&
      (!price.position || price.position === task.position) &&
      (!price.venue_size || price.venue_size === task.venue_size)
  );
  const exact = candidates.find(
    (price) =>
      (!task.position || price.position === task.position) &&
      (!task.venue_size || price.venue_size === task.venue_size)
  );
  return exact || candidates[0] || null;
}

export function findUnitPriceAmount(priceList: UnitPrice[], task: Task): number {
  return findMatchingUnitPrice(priceList, task)?.price ?? 0;
}

export function taxTypeForTask(priceList: UnitPrice[], task: Task, fallback: TaxType = 'exclusive'): TaxType {
  const match = findMatchingUnitPrice(priceList, task);
  if (!match) return fallback;
  return normalizeTaxType(match.tax_type);
}

export function taxRateForTask(priceList: UnitPrice[], task: Task, fallback: number): number {
  const match = findMatchingUnitPrice(priceList, task);
  if (!match || match.tax_rate == null || Number.isNaN(Number(match.tax_rate))) return fallback;
  return Number(match.tax_rate);
}

export function isManualInvoicePrice(item: { task_id?: string | null; price_manual?: boolean | null }): boolean {
  if (item.price_manual === true) return true;
  if (!item.task_id) return true;
  return false;
}

export function isUnsetInvoicePrice(item: {
  task_id?: string | null;
  unit_price?: number | null;
  price_manual?: boolean | null;
}): boolean {
  return Boolean(item.task_id) && !isManualInvoicePrice(item) && !(Number(item.unit_price) > 0);
}
