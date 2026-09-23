import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import type { PageKey } from '@/components/Layout';
import { INVOICE_PLACEHOLDERS } from '@/types';

type Props = {
  onNavigate: (page: PageKey) => void;
};

export function InvoiceHelpPage({ onNavigate }: Props) {
  const [serviceAccountEmail, setServiceAccountEmail] = useState('');

  useEffect(() => {
    fetch('/api/health')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { serviceAccountEmail?: string } | null) => {
        setServiceAccountEmail(data?.serviceAccountEmail || '');
      })
      .catch(() => setServiceAccountEmail(''));
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="page-title">請求書連携</h1>
        <p className="mt-1 text-sm text-slate-500">請求書テンプレートの作り方と、アプリへの登録方法をまとめています</p>
      </div>

      <div className="space-y-6">
        <section className="card p-4 md:p-6">
          <h2 className="text-base font-semibold text-slate-900">雛形の用意</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
            <li>Googleスプレッドシートで雛形を作ります。税区分ごとに「外税」「内税」、さらに非課税明細を含む外税用を用意します。明細が15行以内用と、16行以上用（請求書＋明細書の2シート）を分けてください。</li>
            <li>金額・単価・小計・税額・合計・非課税額はアプリが「￥」付き文字列で差し込みます。テンプレ側のセルは文字列（通貨書式なし）にし、セル内に固定の￥は置かないでください。消費税率は「10%」のように％付きで差し込まれます。</li>
            <li>15行以内用は請求書シートだけです。明細の5つは15行連続で置き、{'{{小計}}'} はその下に置きます。行は増やしません。</li>
            <li>16行以上用は1つのスプレッドシートに2シート（1:請求書、2:明細書）を置きます。請求書側の明細は15行固定（先頭に「別紙明細書のとおり」）、明細書側は30行固定です。行は増やしません。</li>
            <li>
              各テンプレートを、データ用と同じサービスアカウントに共有します（閲覧者で足ります）。
              {serviceAccountEmail ? (
                <span className="mt-1 block break-all font-medium text-slate-800">{serviceAccountEmail}</span>
              ) : (
                <span className="mt-1 block text-amber-700">サービスアカウントを表示できません。.env の接続設定を確認してください。</span>
              )}
            </li>
            <li>スプレッドシートのURLを、設定の使う雛形の欄に貼って保存します。データ用と同じサービスアカウントで読みます。</li>
          </ol>
        </section>

        <section className="card p-4 md:p-6">
          <h2 className="text-base font-semibold text-slate-900">PDFの出力</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700">
            <li>請求書PDFはA4の1ページに収まるよう縮小します。余白の数字は書き出し時に上書きしません。</li>
            <li>出力中はデータ用スプレッドシートに一時シートを作り、他のシートが一瞬非表示になります。終わると戻して消します。</li>
            <li>失敗した場合は Google Cloud で Drive API を有効にしてください。</li>
            <li>設定に保存先フォルダURLを入れると、作成したPDFをGoogleドライブに保存します（端末へのダウンロードはしません）。</li>
            <li>
              フォルダはサービスアカウント
              {serviceAccountEmail ? `（${serviceAccountEmail}）` : ''}
              に編集者として共有してください。通常のマイドライブだと保存に失敗することがあるため、共有ドライブ（Shared Drive）のフォルダを推奨します。
            </li>
            <li>同じファイル名がある場合は、上書き・キャンセル・ファイル名変更を選べます。</li>
            <li>
              一覧・プレビューから「PDF作成」「メール作成」「PDF作成 + メール下書き」を選べます。メール作成はPDFを添付したGmail下書きのみ作ります。
            </li>
          </ul>
        </section>

        <section className="card p-4 md:p-6">
          <h2 className="text-base font-semibold text-slate-900">非課税あり（外税）</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">
            交通費など非課税明細を含む外税請求書は、通常の外税テンプレートとは別URLを設定します。合計欄に{'{{課税小計}}'}・{'{{非課税額}}'}・{'{{消費税額}}'}・{'{{合計金額}}'}を置き、明細の金額は非課税行が{'￥…(※)'}形式になります。テンプレート側に「※は消費税非課税」などの注記を置くと分かりやすいです。
          </p>
        </section>

        <section className="card p-4 md:p-6">
          <h2 className="text-base font-semibold text-slate-900">16行以上用（請求書＋明細書）</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">
            明細が16行以上のときだけ使います。通常の15行以内テンプレートは使いません。1つのスプレッドシートに「請求書」「明細書」の2シートを置き、そのURLを設定に登録してください。明細書の明細欄は30行固定で、行は増やしません。
          </p>
        </section>

        <section className="card p-4 md:p-6">
          <h2 className="text-base font-semibold text-slate-900">請求書の項目</h2>
          <p className="mt-2 text-sm text-slate-600">雛形のセルに、次の差し込み文字を置きます。</p>
          <div className="mt-3 grid gap-1 sm:grid-cols-2">
            {INVOICE_PLACEHOLDERS.filter((item) => !item.note.startsWith('明細行')).map((item) => (
              <p key={item.token} className="text-sm text-slate-700">
                <span className="text-slate-500">{item.label}</span>{' '}
                <code className="font-medium text-slate-800">{item.token}</code>
                {item.note ? <span className="ml-1 text-xs text-slate-500">{item.note}</span> : null}
              </p>
            ))}
          </div>
          <p className="mb-2 mt-5 text-sm font-medium text-slate-800">明細行（請求書は15行固定）</p>
          <div className="grid gap-1 sm:grid-cols-2">
            {INVOICE_PLACEHOLDERS.filter((item) => item.note.startsWith('明細行')).map((item) => (
              <p key={item.token} className="text-sm text-slate-700">
                <span className="text-slate-500">{item.label}</span>{' '}
                <code className="font-medium text-slate-800">{item.token}</code>
              </p>
            ))}
          </div>
          <button type="button" onClick={() => onNavigate('settings')} className="btn-secondary mt-5">
            <FileText className="h-4 w-4" />
            テンプレートURLの設定へ
          </button>
        </section>
      </div>
    </div>
  );
}
