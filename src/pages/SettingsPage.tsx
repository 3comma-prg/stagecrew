import { useEffect, useState, useCallback } from 'react';
import { hydrateSettings, saveSettings } from '@/lib/local-store';
import { checkGoogleCalendar, resolveCalendarId } from '@/lib/calendar-sync';
import { initializeDataSpreadsheet, exportToSpreadsheet, importFromSpreadsheet, preloadSheets, resetSheetsCache } from '@/lib/db';
import { DEFAULT_APP_FOOTER, DEFAULT_APP_NAME, DEFAULT_APP_TAGLINE, spreadsheetIdFromInput, spreadsheetUrlFromId } from '@/types';
import { FormField, inputClass } from '@/components/ui/FormField';
import { OptionOrderList } from '@/components/ui/OptionOrderList';
import { useCatalogOptions } from '@/lib/catalog-options';
import type { PageKey } from '@/components/Layout';
import { ArrowUpDown, Calendar, Download, FileText, Link2, Mail, Save, Check, Lightbulb, Plus, Table2, Upload } from 'lucide-react';

export function SettingsPage({ onNavigate }: { onNavigate?: (page: PageKey) => void }) {
  const { taskTypes, reorderTaskTypes } = useCatalogOptions();
  const [typeOrder, setTypeOrder] = useState<string[]>([]);
  const [savingTypes, setSavingTypes] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [serviceAccountEmail, setServiceAccountEmail] = useState('');
  const [calendarCheck, setCalendarCheck] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [checkingCalendar, setCheckingCalendar] = useState(false);
  const [creatingSheet, setCreatingSheet] = useState(false);
  const [transferring, setTransferring] = useState<'import' | 'export' | null>(null);
  const [sheetMessage, setSheetMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [form, setForm] = useState({
    google_calendar_id: '',
    invoice_template_ext_tax_url: '',
    invoice_template_int_tax_url: '',
    invoice_template_ext_nontax_url: '',
    invoice_template_detail_ext_tax_url: '',
    invoice_template_detail_int_tax_url: '',
    invoice_template_detail_ext_nontax_url: '',
    invoice_pdf_drive_folder_url: '',
    gmail_sender_email: '',
    data_spreadsheet_url: '',
    app_name: DEFAULT_APP_NAME,
    app_tagline: DEFAULT_APP_TAGLINE,
    app_footer: DEFAULT_APP_FOOTER,
  });

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    const data = await hydrateSettings();
    setForm({
      google_calendar_id: data.google_calendar_id || '',
      invoice_template_ext_tax_url: data.invoice_template_ext_tax_url || '',
      invoice_template_int_tax_url: data.invoice_template_int_tax_url || '',
      invoice_template_ext_nontax_url: data.invoice_template_ext_nontax_url || '',
      invoice_template_detail_ext_tax_url: data.invoice_template_detail_ext_tax_url || '',
      invoice_template_detail_int_tax_url: data.invoice_template_detail_int_tax_url || '',
      invoice_template_detail_ext_nontax_url: data.invoice_template_detail_ext_nontax_url || '',
      invoice_pdf_drive_folder_url: data.invoice_pdf_drive_folder_url || '',
      gmail_sender_email: data.gmail_sender_email || '',
      data_spreadsheet_url: data.data_spreadsheet_url || '',
      app_name: data.app_name || DEFAULT_APP_NAME,
      app_tagline: data.app_tagline ?? DEFAULT_APP_TAGLINE,
      app_footer: data.app_footer ?? '',
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchSettings();
      try {
        const response = await fetch('/api/health');
        const data = response.ok
          ? ((await response.json()) as { serviceAccountEmail?: string; spreadsheetUrl?: string | null })
          : null;
        if (cancelled || !data) return;
        setServiceAccountEmail(data.serviceAccountEmail || '');
      } catch {
        if (!cancelled) setServiceAccountEmail('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchSettings]);

  useEffect(() => {
    setTypeOrder(taskTypes);
  }, [taskTypes]);

  const handleSaveTaskTypeOrder = async () => {
    setSavingTypes(true);
    try {
      await reorderTaskTypes(typeOrder);
    } finally {
      setSavingTypes(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const calendarId = resolveCalendarId({ google_calendar_id: form.google_calendar_id });
    const sheetId = spreadsheetIdFromInput(form.data_spreadsheet_url);
    if (form.data_spreadsheet_url.trim() && !sheetId) {
      setSheetMessage({ ok: false, text: 'スプレッドシートのURLが正しくありません。' });
      setSaving(false);
      return;
    }
    const sheetUrl = sheetId ? spreadsheetUrlFromId(sheetId) : null;
    const payload = {
      id: 1,
      google_calendar_id: calendarId || null,
      invoice_template_ext_tax_url: form.invoice_template_ext_tax_url || null,
      invoice_template_int_tax_url: form.invoice_template_int_tax_url || null,
      invoice_template_ext_nontax_url: form.invoice_template_ext_nontax_url || null,
      invoice_template_detail_ext_tax_url: form.invoice_template_detail_ext_tax_url || null,
      invoice_template_detail_int_tax_url: form.invoice_template_detail_int_tax_url || null,
      invoice_template_detail_ext_nontax_url: form.invoice_template_detail_ext_nontax_url || null,
      invoice_pdf_drive_folder_url: form.invoice_pdf_drive_folder_url || null,
      gmail_sender_email: form.gmail_sender_email.trim() || null,
      data_spreadsheet_url: sheetUrl,
      app_name: form.app_name.trim() || DEFAULT_APP_NAME,
      app_tagline: form.app_tagline,
      app_footer: form.app_footer,
      updated_at: new Date().toISOString(),
    };
    try {
      await saveSettings(payload);
    } catch (error) {
      setSheetMessage({
        ok: false,
        text: error instanceof Error ? error.message : '設定の保存に失敗しました。',
      });
      setSaving(false);
      return;
    }
    if (sheetUrl && sheetUrl !== form.data_spreadsheet_url) {
      setForm((current) => ({ ...current, data_spreadsheet_url: sheetUrl }));
    }
    resetSheetsCache();
    preloadSheets().catch((error: unknown) => {
      setSheetMessage({
        ok: false,
        text: error instanceof Error ? error.message : 'データの読み込みに失敗しました。',
      });
    });
    if (calendarId && calendarId !== form.google_calendar_id) {
      setForm((current) => ({ ...current, google_calendar_id: calendarId }));
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleCreateSheet = async () => {
    const sheetId = spreadsheetIdFromInput(form.data_spreadsheet_url);
    if (!sheetId) {
      setSheetMessage({
        ok: false,
        text: '先に、空のスプレッドシートのURLを上の欄に貼ってください。シートと1行目の項目名を用意します。',
      });
      return;
    }
    if (
      !confirm(
        'このスプレッドシートに、クライアント・プロジェクト・スケジュール・単価・請求書・請求明細のシートと項目名を作成します。すでにあるデータ行は消しません。続けますか？'
      )
    ) {
      return;
    }
    const sheetUrl = spreadsheetUrlFromId(sheetId);
    setCreatingSheet(true);
    setSheetMessage(null);
    try {
      setForm((current) => ({ ...current, data_spreadsheet_url: sheetUrl }));
      await saveSettings({ data_spreadsheet_url: sheetUrl });
      const created = await initializeDataSpreadsheet();
      const sheetList = created.sheets?.length ? created.sheets.join('、') : '各シート';
      setSheetMessage({ ok: true, text: `${sheetList} のシートと項目名を作成しました。` });
    } catch (error) {
      setSheetMessage({
        ok: false,
        text: error instanceof Error ? error.message : 'シートと項目名の作成に失敗しました。',
      });
    }
    setCreatingSheet(false);
  };

  const handleImport = async (mode: 'upsert' | 'replace_all') => {
    const sheetId = spreadsheetIdFromInput(form.data_spreadsheet_url);
    if (!sheetId) {
      setSheetMessage({ ok: false, text: 'インポート元のスプレッドシートURLを入力して保存してください。' });
      return;
    }
    if (mode === 'replace_all') {
      if (
        !confirm(
          'アプリ内の全データ（クライアント・プロジェクト・スケジュール・単価・請求書）を削除し、スプレッドシートの内容で置き換えます。この操作は取り消せません。続けますか？'
        )
      ) {
        return;
      }
    } else if (
      !confirm(
        'スプレッドシートから取り込みます。同じIDのデータは上書き、新しいIDは追加されます。続けますか？'
      )
    ) {
      return;
    }
    setTransferring('import');
    setSheetMessage(null);
    try {
      const sheetUrl = spreadsheetUrlFromId(sheetId);
      await saveSettings({ data_spreadsheet_url: sheetUrl });
      const result = await importFromSpreadsheet({ spreadsheetUrl: sheetUrl, mode });
      const warningText =
        result.warnings && result.warnings.length
          ? `\n注意: ${result.warnings.slice(0, 5).join(' / ')}${result.warnings.length > 5 ? ' …' : ''}`
          : '';
      setSheetMessage({
        ok: true,
        text: `インポート完了（追加 ${result.inserted ?? 0} / 更新 ${result.updated ?? 0}）${warningText}`,
      });
    } catch (error) {
      setSheetMessage({
        ok: false,
        text: error instanceof Error ? error.message : 'インポートに失敗しました。',
      });
    }
    setTransferring(null);
  };

  const handleExport = async () => {
    const sheetId = spreadsheetIdFromInput(form.data_spreadsheet_url);
    if (!sheetId) {
      setSheetMessage({ ok: false, text: 'エクスポート先のスプレッドシートURLを入力して保存してください。' });
      return;
    }
    if (!confirm('アプリのデータをスプレッドシートへ書き出します。同名シートの内容は上書きされます。続けますか？')) {
      return;
    }
    setTransferring('export');
    setSheetMessage(null);
    try {
      const sheetUrl = spreadsheetUrlFromId(sheetId);
      await saveSettings({ data_spreadsheet_url: sheetUrl });
      const result = await exportToSpreadsheet({ spreadsheetUrl: sheetUrl });
      setSheetMessage({
        ok: true,
        text: `エクスポート完了（${(result.sheets || []).join('、') || '各シート'}）`,
      });
    } catch (error) {
      setSheetMessage({
        ok: false,
        text: error instanceof Error ? error.message : 'エクスポートに失敗しました。',
      });
    }
    setTransferring(null);
  };

  const handleCalendarCheck = async () => {
    const calendarId = resolveCalendarId({ google_calendar_id: form.google_calendar_id });
    await saveSettings({
      google_calendar_id: calendarId || null,
    });
    if (calendarId && calendarId !== form.google_calendar_id) {
      setForm((current) => ({ ...current, google_calendar_id: calendarId }));
    }
    setCheckingCalendar(true);
    setCalendarCheck(null);
    const result = await checkGoogleCalendar();
    setCheckingCalendar(false);
    if (result.error) {
      setCalendarCheck({ ok: false, text: result.error });
      return;
    }
    const role =
      result.accessRole === 'owner' ? '所有者' : result.accessRole === 'writer' ? '予定の変更' : result.accessRole || '';
    setCalendarCheck({
      ok: true,
      text: result.summary
        ? `接続できます。「${result.summary}」${role ? `（${role}）` : ''}`
        : '接続できます。予定の登録権限があります。',
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="page-title">設定</h1>
        <p className="mt-1 text-sm text-slate-500">URLやIDはサーバーの共有設定ファイルに保存し、PCとスマホで同じ内容を使います。プロジェクト・スケジュール・クライアント・単価・請求書はスプレッドシートで管理します</p>
      </div>

      <div className="space-y-6">
        <div className="card p-4 md:p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
              <Lightbulb className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900">表示名</h2>
              <p className="text-xs text-slate-500">左メニューに出すアプリ名と説明です。保存すると全端末で同じ表示になります</p>
            </div>
          </div>
          <div className="space-y-4">
            <FormField label="アプリ名">
              <input
                type="text"
                value={form.app_name}
                onChange={(e) => setForm({ ...form, app_name: e.target.value })}
                className={inputClass}
                placeholder={DEFAULT_APP_NAME}
              />
            </FormField>
            <FormField label="サブタイトル">
              <input
                type="text"
                value={form.app_tagline}
                onChange={(e) => setForm({ ...form, app_tagline: e.target.value })}
                className={inputClass}
                placeholder={DEFAULT_APP_TAGLINE}
              />
              <p className="mt-1 text-xs text-slate-500">アプリ名の下に小さく出ます。いまは「{DEFAULT_APP_NAME} {DEFAULT_APP_TAGLINE}」です。</p>
            </FormField>
            <FormField label="フッター">
              <textarea
                value={form.app_footer}
                onChange={(e) => setForm({ ...form, app_footer: e.target.value })}
                className={`${inputClass} min-h-[72px] resize-y`}
                placeholder={DEFAULT_APP_FOOTER}
              />
              <p className="mt-1 text-xs text-slate-500">左メニュー下部の説明です。改行できます。空欄にすると表示しません。</p>
            </FormField>
          </div>
        </div>
        <div className="card p-4 md:p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <ArrowUpDown className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900">種別の並び順</h2>
              <p className="text-xs text-slate-500">スケジュール・単価の選択肢と、種別での並び替えに使います</p>
            </div>
          </div>
          <OptionOrderList items={typeOrder} onChange={setTypeOrder} />
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={handleSaveTaskTypeOrder} disabled={savingTypes} className="btn-primary">
              {savingTypes ? '保存中...' : '種別の並びを保存'}
            </button>
          </div>
        </div>
        <div className="card p-4 md:p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
              <Table2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900">Googleスプレッドシート連携</h2>
              <p className="text-xs text-slate-500">
                インポート／エクスポートと請求PDFの作業用です。アプリ本体のデータはサーバー内のデータベースに保存されます
              </p>
            </div>
          </div>
          <div className="space-y-4">
            {serviceAccountEmail ? (
              <p className="break-all text-xs text-slate-600">
                スプレッドシートは次のサービスアカウントに「編集者」で共有してください。
                <span className="mt-1 block font-medium text-slate-800">{serviceAccountEmail}</span>
              </p>
            ) : (
              <p className="text-xs text-amber-700">サービスアカウントを表示できません。.env の接続設定を確認してください。</p>
            )}
            <FormField label="スプレッドシートURL">
              <div className="relative">
                <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="url"
                  value={form.data_spreadsheet_url}
                  onChange={(e) => setForm({ ...form, data_spreadsheet_url: e.target.value })}
                  className={`${inputClass} pl-10`}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                />
              </div>
              <p className="mt-2 text-xs text-slate-500">
                空欄のときは .env の GOOGLE_SPREADSHEET_ID を使います。「シート準備」はファイルを増やさず、タブと1行目の項目名を作ります。インポートは同じIDを上書きし、新しい行は追加します。
              </p>
            </FormField>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={handleCreateSheet} disabled={creatingSheet || Boolean(transferring)} className="btn-secondary">
                <Plus className="h-4 w-4" />
                {creatingSheet ? '準備中...' : 'シート準備'}
              </button>
              <button
                type="button"
                onClick={() => handleImport('upsert')}
                disabled={Boolean(transferring) || creatingSheet}
                className="btn-secondary"
              >
                <Upload className="h-4 w-4" />
                {transferring === 'import' ? '取込中...' : 'インポート'}
              </button>
              <button
                type="button"
                onClick={() => handleImport('replace_all')}
                disabled={Boolean(transferring) || creatingSheet}
                className="btn-secondary"
              >
                <Upload className="h-4 w-4" />
                全置換インポート
              </button>
              <button type="button" onClick={handleExport} disabled={Boolean(transferring) || creatingSheet} className="btn-secondary">
                <Download className="h-4 w-4" />
                {transferring === 'export' ? '書出中...' : 'エクスポート'}
              </button>
              {sheetMessage && (
                <p className={`w-full whitespace-pre-wrap text-sm ${sheetMessage.ok ? 'text-emerald-700' : 'text-red-700'}`}>
                  {sheetMessage.text}
                </p>
              )}
            </div>
          </div>
        </div>
        {/* Google Calendar Section */}
        <div className="card p-4 md:p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Calendar className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900">Googleカレンダー連携</h2>
              <p className="text-xs text-slate-500">アプリで作ったスケジュールをGoogleカレンダーと同期します</p>
            </div>
          </div>

          <div className="space-y-4">
            <ol className="list-decimal space-y-1 pl-4 text-xs leading-relaxed text-slate-600">
              <li>Google Cloud で Calendar API を有効にします。請求書連携と同じプロジェクトで問題ありません。</li>
              <li>
                Googleカレンダー左の一覧で、同期したいカレンダーの「︙」→「設定と共有」を開きます。メインのカレンダーではなく、設定に入れたIDのカレンダーを選んでください。
              </li>
              <li>
                「特定のユーザーとの共有」にサービスアカウントを追加し、権限を「予定の変更」にします。「すべての予定の権限を見る」では登録できません。招待メールは届きませんが、共有は有効です。
                {serviceAccountEmail ? (
                  <span className="mt-1 block break-all font-medium text-slate-800">{serviceAccountEmail}</span>
                ) : (
                  <span className="mt-1 block text-amber-700">サービスアカウントを表示できません。.env の接続設定を確認してください。</span>
                )}
              </li>
              <li>同じ画面の「カレンダーの統合」からカレンダーIDをコピーし、下に貼って保存します。primary は指定しないでください。</li>
            </ol>
            <p className="text-xs leading-relaxed text-slate-500">
              新規予定はアプリからのみ作成します。日時の変更と削除は双方向です。詳細は「カレンダー連携」ページを見てください。
              {onNavigate && (
                <button type="button" onClick={() => onNavigate('calendar_help')} className="ml-1 font-medium text-teal-700 hover:underline">
                  同期のルールを見る
                </button>
              )}
            </p>
            <FormField label="カレンダーID">
              <input
                type="text"
                value={form.google_calendar_id}
                onChange={(e) => setForm({ ...form, google_calendar_id: e.target.value })}
                className={inputClass}
                placeholder="xxx@group.calendar.google.com"
              />
              <p className="mt-2 text-xs text-slate-500">
                「カレンダーの統合」にあるカレンダーIDを貼ってください。同期はサービスアカウントで行います。APIキーは不要です。
              </p>
            </FormField>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleCalendarCheck}
                disabled={checkingCalendar}
                className="btn-secondary"
              >
                {checkingCalendar ? '確認中...' : '接続を確認'}
              </button>
              {calendarCheck && (
                <p className={`w-full text-sm ${calendarCheck.ok ? 'text-emerald-700' : 'text-red-700'}`}>{calendarCheck.text}</p>
              )}
            </div>
          </div>
        </div>

        {/* Invoice Template Section */}
        <div className="card p-4 md:p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900">請求書テンプレート連携</h2>
              <p className="text-xs text-slate-500">請求書テンプレートのスプレッドシート設定</p>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-xs leading-relaxed text-slate-500">
              雛形の作り方、差し込み文字、PDFの注意点は説明ページにまとめています。
              {onNavigate && (
                <button type="button" onClick={() => onNavigate('invoice_help')} className="ml-1 font-medium text-teal-700 hover:underline">
                  請求書の作り方を見る
                </button>
              )}
            </p>
            {serviceAccountEmail ? (
              <p className="break-all text-xs text-slate-600">
                テンプレートは次のサービスアカウントに共有してください（閲覧者で足ります）。
                <span className="mt-1 block font-medium text-slate-800">{serviceAccountEmail}</span>
              </p>
            ) : (
              <p className="text-xs text-amber-700">サービスアカウントを表示できません。.env の接続設定を確認してください。</p>
            )}

            <FormField label="外税テンプレートURL">
              <div className="relative">
                <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="url"
                  value={form.invoice_template_ext_tax_url}
                  onChange={(e) => setForm({ ...form, invoice_template_ext_tax_url: e.target.value })}
                  className={`${inputClass} pl-10`}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                />
              </div>
            </FormField>

            <FormField label="内税テンプレートURL">
              <div className="relative">
                <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="url"
                  value={form.invoice_template_int_tax_url}
                  onChange={(e) => setForm({ ...form, invoice_template_int_tax_url: e.target.value })}
                  className={`${inputClass} pl-10`}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                />
              </div>
            </FormField>

            <FormField label="外税（非課税あり）テンプレートURL">
              <div className="relative">
                <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="url"
                  value={form.invoice_template_ext_nontax_url}
                  onChange={(e) => setForm({ ...form, invoice_template_ext_nontax_url: e.target.value })}
                  className={`${inputClass} pl-10`}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                />
              </div>
              <p className="mt-1 text-xs text-slate-500">
                交通費など非課税明細を含む外税請求書用。{'{{非課税額}}'} などを置いたレイアウトを登録します。
              </p>
            </FormField>

            <div className="rounded-lg border border-slate-100 p-3">
              <p className="mb-3 text-xs font-medium text-slate-600">16行以上用（請求書＋明細書）</p>
              <div className="space-y-3">
                <FormField label="16行以上用（外税）URL">
                  <div className="relative">
                    <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="url"
                      value={form.invoice_template_detail_ext_tax_url}
                      onChange={(e) => setForm({ ...form, invoice_template_detail_ext_tax_url: e.target.value })}
                      className={`${inputClass} pl-10`}
                      placeholder="https://docs.google.com/spreadsheets/d/..."
                    />
                  </div>
                </FormField>

                <FormField label="16行以上用（内税）URL">
                  <div className="relative">
                    <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="url"
                      value={form.invoice_template_detail_int_tax_url}
                      onChange={(e) => setForm({ ...form, invoice_template_detail_int_tax_url: e.target.value })}
                      className={`${inputClass} pl-10`}
                      placeholder="https://docs.google.com/spreadsheets/d/..."
                    />
                  </div>
                </FormField>

                <FormField label="16行以上用（外税・非課税あり）URL">
                  <div className="relative">
                    <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="url"
                      value={form.invoice_template_detail_ext_nontax_url}
                      onChange={(e) => setForm({ ...form, invoice_template_detail_ext_nontax_url: e.target.value })}
                      className={`${inputClass} pl-10`}
                      placeholder="https://docs.google.com/spreadsheets/d/..."
                    />
                  </div>
                </FormField>
              </div>
            </div>

            <FormField label="PDFの保存先フォルダURL">
              <div className="relative">
                <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="url"
                  value={form.invoice_pdf_drive_folder_url}
                  onChange={(e) => setForm({ ...form, invoice_pdf_drive_folder_url: e.target.value })}
                  className={`${inputClass} pl-10`}
                  placeholder="https://drive.google.com/drive/folders/..."
                />
              </div>
              <p className="mt-2 text-xs text-slate-500">作成した請求書PDFの保存先です。フォルダの共有方法は説明ページを見てください。</p>
            </FormField>
          </div>
        </div>

        <div className="card p-4 md:p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900">Gmail下書き作成</h2>
              <p className="text-xs text-slate-500">請求書PDFの出力完了時に、送信元アカウントの下書きを自動作成します</p>
            </div>
          </div>
          <div className="space-y-4">
            <p className="text-xs leading-relaxed text-slate-600">
              Google Cloud で Gmail API を有効にし、サービスアカウントへドメイン全体の委任（gmail.compose と gmail.settings.basic）を設定してください。下書きはここに入れた送信元ユーザーとして作成します。
            </p>
            <FormField label="送信元メールアドレス（Gmail用）">
              <input
                type="email"
                value={form.gmail_sender_email}
                onChange={(e) => setForm({ ...form, gmail_sender_email: e.target.value })}
                className={inputClass}
                placeholder="you@example.com"
              />
              <p className="mt-2 text-xs text-slate-500">Workspace の送信元ユーザーです。未入力のときはPDF出力後に下書きを作れません。</p>
            </FormField>
          </div>
        </div>

        {/* Save button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary"
          >
            {saving ? (
              '保存中...'
            ) : saved ? (
              <>
                <Check className="h-4 w-4" />
                保存しました
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                保存
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
