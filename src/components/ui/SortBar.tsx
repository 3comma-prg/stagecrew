import { ArrowUpDown } from 'lucide-react';

export type SortDir = 'asc' | 'desc';

export function applySortDir(result: number, dir: SortDir) {
  if (result === 0 || dir === 'asc') return result;
  return -result;
}

function chipClass(active: boolean) {
  return `rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
    active
      ? 'bg-teal-100 text-teal-700 border border-teal-200'
      : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
  }`;
}

export function SortBar<K extends string>({
  options,
  sortBy,
  sortDir,
  onChange,
  className = 'mb-4',
}: {
  options: { key: K; label: string }[];
  sortBy: K;
  sortDir: SortDir;
  onChange: (patch: { sortBy?: K; sortDir?: SortDir }) => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <ArrowUpDown className="h-4 w-4 text-slate-400" />
      <span className="text-sm text-slate-500">並び替え:</span>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange({ sortBy: option.key })}
          className={chipClass(sortBy === option.key)}
        >
          {option.label}
        </button>
      ))}
      <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:inline-block" aria-hidden />
      <button type="button" onClick={() => onChange({ sortDir: 'asc' })} className={chipClass(sortDir === 'asc')}>
        昇順
      </button>
      <button type="button" onClick={() => onChange({ sortDir: 'desc' })} className={chipClass(sortDir === 'desc')}>
        降順
      </button>
    </div>
  );
}
