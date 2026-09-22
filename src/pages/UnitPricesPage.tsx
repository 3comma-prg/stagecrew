import { useEffect, useState, useCallback, useRef } from 'react';
import { deleteUnitPrice, listClients, listUnitPrices, reorderUnitPrices, saveUnitPrice, applyCatalogPricesToDraftInvoices } from '@/lib/db';
import type { Client, UnitPrice, VenueSize, TaxType } from '@/types';
import { DEFAULT_TASK_TYPE, VENUE_SIZES, clientName, compareCatalogOrder, compareCreatedAt, compareUnitPriceOrder, canonicalTaskType, normalizeTaxType, taxSettingLabel } from '@/types';
import { Modal } from '@/components/ui/Modal';
import { FormErrorList, FormField, fieldErrorClass, inputClass } from '@/components/ui/FormField';
import { AddableSelect } from '@/components/ui/AddableSelect';
import { EmptyState } from '@/components/ui/EmptyState';
import { TaxRateField } from '@/components/ui/TaxRateField';
import { useCatalogOptions } from '@/lib/catalog-options';
import { moveIndex } from '@/lib/reorder';
import { useSessionPref } from '@/lib/session-list-prefs';
import { Plus, Pencil, Trash2, JapaneseYen, Search, Globe, ArrowUpDown, GripVertical, RefreshCw, Copy } from 'lucide-react';

type UnitPriceSortKey = 'sort_order' | 'created_at' | 'client' | 'price' | 'task_type' | 'position' | 'venue_size';

export function UnitPricesPage() {
  const [unitPrices, setUnitPrices] = useState<UnitPrice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [listPrefs, patchListPrefs] = useSessionPref('unit_prices', {
    clientFilter: 'all',
    domesticFilter: 'all' as 'all' | 'domestic' | 'overseas',
    positionFilter: 'all',
    taskTypeFilter: 'all',
    sortBy: 'sort_order' as UnitPriceSortKey,
  });
  const { clientFilter, domesticFilter, positionFilter, taskTypeFilter, sortBy } = listPrefs;
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UnitPrice | null>(null);
  const [saving, setSaving] = useState(false);
  const [applyingDrafts, setApplyingDrafts] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragFromRef = useRef<number | null>(null);
  const dragOverRef = useRef<number | null>(null);
  const pricesRef = useRef<UnitPrice[]>([]);
  const savedOrderRef = useRef('');
  const persistLockRef = useRef(false);
  const { taskTypes, positions, addTaskType, reorderTaskTypes, addPosition } = useCatalogOptions();
  pricesRef.current = unitPrices;

  const [form, setForm] = useState({
    client_id: '',
    is_domestic: true,
    position: '',
    venue_size: '' as string,
    task_type: DEFAULT_TASK_TYPE,
    price: '' as string,
    tax_rate: 10,
    tax_type: 'exclusive' as TaxType,
  });

  const fetchUnitPrices = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    try {
      const data = await listUnitPrices();
      setUnitPrices(data);
      savedOrderRef.current = data.map((item) => item.id).join(',');
    } catch (error) {
      console.error('Error fetching unit prices:', error);
    }
    if (!options?.silent) setLoading(false);
  }, []);

  const fetchClients = useCallback(async () => {
    try {
      setClients(await listClients());
    } catch (error) {
      console.error('Error fetching clients:', error);
    }
  }, []);

  useEffect(() => {
    fetchUnitPrices();
    fetchClients();
  }, [fetchUnitPrices, fetchClients]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      client_id: '',
      is_domestic: true,
      position: '',
      venue_size: '',
      task_type: DEFAULT_TASK_TYPE,
      price: '',
      tax_rate: 10,
      tax_type: 'exclusive' as TaxType,
    });
    setFormErrors([]);
    setModalOpen(true);
  };

  const openEdit = (up: UnitPrice) => {
    setEditing(up);
    setForm({
      client_id: up.client_id,
      is_domestic: up.is_domestic,
      position: up.position,
      venue_size: up.venue_size || '',
      task_type: up.task_type,
      price: String(up.price),
      tax_rate: up.tax_rate,
      tax_type: normalizeTaxType(up.tax_type),
    });
    setFormErrors([]);
    setModalOpen(true);
  };

  const openCopy = (up: UnitPrice) => {
    setEditing(null);
    setForm({
      client_id: up.client_id,
      is_domestic: up.is_domestic,
      position: up.position,
      venue_size: up.venue_size || '',
      task_type: up.task_type,
      price: String(up.price),
      tax_rate: up.tax_rate,
      tax_type: normalizeTaxType(up.tax_type),
    });
    setFormErrors([]);
    setModalOpen(true);
  };

  const handleClientChange = (clientId: string) => {
    const client = clients.find((c) => c.id === clientId);
    setForm((f) => ({
      ...f,
      client_id: clientId,
      tax_rate: f.is_domestic ? (client?.tax_rate ?? 10) : 0,
      tax_type: f.is_domestic ? normalizeTaxType(client?.tax_type) : 'exclusive',
    }));
  };

  const handleDomesticChange = (isDomestic: boolean) => {
    const client = clients.find((c) => c.id === form.client_id);
    setForm((f) => ({
      ...f,
      is_domestic: isDomestic,
      tax_rate: isDomestic ? (client?.tax_rate ?? 10) : 0,
      tax_type: isDomestic ? normalizeTaxType(client?.tax_type) : 'exclusive',
    }));
  };

  const handleSave = async () => {
    const errors: string[] = [];
    if (!form.client_id) errors.push('クライアントを選択してください。');
    if (!form.position.trim()) errors.push('ポジションを選択してください。');
    if (!form.task_type.trim()) errors.push('種別を選択してください。');
    if (!form.price) errors.push('単価を入力してください。');
    setFormErrors(errors);
    if (errors.length) return;
    setSaving(true);
    const payload = {
      client_id: form.client_id,
      is_domestic: form.is_domestic,
      position: form.position,
      venue_size: form.venue_size || null,
      task_type: form.task_type,
      price: parseInt(form.price) || 0,
      tax_rate: form.tax_rate,
      tax_type: form.tax_type,
    };
    try {
      await saveUnitPrice(payload, editing?.id);
      setModalOpen(false);
      fetchUnitPrices();
      if (
        window.confirm(
          '下書きの請求書に登録単価を反映しますか？\nスケジュールから取り込んだ項目だけ更新し、手動入力した単価はそのままです。'
        )
      ) {
        await applyDraftInvoicePrices();
      }
    } catch (error) {
      setFormErrors([error instanceof Error ? error.message : '単価を保存できませんでした。']);
    }
    setSaving(false);
  };

  const applyDraftInvoicePrices = async () => {
    setApplyingDrafts(true);
    try {
      const result = await applyCatalogPricesToDraftInvoices();
      alert(
        result.items > 0
          ? `下書き請求書 ${result.invoices}件（${result.items}明細）を更新しました。手動入力の単価はそのままです。`
          : '更新する下書き明細はありませんでした。'
      );
    } catch (error) {
      alert(error instanceof Error ? error.message : '下書き請求書への反映に失敗しました。');
    }
    setApplyingDrafts(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('この単価を削除しますか？')) return;
    try {
      await deleteUnitPrice(id);
    } catch (error) {
      console.error('Error deleting unit price:', error);
    }
    fetchUnitPrices();
  };

  const persistOrder = async (ordered: UnitPrice[]) => {
    const hidden = pricesRef.current.filter((item) => !ordered.some((visible) => visible.id === item.id));
    const next = [...ordered, ...hidden].map((item, index) => ({ ...item, sort_order: index }));
    pricesRef.current = next;
    setUnitPrices(next);
    const ids = next.map((item) => item.id);
    const signature = ids.join(',');
    if (signature === savedOrderRef.current) return;
    savedOrderRef.current = signature;
    await reorderUnitPrices(ids);
  };

  const finishDrag = () => {
    if (persistLockRef.current) return;
    const from = dragFromRef.current;
    const to = dragOverRef.current;
    dragFromRef.current = null;
    dragOverRef.current = null;
    setDraggingIndex(null);
    setDragOverIndex(null);
    if (from == null || to == null || from === to) return;
    persistLockRef.current = true;
    const next = moveIndex(sorted, from, to);
    patchListPrefs({ sortBy: 'sort_order' });
    persistOrder(next)
      .catch((error) => {
        console.error('Error reordering unit prices:', error);
        savedOrderRef.current = '';
        fetchUnitPrices({ silent: true });
      })
      .finally(() => {
        persistLockRef.current = false;
      });
  };

  const dragHandleProps = (index: number) => ({
    draggable: true as const,
    onDragStart: (e: React.DragEvent) => {
      dragFromRef.current = index;
      dragOverRef.current = index;
      setDraggingIndex(index);
      setDragOverIndex(index);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    },
    onDragEnd: finishDrag,
  });

  const dropTargetProps = (index: number) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragOverRef.current !== index) {
        dragOverRef.current = index;
        setDragOverIndex(index);
      }
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      dragOverRef.current = index;
      finishDrag();
    },
  });

  const filtered = unitPrices.filter((up) => {
    const matchesSearch =
      clientName(up.client).toLowerCase().includes(search.toLowerCase()) ||
      up.position.toLowerCase().includes(search.toLowerCase());
    const matchesClient = clientFilter === 'all' || up.client_id === clientFilter;
    const matchesDomestic = domesticFilter === 'all' || (domesticFilter === 'domestic' && up.is_domestic) || (domesticFilter === 'overseas' && !up.is_domestic);
    const matchesPosition = positionFilter === 'all' || up.position === positionFilter;
    const matchesTaskType = taskTypeFilter === 'all' || canonicalTaskType(up.task_type) === canonicalTaskType(taskTypeFilter);
    return matchesSearch && matchesClient && matchesDomestic && matchesPosition && matchesTaskType;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'sort_order') return compareUnitPriceOrder(a, b);
    if (sortBy === 'created_at') return compareCreatedAt(a, b);
    if (sortBy === 'client') {
      return clientName(a.client).localeCompare(clientName(b.client), 'ja');
    }
    if (sortBy === 'price') {
      return b.price - a.price;
    }
    if (sortBy === 'task_type') {
      const byType = compareCatalogOrder(a.task_type, b.task_type, taskTypes);
      if (byType !== 0) return byType;
      return compareUnitPriceOrder(a, b);
    }
    if (sortBy === 'position') {
      return a.position.localeCompare(b.position, 'ja');
    }
    if (sortBy === 'venue_size') {
      return (a.venue_size || '').localeCompare(b.venue_size || '', 'ja');
    }
    return 0;
  });

  const formatYen = (n: number) => `¥${n.toLocaleString()}`;

  return (
    <div>
      <div className="page-toolbar">
        <div>
          <h1 className="page-title">単価一覧</h1>
          <p className="mt-1 text-sm text-slate-500">クライアント毎の単価を管理します</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={applyDraftInvoicePrices}
            disabled={applyingDrafts}
            className="btn-secondary"
          >
            <RefreshCw className={`h-4 w-4 ${applyingDrafts ? 'animate-spin' : ''}`} />
            {applyingDrafts ? '反映中...' : '下書き請求書へ反映'}
          </button>
          <button onClick={openCreate} className="btn-primary">
            <Plus className="h-4 w-4" />
            新規単価
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="クライアント名、ポジションで検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputClass} pl-10`}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
          <span className="shrink-0 text-xs font-medium text-slate-400">クライアント名</span>
          <select
            value={clientFilter}
            onChange={(e) => patchListPrefs({ clientFilter: e.target.value })}
            className={`${inputClass} w-full sm:w-auto`}
          >
            <option value="all">すべて</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {clientName(c)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
          <span className="shrink-0 text-xs font-medium text-slate-400">国内 / 海外</span>
          <select
            value={domesticFilter}
            onChange={(e) => patchListPrefs({ domesticFilter: e.target.value as 'all' | 'domestic' | 'overseas' })}
            className={`${inputClass} w-full sm:w-auto`}
          >
            <option value="all">すべて</option>
            <option value="domestic">国内</option>
            <option value="overseas">海外</option>
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
          <span className="shrink-0 text-xs font-medium text-slate-400">ポジション</span>
          <select
            value={positionFilter}
            onChange={(e) => patchListPrefs({ positionFilter: e.target.value })}
            className={`${inputClass} w-full sm:w-auto`}
          >
            <option value="all">すべて</option>
            {positions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
          <span className="shrink-0 text-xs font-medium text-slate-400">種別</span>
          <select
            value={taskTypeFilter}
            onChange={(e) => patchListPrefs({ taskTypeFilter: e.target.value })}
            className={`${inputClass} w-full sm:w-auto`}
          >
            <option value="all">すべて</option>
            {taskTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ArrowUpDown className="h-4 w-4 text-slate-400" />
        <span className="text-sm text-slate-500">並び替え:</span>
        {([
          { key: 'sort_order', label: '並び順' },
          { key: 'created_at', label: '登録順' },
          { key: 'client', label: 'クライアント名' },
          { key: 'task_type', label: '種別' },
          { key: 'position', label: 'ポジション' },
          { key: 'venue_size', label: '規模' },
          { key: 'price', label: '単価' },
        ] as { key: UnitPriceSortKey; label: string }[]).map((s) => (
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

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<JapaneseYen className="h-7 w-7" />}
            title="単価データがありません"
            description="新規単価ボタンから追加してください"
          />
        </div>
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {sorted.map((up, index) => (
              <div
                key={up.id}
                className={`card p-4 ${
                  draggingIndex === index
                    ? 'opacity-60 ring-1 ring-teal-300'
                    : dragOverIndex === index
                      ? 'ring-1 ring-teal-400'
                      : ''
                }`}
                {...dropTargetProps(index)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-1">
                    <button
                      type="button"
                      className="btn-icon mt-0.5 cursor-grab text-slate-400 hover:text-slate-600 active:cursor-grabbing"
                      aria-label="並び替え"
                      title="ドラッグして並べ替え"
                      {...dragHandleProps(index)}
                    >
                      <GripVertical className="h-4 w-4" />
                    </button>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          {up.is_domestic ? '国内' : '海外'}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
                          {up.task_type}
                        </span>
                        {up.venue_size ? (
                          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                            {up.venue_size}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 font-semibold text-slate-900">{clientName(up.client) || '—'}</p>
                      <p className="mt-1 text-sm text-slate-600">{up.position}</p>
                      <p className="mt-0.5 text-sm text-slate-500">{taxSettingLabel(up.tax_rate, up.tax_type)}</p>
                    </div>
                  </div>
                  <div className="row-actions shrink-0">
                    <button onClick={() => openEdit(up)} className="btn-icon" title="編集">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => openCopy(up)} className="btn-icon" title="コピー">
                      <Copy className="h-4 w-4" />
                    </button>
                    <button onClick={() => handleDelete(up.id)} className="btn-icon hover:text-red-500" title="削除">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <p className="mt-3 text-right text-lg font-semibold text-teal-700">{formatYen(up.price)}</p>
              </div>
            ))}
          </div>
          <div className="card table-scroll hidden overflow-hidden md:block">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="w-10 px-2 py-3" />
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">クライアント</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">国内/海外</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">ポジション</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">規模</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">種別</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">単価</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">税率</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sorted.map((up, index) => (
                  <tr
                    key={up.id}
                    className={`group transition-colors hover:bg-slate-50 ${
                      draggingIndex === index
                        ? 'bg-teal-50/60'
                        : dragOverIndex === index
                          ? 'bg-teal-50/30'
                          : ''
                    }`}
                    {...dropTargetProps(index)}
                  >
                    <td className="px-2 py-3">
                      <button
                        type="button"
                        className="btn-icon cursor-grab text-slate-400 hover:text-slate-600 active:cursor-grabbing"
                        aria-label="並び替え"
                        title="ドラッグして並べ替え"
                        {...dragHandleProps(index)}
                      >
                        <GripVertical className="h-4 w-4" />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">
                      {clientName(up.client) || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      <span className="inline-flex items-center gap-1">
                        <Globe className="h-3.5 w-3.5 text-slate-400" />
                        {up.is_domestic ? '国内' : '海外'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{up.position}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{up.venue_size || '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{up.task_type}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-teal-700">{formatYen(up.price)}</td>
                    <td className="px-4 py-3 text-center text-sm text-slate-500">{taxSettingLabel(up.tax_rate, up.tax_type)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="row-actions justify-end">
                        <button onClick={() => openEdit(up)} className="btn-icon" title="編集">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => openCopy(up)} className="btn-icon" title="コピー">
                          <Copy className="h-4 w-4" />
                        </button>
                        <button onClick={() => handleDelete(up.id)} className="btn-icon hover:text-red-500" title="削除">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? '単価編集' : '新規単価登録'}
      >
        <div className="space-y-4">
          <FormErrorList errors={formErrors} />
          <FormField label="クライアント" required>
            <select
              value={form.client_id}
              onChange={(e) => handleClientChange(e.target.value)}
              className={`${inputClass} ${fieldErrorClass(formErrors.find((item) => item.includes('クライアント')))}`}
            >
              <option value="">選択してください</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {clientName(c)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="国内 / 海外">
            <div className="flex gap-2">
              <button
                onClick={() => handleDomesticChange(true)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                  form.is_domestic
                    ? 'border-teal-500 bg-teal-50 text-teal-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                国内
              </button>
              <button
                onClick={() => handleDomesticChange(false)}
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
          <FormField label="ポジション" required>
            <AddableSelect
              value={form.position}
              onChange={(position) => setForm({ ...form, position })}
              options={positions}
              onAdd={addPosition}
              emptyLabel="選択してください"
              className={fieldErrorClass(formErrors.find((item) => item.includes('ポジション')))}
            />
          </FormField>
          <FormField label="規模">
            <select
              value={form.venue_size}
              onChange={(e) => setForm({ ...form, venue_size: e.target.value })}
              className={inputClass}
            >
              <option value="">未選択</option>
              {VENUE_SIZES.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </FormField>
          <FormField label="種別" required>
            <AddableSelect
              value={form.task_type}
              onChange={(task_type) => setForm({ ...form, task_type })}
              options={taskTypes}
              onAdd={addTaskType}
              onReorder={reorderTaskTypes}
              className={fieldErrorClass(formErrors.find((item) => item.includes('種別')))}
            />
          </FormField>
          <FormField label="単価（円）" required>
            <input
              type="text"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value.replace(/[^0-9]/g, '') })}
              className={`${inputClass} ${fieldErrorClass(formErrors.find((item) => item.includes('単価')))}`}
              placeholder="50000"
              inputMode="numeric"
            />
          </FormField>
          <FormField label="消費税率（%）">
            <div className="space-y-2">
              <TaxRateField
                taxRate={form.tax_rate}
                taxType={form.tax_type}
                onChange={({ tax_rate, tax_type }) => setForm({ ...form, tax_rate, tax_type })}
              />
              <p className="text-sm text-slate-500">
                {form.is_domestic ? 'クライアント設定の税率を適用（例外時は変更可）' : '海外は基本0%'}
              </p>
            </div>
          </FormField>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setModalOpen(false)} className="btn-secondary">
              キャンセル
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary"
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
