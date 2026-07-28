import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-opus-5';

/**
 * Сколько всего ждём модель, вместе с повторами. Человеку обещано «до минуты»,
 * тут запас на неспешный ответ. Дальше ждать нельзя: экран на это время заперт.
 */
const TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS) || 90_000;

let client = null;

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AppError(
      'Не задан ANTHROPIC_API_KEY. Добавь его в файл .env рядом с server.js и перезапусти сервер.',
      503,
    );
  }
  client ??= new Anthropic();
  return client;
}

/** Ошибка, текст которой можно показать человеку. */
export class AppError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

// Отказ модели и падение фолбэка — разные вещи, но для человека это одно:
// «не смогли ответить». Различаем их только в логе сервера.
function isFallbackRejected(err) {
  if (err?.status !== 400) return false;
  const text = JSON.stringify(err?.error ?? err?.message ?? '');
  return /fallback|beta/i.test(text);
}

// Молчание модели приходит двумя путями: свой таймаут SDK и наш обрыв по общему сроку.
const isTimedOut = (err) =>
  err instanceof Anthropic.APIConnectionTimeoutError || err instanceof Anthropic.APIUserAbortError;

/**
 * Один вызов модели со структурированным ответом по JSON-схеме.
 * Возвращает разобранный объект — парсить на месте вызова не нужно.
 */
export async function ask({ system, messages, schema, effort = 'medium', maxTokens = 8000 }) {
  const params = {
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages,
    output_config: {
      effort,
      format: { type: 'json_schema', schema },
    },
  };

  const anthropic = getClient();
  // Один срок на весь вызов: сигнал не даёт повторам растянуть ожидание втрое.
  const options = {
    timeout: TIMEOUT_MS,
    maxRetries: 1,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  };

  let response;
  try {
    try {
      // Опус 5 может отклонить запрос по правилам безопасности; fallbacks: "default"
      // перезапускает такой запрос на запасной модели внутри того же вызова.
      response = await anthropic.beta.messages.create(
        { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
        options,
      );
    } catch (err) {
      if (!isFallbackRejected(err)) throw err;
      console.warn('[claude] server-side fallback недоступен, повтор без него');
      response = await anthropic.messages.create(params, options);
    }
  } catch (err) {
    if (!isTimedOut(err)) throw err;
    console.warn('[claude] модель молчала дольше', TIMEOUT_MS, 'мс');
    throw new AppError('Модель не ответила вовремя. Попробуй ещё раз.', 504);
  }

  if (response.stop_reason === 'refusal') {
    console.warn('[claude] refusal:', response.stop_details);
    throw new AppError('Модель не стала отвечать на этот запрос. Попробуй переформулировать.', 422);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new AppError('Ответ модели не поместился в лимит. Попробуй ещё раз.', 502);
  }

  const text = response.content.find((block) => block.type === 'text')?.text;
  if (!text) throw new AppError('Модель вернула пустой ответ.', 502);

  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('Модель вернула ответ не по схеме.', 502);
  }
}
