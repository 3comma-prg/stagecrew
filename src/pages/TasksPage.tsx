import { Fragment, useEffect, useState, useCallback } from 'react';
import { listInvoiceItems, listProjects, listTasks, saveTask, subscribeData, syncGoogleCalendarFromRemote, updateTask } from '@/lib/db';
import type { Task, Project, BillingStatus, TimeType } from '@/types';
import {
  BILLING_STATUS_LABELS,
  BILLING_STATUS_COLORS,
  TIME_TYPE_LABELS,
  billingFromInvoiceStatus,
  clientName,
  compareCreatedAt,
  compareTaskDate,
  DEFAULT_TASK_TYPE,
  formatTaskDateRange,
  monthBillingLabel,
  monthBillingStatus,
  strongerBilling,
  compareCatalogOrder,
  getTaskSubtitle,
} from '@/types';
import { Modal } from '@/components/ui/Modal';
import { FormField, inputClass } from '@/components/ui/FormField';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SplitDetailLayout } from '@/components/ui/SplitDetailLayout';
import { TaskForm } from '@/pages/ProjectsPage';
import { CalendarRefreshButton } from '@/components/CalendarRefreshButton';
import { CancelledBanner, CancelledTitle, cancelledCardClass } from '@/components/CancelledMark';
import { CollapsedSection, isClosedProjectStatus } from '@/components/CollapsedSection';
import { errorFor, inputErrorClass, validateScheduleForm, type FieldError } from '@/lib/schedule-form';
import { parseInvoiceTaskIds } from '@/lib/invoice-line-merge';
import { useSessionPref } from '@/lib/session-list-prefs';
import { SortBar, applySortDir, type SortDir } from '@/components/ui/SortBar';
import { useCatalogOptions } from '@/lib/catalog-options';
import {
  defaultsFromClient,
  normalizeBillingTimingSetting,
  normalizeShowGroupLink,
  taskBillingDisplayMonths,
  type BillingTimingSetting,
  type ShowGroupLink,
} from '@/lib/billing-policy';
import {
  Plus,
  Pencil,
  Trash2,
  CalendarDays,
  Globe,
  Ban,
  Search,
  Copy,
  X,
  Building2,
} from 'lucide-react';

type TaskSortKey = 'created_at' | 'date' | 'project' | 'client_name' | 'task_type' | 'location' | 'position' | 'billing_status';
type BillingByTask = Record<string, Record<string, BillingStatus>>;

function asInvoice(value: unknown): { billing_month: string; status: string } | null {
  if (!value) return null;
  if (Array.isArray(value)) return (value[0] as { billing_month: string; status: string } | undefined) ?? null;
  return value as { billing_month: string; status: string };
}

function MonthBillingBadges({ task, billedMonths }: { task: Task; billedMonths?: Record<string, BillingStatus> }) {
  if (task.is_billable === false || task.billing_status === 'not_billable') {
    return (
      <Badge
        label={BILLING_STATUS_LABELS.not_billable}
        className={BILLING_STATUS_COLORS.not_billable}
      />
    );
  }
  const months = taskBillingDisplayMonths(task, billedMonths);
  if (months.length === 0) {
    return (
      <Badge
        label={BILLING_STATUS_LABELS[task.billing_status]}
        className={BILLING_STATUS_COLORS[task.billing_status]}
      />
    );
  }
  return (
    <>
      {months.map((month) => {
        const status = monthBillingStatus(task, month, billedMonths);
        return (
          <Badge
            key={month}
            label={`${monthBillingLabel(month)} ${BILLING_STATUS_LABELS[status]}`}
            className={BILLING_STATUS_COLORS[status]}
          />
        );
      })}
    </>
  );
}

export function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [billingByTask, setBillingByTask] = useState<BillingByTask>({});
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [listPrefs, patchListPrefs] = useSessionPref('tasks', {
    billingFilter: 'all' as BillingStatus | 'all',
    projectFilter: 'all',
    sortBy: 'date' as TaskSortKey,
    sortDir: 'asc' as SortDir,
    completedOpen: false,
    cancelledOpen: false,
  });
  const { billingFilter, projectFilter, sortBy, sortDir, completedOpen, cancelledOpen } = listPrefs;
  const { taskTypes } = useCatalogOptions();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [saving, setSaving] = useState(false);
  const [formErrors, setFormErrors] = useState<FieldError[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const [form, setForm] = useState({
    project_id: '',
    task_type: DEFAULT_TASK_TYPE,
    time_type: 'all_day' as TimeType,
    start_date: new Date().toISOString().slice(0, 10),
    start_time: '12:00',
    end_date: new Date().toISOString().slice(0, 10),
    end_time: '13:00',
    area: '',
    location: '',
    position: '',
    is_domestic: true,
    venue_size: '' as string,
    notes: '',
    billing_status: 'unbilled' as BillingStatus,
    is_billable: true,
    billing_timing: 'inherit' as BillingTimingSetting,
    show_group_link: 'auto' as ShowGroupLink,
    is_cancelled: false,
  });

  const formProject = projects.find((p) => p.id === form.project_id) || null;
  const projectTasksForForm = tasks.filter((task) => task.project_id === form.project_id);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      setTasks(await listTasks());
    } catch (error) {
      console.error('Error fetching tasks:', error);
    }
    try {
      const billedItems = (await listInvoiceItems()).filter((item) => item.task_id);
      const next: BillingByTask = {};
      for (const item of billedItems) {
        const invoice = asInvoice(item.invoice);
        const status = billingFromInvoiceStatus(invoice?.status);
        if (!invoice?.billing_month || !status) continue;
        for (const taskId of parseInvoiceTaskIds(item.task_id)) {
          const current = next[taskId] || {};
          current[invoice.billing_month] = current[invoice.billing_month]
            ? strongerBilling(current[invoice.billing_month], status)
            : status;
          next[taskId] = current;
        }
      }
      setBillingByTask(next);
    } catch (error) {
      console.error('Error fetching invoice billing:', error);
      setBillingByTask({});
    }
    setLoading(false);
    try {
      await syncGoogleCalendarFromRemote();
    } catch (error) {
      console.error('Error syncing Google Calendar:', error);
    }
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      const data = await listProjects();
      setProjects([...data].sort((a, b) => a.project_name.localeCompare(b.project_name, 'ja')));
    } catch (error) {
      console.error('Error fetching projects:', error);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchProjects();
    return subscribeData(() => {
      listTasks()
        .then(setTasks)
        .catch((error) => console.error('Error fetching tasks:', error));
    });
  }, [fetchTasks, fetchProjects]);

  const openCreate = () => {
    const today = new Date().toISOString().slice(0, 10);
    setEditing(null);
    setForm({
      project_id: '',
      task_type: DEFAULT_TASK_TYPE,
      time_type: 'all_day',
      start_date: today,
      start_time: '12:00',
      end_date: today,
      end_time: '13:00',
      area: '',
      location: '',
      position: '',
      is_domestic: true,
      venue_size: '',
      notes: '',
      billing_status: 'unbilled',
      is_billable: true,
      billing_timing: 'inherit',
      show_group_link: 'auto',
      is_cancelled: false,
    });
    setFormErrors([]);
    setModalOpen(true);
  };

  const openEdit = (task: Task) => {
    setEditing(task);
    setForm({
      project_id: task.project_id,
      task_type: task.task_type,
      time_type: task.time_type,
      start_date: task.start_date || '',
      start_time: task.start_time || '12:00',
      end_date: task.end_date || task.start_date || '',
      end_time: task.end_time || '13:00',
      area: task.area || '',
      location: task.location || '',
      position: task.position || '',
      is_domestic: task.is_domestic,
      venue_size: task.venue_size || '',
      notes: task.notes || '',
      billing_status: task.billing_status,
      is_billable: task.is_billable !== false,
      billing_timing: normalizeBillingTimingSetting(task.billing_timing),
      show_group_link: normalizeShowGroupLink(task.show_group_link),
      is_cancelled: task.is_cancelled,
    });
    setFormErrors([]);
    setModalOpen(true);
  };

  const openCopy = (task: Task) => {
    setEditing(null);
    setForm({
      project_id: task.project_id,
      task_type: task.task_type,
      time_type: task.time_type,
      start_date: task.start_date || '',
      start_time: task.start_time || '12:00',
      end_date: task.end_date || task.start_date || '',
      end_time: task.end_time || '13:00',
      area: task.area || '',
      location: task.location || '',
      position: task.position || '',
      is_domestic: task.is_domestic,
      venue_size: task.venue_size || '',
      notes: task.notes || '',
      billing_status: task.billing_status,
      is_billable: task.is_billable !== false,
      billing_timing: normalizeBillingTimingSetting(task.billing_timing),
      show_group_link: normalizeShowGroupLink(task.show_group_link),
      is_cancelled: false,
    });
    setFormErrors([]);
    setModalOpen(true);
  };

  const handleSave = async () => {
    const errors = validateScheduleForm(form, { requireProject: true });
    setFormErrors(errors);
    if (errors.length) return;
    setSaving(true);
    const payload = {
      project_id: form.project_id,
      date: form.start_date,
      task_type: form.task_type,
      time_type: form.time_type,
      start_date: form.start_date || null,
      start_time: form.time_type === 'time_limited' ? (form.start_time || '12:00') : null,
      end_date: form.time_type !== 'all_day' ? (form.end_date || null) : null,
      end_time: form.time_type === 'time_limited' ? (form.end_time || '13:00') : null,
      area: form.area || null,
      location: form.location || null,
      position: form.position || null,
      is_domestic: form.is_domestic,
      venue_size: form.venue_size || null,
      notes: form.notes || null,
      billing_status: form.is_billable ? form.billing_status : 'not_billable',
      is_billable: form.is_billable,
      billing_timing: form.billing_timing,
      show_group_link: form.show_group_link,
      is_cancelled: form.is_cancelled,
    };
    try {
      await saveTask(payload, editing?.id);
      setModalOpen(false);
      fetchTasks();
    } catch (error) {
      console.error('Error saving task:', error);
      setFormErrors([
        {
          field: 'save',
          message: error instanceof Error ? error.message : 'スケジュールを保存できませんでした。',
        },
      ]);
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('このスケジュールを削除しますか？')) return;
    try {
      await updateTask(id, { is_deleted: true });
    } catch (error) {
      console.error('Error deleting task:', error);
    }
    if (selectedTaskId === id) setSelectedTaskId(null);
    fetchTasks();
  };

  const handleCancel = async (id: string, current: boolean) => {
    try {
      await updateTask(id, { is_cancelled: !current });
    } catch (error) {
      console.error('Error updating task:', error);
    }
    fetchTasks();
  };

  const filtered = tasks.filter((t) => {
    const matchesSearch =
      (t.area || '').toLowerCase().includes(search.toLowerCase()) ||
      (t.location || '').toLowerCase().includes(search.toLowerCase()) ||
      (t.position || '').toLowerCase().includes(search.toLowerCase()) ||
      (t.notes || '').toLowerCase().includes(search.toLowerCase()) ||
      (t.project?.project_name || '').toLowerCase().includes(search.toLowerCase()) ||
      clientName(t.project?.client).toLowerCase().includes(search.toLowerCase());
    const months = taskBillingDisplayMonths(t, billingByTask[t.id]);
    const effectiveStatus =
      t.is_billable === false || t.billing_status === 'not_billable' ? 'not_billable' : t.billing_status;
    const matchesBilling =
      billingFilter === 'all' ||
      (billingFilter === 'unbilled'
        ? effectiveStatus === 'unbilled'
        : billingFilter === 'not_billable'
          ? effectiveStatus === 'not_billable'
          : months.length === 0
            ? effectiveStatus === billingFilter
            : months.some((month) => monthBillingStatus(t, month, billingByTask[t.id]) === billingFilter) ||
              effectiveStatus === billingFilter);
    const matchesProject = projectFilter === 'all' || t.project_id === projectFilter;
    return matchesSearch && matchesBilling && matchesProject;
  });

  const sorted = [...filtered].sort((a, b) => {
    let result = 0;
    if (sortBy === 'created_at') result = compareCreatedAt(a, b);
    else if (sortBy === 'date') result = compareTaskDate(a, b);
    else if (sortBy === 'project') {
      result = (a.project?.project_name || '').localeCompare(b.project?.project_name || '', 'ja');
    } else if (sortBy === 'client_name') {
      const nameA = clientName(a.project?.client) || 'zzz';
      const nameB = clientName(b.project?.client) || 'zzz';
      result = nameA.localeCompare(nameB, 'ja');
    } else if (sortBy === 'task_type') {
      result = compareCatalogOrder(a.task_type, b.task_type, taskTypes);
    } else if (sortBy === 'location') {
      result = (a.location || '').localeCompare(b.location || '', 'ja');
    } else if (sortBy === 'position') {
      result = (a.position || '').localeCompare(b.position || '', 'ja');
    } else {
      result = a.billing_status.localeCompare(b.billing_status);
    }
    return applySortDir(result, sortDir);
  });

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;
  const selectedProject = selectedTask
    ? projects.find((p) => p.id === selectedTask.project_id) || null
    : null;

  return (
    <div>
      <div className="page-toolbar">
        <div>
          <h1 className="page-title">スケジュール一覧</h1>
          <p className="mt-1 text-sm text-slate-500">全プロジェクトのスケジュールを管理します</p>
        </div>
        <div className="flex items-center gap-2">
          <CalendarRefreshButton />
          <button onClick={openCreate} className="btn-primary">
            <Plus className="h-4 w-4" />
            新規スケジュール
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="プロジェクト名、クライアント名、エリア、会場、ポジション、備考で検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputClass} pl-10`}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
          <span className="shrink-0 text-xs font-medium text-slate-400">プロジェクト名</span>
          <select
            value={projectFilter}
            onChange={(e) => patchListPrefs({ projectFilter: e.target.value })}
            className={`${inputClass} w-full sm:w-auto`}
          >
            <option value="all">すべて</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.project_name}</option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
          <span className="shrink-0 text-xs font-medium text-slate-400">請求状態</span>
          <div className="flex flex-wrap gap-2">
          {(['all', 'unbilled', 'draft', 'billed', 'paid', 'not_billable'] as const).map((s) => (
            <button
              key={s}
              onClick={() => patchListPrefs({ billingFilter: s })}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                billingFilter === s
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {s === 'all' ? 'すべて' : BILLING_STATUS_LABELS[s]}
            </button>
          ))}
          </div>
        </div>
      </div>

      <SortBar
        options={[
          { key: 'date' as const, label: '日付' },
          { key: 'created_at' as const, label: '登録順' },
          { key: 'project' as const, label: 'プロジェクト名' },
          { key: 'client_name' as const, label: 'クライアント名' },
          { key: 'task_type' as const, label: '種別' },
          { key: 'location' as const, label: '会場' },
          { key: 'position' as const, label: 'ポジション' },
          { key: 'billing_status' as const, label: '請求状態' },
        ]}
        sortBy={sortBy}
        sortDir={sortDir}
        onChange={patchListPrefs}
      />

      <SplitDetailLayout
        selected={Boolean(selectedTask)}
        pane={
          selectedTask && selectedProject ? (
            <SameProjectSchedulePane
              task={selectedTask}
              project={selectedProject}
              billingByTask={billingByTask}
              onClose={() => setSelectedTaskId(null)}
              onSelectTask={(id) => setSelectedTaskId((current) => (current === id ? null : id))}
              onEdit={openEdit}
              onCopy={openCopy}
              onDelete={handleDelete}
            />
          ) : null
        }
      >
        {({ isDesktop }) =>
          loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
            </div>
          ) : sorted.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={<CalendarDays className="h-7 w-7" />}
                title="スケジュールがありません"
                description="新規スケジュールボタンから追加してください"
              />
            </div>
          ) : (
            (() => {
              const selectedProjectClosed =
                projectFilter !== 'all' &&
                isClosedProjectStatus(projects.find((p) => p.id === projectFilter)?.status);
              const active = selectedProjectClosed
                ? sorted
                : sorted.filter((t) => t.project?.status === 'in_progress' || !t.project);
              const completed = selectedProjectClosed
                ? []
                : sorted.filter((t) => t.project?.status === 'completed');
              const cancelled = selectedProjectClosed
                ? []
                : sorted.filter((t) => t.project?.status === 'cancelled');
              const renderTask = (task: Task) => (
              <Fragment key={task.id}>
                <div
                  className={`card group cursor-pointer p-4 transition-all hover:shadow-md ${cancelledCardClass(task.is_cancelled)} ${
                    selectedTaskId === task.id ? 'ring-2 ring-teal-500' : ''
                  }`}
                  onClick={() => setSelectedTaskId((current) => (current === task.id ? null : task.id))}
                >
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    {task.is_cancelled && <CancelledBanner />}
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge label={task.task_type} className="bg-teal-50 text-teal-700 border-teal-200" />
                      <Badge label={TIME_TYPE_LABELS[task.time_type]} className="bg-slate-50 text-slate-600 border-slate-200" />
                      <MonthBillingBadges task={task} billedMonths={billingByTask[task.id]} />
                    </div>
                    <h3 className="mt-2 text-lg font-bold text-slate-900">
                      {task.is_cancelled ? (
                        <CancelledTitle>
                          {task.project?.project_name || '—'}
                          {(() => {
                            const sub = getTaskSubtitle(task);
                            return sub ? <span className="font-medium"> ({sub})</span> : null;
                          })()}
                        </CancelledTitle>
                      ) : (
                        <>
                          {task.project?.project_name || '—'}
                          {(() => {
                            const sub = getTaskSubtitle(task);
                            return sub ? <span className="font-medium text-slate-500"> ({sub})</span> : null;
                          })()}
                        </>
                      )}
                    </h3>
                    <div className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                      <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="truncate">{clientName(task.project?.client) || 'クライアント未設定'}</span>
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-700">
                      {formatTaskDateRange(task)}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <Globe className="h-3.5 w-3.5 text-slate-400" />
                        <span>{task.is_domestic ? '国内' : '海外'}</span>
                        {task.venue_size && <span>・{task.venue_size}</span>}
                      </div>
                      {task.position && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-400">ポジション:</span>
                          <span>{task.position}</span>
                        </div>
                      )}
                    </div>
                    {task.notes && (
                      <p className="mt-2 line-clamp-2 text-sm text-slate-500">{task.notes}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1" onClick={(e) => e.stopPropagation()}>
                    <div className="row-actions">
                      <button onClick={() => openEdit(task)} className="btn-icon" title="編集">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => openCopy(task)} className="btn-icon" title="コピー">
                        <Copy className="h-4 w-4" />
                      </button>
                      <button onClick={() => handleDelete(task.id)} className="btn-icon hover:text-red-500" title="削除">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <button
                      onClick={() => handleCancel(task.id, task.is_cancelled)}
                      className={`rounded-lg px-2 py-1 text-xs font-medium transition-all ${
                        task.is_cancelled ? 'text-slate-500 hover:bg-slate-100' : 'text-red-500 hover:bg-red-50'
                      }`}
                    >
                      <Ban className="mr-1 inline h-3 w-3" />
                      {task.is_cancelled ? 'キャンセル解除' : 'キャンセル'}
                    </button>
                  </div>
                </div>
              </div>
              {!isDesktop && selectedTaskId === task.id && selectedTask && selectedProject ? (
                <SameProjectSchedulePane
                  task={selectedTask}
                  project={selectedProject}
                  billingByTask={billingByTask}
                  onClose={() => setSelectedTaskId(null)}
                  onSelectTask={(id) => setSelectedTaskId((current) => (current === id ? null : id))}
                  onEdit={openEdit}
                  onCopy={openCopy}
                  onDelete={handleDelete}
                />
              ) : null}
            </Fragment>
              );
              return (
                <>
                  {active.map(renderTask)}
                  {completed.length > 0 ? (
                    <CollapsedSection
                      title="完了したプロジェクトのスケジュール"
                      count={completed.length}
                      open={completedOpen}
                      onToggle={() => patchListPrefs({ completedOpen: !completedOpen })}
                    >
                      {completed.map(renderTask)}
                    </CollapsedSection>
                  ) : null}
                  {cancelled.length > 0 ? (
                    <CollapsedSection
                      title="キャンセルしたプロジェクトのスケジュール"
                      count={cancelled.length}
                      open={cancelledOpen}
                      onToggle={() => patchListPrefs({ cancelledOpen: !cancelledOpen })}
                    >
                      {cancelled.map(renderTask)}
                    </CollapsedSection>
                  ) : null}
                </>
              );
            })()
          )
        }
      </SplitDetailLayout>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'スケジュール編集' : '新規スケジュール登録'}
        maxWidth="max-w-2xl"
      >
        <div className="space-y-4">
          <FormField label="プロジェクト" required>
            <select
              value={form.project_id}
              onChange={(e) => {
                const project_id = e.target.value;
                const project = projects.find((p) => p.id === project_id) || null;
                const defaults = defaultsFromClient(form.task_type, project?.client, project);
                setForm({
                  ...form,
                  project_id,
                  is_billable: defaults.is_billable,
                  billing_timing: defaults.billing_timing,
                  show_group_link: defaults.show_group_link,
                });
              }}
              className={`${inputClass} ${inputErrorClass(formErrors, 'project_id')}`}
            >
              <option value="">選択してください</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.project_name}</option>
              ))}
            </select>
            {errorFor(formErrors, 'project_id') && (
              <p className="text-xs text-red-600">{errorFor(formErrors, 'project_id')}</p>
            )}
          </FormField>
          <TaskForm
            form={form}
            setForm={setForm}
            onSave={handleSave}
            saving={saving}
            onCancel={() => setModalOpen(false)}
            isNew={!editing}
            formErrors={formErrors}
            client={formProject?.client}
            project={formProject}
            projectTasks={projectTasksForForm}
            editingTaskId={editing?.id ?? null}
          />
        </div>
      </Modal>
    </div>
  );
}

// ---- Same Project Schedule Pane ----

interface SameProjectSchedulePaneProps {
  task: Task;
  project: Project;
  billingByTask: BillingByTask;
  onClose: () => void;
  onSelectTask: (id: string) => void;
  onEdit: (task: Task) => void;
  onCopy: (task: Task) => void;
  onDelete: (id: string) => void;
}

type SchedulePaneSortKey = 'date' | 'created_at';

function SameProjectSchedulePane({
  task,
  project,
  billingByTask,
  onClose,
  onSelectTask,
  onEdit,
  onCopy,
  onDelete,
}: SameProjectSchedulePaneProps) {
  const [schedules, setSchedules] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [panePrefs, patchPanePrefs] = useSessionPref('schedule_pane', {
    sortBy: 'date' as SchedulePaneSortKey,
    sortDir: 'asc' as SortDir,
  });

  const fetchSchedules = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listTasks();
      setSchedules(data.filter((item) => item.project_id === project.id));
    } catch (error) {
      console.error('Error fetching schedules:', error);
    }
    setLoading(false);
  }, [project.id]);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  const sortedSchedules = [...schedules].sort((a, b) => {
    const result = panePrefs.sortBy === 'created_at' ? compareCreatedAt(a, b) : compareTaskDate(a, b);
    return applySortDir(result, panePrefs.sortDir);
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="btn-icon">
            <X className="h-5 w-5" />
          </button>
          <div>
            <h2 className="font-bold text-slate-900">{project.project_name}</h2>
            <p className="text-xs text-slate-500">同一プロジェクトのスケジュール一覧</p>
          </div>
        </div>
      </div>

      <SortBar
        className="mb-3"
        options={[
          { key: 'date' as const, label: '日付' },
          { key: 'created_at' as const, label: '登録順' },
        ]}
        sortBy={panePrefs.sortBy}
        sortDir={panePrefs.sortDir}
        onChange={patchPanePrefs}
      />

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
        </div>
      ) : schedules.length === 0 ? (
        <div className="card py-8">
          <EmptyState
            icon={<CalendarDays className="h-6 w-6" />}
            title="スケジュールがありません"
          />
        </div>
      ) : (
        <div className="space-y-2.5">
          {sortedSchedules.map((s) => (
            <div
              key={s.id}
              className={`card group cursor-pointer p-3 transition-all hover:shadow-md ${
                s.id === task.id ? 'ring-2 ring-teal-500' : ''
              } ${cancelledCardClass(s.is_cancelled)}`}
              onClick={() => onSelectTask(s.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {s.is_cancelled && <CancelledBanner compact />}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge label={s.task_type} className="bg-teal-50 text-teal-700 border-teal-200" />
                    <Badge label={TIME_TYPE_LABELS[s.time_type]} className="bg-slate-50 text-slate-600 border-slate-200" />
                    <MonthBillingBadges task={s} billedMonths={billingByTask[s.id]} />
                  </div>
                  <div className="mt-1.5 text-sm font-bold text-slate-800">
                    {s.is_cancelled ? <CancelledTitle>{getTaskSubtitle(s)}</CancelledTitle> : getTaskSubtitle(s)}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                    <Building2 className="h-3 w-3 shrink-0 text-slate-400" />
                    <span className="truncate">{clientName(s.project?.client || project.client) || 'クライアント未設定'}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {formatTaskDateRange(s)}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                    <span>{s.is_domestic ? '国内' : '海外'}{s.venue_size && `・${s.venue_size}`}</span>
                    {s.position && <span>ポジション: {s.position}</span>}
                  </div>
                  {s.notes && (
                    <p className="mt-1 text-xs text-slate-400 line-clamp-2">{s.notes}</p>
                  )}
                </div>
                <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => onEdit(s)} className="btn-icon" title="編集">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => onCopy(s)} className="btn-icon" title="コピー">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => onDelete(s.id)} className="btn-icon hover:text-red-500" title="削除">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
