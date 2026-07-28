import { createServer } from 'node:http';

import { CLARIFY_NEEDS_LANGUAGE, WORDS_SET_A } from './fixtures.js';

/**
 * Подставная модель: отвечает как Anthropic API, но без сети, без ключа и без денег.
 * Приложение ходит сюда, потому что стенд подсовывает ему адрес этого сервера.
 *
 * Стенд ничего не знает о внутренностях приложения: он видит только HTTP-запросы,
 * которые приложение шлёт наружу, и отвечает на них.
 */
export async function startModelStub() {
  const state = {
    clarify: CLARIFY_NEEDS_LANGUAGE,
    words: WORDS_SET_A,
    delayMs: 0,
    failNext: 0,
    requests: [],
  };

  const readBody = async (req) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  };

  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method !== 'POST' || pathname !== '/v1/messages') {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ type: 'error', error: { message: 'нет такой ручки' } }));
    }

    const body = await readBody(req);
    const system = String(body.system ?? '');
    // Какой из двух разговоров с моделью идёт — видно по заданию, которое прислало приложение.
    const kind = system.includes('подбираешь набор слов') ? 'words' : 'clarify';
    state.requests.push({ kind, system, messages: body.messages, params: body });

    if (state.failNext > 0) {
      state.failNext -= 1;
      // 400 вместо 500: SDK не повторяет такой запрос, тест не ждёт лишнего.
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'invalid_request_error', message: 'подставная модель: отказ по сценарию теста' },
        }),
      );
    }

    if (state.delayMs > 0) await new Promise((r) => setTimeout(r, state.delayMs));

    const source = kind === 'words' ? state.words : state.clarify;
    const payload = typeof source === 'function' ? source(body) : source;

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'msg_stub',
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    /** Все запросы, которые приложение отправило модели. */
    get requests() {
      return state.requests;
    },
    requestsOf(kind) {
      return state.requests.filter((r) => r.kind === kind);
    },
    /** Что модель ответит на уточнение задачи. */
    setClarify(value) {
      state.clarify = value;
    },
    /** Что модель ответит на подбор набора. */
    setWords(value) {
      state.words = value;
    },
    /** Следующий запрос завершится ошибкой. */
    failOnce() {
      state.failNext += 1;
    },
    /** Модель отвечает медленно. */
    setDelay(ms) {
      state.delayMs = ms;
    },
    reset() {
      state.requests.length = 0;
    },
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
