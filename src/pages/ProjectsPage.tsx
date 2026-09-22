import { Fragment, useEffect, useState, useCallback, useRef } from 'react';
import { deleteProject, listClients, listProjects, listTasks, saveProject, saveTask, subscribeData, syncGoogleCalendarFromRemote, updateTask } from '@/lib/db';
import type { Client, Project, ProjectStatus, Task, TimeType, BillingStatus } from '@/types';
import {
  PROJECT_STATUS_LABELS as PSL,
  PROJECT_STATUS_COLORS as PSC,
  BILLING_STATUS_LABELS,
  BILLING_STATUS_COLORS,
  VENUE_SIZES,
  TIME_TYPE_LABELS,
  makeProjectName,
  formatTaskDateRange,
  clientName,
  compareCreatedAt,
  DEFAULT_TASK_TYPE,
  getTaskSubtitle,
} from '@/types';
import { Modal } from '@/components/ui/Modal';
import { FormErrorList, FormField, fieldErrorClass, inputClass } from '@/components/ui/FormField';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SplitDetailLayout } from '@/components/ui/SplitDetailLayout';
import { AddableSelect } from '@/components/ui/AddableSelect';
import { inputErrorClass, validateScheduleForm, type FieldError } from '@/lib/schedule-form';
import { useCatalogOptions } from '@/lib/catalog-options';
import { CancelledBanner, CancelledTitle, cancelledCardClass } from '@/components/CancelledMark';
import { CollapsedSection } from '@/components/CollapsedSection';
import { useSessionPref } from '@/lib/session-list-prefs';
import {
  Plus,
  Pencil,
  Trash2,
  FolderKanban,
  Search,
  CalendarDays,
  MapPin,
  Globe,
  Ban,
  X,
  ArrowUpDown,
  Copy,
} from 'lucide-react';

type ProjectSortKey = 'created_at' | 'earliest_task' | 'client_name' | 'project_name';

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [listPrefs, patchListPrefs] = useSessionPref('projects', {
    statusFilter: 'all' as ProjectStatus | 'all',
    sortBy: 'created_at' as ProjectSortKey,
    completedOpen: false,
    cancelledOpen: false,
  });
  const { statusFilter, sortBy, completedOpen, cancelledOpen } = listPrefs;
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [saving, setSaving] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectEarliestDates, setProjectEarliestDates] = useState<Record<string, string | null>>({});

  const [form, setForm] = useState({
    artist_name: '',
    event_name: '',
    client_id: '',
    status: 'in_progress' as ProjectStatus,
  });

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      setProjects(await listProjects());
    } catch (error) {
      console.error('Error fetching projects:', error);
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
    fetchProjects();
    fetchClients();
  }, [fetchProjects, fetchClients]);

  useEffect(() => {
    if (projects.length === 0) return;
    (async () => {
      const dates: Record<string, string | null> = {};
      const tasks = await listTasks();
      for (const project of projects) {
        const earliest = tasks
          .filter((task) => task.project_id === project.id && task.start_date)
          .map((task) => task.start_date as string)
          .sort()[0];
        dates[project.id] = earliest || null;
      }
      setProjectEarliestDates(dates);
    })().catch((error) => console.error('Error fetching project dates:', error));
  }, [projects]);

  const openCreate = () => {
    setEditing(null);
    setForm({ artist_name: '', event_name: '', client_id: '', status: 'in_progress' });
    setFormErrors([]);
    setModalOpen(true);
  };

  const openEdit = (project: Project) => {
    setEditing(project);
    setForm({
      artist_name: project.artist_name || '',
      event_name: project.event_name || '',
      client_id: project.client_id || '',
      status: project.status,
    });
    setFormErrors([]);
    setModalOpen(true);
  };

  const openCopy = (project: Project) => {
    setEditing(null);
    setForm({
      artist_name: project.artist_name || '',
      event_name: project.event_name || '',
      client_id: project.client_id || '',
      status: project.status,
    });
    setFormErrors([]);
    setModalOpen(true);
  };

  const handleSave = async () => {
    const errors: string[] = [];
    if (!form.artist_name.trim()) errors.push('アーティスト名を入力してください。');
    if (!form.client_id) errors.push('クライアントを選択してください。');
    setFormErrors(errors);
    if (errors.length) return;
    setSaving(true);
    const projectName = makeProjectName(form.artist_name.trim(), form.event_name.trim());
    const payload = {
      project_name: projectName,
      artist_name: form.artist_name.trim(),
      event_name: form.event_name.trim() || null,
      client_id: form.client_id || null,
      status: form.status,
    };
    try {
      await saveProject(payload, editing?.id);
      setModalOpen(false);
      fetchProjects();
    } catch (error) {
      setFormErrors([error instanceof Error ? error.message : 'プロジェクトを保存できませんでした。']);
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('このプロジェクトを削除しますか？関連するスケジュールも削除されます。')) return;
    try {
      await deleteProject(id);
    } catch (error) {
      console.error('Error deleting project:', error);
    }
    if (selectedProjectId === id) setSelectedProjectId(null);
    fetchProjects();
  };

  const filtered = [...projects].filter((p) => {
    const matchesSearch =
      p.project_name.toLowerCase().includes(search.toLowerCase()) ||
      (p.artist_name || '').toLowerCase().includes(search.toLowerCase()) ||
      (p.event_name || '').toLowerCase().includes(search.toLowerCase()) ||
      clientName(p.client).toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'created_at') return compareCreatedAt(a, b);
    if (sortBy === 'earliest_task') {
      const dateA = projectEarliestDates[a.id] || '9999-12-31';
      const dateB = projectEarliestDates[b.id] || '9999-12-31';
      return dateA.localeCompare(dateB);
    }
    if (sortBy === 'client_name') {
      const nameA = (clientName(a.client) || 'zzz').toLowerCase();
      const nameB = (clientName(b.client) || 'zzz').toLowerCase();
      return nameA.localeCompare(nameB);
    }
    return a.project_name.localeCompare(b.project_name, 'ja');
  });

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null;

  return (
    <div>
      <div className="page-toolbar">
        <div>
          <h1 className="page-title">プロジェクト一覧</h1>
          <p className="mt-1 text-sm text-slate-500">プロジェクトを選択すると右ペインにスケジュールが表示されます</p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="h-4 w-4" />
          新規プロジェクト
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="プロジェクト名、アーティスト名、イベント名、クライアント名で検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputClass} pl-10`}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
          <span className="shrink-0 text-xs font-medium text-slate-400">ステータス</span>
          <div className="flex flex-wrap gap-2">
          {(['all', 'in_progress', 'completed', 'cancelled'] as const).map((s) => (
            <button
              key={s}
              onClick={() => patchListPrefs({ statusFilter: s })}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                statusFilter === s
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {s === 'all' ? 'すべて' : PSL[s]}
            </button>
          ))}
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ArrowUpDown className="h-4 w-4 text-slate-400" />
        <span className="text-sm text-slate-500">並び替え:</span>
        {([
          { key: 'created_at', label: '登録順' },
          { key: 'earliest_task', label: '日付' },
          { key: 'project_name', label: 'プロジェクト名' },
          { key: 'client_name', label: 'クライアント名' },
        ] as { key: ProjectSortKey; label: string }[]).map((s) => (
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

      <SplitDetailLayout
        selected={Boolean(selectedProject)}
        pane={
          selectedProject ? (
            <TaskPane project={selectedProject} onClose={() => setSelectedProjectId(null)} />
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
                icon={<FolderKanban className="h-7 w-7" />}
                title="プロジェクトがありません"
                description="新規プロジェクトボタンから追加してください"
              />
            </div>
          ) : (
            (() => {
              const splitArchived = statusFilter === 'all';
              const active = splitArchived ? sorted.filter((p) => p.status === 'in_progress') : sorted;
              const completed = splitArchived ? sorted.filter((p) => p.status === 'completed') : [];
              const cancelled = splitArchived ? sorted.filter((p) => p.status === 'cancelled') : [];
              const renderProject = (project: Project) => (
                <Fragment key={project.id}>
                  <div
                    className={`list-card group cursor-pointer ${
                      selectedProjectId === project.id ? 'ring-2 ring-teal-500' : ''
                    }`}
                    onClick={() => setSelectedProjectId((current) => (current === project.id ? null : project.id))}
                  >
                  <div className="list-card-main">
                    <div className="list-card-icon">
                      <FolderKanban className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge label={PSL[project.status]} className={PSC[project.status]} />
                      </div>
                      <h3 className="mt-1 min-w-0 truncate font-semibold text-slate-900">{project.project_name}</h3>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-sm text-slate-500">
                        <span>{clientName(project.client) || 'クライアント未設定'}</span>
                        {projectEarliestDates[project.id] && (
                          <span className="flex items-center gap-1 text-xs text-teal-600">
                            <CalendarDays className="h-3 w-3" />
                            {projectEarliestDates[project.id]}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => openEdit(project)} className="btn-icon" title="編集">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => openCopy(project)} className="btn-icon" title="コピー">
                      <Copy className="h-4 w-4" />
                    </button>
                    <button onClick={() => handleDelete(project.id)} className="btn-icon hover:text-red-500" title="削除">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                { !isDesktop && selectedProjectId === project.id && selectedProject ? (
                  <TaskPane project={selectedProject} onClose={() => setSelectedProjectId(null)} />
                ) : null}
                </Fragment>
              );
              return (
                <>
                  {active.map(renderProject)}
                  {completed.length > 0 ? (
                    <CollapsedSection
                      title="完了したプロジェクト"
                      count={completed.length}
                      open={completedOpen}
                      onToggle={() => patchListPrefs({ completedOpen: !completedOpen })}
                    >
                      {completed.map(renderProject)}
                    </CollapsedSection>
                  ) : null}
                  {cancelled.length > 0 ? (
                    <CollapsedSection
                      title="キャンセルしたプロジェクト"
                      count={cancelled.length}
                      open={cancelledOpen}
                      onToggle={() => patchListPrefs({ cancelledOpen: !cancelledOpen })}
                    >
                      {cancelled.map(renderProject)}
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
        title={editing ? 'プロジェクト編集' : '新規プロジェクト登録'}
      >
        <div className="space-y-4">
          <FormErrorList errors={formErrors} />
          <FormField label="アーティスト名" required>
            <input
              type="text"
              value={form.artist_name}
              onChange={(e) => setForm({ ...form, artist_name: e.target.value })}
              className={`${inputClass} ${fieldErrorClass(formErrors.find((item) => item.includes('アーティスト名')))}`}
              placeholder="アーティスト名"
            />
          </FormField>
          <FormField label="イベント名（任意）">
            <input
              type="text"
              value={form.event_name}
              onChange={(e) => setForm({ ...form, event_name: e.target.value })}
              className={inputClass}
              placeholder="イベント名"
            />
          </FormField>
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
            プロジェクト名: <span className="font-semibold text-slate-700">
              {form.artist_name ? makeProjectName(form.artist_name, form.event_name) : '—'}
            </span>
          </div>
          <FormField label="クライアント" required>
            <select
              value={form.client_id}
              onChange={(e) => setForm({ ...form, client_id: e.target.value })}
              className={`${inputClass} ${fieldErrorClass(formErrors.find((item) => item.includes('クライアント')))}`}
            >
              <option value="">未選択</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {clientName(c)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="ステータス">
            <div className="flex gap-2">
              {(['in_progress', 'completed', 'cancelled'] as ProjectStatus[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setForm({ ...form, status: s })}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                    form.status === s
                      ? 'border-teal-500 bg-teal-50 text-teal-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {PSL[s]}
                </button>
              ))}
            </div>
          </FormField>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setModalOpen(false)} className="btn-secondary">
              キャンセル
            </button>
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---- Task Pane (inline in ProjectsPage for split-pane view) ----

interface TaskPaneProps {
  project: Project;
  onClose: () => void;
}

function TaskPane({ project, onClose }: TaskPaneProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [saving, setSaving] = useState(false);
  const [formErrors, setFormErrors] = useState<FieldError[]>([]);

  const [form, setForm] = useState({
    task_type: DEFAULT_TASK_TYPE,
    time_type: 'all_day' as TimeType,
    start_date: '',
    start_time: '12:00',
    end_date: '',
    end_time: '13:00',
    area: '',
    location: '',
    position: '',
    is_domestic: true,
    venue_size: '' as '' | (typeof VENUE_SIZES)[number],
    notes: '',
    billing_status: 'unbilled' as BillingStatus,
    is_cancelled: false,
  });

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listTasks();
      setTasks(
        data
          .filter((task) => task.project_id === project.id)
          .sort(compareCreatedAt)
      );
    } catch (error) {
      console.error('Error fetching tasks:', error);
    }
    setLoading(false);
    try {
      await syncGoogleCalendarFromRemote();
    } catch (error) {
      console.error('Error syncing Google Calendar:', error);
    }
  }, [project.id]);

  useEffect(() => {
    fetchTasks();
    return subscribeData(() => {
      listTasks()
        .then((data) => {
          setTasks(
            data
              .filter((task) => task.project_id === project.id)
              .sort(compareCreatedAt)
          );
        })
        .catch((error) => console.error('Error fetching tasks:', error));
    });
  }, [fetchTasks, project.id]);

  const openCreate = () => {
    const today = new Date().toISOString().slice(0, 10);
    setEditing(null);
    setForm({
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
      is_cancelled: false,
    });
    setFormErrors([]);
    setModalOpen(true);
  };

  const openEdit = (task: Task) => {
    setEditing(task);
    setForm({
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
      is_cancelled: task.is_cancelled,
    });
    setFormErrors([]);
    setModalOpen(true);
  };

  const openCopy = (task: Task) => {
    setEditing(null);
    setForm({
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
      is_cancelled: false,
    });
    setFormErrors([]);
    setModalOpen(true);
  };

  const handleSave = async () => {
    const errors = validateScheduleForm(form);
    setFormErrors(errors);
    if (errors.length) return;
    setSaving(true);
    const payload = {
      project_id: project.id,
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
      billing_status: form.billing_status,
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

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="btn-icon">
            <X className="h-5 w-5" />
          </button>
          <div>
            <h2 className="font-bold text-slate-900">{project.project_name}</h2>
            <p className="text-xs text-slate-500">スケジュール一覧</p>
          </div>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="h-4 w-4" />
          新規
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="card py-8">
          <EmptyState
            icon={<CalendarDays className="h-6 w-6" />}
            title="スケジュールがありません"
          />
        </div>
      ) : (
        <div className="space-y-2.5">
          {tasks.map((task) => (
            <div
              key={task.id}
              className={`card group p-3 transition-all hover:shadow-md ${cancelledCardClass(task.is_cancelled)}`}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  {task.is_cancelled && <CancelledBanner compact />}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      label={task.task_type}
                      className="bg-teal-50 text-teal-700 border-teal-200"
                    />
                    <Badge
                      label={TIME_TYPE_LABELS[task.time_type]}
                      className="bg-slate-50 text-slate-600 border-slate-200"
                    />
                    <Badge
                      label={BILLING_STATUS_LABELS[task.billing_status]}
                      className={BILLING_STATUS_COLORS[task.billing_status]}
                    />
                  </div>
                  <div className="mt-1.5 text-sm font-bold text-slate-800">
                    {task.is_cancelled ? <CancelledTitle>{getTaskSubtitle(task)}</CancelledTitle> : getTaskSubtitle(task)}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {formatTaskDateRange(task)}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <Globe className="h-3 w-3" />{task.is_domestic ? '国内' : '海外'}
                      {task.venue_size && `・${task.venue_size}`}
                    </span>
                    {task.position && <span>ポジション: {task.position}</span>}
                  </div>
                  {task.notes && (
                    <p className="mt-1 text-xs text-slate-400 line-clamp-2">{task.notes}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="row-actions">
                    <button onClick={() => openEdit(task)} className="btn-icon" title="編集">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => openCopy(task)} className="btn-icon" title="コピー">
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => handleDelete(task.id)} className="btn-icon hover:text-red-500" title="削除">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <button
                    onClick={() => handleCancel(task.id, task.is_cancelled)}
                    className="text-xs text-red-400 hover:text-red-600"
                  >
                    <Ban className="mr-0.5 inline h-3 w-3" />
                    {task.is_cancelled ? '解除' : 'キャンセル'}
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
        title={editing ? 'スケジュール編集' : '新規スケジュール登録'}
        maxWidth="max-w-2xl"
      >
        <TaskForm
          form={form}
          setForm={setForm}
          onSave={handleSave}
          saving={saving}
          onCancel={() => setModalOpen(false)}
          isNew={!editing}
          formErrors={formErrors}
        />
      </Modal>
    </div>
  );
}

// ---- Shared Task Form ----

interface TaskFormProps {
  form: {
    task_type: string;
    time_type: TimeType;
    start_date: string;
    start_time: string;
    end_date: string;
    end_time: string;
    area: string;
    location: string;
    position: string;
    is_domestic: boolean;
    venue_size: string;
    notes: string;
    billing_status: BillingStatus;
    is_cancelled: boolean;
  };
  setForm: React.Dispatch<React.SetStateAction<any>>;
  onSave: () => void;
  saving: boolean;
  onCancel: () => void;
  isNew?: boolean;
  formErrors?: FieldError[];
}

export function TaskForm({ form, setForm, onSave, saving, onCancel, isNew = false, formErrors = [] }: TaskFormProps) {
  const { taskTypes, positions, addTaskType, reorderTaskTypes, addPosition } = useCatalogOptions();
  const isAllDay = form.time_type === 'all_day' || form.time_type === 'multi_day';
  const endDateTouched = useRef(false);
  const endTimeTouched = useRef(false);

  const addOneHour = (time: string): string => {
    const [h, m] = time.split(':').map(Number);
    const newH = (h + 1) % 24;
    return `${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const handleAllDayChange = (checked: boolean) => {
    if (checked) {
      setForm((f: any) => ({ ...f, time_type: f.end_date && f.end_date !== f.start_date ? 'multi_day' : 'all_day' }));
    } else {
      setForm((f: any) => ({
        ...f,
        time_type: 'time_limited',
        end_time: f.end_time && f.end_time !== '00:00' ? f.end_time : addOneHour(f.start_time || '12:00'),
      }));
    }
  };

  const handleEndDateChange = (value: string) => {
    setForm((f: any) => {
      const hasEnd = value && value !== f.start_date;
      let timeType = f.time_type;
      if (hasEnd) {
        if (f.time_type === 'all_day') timeType = 'multi_day';
      } else if (f.time_type === 'multi_day') {
        timeType = 'all_day';
      }
      return { ...f, end_date: value, time_type: timeType as TimeType };
    });
  };

  return (
    <div className="space-y-4">
      {formErrors.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <p className="font-medium">入力内容を確認してください。</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {formErrors.map((item) => (
              <li key={`${item.field}-${item.message}`}>{item.message}</li>
            ))}
          </ul>
        </div>
      )}
      <FormField label="種別">
        <AddableSelect
          value={form.task_type}
          onChange={(task_type) => setForm((f: any) => ({ ...f, task_type }))}
          options={taskTypes}
          onAdd={addTaskType}
          onReorder={reorderTaskTypes}
        />
      </FormField>

      <div className={`space-y-3 rounded-lg border p-4 ${formErrors.some((item) => ['start_date', 'start_time', 'end_date', 'end_time'].includes(item.field)) ? 'border-red-300' : 'border-slate-200'}`}>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="all_day_toggle"
            checked={isAllDay}
            onChange={(e) => handleAllDayChange(e.target.checked)}
            className="h-5 w-5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          <label htmlFor="all_day_toggle" className="text-sm font-medium text-slate-700">
            終日
          </label>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <span className="w-10 shrink-0 text-xs font-medium text-slate-500">開始<span className="ml-0.5 text-red-500">*</span></span>
          <input
            type="date"
            value={form.start_date}
            onChange={(e) => {
              const newDate = e.target.value;
              setForm((f: any) => {
                let end_date = f.end_date;
                if (isNew && !endDateTouched.current) {
                  end_date = newDate;
                }
                return { ...f, start_date: newDate, end_date };
              });
            }}
            className={`${inputClass} min-w-0 flex-1 ${inputErrorClass(formErrors, 'start_date')}`}
          />
          {!isAllDay && (
            <input
              type="time"
              value={form.start_time}
              onChange={(e) => {
                const newTime = e.target.value;
                setForm((f: any) => {
                  let end_time = f.end_time;
                  if (isNew && !endTimeTouched.current) {
                    end_time = addOneHour(newTime);
                  }
                  return { ...f, start_time: newTime, end_time };
                });
              }}
              className={`${inputClass} w-full sm:w-32 ${inputErrorClass(formErrors, 'start_time')}`}
            />
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <span className="w-10 shrink-0 text-xs font-medium text-slate-500">終了</span>
          <input
            type="date"
            value={form.end_date}
            onChange={(e) => {
              endDateTouched.current = true;
              handleEndDateChange(e.target.value);
            }}
            className={`${inputClass} min-w-0 flex-1 ${inputErrorClass(formErrors, 'end_date')}`}
          />
          {!isAllDay && (
            <input
              type="time"
              value={form.end_time}
              onChange={(e) => {
                endTimeTouched.current = true;
                setForm((f: any) => ({ ...f, end_time: e.target.value }));
              }}
              className={`${inputClass} w-full sm:w-32 ${inputErrorClass(formErrors, 'end_time')}`}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField label="エリア">
          <input
            type="text"
            value={form.area}
            onChange={(e) => setForm((f: any) => ({ ...f, area: e.target.value }))}
            className={inputClass}
            placeholder="東京"
          />
        </FormField>
        <FormField label="会場">
          <input
            type="text"
            value={form.location}
            onChange={(e) => setForm((f: any) => ({ ...f, location: e.target.value }))}
            className={inputClass}
            placeholder="東京ドーム"
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField label="ポジション">
          <AddableSelect
            value={form.position}
            onChange={(position) => setForm((f: any) => ({ ...f, position }))}
            options={positions}
            onAdd={addPosition}
            emptyLabel="未選択"
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
        <FormField label="国内 / 海外">
          <div className="flex gap-2">
            <button
              onClick={() => setForm((f: any) => ({ ...f, is_domestic: true }))}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                form.is_domestic
                  ? 'border-teal-500 bg-teal-50 text-teal-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              国内
            </button>
            <button
              onClick={() => setForm((f: any) => ({ ...f, is_domestic: false }))}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                !form.is_domestic
                  ? 'border-teal-500 bg-teal-50 text-teal-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              海外
            </button>
          </div>
        </FormField>
        <FormField label="規模">
          <select
            value={form.venue_size}
            onChange={(e) => setForm((f: any) => ({ ...f, venue_size: e.target.value }))}
            className={inputClass}
          >
            <option value="">未選択</option>
            {VENUE_SIZES.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </FormField>
        <FormField label="請求状態">
          <select
            value={form.billing_status}
            onChange={(e) => setForm((f: any) => ({ ...f, billing_status: e.target.value as BillingStatus }))}
            className={inputClass}
          >
            <option value="unbilled">未請求</option>
            <option value="draft">下書き</option>
            <option value="billed">請求済</option>
            <option value="paid">入金済</option>
          </select>
        </FormField>
      </div>

      <FormField label="備考">
        <textarea
          value={form.notes}
          onChange={(e) => setForm((f: any) => ({ ...f, notes: e.target.value }))}
          className={`${inputClass} min-h-[80px] resize-y`}
          placeholder="メモや注意事項..."
        />
      </FormField>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="is_cancelled"
          checked={form.is_cancelled}
          onChange={(e) => setForm((f: any) => ({ ...f, is_cancelled: e.target.checked }))}
          className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        />
        <label htmlFor="is_cancelled" className="text-sm text-slate-600">
          このスケジュールをキャンセル状態にする
        </label>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button onClick={onCancel} className="btn-secondary">
          キャンセル
        </button>
        <button onClick={onSave} disabled={saving} className="btn-primary">
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  );
}
