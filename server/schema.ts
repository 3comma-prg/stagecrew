export type FieldType = 'string' | 'number' | 'boolean' | 'domestic' | 'date' | 'time';

export type Column = {
  key: string;
  header: string;
  type: FieldType;
  fallback?: string | number | boolean | null;
  aliases?: string[];
};

export type SheetKey = 'clients' | 'projects' | 'tasks' | 'unit_prices' | 'invoices' | 'invoice_items';

export type SheetSpec = {
  key: SheetKey;
  title: string;
  columns: Column[];
};

const id = { key: 'id', header: 'ID', type: 'string' as const };
const createdAt = { key: 'created_at', header: '作成日時', type: 'string' as const };

export const SHEETS: SheetSpec[] = [
  {
    key: 'clients',
    title: 'クライアント',
    columns: [
      id,
      { key: 'company_name', header: '会社名', type: 'string' },
      { key: 'representative_name', header: '代表者名', type: 'string', fallback: '' },
      { key: 'contact_person_name', header: '担当者名', type: 'string' },
      { key: 'postal_code', header: '郵便番号', type: 'string', aliases: ['〒', '郵便'] },
      { key: 'address', header: '住所', type: 'string' },
      { key: 'phone', header: '電話番号', type: 'string', aliases: ['電話'] },
      { key: 'email', header: 'メールアドレス', type: 'string', aliases: ['メール'] },
      { key: 'representative_email', header: '代表者メールアドレス', type: 'string', aliases: ['代表者メール'] },
      { key: 'contact_person_email', header: '担当者メールアドレス', type: 'string', aliases: ['担当者メール'] },
      { key: 'tax_rate', header: '消費税率（%）', type: 'number', fallback: 10, aliases: ['消費税率'] },
      { key: 'tax_type', header: '税区分', type: 'string', fallback: 'exclusive', aliases: ['消費税区分', '内外税'] },
      { key: 'google_calendar_color_id', header: 'Googleカレンダーの色', type: 'number', fallback: null, aliases: ['カレンダー色'] },
      { key: 'non_billable_task_types', header: '請求しない種別', type: 'string', fallback: '', aliases: ['非請求種別'] },
      { key: 'billing_timing', header: '請求タイミング', type: 'string', fallback: 'schedule_month', aliases: ['請求のタイミング'] },
      { key: 'show_group_gap_days', header: '本番まとめ間隔（日）', type: 'number', fallback: 14, aliases: ['本番グループ間隔'] },
      { key: 'sort_order', header: '並び順', type: 'number', fallback: null },
      createdAt,
    ],
  },
  {
    key: 'projects',
    title: 'プロジェクト',
    columns: [
      id,
      { key: 'project_name', header: 'プロジェクト名', type: 'string' },
      { key: 'artist_name', header: 'アーティスト名', type: 'string' },
      { key: 'event_name', header: 'イベント名', type: 'string' },
      { key: 'client_id', header: 'クライアントID', type: 'string' },
      { key: 'status', header: 'ステータス', type: 'string', fallback: 'in_progress' },
      { key: 'billing_timing', header: '請求タイミング', type: 'string', fallback: 'inherit', aliases: ['請求のタイミング'] },
      { key: 'show_group_gap_days', header: '本番まとめ間隔（日）', type: 'number', fallback: null, aliases: ['本番グループ間隔'] },
      createdAt,
    ],
  },
  {
    key: 'tasks',
    title: 'スケジュール',
    columns: [
      id,
      { key: 'project_id', header: 'プロジェクトID', type: 'string' },
      { key: 'date', header: '日付', type: 'date' },
      { key: 'is_cancelled', header: 'キャンセル', type: 'boolean', fallback: false },
      { key: 'is_deleted', header: '削除', type: 'boolean', fallback: false },
      { key: 'task_type', header: '種別', type: 'string', fallback: '仕込み/本番' },
      { key: 'time_type', header: '時間区分', type: 'string', fallback: 'all_day' },
      { key: 'start_date', header: '開始日', type: 'date' },
      { key: 'start_time', header: '開始時刻', type: 'time' },
      { key: 'end_date', header: '終了日', type: 'date' },
      { key: 'end_time', header: '終了時刻', type: 'time' },
      { key: 'area', header: 'エリア', type: 'string' },
      { key: 'location', header: '会場', type: 'string', aliases: ['場所'] },
      { key: 'position', header: 'ポジション', type: 'string' },
      { key: 'is_domestic', header: '国内 / 海外', type: 'domestic', fallback: true, aliases: ['国内海外', '国内/海外'] },
      { key: 'venue_size', header: '規模', type: 'string', aliases: ['会場規模', '会場の大きさ'] },
      { key: 'notes', header: '備考', type: 'string' },
      { key: 'billing_status', header: '請求状態', type: 'string', fallback: 'unbilled' },
      { key: 'is_billable', header: '請求する', type: 'boolean', fallback: true, aliases: ['請求対象'] },
      { key: 'billing_timing', header: '請求タイミング', type: 'string', fallback: 'inherit', aliases: ['請求のタイミング'] },
      { key: 'show_group_link', header: '本番グループ', type: 'string', fallback: 'auto', aliases: ['請求グループ'] },
      { key: 'google_event_id', header: 'GoogleイベントID', type: 'string', aliases: ['カレンダーイベントID'] },
      createdAt,
    ],
  },
  {
    key: 'unit_prices',
    title: '単価',
    columns: [
      id,
      { key: 'client_id', header: 'クライアントID', type: 'string' },
      { key: 'is_domestic', header: '国内 / 海外', type: 'domestic', fallback: true, aliases: ['国内海外', '国内/海外'] },
      { key: 'position', header: 'ポジション', type: 'string' },
      { key: 'venue_size', header: '規模', type: 'string', aliases: ['会場規模', '会場の大きさ'] },
      { key: 'task_type', header: '種別', type: 'string', fallback: '仕込み/本番' },
      { key: 'price', header: '単価（円）', type: 'number', fallback: 0, aliases: ['単価'] },
      { key: 'tax_rate', header: '消費税率（%）', type: 'number', fallback: 10, aliases: ['消費税率'] },
      { key: 'tax_type', header: '税区分', type: 'string', fallback: 'exclusive', aliases: ['消費税区分', '内外税'] },
      { key: 'sort_order', header: '並び順', type: 'number', fallback: null },
      createdAt,
    ],
  },
  {
    key: 'invoices',
    title: '請求書',
    columns: [
      id,
      { key: 'client_id', header: 'クライアントID', type: 'string' },
      { key: 'billing_month', header: '請求月', type: 'string' },
      { key: 'invoice_number', header: '請求書No', type: 'string' },
      { key: 'subject', header: '件名', type: 'string' },
      { key: 'issue_date', header: '発行日', type: 'date' },
      { key: 'due_date', header: '支払日', type: 'date' },
      { key: 'tax_type', header: '税区分', type: 'string', fallback: 'exclusive' },
      { key: 'tax_rate', header: '消費税率（%）', type: 'number', fallback: 0 },
      { key: 'subtotal', header: '小計', type: 'number', fallback: 0 },
      { key: 'tax_amount', header: '消費税額', type: 'number', fallback: 0 },
      { key: 'status', header: 'ステータス', type: 'string', fallback: 'draft' },
      { key: 'total_amount', header: '合計金額', type: 'number', fallback: 0 },
      { key: 'notes', header: '備考', type: 'string' },
      createdAt,
    ],
  },
  {
    key: 'invoice_items',
    title: '請求明細',
    columns: [
      id,
      { key: 'invoice_id', header: '請求書ID', type: 'string' },
      { key: 'task_id', header: 'スケジュールID', type: 'string' },
      { key: 'description', header: '品目（スケジュール名）', type: 'string', aliases: ['品目'] },
      { key: 'quantity', header: '数量', type: 'number', fallback: 1 },
      { key: 'quantity_unit', header: '単位', type: 'string', fallback: '日' },
      { key: 'unit_price', header: '単価', type: 'number', fallback: 0 },
      { key: 'amount', header: '金額', type: 'number', fallback: 0 },
      { key: 'tax_exempt', header: '非課税', type: 'boolean', fallback: false, aliases: ['税非課税'] },
      { key: 'sort_order', header: '並び順', type: 'number', fallback: null },
      { key: 'price_manual', header: '手動単価', type: 'boolean', fallback: false },
      createdAt,
    ],
  },
];

export const SHEET_BY_KEY = Object.fromEntries(SHEETS.map((sheet) => [sheet.key, sheet])) as Record<SheetKey, SheetSpec>;

const ENUMS: Record<string, Record<string, string>> = {
  status: {
    進行中: 'in_progress',
    完了: 'completed',
    キャンセル: 'cancelled',
    下書き: 'draft',
    発行済: 'issued',
    入金済: 'paid',
  },
  time_type: { 終日: 'all_day', 時間限定: 'time_limited', 複数日: 'multi_day' },
  billing_status: {
    未請求: 'unbilled',
    下書き: 'draft',
    請求済: 'billed',
    入金済: 'paid',
    請求対象外: 'not_billable',
  },
  tax_type: { 外税: 'exclusive', 内税: 'inclusive', 税込み: 'inclusive', 税込: 'inclusive' },
  billing_timing: {
    日程の月で請求: 'schedule_month',
    本番まとめ: 'show_bundle',
    クライアントに合わせる: 'inherit',
    案件に合わせる: 'inherit',
    継承: 'inherit',
  },
  show_group_link: {
    自動: 'auto',
    '自動（間隔ルール）': 'auto',
    前の本番とまとめる: 'with_previous',
    ここで別の請求にする: 'new_group',
  },
};

const ENUM_OUT: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(ENUMS).map(([key, map]) => [key, Object.fromEntries(Object.entries(map).map(([label, value]) => [value, label]))])
);

export function labelFor(key: string, value: unknown): string {
  if (value == null || value === '') return '';
  return ENUM_OUT[key]?.[String(value)] || String(value);
}

export function valueFor(key: string, raw: string): string {
  const trimmed = raw.trim();
  return ENUMS[key]?.[trimmed] || trimmed;
}
