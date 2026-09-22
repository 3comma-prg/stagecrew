# Stagecrew（舞台照明 業務管理）

Googleスプレッドシートをデータベースにした、スケジュール・請求書の業務管理アプリです。設定と表示名はサーバーに保存し、PCとスマホで同じ内容を使います。

## 必要なもの

- Node.js 20 以降、または Docker Desktop
- Google サービスアカウント（Sheets / Drive / Calendar / Gmail）
- データ用スプレッドシート（空のファイルを用意し、サービスアカウントに編集者で共有）

`.env.example` を `.env` にコピーし、サービスアカウントを入れてください。`GOOGLE_PRIVATE_KEY` の改行は `\n` のままで構いません。

### Gmail 下書き作成（任意）

請求書の「メール作成」「PDF作成 + メール下書き」を使う場合:

1. Google Cloud で **Gmail API** を有効にする
2. サービスアカウントにドメイン全体の委任（Domain-Wide Delegation）を設定する  
   - `https://www.googleapis.com/auth/gmail.compose`  
   - `https://www.googleapis.com/auth/gmail.settings.basic`
3. アプリの設定画面で「送信元メールアドレス（Gmail用）」を保存する

## Docker で起動（試験運用向け）

PC 上でソースからビルドする場合:

```bash
docker compose -f docker-compose.build.yml up --build
```

ブラウザで [http://localhost:5173](http://localhost:5173) を開きます。設定の URL や ID は `defaults/app-settings.json` を初期値として `data/app-settings.json` に保存し、PC とスマホで同じ内容を使います。止めるときは `Ctrl+C`、または:

```bash
docker compose -f docker-compose.build.yml down
```

データを含めて消す場合は `data/app-settings.json` を削除します。初期値は次の起動時に `defaults/app-settings.json` から入り直します。

## UGREEN NAS（yaml + data だけ。他の Docker アプリと同じ）

NAS にはソースコードを置きません。置くのは次だけです。

```
stagecrew/
  docker-compose.yml
  .env
  data/          ← 他アプリの db フォルダに相当（設定の永続化）
```

`docker-compose.yml` の `image:` が、Docker Hub / GHCR 上の完成イメージを指します。UGREEN の「アップデート / Redeploy + Pull latest image」は、このイメージを取り直してコンテナを作り直します。`data/` と `.env` はそのまま残ります。

### 初回（PC）

1. Docker Hub アカウントを作る（または GitHub の GHCR を使う）
2. イメージをビルドして push する

```bash
docker login
docker build -t yourname/stagecrew:latest .
docker push yourname/stagecrew:latest
```

GitHub にこのリポジトリを push している場合は、`.github/workflows/docker-publish.yml` が `ghcr.io/<owner>/<repo>:latest` に自動公開します。パッケージを Private にした場合は、NAS 側で GHCR にログインする必要があります。公開（Public）なら pull だけできます。

### 初回（NAS）

1. Docker 用フォルダに `docker-compose.yml` と `.env` と空の `data` フォルダを置く
2. `docker-compose.yml` の `image:` を `yourname/stagecrew:latest`（または `ghcr.io/owner/repo:latest`）にする
3. UGREEN Docker → プロジェクト作成 → そのフォルダを指定してデプロイ

ソース・Dockerfile・プロジェクトの作り直しは不要です。

### 更新（以降）

1. PC で新しいイメージを push する（上と同じ `docker build` / `docker push`、または GitHub への push）
2. UGREEN Docker → 該当プロジェクト → Compose 設定 → **Redeploy** → **Pull latest image** にチェックして Deploy

ファイルの全削除や、コンテナ／イメージ／プロジェクトの削除はしません。

JSON ファイルをパス指定する場合は、`docker-compose.yml` でファイルをマウントしてください。

```yaml
volumes:
  - ./service-account.json:/app/service-account.json:ro
```

`.env` 側は `GOOGLE_SERVICE_ACCOUNT_JSON=/app/service-account.json` にします。

## ローカルで開発起動

```bash
npm install
npm run dev
```

[http://localhost:5173](http://localhost:5173) を開きます。

## ローカルで本番相当の起動

```bash
npm run build
npm start
```

初回は設定画面で、空のスプレッドシート URL を貼り **新規作成** を押してシートと項目名を作ります。

## NAS に置くファイル

| 種別 | 内容 |
|------|------|
| 起動 | `docker-compose.yml` |
| 環境 | `.env`（`.env.example` をコピー。Google 認証） |
| データ | `data/`（空で可。起動後に `app-settings.json` ができます） |

ソース一式を NAS に置く必要はありません。イメージのビルドは PC または GitHub Actions で行います。
