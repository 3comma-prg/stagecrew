import { useEffect, useMemo, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { hydrateSettings, loadSettings, subscribeSettings } from '@/lib/local-store';
import { resolveCalendarId } from '@/lib/calendar-sync';
import { CalendarRefreshButton } from '@/components/CalendarRefreshButton';

export function GoogleCalendarWidget() {
  const [calendarId, setCalendarId] = useState(() => resolveCalendarId(loadSettings()));

  useEffect(() => {
    hydrateSettings()
      .then((settings) => setCalendarId(resolveCalendarId(settings)))
      .catch(() => setCalendarId(resolveCalendarId(loadSettings())));
    return subscribeSettings(() => setCalendarId(resolveCalendarId(loadSettings())));
  }, []);

  const embedSrc = useMemo(() => {
    if (!calendarId) return '';
    const params = new URLSearchParams({
      src: calendarId,
      ctz: 'Asia/Tokyo',
      hl: 'ja',
      mode: 'MONTH',
      wkst: '1',
      showTitle: '0',
      showNav: '1',
      showDate: '1',
      showPrint: '0',
      showTabs: '1',
      showCalendars: '0',
      showTz: '0',
    });
    return `https://calendar.google.com/calendar/embed?${params.toString()}`;
  }, [calendarId]);

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 md:px-6">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900">
          <CalendarDays className="h-5 w-5 text-teal-600" />
          Googleカレンダー
        </h2>
        <CalendarRefreshButton />
      </div>
      {embedSrc ? (
        <iframe
          title="Googleカレンダー"
          src={embedSrc}
          className="h-[380px] w-full border-0 bg-white sm:h-[460px] lg:h-[540px]"
        />
      ) : (
        <p className="px-6 py-16 text-center text-sm text-slate-400">
          設定でGoogleカレンダーIDを登録すると、ここにカレンダーが表示されます
        </p>
      )}
    </div>
  );
}
