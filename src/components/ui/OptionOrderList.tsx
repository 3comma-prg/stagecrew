import { useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';
import { moveIndex } from '@/lib/reorder';

export function OptionOrderList({
  items,
  onChange,
}: {
  items: string[];
  onChange: (next: string[]) => void;
}) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const fromRef = useRef<number | null>(null);
  const overRef = useRef<number | null>(null);

  const finish = () => {
    const from = fromRef.current;
    const to = overRef.current;
    fromRef.current = null;
    overRef.current = null;
    setDraggingIndex(null);
    setDragOverIndex(null);
    if (from == null || to == null || from === to) return;
    onChange(moveIndex(items, from, to));
  };

  return (
    <div className="space-y-1.5">
      {items.map((item, index) => (
        <div
          key={item}
          className={`flex items-center gap-2 rounded-lg border bg-white px-2 py-1.5 ${
            draggingIndex === index
              ? 'border-teal-300 opacity-60'
              : dragOverIndex === index
                ? 'border-teal-400'
                : 'border-slate-200'
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (overRef.current !== index) {
              overRef.current = index;
              setDragOverIndex(index);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            overRef.current = index;
            finish();
          }}
        >
          <button
            type="button"
            className="btn-icon cursor-grab text-slate-400 hover:text-slate-600 active:cursor-grabbing"
            aria-label="並び替え"
            title="ドラッグして並べ替え"
            draggable
            onDragStart={(e) => {
              fromRef.current = index;
              overRef.current = index;
              setDraggingIndex(index);
              setDragOverIndex(index);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(index));
            }}
            onDragEnd={finish}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{item}</span>
        </div>
      ))}
    </div>
  );
}
