import { CalendarDays, RefreshCw } from 'lucide-react';
import type { PageKey } from '@/components/Layout';

type Props = {
  onNavigate: (page: PageKey) => void;
};

export function CalendarHelpPage({ onNavigate }: Props) {
  return (
    <div>
      <div className="mb-6">
        <h1 className="page-title">カレンダー連携</h1>
        <p className="mt-1 text-sm text-slate-500">
          アプリとGoogleカレンダーのあいだで、何が同期されるかをまとめています
        </p>
      </div>

      <div className="space-y-6">
        <section className="card p-4 md:p-6">
          <h2 className="text-base font-semibold text-slate-900">はじめに</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700">
            <li>新しい予定は、アプリから登録したときだけカレンダーに追加されます。</li>
            <li>Googleカレンダー側で新しく作った予定は、アプリには入りません。</li>
            <li>カレンダー側の変更を取り込むには、左メニューまたはスケジュール画面の「カレンダーを更新」を押します。</li>
            <li>起動時と、スケジュール／プロジェクト画面を開いたときにも取り込みます。</li>
          </ul>
          <button type="button" onClick={() => onNavigate('tasks')} className="btn-secondary mt-4">
            <CalendarDays className="h-4 w-4" />
            スケジュールへ
          </button>
        </section>

        <section className="card p-4 md:p-6">
          <h2 className="text-base font-semibold text-slate-900">アプリからカレンダーへ</h2>
          <p className="mt-2 text-sm text-slate-600">スケジュールを保存すると、次の内容をカレンダーへ書き込みます。</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-4 font-medium">操作</th>
                  <th className="py-2 font-medium">カレンダー側の動き</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                <tr className="border-b border-slate-100">
                  <td className="py-2 pr-4">新規登録</td>
                  <td className="py-2">新しい予定を追加します</td>
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="py-2 pr-4">日時・種別・場所・メモの変更</td>
                  <td className="py-2">同じ予定を上書きします</td>
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="py-2 pr-4">キャンセル</td>
                  <td className="py-2">予定は残し、グレー（グラファイト）にします</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">削除</td>
                  <td className="py-2">カレンダーの予定も削除します</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="card p-4 md:p-6">
          <h2 className="text-base font-semibold text-slate-900">カレンダーからアプリへ</h2>
          <p className="mt-2 text-sm text-slate-600">
            アプリが登録した予定だけが対象です。「カレンダーを更新」を押したときに、次の条件で取り込みます。
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-4 font-medium">項目</th>
                  <th className="py-2 pr-4 font-medium">反映する条件</th>
                  <th className="py-2 font-medium">反映しない場合</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                <tr className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-4">開始日・終了日・時刻</td>
                  <td className="py-2 pr-4">請求状態が未請求のとき</td>
                  <td className="py-2">下書き・請求済・入金済。画面でどちらに合わせるか選べます</td>
                </tr>
                <tr className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-4">予定の削除</td>
                  <td className="py-2 pr-4">カレンダーで予定を消したとき</td>
                  <td className="py-2">ゴミ箱から戻しても、アプリへは復活しません</td>
                </tr>
                <tr className="align-top">
                  <td className="py-2 pr-4">タイトル・場所・色・説明</td>
                  <td className="py-2 pr-4">取り込みません</td>
                  <td className="py-2">アプリ側の内容が正です</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="card p-4 md:p-6">
          <h2 className="text-base font-semibold text-slate-900">反映できないときの選び方</h2>
          <p className="mt-2 text-sm text-slate-600">
            請求に使っているスケジュールの日時をカレンダーで変えると、自動ではアプリに入れません。次から選べます。
          </p>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
            <li>
              <span className="font-medium text-slate-900">アプリ側に合わせる</span>
              <span className="block text-slate-600">カレンダーの日時を、アプリの内容で上書きします。請求書はそのままです。</span>
            </li>
            <li>
              <span className="font-medium text-slate-900">カレンダー側に合わせる</span>
              <span className="block text-slate-600">アプリの日時だけカレンダーに合わせます。請求書の日付や金額は変わりません。</span>
            </li>
            <li>
              <span className="font-medium text-slate-900">あとで決める</span>
              <span className="block text-slate-600">今はどちらも変えません。同じ日時のままだと警告を再表示しません。</span>
            </li>
          </ol>
        </section>

        <section className="card p-4 md:p-6">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <RefreshCw className="h-4 w-4 text-teal-600" />
            更新ボタン
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">
            Googleカレンダーで日時を変えたあとは、アプリの「カレンダーを更新」を押してください。押すまで、カレンダー側の変更はアプリに入りません。
          </p>
          <button type="button" onClick={() => onNavigate('settings')} className="btn-secondary mt-4">
            カレンダーIDの設定へ
          </button>
        </section>
      </div>
    </div>
  );
}
