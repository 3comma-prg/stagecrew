import { useEffect, useState } from 'react';
import { listClients, listInvoices, listProjects, listTasks, subscribeData } from '@/lib/db';
import type { Project, Task, Invoice, Client } from '@/types';
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_COLORS,
  BILLING_STATUS_LABELS,
  BILLING_STATUS_COLORS,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_COLORS,
  clientName,
} from '@/types';
import { Badge } from '@/components/ui/Badge';
import { GoogleCalendarWidget } from '@/components/GoogleCalendarWidget';
import {
  FolderKanban,
  CalendarDays,
  Users,
  FileText,
  TrendingUp,
  Clock,
  AlertCircle,
} from 'lucide-react';
import type { PageKey } from '@/components/Layout';

interface DashboardProps {
  onNavigate: (page: PageKey) => void;
}

export function DashboardPage({ onNavigate }: DashboardProps) {
  const [stats, setStats] = useState({
    projectCount: 0,
    activeProjects: 0,
    taskCount: 0,
    upcomingTasks: 0,
    clientCount: 0,
    invoiceCount: 0,
    unpaidAmount: 0,
    lifetimeIncome: 0,
    lastYearIncome: 0,
    thisYearIncome: 0,
  });
  const [recentTasks, setRecentTasks] = useState<(Task & { project?: Project | null })[]>([]);
  const [recentProjects, setRecentProjects] = useState<(Project & { client?: Client | null })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const today = new Date().toISOString().slice(0, 10);
      const now = new Date();
      const thisYear = String(now.getFullYear());
      const lastYear = String(now.getFullYear() - 1);

      const [projectList, taskList, clientList, invoiceList] = await Promise.all([
        listProjects(),
        listTasks(),
        listClients(),
        listInvoices(),
      ]);
      const recentTasksData = [...taskList]
        .filter((task) => (task.date || task.start_date || '') >= today && !task.is_cancelled)
        .sort((a, b) => (a.date || a.start_date || '').localeCompare(b.date || b.start_date || ''))
        .slice(0, 5);
      const recentProjectsData = [...projectList]
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
        .slice(0, 5);

      const paidInvoices = invoiceList.filter((invoice) => invoice.status === 'paid');
      const sumAmounts = (invoices: Invoice[]) =>
        invoices.reduce((sum, invoice) => sum + invoice.total_amount, 0);

      setStats({
        projectCount: projectList.length,
        activeProjects: projectList.filter((p) => p.status === 'in_progress').length,
        taskCount: taskList.length,
        upcomingTasks: taskList.filter((t) => (t.date || t.start_date || '') >= today && !t.is_cancelled).length,
        clientCount: clientList.length,
        invoiceCount: invoiceList.length,
        unpaidAmount: sumAmounts(invoiceList.filter((invoice) => invoice.status !== 'paid')),
        lifetimeIncome: sumAmounts(paidInvoices),
        lastYearIncome: sumAmounts(
          paidInvoices.filter((invoice) => (invoice.billing_month || '').startsWith(lastYear)),
        ),
        thisYearIncome: sumAmounts(
          paidInvoices.filter((invoice) => (invoice.billing_month || '').startsWith(thisYear)),
        ),
      });

      setRecentTasks(recentTasksData);
      setRecentProjects(recentProjectsData);
      setLoading(false);
    };

    load().catch((error) => {
      console.error('Error loading dashboard:', error);
      setLoading(false);
    });
    return subscribeData(() => {
      load().catch((error) => console.error('Error loading dashboard:', error));
    });
  }, []);

  const formatYen = (n: number) => `¥${n.toLocaleString()}`;

  const statCards = [
    {
      label: '進行中プロジェクト',
      value: stats.activeProjects,
      total: stats.projectCount,
      icon: <FolderKanban className="h-5 w-5" />,
      color: 'text-blue-600 bg-blue-50',
      page: 'projects' as PageKey,
    },
    {
      label: '直近のスケジュール',
      value: stats.upcomingTasks,
      total: stats.taskCount,
      icon: <Clock className="h-5 w-5" />,
      color: 'text-amber-600 bg-amber-50',
      page: 'tasks' as PageKey,
    },
    {
      label: 'クライアント数',
      value: stats.clientCount,
      icon: <Users className="h-5 w-5" />,
      color: 'text-teal-600 bg-teal-50',
      page: 'clients' as PageKey,
    },
    {
      label: '請求書発行数',
      value: stats.invoiceCount,
      icon: <FileText className="h-5 w-5" />,
      color: 'text-slate-600 bg-slate-100',
      page: 'invoices' as PageKey,
    },
  ];

  const incomeCards = [
    {
      label: '過去の総収入',
      value: formatYen(stats.lifetimeIncome),
      icon: <TrendingUp className="h-5 w-5" />,
      color: 'text-emerald-600 bg-emerald-50',
    },
    {
      label: '昨年の総収入',
      value: formatYen(stats.lastYearIncome),
      icon: <TrendingUp className="h-5 w-5" />,
      color: 'text-teal-600 bg-teal-50',
    },
    {
      label: '今年の総収入',
      value: formatYen(stats.thisYearIncome),
      icon: <TrendingUp className="h-5 w-5" />,
      color: 'text-blue-600 bg-blue-50',
    },
    {
      label: '未入金',
      value: formatYen(stats.unpaidAmount),
      icon: <AlertCircle className="h-5 w-5" />,
      color: 'text-red-600 bg-red-50',
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="page-title">ダッシュボード</h1>
        <p className="mt-1 text-sm text-slate-500">業務全体の状況を確認できます</p>
      </div>

      {/* Stat cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card, i) => (
          <button
            key={i}
            onClick={() => onNavigate(card.page)}
            className="card group p-5 text-left transition-all hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${card.color}`}>
                {card.icon}
              </div>
              {card.total !== undefined && (
                <span className="text-xs text-slate-400">/ {card.total}</span>
              )}
            </div>
            <p className="mt-4 text-2xl font-bold text-slate-900">{card.value}</p>
            <p className="mt-1 text-sm text-slate-500">{card.label}</p>
          </button>
        ))}
      </div>

      <div className="mb-8">
        <GoogleCalendarWidget />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Upcoming tasks */}
        <div className="card p-4 md:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold text-slate-900">
              <CalendarDays className="h-5 w-5 text-teal-600" />
              今後のスケジュール
            </h2>
            <button
              onClick={() => onNavigate('tasks')}
              className="text-sm font-medium text-teal-600 hover:text-teal-700"
            >
              すべて見る →
            </button>
          </div>
          {recentTasks.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">今後のスケジュールはありません</p>
          ) : (
            <div className="space-y-3">
              {recentTasks.map((task) => {
                const taskDay = task.start_date || task.date;
                const taskDate = taskDay ? new Date(taskDay) : null;
                return (
                <div key={task.id} className="flex items-center gap-3 rounded-lg border border-slate-100 p-3">
                  <div className="flex w-12 shrink-0 flex-col items-center rounded-lg bg-slate-50 py-1.5">
                    <span className="text-lg font-bold text-slate-900">
                      {taskDate ? taskDate.getDate() : '—'}
                    </span>
                    <span className="text-xs text-slate-500">{taskDate ? `${taskDate.getMonth() + 1}月` : ''}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        label={task.task_type}
                        className="bg-teal-50 text-teal-700 border-teal-200"
                      />
                      {task.is_cancelled && (
                        <Badge label="キャンセル" className="bg-red-50 text-red-600 border-red-200" />
                      )}
                      <Badge
                        label={
                          task.is_billable === false || task.billing_status === 'not_billable'
                            ? BILLING_STATUS_LABELS.not_billable
                            : BILLING_STATUS_LABELS[task.billing_status]
                        }
                        className={
                          task.is_billable === false || task.billing_status === 'not_billable'
                            ? BILLING_STATUS_COLORS.not_billable
                            : BILLING_STATUS_COLORS[task.billing_status]
                        }
                      />
                    </div>
                    <p className="mt-1 text-sm font-medium text-slate-800 truncate">
                      {task.project?.project_name || '—'}
                    </p>
                    {task.location ? (
                      <p className="mt-0.5 text-xs text-slate-500 truncate">@ {task.location}</p>
                    ) : null}
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent projects */}
        <div className="card p-4 md:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold text-slate-900">
              <FolderKanban className="h-5 w-5 text-teal-600" />
              最近のプロジェクト
            </h2>
            <button
              onClick={() => onNavigate('projects')}
              className="text-sm font-medium text-teal-600 hover:text-teal-700"
            >
              すべて見る →
            </button>
          </div>
          {recentProjects.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">プロジェクトがありません</p>
          ) : (
            <div className="space-y-3">
              {recentProjects.map((project) => (
                <div key={project.id} className="flex items-center gap-3 rounded-lg border border-slate-100 p-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
                    <FolderKanban className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <Badge
                      label={PROJECT_STATUS_LABELS[project.status]}
                      className={PROJECT_STATUS_COLORS[project.status]}
                    />
                    <p className="mt-1 text-sm font-medium text-slate-900 truncate">{project.project_name}</p>
                    <p className="text-xs text-slate-500">
                      {clientName(project.client) || 'クライアント未設定'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {incomeCards.map((card) => (
          <button
            key={card.label}
            onClick={() => onNavigate('invoices')}
            className="card group p-5 text-left transition-all hover:shadow-md"
          >
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${card.color}`}>
              {card.icon}
            </div>
            <p className="mt-4 text-2xl font-bold text-slate-900">{card.value}</p>
            <p className="mt-1 text-sm text-slate-500">{card.label}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
