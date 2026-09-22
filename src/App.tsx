import { useEffect, useState } from 'react';
import { preloadSheets, syncGoogleCalendarFromRemote } from '@/lib/db';
import { hydrateSettings } from '@/lib/local-store';
import { Layout, type PageKey } from '@/components/Layout';
import { CalendarSyncBanner } from '@/components/CalendarSyncBanner';
import { DashboardPage } from '@/pages/DashboardPage';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { TasksPage } from '@/pages/TasksPage';
import { ClientsPage } from '@/pages/ClientsPage';
import { UnitPricesPage } from '@/pages/UnitPricesPage';
import { InvoicesPage } from '@/pages/InvoicesPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { CalendarHelpPage } from '@/pages/CalendarHelpPage';
import { InvoiceHelpPage } from '@/pages/InvoiceHelpPage';

function App() {
  const [page, setPage] = useState<PageKey>('dashboard');
  const [dataError, setDataError] = useState<string | null>(null);

  useEffect(() => {
    hydrateSettings()
      .then(() => preloadSheets())
      .then(() => syncGoogleCalendarFromRemote())
      .catch((error: unknown) => {
        setDataError(error instanceof Error ? error.message : 'Googleスプレッドシートの読み込みに失敗しました。');
      });
  }, []);

  const handleNavigate = (p: PageKey) => {
    setPage(p);
  };

  return (
    <Layout currentPage={page} onNavigate={handleNavigate}>
      {dataError && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {dataError}
        </div>
      )}
      <CalendarSyncBanner onNavigate={handleNavigate} />
      {page === 'dashboard' && <DashboardPage onNavigate={handleNavigate} />}
      {page === 'projects' && <ProjectsPage />}
      {page === 'tasks' && <TasksPage />}
      {page === 'clients' && <ClientsPage />}
      {page === 'unit_prices' && <UnitPricesPage />}
      {page === 'invoices' && <InvoicesPage />}
      {page === 'calendar_help' && <CalendarHelpPage onNavigate={handleNavigate} />}
      {page === 'invoice_help' && <InvoiceHelpPage onNavigate={handleNavigate} />}
      {page === 'settings' && <SettingsPage onNavigate={handleNavigate} />}
    </Layout>
  );
}

export default App;
