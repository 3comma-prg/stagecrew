import type { SheetKey } from './schema';

type Row = Record<string, unknown>;

export type CalendarConflict = {
  taskId: string;
  scheduleName: string;
  billingStatus: string;
  app: CalendarTimeSnapshot;
  google: CalendarTimeSnapshot;
};

export type CalendarTimeSnapshot = {
  time_type: string;
  start_date: string | null;
  start_time: string | null;
  end_date: string | null;
  end_time: string | null;
};

export type CalendarDeps = {
  getToken: () => Promise<string>;
  serviceAccountEmail: string;
  list: (key: SheetKey) => Promise<Row[]>;
  update: (key: SheetKey, id: string, patch: Row) => Promise<Row>;
};

type CalendarEvent = {
  id?: string;
  status?: string;
  summary?: string;
  location?: string;
  description?: string;
  colorId?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  reminders?: { useDefault?: boolean };
  extendedProperties?: { private?: Record<string, string> };
};

const TIME_ZONE = 'Asia/Tokyo';
const CANCEL_COLOR_ID = '8';
const VENUE_TASK_TYPES = ['仕込み/本番', '本番', '仕込み', 'バラシ', 'GP', '仮組'];
const LOCKED_BILLING = new Set(['draft', 'billed', 'paid']);

function asString(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function asBool(value: unknown) {
  return value === true || value === 'true' || value === 'はい';
}

function shiftDate(iso: string, days: number) {
  const [year, month, day] = iso.split('-').map(Number);
  const next = new Date(Date.UTC(year, (month || 1) - 1, (day || 1) + days));
  return next.toISOString().slice(0, 10);
}

function zonedParts(iso: string) {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    time: `${map.hour}:${map.minute}`,
  };
}

function taskSubtitle(task: Row) {
  const type = asString(task.task_type);
  if (VENUE_TASK_TYPES.includes(type)) {
    const venue = [asString(task.area), asString(task.location)].filter(Boolean).join(' / ');
    if (venue) return venue;
  }
  return type;
}

function scheduleName(task: Row, project: Row | undefined) {
  const projectName = asString(project?.project_name);
  const subtitle = taskSubtitle(task);
  if (projectName && subtitle) return `${projectName} (${subtitle})`;
  return projectName || subtitle || asString(task.task_type) || 'スケジュール';
}

function timeSnapshot(task: Row): CalendarTimeSnapshot {
  const timeType = asString(task.time_type) || 'all_day';
  const startDate = asString(task.start_date || task.date) || null;
  const endDate = timeType === 'all_day' ? null : asString(task.end_date) || startDate;
  return {
    time_type: timeType,
    start_date: startDate,
    start_time: timeType === 'time_limited' ? asString(task.start_time).slice(0, 5) || null : null,
    end_date: endDate,
    end_time: timeType === 'time_limited' ? asString(task.end_time).slice(0, 5) || null : null,
  };
}

function sameTime(a: CalendarTimeSnapshot, b: CalendarTimeSnapshot) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function snapshotFromEvent(event: CalendarEvent): CalendarTimeSnapshot | null {
  if (event.start?.date) {
    const startDate = event.start.date;
    const endExclusive = event.end?.date || shiftDate(startDate, 1);
    const endDate = shiftDate(endExclusive, -1);
    const timeType = endDate > startDate ? 'multi_day' : 'all_day';
    return {
      time_type: timeType,
      start_date: startDate,
      start_time: null,
      end_date: timeType === 'all_day' ? null : endDate,
      end_time: null,
    };
  }
  if (event.start?.dateTime && event.end?.dateTime) {
    const start = zonedParts(event.start.dateTime);
    const end = zonedParts(event.end.dateTime);
    return {
      time_type: 'time_limited',
      start_date: start.date,
      start_time: start.time,
      end_date: end.date,
      end_time: end.time,
    };
  }
  return null;
}

function eventTimes(task: Row) {
  const timeType = asString(task.time_type) || 'all_day';
  const startDate = asString(task.start_date || task.date);
  const endDate = asString(task.end_date) || startDate;
  if (!startDate) throw new Error('開始日がないため、Googleカレンダーに登録できません。');
  if (timeType === 'time_limited') {
    const startTime = (asString(task.start_time) || '12:00').slice(0, 5);
    const endTime = (asString(task.end_time) || '13:00').slice(0, 5);
    return {
      start: { dateTime: `${startDate}T${startTime}:00`, timeZone: TIME_ZONE },
      end: { dateTime: `${endDate}T${endTime}:00`, timeZone: TIME_ZONE },
    };
  }
  const lastDay = timeType === 'multi_day' ? endDate : startDate;
  return {
    start: { date: startDate },
    end: { date: shiftDate(lastDay, 1) },
  };
}

function eventColorId(task: Row, client: Row | undefined) {
  if (asBool(task.is_cancelled)) return CANCEL_COLOR_ID;
  const color = Number(client?.google_calendar_color_id);
  if (Number.isInteger(color) && color >= 1 && color <= 11) return String(color);
  return undefined;
}

function eventDescription(task: Row) {
  const lines: string[] = [];
  if (asString(task.task_type)) lines.push(`種別: ${asString(task.task_type)}`);
  if (asString(task.position)) lines.push(`ポジション: ${asString(task.position)}`);
  lines.push(asBool(task.is_domestic) ? '国内' : '海外');
  if (asString(task.venue_size)) lines.push(`規模: ${asString(task.venue_size)}`);
  if (asString(task.notes)) {
    lines.push('');
    lines.push(asString(task.notes));
  }
  if (asBool(task.is_cancelled)) {
    lines.push('');
    lines.push('【キャンセル】');
  }
  return lines.join('\n');
}

function buildEvent(task: Row, project: Row | undefined, client: Row | undefined): CalendarEvent {
  const times = eventTimes(task);
  const colorId = eventColorId(task, client);
  return {
    summary: scheduleName(task, project),
    location: [asString(task.area), asString(task.location)].filter(Boolean).join(' / ') || undefined,
    description: eventDescription(task) || undefined,
    ...(colorId ? { colorId } : {}),
    start: times.start,
    end: times.end,
    status: 'confirmed',
    reminders: { useDefault: true },
    extendedProperties: { private: { appTaskId: asString(task.id) } },
  };
}

function calendarMessage(status: number, body: string, email: string) {
  let message = body.slice(0, 400);
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    message = parsed.error?.message || message;
  } catch {
    message = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
  }
  if (/has not been used in project|accessNotConfigured|Calendar API/i.test(message)) {
    return 'Google Calendar API が無効です。Google Cloud のプロジェクトで Calendar API を有効にしてから、もう一度試してください。';
  }
  if (/insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(message)) {
    return 'Googleカレンダーの権限がトークンに含まれていません。開発サーバーを再起動してから、もう一度試してください。';
  }
  if (status === 404) {
    return `指定したカレンダーが見つかりません。設定のカレンダーIDを確認し、サービスアカウント（${email || '設定済みのアカウント'}）に「予定の変更」権限で共有してください。`;
  }
  if (status === 401 || status === 403 || /permission|forbidden|writer access/i.test(message)) {
    return `Googleカレンダーを更新できません。カレンダーをサービスアカウント（${email || '設定済みのアカウント'}）に「予定の変更」権限で共有してください。閲覧のみでは登録できません。`;
  }
  return `Googleカレンダーとの同期に失敗しました。（${status}）${message.slice(0, 240)}`;
}

async function googleFetch(token: string, email: string, url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    console.error('[calendar]', response.status, url, text.slice(0, 800));
    const error = new Error(calendarMessage(response.status, text, email)) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  if (!text || response.status === 204) return null;
  return JSON.parse(text) as {
    items?: (CalendarEvent & { accessRole?: string; summary?: string; id?: string; primary?: boolean })[];
    nextPageToken?: string;
    nextSyncToken?: string;
    accessRole?: string;
    summary?: string;
    id?: string;
  } & CalendarEvent;
}

function notFoundMessage(calendarId: string, email: string) {
  return `指定したカレンダー（${calendarId}）にアクセスできません。このカレンダーの「設定と共有」→「特定のユーザーとの共有」に ${email} を追加し、権限を「予定の変更」にしてください。calendarId は primary ではなく、カレンダー本体のIDを指定してください。`;
}

function resolvedCalendarId(calendarId: string): { id: string } | { empty: true } | { error: string } {
  const id = calendarId.trim();
  if (!id) return { empty: true };
  if (id.toLowerCase() === 'primary') {
    return {
      error:
        'サービスアカウントでは calendarId に primary は使えません。設定のカレンダーIDに、同期したいカレンダー本体のID（〜@group.calendar.google.com など）を指定してください。',
    };
  }
  return { id };
}

async function calendarFetch(
  token: string,
  email: string,
  calendarId: string,
  path: string,
  init: RequestInit = {}
) {
  return googleFetch(
    token,
    email,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}${path}`,
    init
  );
}

async function probeCalendarAccess(deps: CalendarDeps, calendarId: string) {
  const token = await deps.getToken();
  const email = deps.serviceAccountEmail;
  const data = await calendarFetch(token, email, calendarId, '/events?maxResults=1');
  return {
    summary: asString(data?.summary) || calendarId,
    accessRole: asString(data?.accessRole),
  };
}

function readOnlyMessage(summary: string, email: string) {
  return `カレンダー「${summary}」は閲覧のみです。サービスアカウント（${email}）に「予定の変更」権限で共有し直してください。`;
}

export async function inspectCalendar(deps: CalendarDeps, calendarId: string) {
  const resolved = resolvedCalendarId(calendarId);
  if ('empty' in resolved) return { error: 'カレンダーIDがありません。' };
  if ('error' in resolved) return { error: resolved.error };

  const id = resolved.id;
  const email = deps.serviceAccountEmail;
  try {
    const probed = await probeCalendarAccess(deps, id);
    if (probed.accessRole === 'reader' || probed.accessRole === 'freeBusyReader') {
      return {
        error: readOnlyMessage(probed.summary, email),
        serviceAccountEmail: email,
      };
    }
    return {
      ok: true as const,
      calendarId: id,
      summary: probed.summary,
      accessRole: probed.accessRole || 'writer',
      serviceAccountEmail: email,
    };
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    if (status === 404) {
      return { error: notFoundMessage(id, email), serviceAccountEmail: email };
    }
    return {
      error: error instanceof Error ? error.message : 'カレンダーの確認に失敗しました。',
      serviceAccountEmail: email,
    };
  }
}

function billingFromInvoice(status: string) {
  if (status === 'paid') return 'paid';
  if (status === 'issued') return 'billed';
  if (status === 'draft') return 'draft';
  return null;
}

function strongerBilling(current: string, next: string) {
  const rank: Record<string, number> = { unbilled: 0, draft: 1, billed: 2, paid: 3 };
  return (rank[next] || 0) > (rank[current] || 0) ? next : current;
}

function billingForTask(task: Row, invoices: Row[], items: Row[]) {
  let status = asString(task.billing_status) || 'unbilled';
  for (const item of items) {
    if (asString(item.task_id) !== asString(task.id)) continue;
    const invoice = invoices.find((row) => asString(row.id) === asString(item.invoice_id));
    const next = billingFromInvoice(asString(invoice?.status));
    if (next) status = strongerBilling(status, next);
  }
  return status;
}

function isDeletedEvent(event: CalendarEvent) {
  return event.status === 'cancelled';
}

async function deleteEvent(deps: CalendarDeps, calendarId: string, eventId: string) {
  try {
    await calendarFetch(await deps.getToken(), deps.serviceAccountEmail, calendarId, `/events/${encodeURIComponent(eventId)}?sendUpdates=none`, {
      method: 'DELETE',
    });
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    if (status === 404 || status === 410) return;
    throw error;
  }
}

export async function pushTaskToCalendar(
  deps: CalendarDeps,
  calendarId: string,
  taskId: string,
  options?: { deleteEvent?: boolean }
) {
  const resolved = resolvedCalendarId(calendarId);
  if ('empty' in resolved) return { skipped: true as const };
  if ('error' in resolved) return { skipped: true as const, error: resolved.error };
  const id = resolved.id;

  const [tasks, projects, clients] = await Promise.all([deps.list('tasks'), deps.list('projects'), deps.list('clients')]);
  const task = tasks.find((row) => asString(row.id) === taskId);
  if (!task) return { skipped: true as const, error: '対象のスケジュールが見つかりません。' };

  const eventId = asString(task.google_event_id);
  const shouldDelete = options?.deleteEvent || asBool(task.is_deleted);

  if (shouldDelete) {
    if (eventId) await deleteEvent(deps, id, eventId);
    return { ok: true as const, deleted: true as const, google_event_id: eventId || null };
  }

  const project = projects.find((row) => asString(row.id) === asString(task.project_id));
  const client = clients.find((row) => asString(row.id) === asString(project?.client_id));
  const body = JSON.stringify(buildEvent(task, project, client));
  const token = await deps.getToken();
  const email = deps.serviceAccountEmail;

  const saveId = async (nextId: string) => {
    if (nextId && nextId !== eventId) {
      await deps.update('tasks', taskId, { google_event_id: nextId });
    }
    return nextId;
  };

  if (eventId) {
    try {
      const updated = await calendarFetch(token, email, id, `/events/${encodeURIComponent(eventId)}?sendUpdates=none`, {
        method: 'PUT',
        body,
      });
      return { ok: true as const, google_event_id: await saveId(asString(updated?.id) || eventId) };
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status !== 404 && status !== 410) throw error;
    }
  }

  const created = await calendarFetch(token, email, id, '/events?sendUpdates=none', { method: 'POST', body }).catch(
    (error) => {
      const status = (error as Error & { status?: number }).status;
      if (status === 404) throw new Error(notFoundMessage(id, email));
      throw error;
    }
  );
  const nextId = asString(created?.id);
  if (!nextId) throw new Error('GoogleカレンダーのイベントIDを取得できませんでした。');
  return { ok: true as const, google_event_id: await saveId(nextId) };
}

async function listChangedEvents(deps: CalendarDeps, calendarId: string, syncToken: string | null) {
  const token = await deps.getToken();
  const email = deps.serviceAccountEmail;
  const items: CalendarEvent[] = [];
  let pageToken = '';
  let nextSyncToken = '';
  const base = syncToken
    ? `/events?maxResults=2500&syncToken=${encodeURIComponent(syncToken)}`
    : `/events?showDeleted=true&maxResults=2500&timeMin=${encodeURIComponent(
        new Date(Date.now() - 1000 * 60 * 60 * 24 * 730).toISOString()
      )}`;

  while (true) {
    const path = `${base}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const data = await calendarFetch(token, email, calendarId, path);
    items.push(...(data?.items || []));
    if (data?.nextSyncToken) nextSyncToken = data.nextSyncToken;
    if (!data?.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return { items, nextSyncToken: nextSyncToken || syncToken || null };
}

export async function pullCalendarChanges(deps: CalendarDeps, calendarId: string, syncToken: string | null) {
  const resolved = resolvedCalendarId(calendarId);
  if ('empty' in resolved) {
    return { skipped: true as const, conflicts: [] as CalendarConflict[], applied: { deleted: 0, updated: 0 }, syncToken: null as string | null };
  }
  if ('error' in resolved) throw new Error(resolved.error);
  const id = resolved.id;

  let listed: { items: CalendarEvent[]; nextSyncToken: string | null };
  try {
    listed = await listChangedEvents(deps, id, syncToken);
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    if ((status === 410 || status === 400) && syncToken) {
      listed = await listChangedEvents(deps, id, null);
    } else {
      throw error;
    }
  }

  const [tasks, projects, invoices, items] = await Promise.all([
    deps.list('tasks'),
    deps.list('projects'),
    deps.list('invoices'),
    deps.list('invoice_items'),
  ]);
  const tasksById = new Map(tasks.map((row) => [asString(row.id), row]));
  const tasksByEventId = new Map(
    tasks.filter((row) => asString(row.google_event_id)).map((row) => [asString(row.google_event_id), row])
  );

  const conflicts: CalendarConflict[] = [];
  let deleted = 0;
  let updated = 0;

  for (const event of listed.items) {
    const appTaskId = asString(event.extendedProperties?.private?.appTaskId);
    const task = (appTaskId ? tasksById.get(appTaskId) : undefined) || (event.id ? tasksByEventId.get(event.id) : undefined);
    if (!task) continue;
    if (asBool(task.is_deleted)) continue;

    if (isDeletedEvent(event)) {
      await deps.update('tasks', asString(task.id), { is_deleted: true });
      task.is_deleted = true;
      deleted += 1;
      continue;
    }

    const googleTime = snapshotFromEvent(event);
    if (!googleTime) continue;
    const appTime = timeSnapshot(task);
    if (sameTime(appTime, googleTime)) continue;

    const billingStatus = billingForTask(task, invoices, items);
    if (LOCKED_BILLING.has(billingStatus)) {
      const project = projects.find((row) => asString(row.id) === asString(task.project_id));
      conflicts.push({
        taskId: asString(task.id),
        scheduleName: scheduleName(task, project),
        billingStatus,
        app: appTime,
        google: googleTime,
      });
      continue;
    }

    await deps.update('tasks', asString(task.id), {
      time_type: googleTime.time_type,
      start_date: googleTime.start_date,
      date: googleTime.start_date,
      start_time: googleTime.start_time,
      end_date: googleTime.end_date,
      end_time: googleTime.end_time,
    });
    Object.assign(task, googleTime, { date: googleTime.start_date });
    updated += 1;
  }

  return {
    ok: true as const,
    syncToken: listed.nextSyncToken,
    applied: { deleted, updated },
    conflicts,
  };
}
