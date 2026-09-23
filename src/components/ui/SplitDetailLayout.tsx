import { type ReactNode, useEffect, useRef, useState } from 'react';

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

/** Viewport-capped independent scroll for list / detail when split is open. */
const SPLIT_SCROLL =
  'min-h-0 max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain';

function wheelPixels(event: WheelEvent) {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * window.innerHeight;
  return event.deltaY;
}

function canScrollInDirection(el: HTMLElement, deltaY: number) {
  const max = el.scrollHeight - el.clientHeight;
  if (max <= 1) return false;
  if (deltaY < 0) return el.scrollTop > 0;
  return el.scrollTop + el.clientHeight < el.scrollHeight - 1;
}

/** When a pane cannot scroll further, continue the gesture on the page. */
function chainWheelToPage(el: HTMLElement) {
  const onWheel = (event: WheelEvent) => {
    const deltaY = wheelPixels(event);
    if (deltaY === 0 || event.ctrlKey) return;

    let node = event.target instanceof Node ? event.target : null;
    while (node && node !== el) {
      if (node instanceof HTMLElement && canScrollInDirection(node, deltaY)) return;
      node = node.parentNode;
    }
    if (canScrollInDirection(el, deltaY)) return;

    const page = document.scrollingElement;
    if (!page) return;
    const next = Math.max(0, Math.min(page.scrollHeight - page.clientHeight, page.scrollTop + deltaY));
    if (next === page.scrollTop) return;
    page.scrollTop = next;
  };

  el.addEventListener('wheel', onWheel, { passive: true });
  return () => el.removeEventListener('wheel', onWheel);
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
  const split = selected && isDesktop;
  const listRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!split) return;
    const cleanups = [listRef.current, paneRef.current]
      .filter((el): el is HTMLDivElement => Boolean(el))
      .map(chainWheelToPage);
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [split]);

  return (
    <div className={split ? gridClassName : ''}>
      <div ref={listRef} className={split ? `sticky top-4 ${SPLIT_SCROLL}` : undefined}>
        <div className={split ? `${listClassName} p-1` : listClassName}>{children({ isDesktop })}</div>
      </div>
      {split ? (
        <div ref={paneRef} className={`sticky top-4 min-w-0 ${SPLIT_SCROLL}`}>
          <div className="p-1">{pane}</div>
        </div>
      ) : null}
    </div>
  );
}
