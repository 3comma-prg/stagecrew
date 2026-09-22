import { Fragment, useEffect, useState, useCallback } from 'react';
import { deleteClient, deleteUnitPrice, listClients, listUnitPrices, saveClient, saveUnitPrice, applyCatalogPricesToDraftInvoices } from '@/lib/db';
import type { Client, UnitPrice, VenueSize, TaxType } from '@/types';
import { DEFAULT_TASK_TYPE, VENUE_SIZES, GOOGLE_CALENDAR_COLORS, clientName, normalizeTaxType, taxSettingLabel } from '@/types';
import { Modal } from '@/components/ui/Modal';
import { FormErrorList, FormField, fieldErrorClass, inputClass } from '@/components/ui/FormField';
import { AddableSelect } from '@/components/ui/AddableSelect';
import { EmptyState } from '@/components/ui/EmptyState';
import { SplitDetailLayout } from '@/components/ui/SplitDetailLayout';
import { TaxRateField } from '@/components/ui/TaxRateField';
import { Plus, Pencil, Trash2, Users, Search, Mail, Phone, MapPin, Building2, X, JapaneseYen, Copy } from 'lucide-react';
import { formatPostalCode, lookupPostalAddress, postalDigits } from '@/lib/postal';
import { Badge } from '@/components/ui/Badge';
import { useCatalogOptions } from '@/lib/catalog-options';

export function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [saving, setSaving] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [postalMessage, setPostalMessage] = useState('');
  const [lookingUpPostal, setLookingUpPostal] = useState(false);

  const [form, setForm] = useState({
    company_name: '',
    representative_name: '',
    contact_person_name: '',
    postal_code: '',
    address: '',
    phone: '',
    email: '',
    representative_email: '',
    contact_person_email: '',
    tax_rate: 10,
    tax_type: 'exclusive' as TaxType,
    google_calendar_color_id: null as number | null,
  });

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listClients();
      setClients(data);
    } catch (error) {
      console.error('Error fetching clients:', error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      company_name: '',
      representative_name: '',
      contact_person_name: '',
      postal_code: '',
      address: '',
      phone: '',
      email: '',
      representative_email: '',
      contact_person_email: '',
      tax_rate: 10,
      tax_type: 'exclusive' as TaxType,
      google_calendar_color_id: null,
    });
    setFormErrors([]);
    setPostalMessage('');
    setModalOpen(true);
  };

  const openEdit = (client: Client) => {
    setEditing(client);
    setForm({
      company_name: client.company_name || '',
      representative_name: client.representative_name || '',
      contact_person_name: client.contact_person_name || '',
      postal_code: formatPostalCode(client.postal_code || ''),
      address: client.address || '',
      phone: client.phone || '',
      email: client.email || '',
      representative_email: client.representative_email || '',
      contact_person_email: client.contact_person_email || '',
      tax_rate: client.tax_rate,
      tax_type: normalizeTaxType(client.tax_type),
      google_calendar_color_id:
        client.google_calendar_color_id && client.google_calendar_color_id > 0
          ? client.google_calendar_color_id
          : null,
    });
    setFormErrors([]);
    setPostalMessage('');
    setModalOpen(true);
  };

  const fillAddressFromPostal = async (value: string) => {
    if (postalDigits(value).length !== 7) return;
    setLookingUpPostal(true);
    const result = await lookupPostalAddress(value);
    setLookingUpPostal(false);
    if (result.address) {
      setForm((current) => ({ ...current, address: result.address }));
      setPostalMessage('住所を自動入力しました。');
      return;
    }
    setPostalMessage(result.error);
  };

  const handlePostalChange = (value: string) => {
    const formatted = formatPostalCode(value);
    setForm((current) => ({ ...current, postal_code: formatted }));
    setPostalMessage('');
    if (postalDigits(formatted).length === 7) {
      fillAddressFromPostal(formatted);
    }
  };

  const handleSave = async () => {
    const errors: string[] = [];
    if (!form.company_name.trim()) errors.push('会社名を入力してください。');
    setFormErrors(errors);
    if (errors.length) return;
    setSaving(true);
    const payload = {
      company_name: form.company_name.trim(),
      representative_name: form.representative_name.trim(),
      contact_person_name: form.contact_person_name || null,
      postal_code: formatPostalCode(form.postal_code) || null,
      address: form.address || null,
      phone: form.phone || null,
      email: form.email || null,
      representative_email: form.representative_email || null,
      contact_person_email: form.contact_person_email || null,
      tax_rate: form.tax_rate,
      tax_type: form.tax_type,
      google_calendar_color_id: form.google_calendar_color_id,
    };
    try {
      await saveClient(payload, editing?.id);
      setModalOpen(false);
      fetchClients();
    } catch (error) {
      setFormErrors([error instanceof Error ? error.message : 'クライアントを保存できませんでした。']);
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('このクライアントを削除しますか？')) return;
    try {
      await deleteClient(id);
    } catch (error) {
      console.error('Error deleting client:', error);
    }
    if (selectedClient?.id === id) setSelectedClient(null);
    fetchClients();
  };

  const filtered = clients.filter((c) => {
    const q = search.toLowerCase();
    return (
      (c.representative_name || '').toLowerCase().includes(q) ||
      (c.company_name || '').toLowerCase().includes(q) ||
      (c.contact_person_name || '').toLowerCase().includes(q) ||
      (c.postal_code || '').includes(search) ||
      (c.address || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <div className="page-toolbar">
        <div>
          <h1 className="page-title">クライアント一覧</h1>
          <p className="mt-1 text-sm text-slate-500">クライアントを選択すると単価一覧が表示されます</p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="h-4 w-4" />
          新規登録
        </button>
      </div>

      <div className="mb-4 relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="会社名、代表者名、担当者名、住所、メールアドレスで検索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${inputClass} pl-10`}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Users className="h-7 w-7" />}
            title="クライアントがありません"
            description="新規登録ボタンからクライアントを追加してください"
          />
        </div>
      ) : (
        <SplitDetailLayout
          selected={Boolean(selectedClient)}
          pane={selectedClient ? <UnitPricePane client={selectedClient} onClose={() => setSelectedClient(null)} /> : null}
        >
          {({ isDesktop }) =>
            filtered.map((client) => (
              <Fragment key={client.id}>
                <div
                  className={`list-card group cursor-pointer ${
                    selectedClient?.id === client.id ? 'ring-2 ring-teal-500' : ''
                  }`}
                  onClick={() => setSelectedClient((current) => (current?.id === client.id ? null : client))}
                >
                  <div className="list-card-main">
                    <div className="list-card-icon">
                      <Building2 className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {client.google_calendar_color_id !== null && client.google_calendar_color_id > 0 ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: GOOGLE_CALENDAR_COLORS.find((c) => c.id === client.google_calendar_color_id)?.color || '#64748b' }}
                            />
                            {GOOGLE_CALENDAR_COLORS.find((c) => c.id === client.google_calendar_color_id)?.label || 'カレンダーの色'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                            <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
                            カレンダーの色
                          </span>
                        )}
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          {taxSettingLabel(client.tax_rate, client.tax_type)}
                        </span>
                      </div>
                      <h3 className="mt-1 min-w-0 truncate font-semibold text-slate-900">{clientName(client) || '—'}</h3>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-sm text-slate-500">
                        {client.representative_name ? (
                          <span>
                            <span className="mr-1 text-xs text-slate-400">代表</span>
                            <span className="font-medium text-slate-800">{client.representative_name}</span>
                          </span>
                        ) : null}
                        {client.contact_person_name ? (
                          <span>
                            <span className="mr-1 text-xs text-slate-400">担当</span>
                            <span className="font-medium text-slate-800">{client.contact_person_name}</span>
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-sm text-slate-600">
                        {client.phone ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Phone className="h-3.5 w-3.5 text-slate-400" />
                            {client.phone}
                          </span>
                        ) : null}
                        {client.postal_code || client.address ? (
                          <span className="inline-flex min-w-0 items-center gap-1.5">
                            <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <span className="truncate">
                              {client.postal_code ? `〒${formatPostalCode(client.postal_code)}` : ''}
                              {client.postal_code && client.address ? ' ' : ''}
                              {client.address || ''}
                            </span>
                          </span>
                        ) : null}
                        {client.representative_email ? (
                          <span className="inline-flex min-w-0 items-center gap-1.5">
                            <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <span className="truncate">{client.representative_email}</span>
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => openEdit(client)} className="btn-icon" title="編集">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => handleDelete(client.id)} className="btn-icon hover:text-red-500" title="削除">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {!isDesktop && selectedClient?.id === client.id ? (
                  <UnitPricePane client={selectedClient} onClose={() => setSelectedClient(null)} />
                ) : null}
              </Fragment>
            ))
          }
        </SplitDetailLayout>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'クライアント編集' : '新規クライアント登録'}
      >
        <div className="space-y-4">
          <FormErrorList errors={formErrors} />
          <FormField label="会社名" required>
            <input
              type="text"
              value={form.company_name}
              onChange={(e) => setForm({ ...form, company_name: e.target.value })}
              className={`${inputClass} ${fieldErrorClass(formErrors.find((item) => item.includes('会社名')))}`}
              placeholder="株式会社〇〇"
            />
          </FormField>
          <FormField label="郵便番号">
            <input
              type="text"
              inputMode="numeric"
              value={form.postal_code}
              onChange={(e) => handlePostalChange(e.target.value)}
              className={inputClass}
              placeholder="100-0001"
              autoComplete="postal-code"
            />
            <p className="mt-1 text-xs text-slate-500">
              {lookingUpPostal ? '住所を検索しています...' : postalMessage || '7桁入力すると住所を自動入力します。'}
            </p>
          </FormField>
          <FormField label="住所">
            <input
              type="text"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className={inputClass}
              placeholder="東京都渋谷区..."
            />
          </FormField>
          <FormField label="電話番号">
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className={inputClass}
              placeholder="03-1234-5678"
            />
          </FormField>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="代表者名">
              <input
                type="text"
                value={form.representative_name}
                onChange={(e) => setForm({ ...form, representative_name: e.target.value })}
                className={inputClass}
                placeholder="山田太郎"
              />
            </FormField>
            <FormField label="代表者メールアドレス">
              <input
                type="email"
                value={form.representative_email}
                onChange={(e) => setForm({ ...form, representative_email: e.target.value })}
                className={inputClass}
                placeholder="representative@example.com"
              />
            </FormField>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="担当者名">
              <input
                type="text"
                value={form.contact_person_name}
                onChange={(e) => setForm({ ...form, contact_person_name: e.target.value })}
                className={inputClass}
                placeholder="佐藤花子"
              />
            </FormField>
            <FormField label="担当者メールアドレス">
              <input
                type="email"
                value={form.contact_person_email}
                onChange={(e) => setForm({ ...form, contact_person_email: e.target.value })}
                className={inputClass}
                placeholder="contact@example.com"
              />
            </FormField>
          </div>
          <FormField label="Googleカレンダーの色">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setForm({ ...form, google_calendar_color_id: null })}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all ${
                  form.google_calendar_color_id == null || form.google_calendar_color_id === 0
                    ? 'border-teal-500 bg-teal-50 text-teal-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="h-3 w-3 rounded-full bg-slate-400" />
                カレンダーの色
              </button>
              {GOOGLE_CALENDAR_COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setForm({ ...form, google_calendar_color_id: c.id })}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all ${
                    form.google_calendar_color_id === c.id
                      ? 'border-teal-500 bg-teal-50 text-teal-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: c.color }}
                  />
                  {c.label}
                </button>
              ))}
            </div>
          </FormField>

          <FormField label="消費税率（%）" required>
            <TaxRateField
              taxRate={form.tax_rate}
              taxType={form.tax_type}
              onChange={({ tax_rate, tax_type }) => setForm({ ...form, tax_rate, tax_type })}
            />
          </FormField>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setModalOpen(false)} className="btn-secondary">
              キャンセル
            </button>
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---- Unit Price Pane (inline in ClientsPage) ----

interface UnitPricePaneProps {
  client: Client;
  onClose: () => void;
}

function UnitPricePane({ client, onClose }: UnitPricePaneProps) {
  const { taskTypes, positions, addTaskType, reorderTaskTypes, addPosition } = useCatalogOptions();
  const [unitPrices, setUnitPrices] = useState<UnitPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UnitPrice | null>(null);
  const [saving, setSaving] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);

  const [form, setForm] = useState({
    is_domestic: true,
    position: '',
    venue_size: '' as string,
    task_type: DEFAULT_TASK_TYPE,
    price: '' as string,
    tax_rate: 10,
    tax_type: 'exclusive' as TaxType,
  });

  const fetchUnitPrices = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listUnitPrices();
      setUnitPrices(data.filter((price) => price.client_id === client.id));
    } catch (error) {
      console.error('Error fetching unit prices:', error);
    }
    setLoading(false);
  }, [client.id]);

  useEffect(() => {
    fetchUnitPrices();
  }, [fetchUnitPrices]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      is_domestic: true,
      position: '',
      venue_size: '',
      task_type: DEFAULT_TASK_TYPE,
      price: '',
      tax_rate: client.tax_rate,
      tax_type: normalizeTaxType(client.tax_type),
    });
    setFormErrors([]);
    setModalOpen(true);
  };

  const openEdit = (up: UnitPrice) => {
    setEditing(up);
    setForm({
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

  const handleDomesticChange = (isDomestic: boolean) => {
    setForm((f) => ({
      ...f,
      is_domestic: isDomestic,
      tax_rate: isDomestic ? client.tax_rate : 0,
      tax_type: isDomestic ? normalizeTaxType(client.tax_type) : 'exclusive',
    }));
  };

  const handleSave = async () => {
    const errors: string[] = [];
    if (!form.position.trim()) errors.push('ポジションを選択してください。');
    if (!form.task_type.trim()) errors.push('種別を選択してください。');
    if (!form.price) errors.push('単価を入力してください。');
    setFormErrors(errors);
    if (errors.length) return;
    setSaving(true);
    const payload = {
      client_id: client.id,
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
        try {
          const result = await applyCatalogPricesToDraftInvoices();
          if (result.items > 0) {
            alert(`下書き請求書 ${result.invoices}件（${result.items}明細）を更新しました。手動入力の単価はそのままです。`);
          }
        } catch (applyError) {
          alert(applyError instanceof Error ? applyError.message : '下書き請求書への反映に失敗しました。');
        }
      }
    } catch (error) {
      setFormErrors([error instanceof Error ? error.message : '単価を保存できませんでした。']);
    }
    setSaving(false);
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

  const formatYen = (n: number) => `¥${n.toLocaleString()}`;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="btn-icon">
            <X className="h-5 w-5" />
          </button>
          <div>
            <h2 className="font-bold text-slate-900">
              {clientName(client)}
            </h2>
            <p className="text-xs text-slate-500">単価一覧</p>
          </div>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="h-4 w-4" />
          新規
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
        </div>
      ) : unitPrices.length === 0 ? (
        <div className="card py-8">
          <EmptyState icon={<JapaneseYen className="h-6 w-6" />} title="単価がありません" />
        </div>
      ) : (
        <div className="space-y-2.5">
          {unitPrices.map((up) => (
            <div key={up.id} className="card group p-3 transition-all hover:shadow-md">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge label={up.is_domestic ? '国内' : '海外'} className="bg-slate-50 text-slate-600 border-slate-200" />
                    <Badge label={up.task_type} className="bg-teal-50 text-teal-700 border-teal-200" />
                    {up.venue_size && (
                      <Badge label={up.venue_size} className="bg-slate-50 text-slate-600 border-slate-200" />
                    )}
                  </div>
                  <div className="mt-1.5 text-sm font-medium text-slate-800">{up.position}</div>
                  <div className="mt-1.5 flex items-center gap-3">
                    <span className="text-lg font-bold text-teal-700">{formatYen(up.price)}</span>
                    <span className="text-xs text-slate-400">{taxSettingLabel(up.tax_rate, up.tax_type)}</span>
                  </div>
                </div>
                <div className="row-actions">
                  <button onClick={() => openEdit(up)} className="btn-icon" title="編集">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => openCopy(up)} className="btn-icon" title="コピー">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => handleDelete(up.id)} className="btn-icon hover:text-red-500" title="削除">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? '単価編集' : '新規単価登録'}
      >
        <div className="space-y-4">
          <FormErrorList errors={formErrors} />
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
                {form.is_domestic ? 'クライアント設定の税率を適用' : '海外は基本0%'}
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
