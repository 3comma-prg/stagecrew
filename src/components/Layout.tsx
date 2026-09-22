import { type ReactNode, useEffect, useState } from 'react';
import {
  FolderKanban,
  CalendarDays,
  Users,
  JapaneseYen,
  FileText,
  Lightbulb,
  Settings,
  CircleHelp,
  BookOpen,
  Menu,
  X,
} from 'lucide-react';
import { CalendarRefreshButton } from '@/components/CalendarRefreshButton';
import { loadSettings, subscribeSettings } from '@/lib/local-store';
import { displayAppFooter, displayAppName, displayAppTagline } from '@/types';

export type PageKey =
  | 'dashboard'
  | 'projects'
  | 'tasks'
  | 'clients'
  | 'unit_prices'
  | 'invoices'
  | 'settings'
  | 'calendar_help'
  | 'invoice_help';

interface NavItem {
  key: PageKey;
  label: string;
  icon: ReactNode;
  shortLabel?: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'ダッシュボード', shortLabel: 'ホーム', icon: <Lightbulb className="h-5 w-5" /> },
  { key: 'projects', label: 'プロジェクト', icon: <FolderKanban className="h-5 w-5" /> },
  { key: 'tasks', label: 'スケジュール', icon: <CalendarDays className="h-5 w-5" /> },
  { key: 'clients', label: 'クライアント', icon: <Users className="h-5 w-5" /> },
  { key: 'unit_prices', label: '単価管理', icon: <JapaneseYen className="h-5 w-5" /> },
  { key: 'invoices', label: '請求書', icon: <FileText className="h-5 w-5" /> },
  { key: 'calendar_help', label: 'カレンダー連携', icon: <CircleHelp className="h-5 w-5" /> },
  { key: 'invoice_help', label: '請求書連携', icon: <BookOpen className="h-5 w-5" /> },
  { key: 'settings', label: '設定', icon: <Settings className="h-5 w-5" /> },
];

const BOTTOM_NAV_KEYS: PageKey[] = ['dashboard', 'projects', 'tasks', 'clients', 'invoices'];

interface LayoutProps {
  currentPage: PageKey;
  onNavigate: (page: PageKey) => void;
  children: ReactNode;
}

export function Layout({ currentPage, onNavigate, children }: LayoutProps) {
  const [settings, setSettings] = useState(loadSettings);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)').matches : true
  );

  useEffect(() => subscribeSettings(() => setSettings(loadSettings())), []);

  useEffect(() => {
    const title = [displayAppName(settings), displayAppTagline(settings)].filter(Boolean).join(' - ');
    document.title = title;
  }, [settings]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = () => {
      setIsDesktop(mq.matches);
      if (mq.matches) setMenuOpen(false);
    };
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  const footerLines = displayAppFooter(settings).split('\n').filter((line) => line.length > 0);
  const currentLabel = NAV_ITEMS.find((item) => item.key === currentPage)?.label ?? displayAppName(settings);

  const handleNavigate = (page: PageKey) => {
    onNavigate(page);
    setMenuOpen(false);
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      {menuOpen && !isDesktop ? (
        <button
          type="button"
          aria-label="メニューを閉じる"
          className="fixed inset-0 z-40 bg-slate-900/50 md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-slate-900 text-slate-300 transition-transform duration-200 md:z-30 md:w-64 md:translate-x-0 ${
          menuOpen || isDesktop ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-hidden={!isDesktop && !menuOpen}
        {...({ inert: !isDesktop && !menuOpen ? true : undefined } as object)}
      >
        <div className="flex items-center gap-3 px-6 py-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400 to-cyan-600 text-white shadow-lg shadow-teal-500/20">
            <Lightbulb className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-white">{displayAppName(settings)}</p>
            {displayAppTagline(settings) ? (
              <p className="truncate text-xs text-slate-400">{displayAppTagline(settings)}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white md:hidden"
            onClick={() => setMenuOpen(false)}
            aria-label="メニューを閉じる"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              onClick={() => handleNavigate(item.key)}
              className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                currentPage === item.key
                  ? 'bg-teal-500/15 text-teal-300 shadow-sm'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="space-y-2 px-3 py-4">
          <CalendarRefreshButton variant="sidebar" />
          {footerLines.length > 0 ? (
            <p className="whitespace-pre-line px-3 text-xs text-slate-500">
              {footerLines.map((line, index) => (
                <span key={`${line}-${index}`}>
                  {index > 0 ? <br /> : null}
                  {line}
                </span>
              ))}
            </p>
          ) : null}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col md:ml-64">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:hidden">
          <button
            type="button"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
            onClick={() => setMenuOpen(true)}
            aria-label="メニューを開く"
          >
            <Menu className="h-6 w-6" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-slate-900">{displayAppName(settings)}</p>
            <p className="truncate text-xs text-slate-500">{currentLabel}</p>
          </div>
        </header>

        <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 pb-24 md:px-8 md:py-8 md:pb-8">
          {children}
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="grid grid-cols-5">
          {BOTTOM_NAV_KEYS.map((key) => {
            const item = NAV_ITEMS.find((nav) => nav.key === key);
            if (!item) return null;
            const active = currentPage === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleNavigate(key)}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium ${
                  active ? 'text-teal-600' : 'text-slate-500'
                }`}
              >
                {item.icon}
                <span className="truncate">{item.shortLabel || item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
