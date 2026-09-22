import { readFileSync, createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, relative, resolve, sep } from 'node:path';
import { createSheetsApi } from './sheets';

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '0.0.0.0';
const DIST = resolve(process.env.DIST_DIR || 'dist');

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function loadDotEnv(filePath: string) {
  if (!existsSync(filePath)) return;
  for (const raw of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key || process.env[key] != null) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function envRecord() {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  return env;
}

function safeFile(urlPath: string) {
  const decoded = decodeURIComponent(urlPath.split('?')[0] || '/');
  const target = resolve(DIST, `.${decoded}`);
  const rel = relative(DIST, target);
  if (!rel || rel.startsWith('..') || rel.startsWith(`..${sep}`) || rel.includes(`..${sep}`)) {
    return null;
  }
  return target;
}

function sendFile(filePath: string, res: import('node:http').ServerResponse, status = 200) {
  const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  if (type.startsWith('text/javascript')) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
  createReadStream(filePath).pipe(res);
}

loadDotEnv(resolve(process.cwd(), '.env'));

const api = createSheetsApi(envRecord());

createServer((req, res) => {
  api(req, res, () => {
    const file = safeFile(req.url || '/');
    if (file && existsSync(file) && statSync(file).isFile()) {
      sendFile(file, res);
      return;
    }
    const nestedIndex = file && existsSync(file) && statSync(file).isDirectory() ? join(file, 'index.html') : '';
    if (nestedIndex && existsSync(nestedIndex)) {
      sendFile(nestedIndex, res);
      return;
    }
    sendFile(join(DIST, 'index.html'), res);
  });
}).listen(PORT, HOST, () => {
  console.log(`Stagecrew listening on http://${HOST}:${PORT}`);
});
