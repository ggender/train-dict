import { routes } from '../../lib/api.js';
import { AppError } from '../../lib/claude.js';
import * as store from '../../lib/store.js';

/** Холодный старт функции — как запуск server.js: состояние читаем один раз. */
await store.load();

const json = (status, payload) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

async function readBody(req) {
  const text = await req.text();
  if (text.length > 1e6) throw new AppError('Слишком большой запрос.', 413);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('Тело запроса — не JSON.', 400);
  }
}

export default async (req) => {
  const { pathname } = new URL(req.url);

  const handler = routes[`${req.method} ${pathname}`];
  if (!handler) return json(404, { error: 'Нет такой ручки.' });

  try {
    const body = req.method === 'POST' ? await readBody(req) : null;
    return json(200, await handler(body));
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    if (status >= 500) console.error('[api]', pathname, err);
    return json(status, {
      error: err instanceof AppError ? err.message : 'Что-то сломалось на сервере.',
    });
  }
};

export const config = { path: '/api/*' };
