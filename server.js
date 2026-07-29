import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AppError } from './lib/claude.js';
import { clarifyGoal, proposeWords } from './lib/prompts.js';
import { grade } from './lib/scheduler.js';
import { buildCards, progress, queue } from './lib/session.js';
import * as store from './lib/store.js';

const PORT = Number(process.env.PORT) || 5173;
const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'public');

// ------------------------------------------------------------------ ответы

/**
 * Подбор идёт прямо сейчас. Держим отдельно от сохраняемого состояния: перезагруженная
 * страница и второе окно должны это видеть, а перезапуск сервиса — забыть вместе с вызовом.
 */
let picking = false;

/**
 * Лишний заход: человек решил пройти уже пройденные слова, не дожидаясь срока.
 * Очередь такого захода — `{ ids }`, первый в списке и есть карточка перед человеком.
 * Держим в памяти, как и подбор: это про «здесь и сейчас», а не про ход, который надо
 * помнить между заходами. Сроки повторений этот заход не двигает — их считает FSRS.
 */
let extra = null;

const snapshot = (state) => ({
  stage: state.stage,
  picking,
  goal: {
    messages: state.goal.messages,
    missing: state.goal.missing,
    brief: state.goal.brief,
  },
  proposal: state.proposal,
  progress: progress(state),
});

const studyView = (state) => {
  if (extra) {
    const card = state.cards.find((c) => c.id === extra.ids[0]);
    return { card, remaining: extra.ids.length, nextDueAt: null, extra: true, progress: progress(state) };
  }
  const { card, remaining, nextDueAt } = queue(state);
  return { card, remaining, nextDueAt, extra: false, progress: progress(state) };
};

/** Пройденные карточки — те, что человек уже видел. Новые лишний заход не открывает. */
const passedCards = (state) => state.cards.filter((c) => c.firstSeenAt);

// ----------------------------------------------------------------- ручки

const routes = {
  'GET /api/state': async () => snapshot(store.get()),

  'POST /api/goal': async (body) => {
    const text = String(body?.text ?? '').trim();
    if (!text) throw new AppError('Пустое сообщение.', 400);

    const state = store.get();
    if (state.stage !== 'goal') throw new AppError('Задача уже принята.', 409);

    state.goal.messages.push({ role: 'user', content: text });
    let answer;
    try {
      answer = await clarifyGoal(state.goal.messages);
    } catch (err) {
      state.goal.messages.pop(); // не оставляем реплику без ответа
      throw err;
    }

    state.goal.messages.push({ role: 'assistant', content: answer.reply });
    state.goal.missing = answer.ready ? [] : answer.missing;
    state.goal.brief = answer.ready ? answer.brief : null;
    if (answer.ready) state.stage = 'proposal';

    await store.save();
    return snapshot(state);
  },

  'POST /api/words': async () => {
    const state = store.get();
    if (!state.goal.brief) throw new AppError('Задача ещё не определена.', 409);
    // Забытое окно на экране набора не должно собирать новый поверх начатой тренировки.
    if (state.stage === 'study') throw new AppError('Набор уже взят — идёт тренировка по нему.', 409);
    if (picking) throw new AppError('Подбор уже идёт — вот-вот покажу набор.', 409);

    picking = true;
    try {
      const { items } = await proposeWords(state.goal.brief);
      if (!Array.isArray(items) || items.length === 0) {
        throw new AppError('Не удалось подобрать слова. Попробуй ещё раз.', 502);
      }

      state.proposal = { items, createdAt: new Date().toISOString() };
      state.stage = 'proposal';
      await store.save();
    } finally {
      picking = false;
    }
    return snapshot(state);
  },

  'POST /api/words/confirm': async () => {
    const state = store.get();
    if (state.stage === 'study') {
      throw new AppError('Этот набор уже не актуален — ты занимаешься по другому.', 409);
    }
    if (!state.proposal) throw new AppError('Нечего подтверждать.', 409);

    const { words, cards } = buildCards(state.proposal.items);
    state.words = words;
    state.cards = cards;
    state.proposal = null;
    state.stage = 'study';
    extra = null; // карточек прежнего набора больше нет
    await store.save();
    return studyView(state);
  },

  'GET /api/study': async () => {
    const state = store.get();
    if (state.stage !== 'study') throw new AppError('Набор ещё не подтверждён.', 409);
    return studyView(state);
  },

  /**
   * Человек хочет пройти слова ещё раз, не дожидаясь следующего дня.
   * Даём ему то, что он уже проходил, отдельной очередью поверх расписания.
   */
  'POST /api/study/again': async () => {
    const state = store.get();
    if (state.stage !== 'study') throw new AppError('Набор ещё не подтверждён.', 409);
    // Заход уже идёт или по расписанию и так есть что показать — лишний не нужен.
    if (extra || queue(state).card) return studyView(state);

    const passed = passedCards(state);
    if (passed.length === 0) throw new AppError('Проходить пока нечего.', 409);

    extra = { ids: passed.map((c) => c.id) };
    return studyView(state);
  },

  'POST /api/study/again/stop': async () => {
    extra = null;
    return studyView(store.get());
  },

  'POST /api/study/answer': async (body) => {
    const state = store.get();
    const card = state.cards.find((c) => c.id === body?.id);
    if (!card) throw new AppError('Карточка не найдена.', 404);

    // Лишний заход человек затеял сам, сверх расписания: сроки повторений он не двигает,
    // и пройденное по нему не считается. Провал возвращается в конец этого же захода.
    if (extra) {
      if (extra.ids[0] !== card.id) return studyView(state); // эту карточку уже оценили
      extra.ids.shift();
      if (body.ok !== true) extra.ids.push(card.id);
      if (extra.ids.length === 0) extra = null;
      return studyView(state);
    }

    // Оценка приходит с номером показа, который человек видел. Если карточку уже оценили —
    // вторым нажатием или из другого окна, — номер устарел, и второй раз она не считается.
    if (typeof body.reps === 'number' && body.reps !== card.reps) return studyView(state);

    const ok = body.ok === true;
    const now = new Date();
    card.fsrs = grade(card.fsrs, ok, now);
    card.firstSeenAt ??= now.toISOString();
    card.reps += 1;
    if (!ok) card.fails += 1;

    await store.save();
    return studyView(state);
  },

  'POST /api/reset': async () => {
    extra = null;
    return snapshot(await store.reset());
  },
};

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
