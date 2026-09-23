import {
  canonicalTaskType,
  clipToMonth,
  inclusiveDayCount,
  parseOptionList,
  serializeOptionList,
  summarizeBilling,
  taskMonthKeys,
  taskDateRange,
  type BillingStatus,
  type Client,
  type Project,
  type Task,
} from '@/types';

/** 月締め（日程の月） / 本番まとめ */
export type BillingTiming = 'schedule_month' | 'show_bundle';

/** プロジェクト・スケジュールの継承付き */
export type BillingTimingSetting = 'inherit' | BillingTiming;

/** 本番どうしのグループ化（個別上書き） */
export type ShowGroupLink = 'auto' | 'with_previous' | 'new_group';

export const DEFAULT_SHOW_GROUP_GAP_DAYS = 14;

export const SHOW_TASK_TYPES = ['本番', '仕込み/本番'] as const;

export const BILLING_TIMING_LABELS: Record<BillingTiming, string> = {
  schedule_month: '日程の月で請求',
  show_bundle: '本番まとめ',
};

export const SHOW_GROUP_LINK_LABELS: Record<ShowGroupLink, string> = {
  auto: '自動（間隔ルール）',
  with_previous: '前の本番とまとめる',
  new_group: 'ここで別の請求にする',
};

export function isShowTaskType(taskType: string | null | undefined): boolean {
  const name = canonicalTaskType(taskType || '');
  return (SHOW_TASK_TYPES as readonly string[]).includes(name);
}

export function parseNonBillableTaskTypes(raw: string | null | undefined): string[] {
  return parseOptionList(raw).map(canonicalTaskType);
}

export function serializeNonBillableTaskTypes(types: string[]): string {
  return serializeOptionList([...new Set(types.map(canonicalTaskType).filter(Boolean))]);
}

export function normalizeBillingTiming(value: unknown): BillingTiming {
  return value === 'show_bundle' || value === '本番まとめ' ? 'show_bundle' : 'schedule_month';
}

export function normalizeBillingTimingSetting(value: unknown): BillingTimingSetting {
  if (value === 'inherit' || value === 'クライアントに合わせる' || value === '案件に合わせる') return 'inherit';
  if (value === 'show_bundle' || value === '本番まとめ') return 'show_bundle';
  if (value === 'schedule_month' || value === '日程の月で請求') return 'schedule_month';
  return 'inherit';
}

export function normalizeShowGroupLink(value: unknown): ShowGroupLink {
  if (value === 'with_previous' || value === '前の本番とまとめる') return 'with_previous';
  if (value === 'new_group' || value === 'ここで別の請求にする') return 'new_group';
  return 'auto';
}

export function normalizeGapDays(value: unknown, fallback = DEFAULT_SHOW_GROUP_GAP_DAYS): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n);
}

export function defaultIsBillable(taskType: string, nonBillableTypes: string[]): boolean {
  const name = canonicalTaskType(taskType);
  return !nonBillableTypes.map(canonicalTaskType).includes(name);
}

export function resolveProjectBillingTiming(
  project: Pick<Project, 'billing_timing'> | null | undefined,
  client: Pick<Client, 'billing_timing'> | null | undefined
): BillingTiming {
  const setting = normalizeBillingTimingSetting(project?.billing_timing);
  if (setting !== 'inherit') return setting;
  return normalizeBillingTiming(client?.billing_timing);
}

export function resolveTaskBillingTiming(
  task: Pick<Task, 'billing_timing'> | null | undefined,
  project: Pick<Project, 'billing_timing'> | null | undefined,
  client: Pick<Client, 'billing_timing'> | null | undefined
): BillingTiming {
  const setting = normalizeBillingTimingSetting(task?.billing_timing);
  if (setting !== 'inherit') return setting;
  return resolveProjectBillingTiming(project, client);
}

export function resolveShowGroupGapDays(
  project: Pick<Project, 'show_group_gap_days'> | null | undefined,
  client: Pick<Client, 'show_group_gap_days'> | null | undefined
): number {
  if (project?.show_group_gap_days != null) {
    const n = Number(project.show_group_gap_days);
    if (Number.isFinite(n) && n >= 0) return Math.round(n);
  }
  return normalizeGapDays(client?.show_group_gap_days, DEFAULT_SHOW_GROUP_GAP_DAYS);
}

function toUtcDay(value: string): number {
  const [y, m, d] = value.split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

/** 前の本番の終了日〜次の開始日の差（日）。重なりは 0。 */
export function showGapDays(prevEnd: string, nextStart: string): number {
  const diff = Math.round((toUtcDay(nextStart) - toUtcDay(prevEnd)) / 86400000);
  return Math.max(0, diff);
}

export type ShowGroup = {
  index: number;
  taskIds: string[];
  start: string;
  end: string;
  billingMonth: string;
};

type ShowLike = Pick<
  Task,
  'id' | 'task_type' | 'is_cancelled' | 'is_deleted' | 'start_date' | 'end_date' | 'date' | 'show_group_link'
>;

export function listActiveShows(tasks: ShowLike[]): ShowLike[] {
  return tasks
    .filter((task) => !task.is_cancelled && !task.is_deleted && isShowTaskType(task.task_type))
    .filter((task) => taskDateRange(task))
    .sort((a, b) => {
      const ra = taskDateRange(a)!;
      const rb = taskDateRange(b)!;
      const byStart = ra.start.localeCompare(rb.start);
      if (byStart !== 0) return byStart;
      return a.id.localeCompare(b.id);
    });
}

/**
 * 本番をグループ化。
 * - auto: 間隔が gapDays 以内なら前とまとめる
 * - with_previous: 間隔に関係なく前とまとめる
 * - new_group: 間隔に関係なくここで区切る
 */
export function buildShowGroups(tasks: ShowLike[], gapDays: number): ShowGroup[] {
  const shows = listActiveShows(tasks);
  const groups: ShowGroup[] = [];

  for (const show of shows) {
    const range = taskDateRange(show)!;
    const link = normalizeShowGroupLink(show.show_group_link);
    const prev = groups[groups.length - 1];

    let merge = false;
    if (prev) {
      if (link === 'with_previous') merge = true;
      else if (link === 'new_group') merge = false;
      else merge = showGapDays(prev.end, range.start) <= gapDays;
    }

    if (prev && merge) {
      prev.taskIds.push(show.id);
      if (range.start < prev.start) prev.start = range.start;
      if (range.end > prev.end) prev.end = range.end;
      prev.billingMonth = prev.end.slice(0, 7);
    } else {
      groups.push({
        index: groups.length,
        taskIds: [show.id],
        start: range.start,
        end: range.end,
        billingMonth: range.end.slice(0, 7),
      });
    }
  }

  return groups;
}

export type BillingResolution =
  | { kind: 'not_billable'; label: string }
  | { kind: 'waiting_show'; label: string }
  | {
      kind: 'month';
      billingMonth: string;
      /** true: 期間全体をその請求月に載せる / false: その月に重なる日だけ */
      wholePeriod: boolean;
      label: string;
    };

function formatMonthLabel(billingMonth: string) {
  const m = Number(billingMonth.slice(5, 7));
  return `${m}月`;
}

function formatRangeShort(start: string, end: string) {
  const sm = Number(start.slice(5, 7));
  const sd = Number(start.slice(8, 10));
  const em = Number(end.slice(5, 7));
  const ed = Number(end.slice(8, 10));
  if (start === end) return `${sm}/${sd}`;
  if (sm === em) return `${sm}/${sd}～${ed}`;
  return `${sm}/${sd}～${em}/${ed}`;
}

export function resolveTaskBilling(
  task: Task,
  projectTasks: Task[],
  client: Pick<Client, 'billing_timing' | 'show_group_gap_days'> | null | undefined,
  project: Pick<Project, 'billing_timing' | 'show_group_gap_days'> | null | undefined
): BillingResolution {
  if (task.is_billable === false) {
    return { kind: 'not_billable', label: '請求対象外' };
  }

  const timing = resolveTaskBillingTiming(task, project, client);
  const range = taskDateRange(task);

  if (timing === 'schedule_month') {
    if (!range) return { kind: 'waiting_show', label: '請求月: 未定（日程なし）' };
    const month = range.end.slice(0, 7);
    const multi = range.start.slice(0, 7) !== range.end.slice(0, 7);
    return {
      kind: 'month',
      billingMonth: month,
      wholePeriod: false,
      label: multi
        ? `請求月: 日程の各月（月ごとに分けて計上）`
        : `請求月: ${formatMonthLabel(month)}（日程の月）`,
    };
  }

  // 本番まとめ
  const gapDays = resolveShowGroupGapDays(project, client);
  const groups = buildShowGroups(projectTasks, gapDays);

  if (isShowTaskType(task.task_type)) {
    if (task.is_cancelled || task.is_deleted) {
      return { kind: 'not_billable', label: '請求対象外（キャンセル）' };
    }
    const group = groups.find((g) => g.taskIds.includes(task.id));
    if (!group) {
      return { kind: 'waiting_show', label: '請求月: 未定' };
    }
    const multiShow = group.taskIds.length > 1;
    const span = group.start.slice(0, 7) !== group.end.slice(0, 7);
    return {
      kind: 'month',
      billingMonth: group.billingMonth,
      wholePeriod: true,
      label: multiShow
        ? `請求月: ${formatMonthLabel(group.billingMonth)}（本番グループ ${formatRangeShort(group.start, group.end)}・期間全体）`
        : span
          ? `請求月: ${formatMonthLabel(group.billingMonth)}（本番 ${formatRangeShort(group.start, group.end)}・期間全体）`
          : `請求月: ${formatMonthLabel(group.billingMonth)}（本番 ${formatRangeShort(group.start, group.end)}）`,
    };
  }

  if (!range) {
    return { kind: 'waiting_show', label: '請求月: 未定（日程なし）' };
  }

  if (groups.length === 0) {
    return { kind: 'waiting_show', label: '請求月: 未定（次の本番待ち）' };
  }

  // 直後の本番グループ（グループ開始日がこの予定の開始日以降）
  const nextGroup = groups.find((g) => g.start >= range.start);
  if (!nextGroup) {
    // 本番後 → 日程の月（月締め）
    const multi = range.start.slice(0, 7) !== range.end.slice(0, 7);
    return {
      kind: 'month',
      billingMonth: range.end.slice(0, 7),
      wholePeriod: false,
      label: multi
        ? `請求月: 日程の各月（本番後・月ごとに分けて計上）`
        : `請求月: ${formatMonthLabel(range.end.slice(0, 7))}（日程の月・本番後）`,
    };
  }

  return {
    kind: 'month',
    billingMonth: nextGroup.billingMonth,
    wholePeriod: true,
    label: `請求月: ${formatMonthLabel(nextGroup.billingMonth)}（本番 ${formatRangeShort(nextGroup.start, nextGroup.end)} に付ける・期間全体）`,
  };
}

/** 指定請求月の自動取込で使う期間。該当しなければ null */
export function importPeriodForBillingMonth(
  task: Task,
  billingMonth: string,
  projectTasks: Task[],
  client: Pick<Client, 'billing_timing' | 'show_group_gap_days'> | null | undefined,
  project: Pick<Project, 'billing_timing' | 'show_group_gap_days'> | null | undefined
): { start: string; end: string; wholePeriod: boolean } | null {
  const resolved = resolveTaskBilling(task, projectTasks, client, project);
  if (resolved.kind === 'not_billable' || resolved.kind === 'waiting_show') return null;

  const range = taskDateRange(task);
  if (!range) return null;

  if (resolved.wholePeriod) {
    if (resolved.billingMonth !== billingMonth) return null;
    return { start: range.start, end: range.end, wholePeriod: true };
  }

  const period = clipToMonth(range.start, range.end, billingMonth);
  if (!period) return null;
  return { ...period, wholePeriod: false };
}

export function defaultsFromClient(
  taskType: string,
  client: Pick<Client, 'non_billable_task_types' | 'billing_timing'> | null | undefined,
  project: Pick<Project, 'billing_timing'> | null | undefined
): { is_billable: boolean; billing_timing: BillingTimingSetting; show_group_link: ShowGroupLink } {
  const nonBillable = parseNonBillableTaskTypes(client?.non_billable_task_types);
  return {
    is_billable: defaultIsBillable(taskType, nonBillable),
    billing_timing: 'inherit',
    show_group_link: 'auto',
  };
}

export function effectiveGapHint(
  project: Pick<Project, 'billing_timing' | 'show_group_gap_days'> | null | undefined,
  client: Pick<Client, 'billing_timing' | 'show_group_gap_days'> | null | undefined
): number {
  return resolveShowGroupGapDays(project, client);
}

/**
 * 請求書に載っている月と日程月をあわせた表示用キー。
 * 本番まとめで請求月が日程とずれる場合も請求済み月が見えるようにする。
 */
export function taskBillingDisplayMonths(
  task: Parameters<typeof taskMonthKeys>[0],
  billedMonths?: Record<string, BillingStatus> | null
): string[] {
  const months = new Set(taskMonthKeys(task));
  if (billedMonths) {
    for (const month of Object.keys(billedMonths)) months.add(month);
  }
  return [...months].sort();
}

/**
 * 請求書の状態からスケジュールの billing_status を決める。
 * 本番まとめ（wholePeriod）では請求月＝日程月とは限らないため、解決した請求月／請求書上の月を優先する。
 */
export function summarizeTaskBillingStatus(
  task: Task,
  billedMonths: Record<string, BillingStatus>,
  projectTasks: Task[],
  client?: Pick<Client, 'billing_timing' | 'show_group_gap_days' | 'non_billable_task_types'> | null,
  project?: Pick<Project, 'billing_timing' | 'show_group_gap_days'> | null
): BillingStatus {
  if (task.is_billable === false) return 'not_billable';

  const resolved = resolveTaskBilling(task, projectTasks, client, project);
  const invoiceMonths = Object.keys(billedMonths);

  if (resolved.kind === 'not_billable') return 'not_billable';

  if (resolved.kind === 'waiting_show') {
    return invoiceMonths.length > 0 ? summarizeBilling(Object.values(billedMonths)) : 'unbilled';
  }

  if (resolved.wholePeriod) {
    const status = billedMonths[resolved.billingMonth];
    if (status) return status;
    // 解決月以外に載っている（手で請求月を変えた等）→ 請求書側を優先
    return invoiceMonths.length > 0 ? summarizeBilling(Object.values(billedMonths)) : 'unbilled';
  }

  // 月締め: 日程がかかる各月。請求書だけ別月にある場合はそれも含める
  const calendarMonths = taskMonthKeys(task);
  if (calendarMonths.length === 0) {
    return invoiceMonths.length > 0 ? summarizeBilling(Object.values(billedMonths)) : 'unbilled';
  }

  const months = new Set(calendarMonths);
  for (const month of invoiceMonths) months.add(month);
  return summarizeBilling(
    [...months].sort().map((month) => billedMonths[month] ?? 'unbilled')
  );
}
