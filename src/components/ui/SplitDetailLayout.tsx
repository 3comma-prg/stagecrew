import { type ReactNode, useEffect, useState } from 'react';

function useMinWidth(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export function SplitDetailLayout({
  selected,
  pane,
  query = '(min-width: 1024px)',
  gridClassName = 'grid grid-cols-[minmax(0,1fr)_420px] items-start gap-x-6',
  listClassName = 'space-y-3',
  children,
}: {
  selected: boolean;
  pane: ReactNode;
  query?: string;
  gridClassName?: string;
  listClassName?: string;
  children: (opts: { isDesktop: boolean }) => ReactNode;
}) {
  const isDesktop = useMinWidth(query);
  return (
    <div className={selected && isDesktop ? gridClassName : ''}>
      <div className={listClassName}>{children({ isDesktop })}</div>
      {selected && isDesktop ? <div className="sticky top-4 min-w-0">{pane}</div> : null}
    </div>
  );
}
