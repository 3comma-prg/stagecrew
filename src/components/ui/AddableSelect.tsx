import { useState } from 'react';
import { ArrowUpDown } from 'lucide-react';
import { inputClass } from '@/components/ui/FormField';
import { Modal } from '@/components/ui/Modal';
import { OptionOrderList } from '@/components/ui/OptionOrderList';

export function AddableSelect({
  value,
  onChange,
  options,
  onAdd,
  onReorder,
  className = '',
  emptyLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  onAdd: (name: string) => void | Promise<void>;
  onReorder?: (ordered: string[]) => void | Promise<void>;
  className?: string;
  emptyLabel?: string;
}) {
  const [reorderOpen, setReorderOpen] = useState(false);
  const [draftOrder, setDraftOrder] = useState<string[]>([]);
  const [savingOrder, setSavingOrder] = useState(false);

  const handleAdd = async () => {
    const name = window.prompt('追加する項目名を入力してください')?.trim();
    if (!name) return;
    await onAdd(name);
    onChange(name);
  };

  const openReorder = () => {
    setDraftOrder(options);
    setReorderOpen(true);
  };

  const saveReorder = async () => {
    if (!onReorder) return;
    setSavingOrder(true);
    try {
      await onReorder(draftOrder);
      if (value && !draftOrder.includes(value) && draftOrder[0]) onChange(draftOrder[0]);
      setReorderOpen(false);
    } finally {
      setSavingOrder(false);
    }
  };

  return (
    <div className="flex flex-wrap items-stretch gap-2">
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} min-w-[10rem] flex-1 basis-[12rem] ${className}`}>
        {emptyLabel != null ? <option value="">{emptyLabel}</option> : null}
        {value && !options.includes(value) ? <option value={value}>{value}</option> : null}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {onReorder ? (
        <button type="button" onClick={openReorder} className="btn-secondary shrink-0 px-3" title="種別の並び替え">
          <ArrowUpDown className="h-4 w-4" />
          並び替え
        </button>
      ) : null}
      <button type="button" onClick={handleAdd} className="btn-secondary shrink-0 px-3">
        追加
      </button>
      {onReorder ? (
        <Modal open={reorderOpen} onClose={() => setReorderOpen(false)} title="種別の並び替え">
          <div className="space-y-4">
            <p className="text-sm text-slate-500">ドラッグして種別の表示順を変更します。スケジュールや単価の選択肢・並び替えに反映されます。</p>
            <OptionOrderList items={draftOrder} onChange={setDraftOrder} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setReorderOpen(false)} className="btn-secondary">
                キャンセル
              </button>
              <button type="button" onClick={saveReorder} disabled={savingOrder} className="btn-primary">
                {savingOrder ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
