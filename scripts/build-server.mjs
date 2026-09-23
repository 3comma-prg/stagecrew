import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  absWorkingDir: root,
  entryPoints: ['server/prod.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist-server/index.mjs',
  packages: 'external',
  logLevel: 'info',
  target: 'node20',
});

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

mkdirSync(join(root, 'dist-server'), { recursive: true });
copyFileSync(join(root, 'defaults', 'app-settings.json'), join(root, 'dist-server', 'app-settings.default.json'));
