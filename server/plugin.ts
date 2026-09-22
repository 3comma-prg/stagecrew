import { loadEnv, type Plugin, type ViteDevServer } from 'vite';
import type { PreviewServer } from 'vite';
import { createSheetsApi } from './sheets';

function runtimeEnv(mode: string) {
  const fileEnv = loadEnv(mode, process.cwd(), '');
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...fileEnv })) {
    if (typeof value === 'string') env[key] = value;
  }
  return env;
}

function attach(server: ViteDevServer | PreviewServer) {
  const handler = createSheetsApi(runtimeEnv(server.config.mode));
  server.middlewares.use(handler);
}

export function sheetsApiPlugin(): Plugin {
  return {
    name: 'google-sheets-api',
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
