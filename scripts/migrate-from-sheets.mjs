/**
 * 既存の Google スプレッドシート → SQLite 初回移行（冪等 upsert）
 *
 * 使い方:
 *   npm run migrate:from-sheets
 *   npm run migrate:from-sheets -- "https://docs.google.com/spreadsheets/d/xxxxx/edit"
 *
 * Docker（data ボリュームをマウントした状態）:
 *   docker compose run --rm app node dist-server/migrate.mjs
 *   # またはイメージ内で npm run migrate:from-sheets
 *
 * バックアップ: data/stagecrew.sqlite（および -wal/-shm があればそれら）をコピーしてください。
 */
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = join(root, 'dist-server', 'migrate.mjs');

await build({
  absWorkingDir: root,
  entryPoints: ['server/migrate-cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist-server/migrate.mjs',
  packages: 'external',
  logLevel: 'info',
  target: 'node20',
});

const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [outfile, ...args], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
process.exit(result.status ?? 1);
