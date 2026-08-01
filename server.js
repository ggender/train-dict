import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { routes } from './lib/api.js';
import { AppError } from './lib/claude.js';
import * as store from './lib/store.js';

const PORT = Number(process.env.PORT) || 5173;
const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'public');

// -------------------------------------------------------------- транспорт

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1e6) throw new AppError('Слишком большой запрос.', 413);
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('Тело запроса — не JSON.', 400);
  }
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = join(PUBLIC_DIR, normalize(rel));
  if (!file.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'Нет доступа.' });

  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  } catch {
    json(res, 404, { error: 'Не найдено.' });
  }
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (!pathname.startsWith('/api/')) return serveStatic(res, pathname);

  const handler = routes[`${req.method} ${pathname}`];
  if (!handler) return json(res, 404, { error: 'Нет такой ручки.' });

  try {
    const body = req.method === 'POST' ? await readBody(req) : null;
    json(res, 200, await handler(body));
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    if (status >= 500) console.error('[api]', pathname, err);
    json(res, status, {
      error: err instanceof AppError ? err.message : 'Что-то сломалось на сервере.',
    });
  }
});

await store.load();
server.listen(PORT, () => {
  console.log(`Тренажёр слов: http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('ANTHROPIC_API_KEY не задан — подбор слов работать не будет.');
  }
});
