import { ask } from './claude.js';

const WORDS_PER_SET = 12;

// ---------------------------------------------------------------- уточнение

const CLARIFY_SCHEMA = {
  type: 'object',
  properties: {
    ready: { type: 'boolean' },
    reply: { type: 'string' },
    missing: { type: 'array', items: { type: 'string' } },
    brief: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            language: { type: 'string' },
            native_language: { type: 'string' },
            situations: { type: 'array', items: { type: 'string' } },
          },
          required: ['summary', 'language', 'native_language', 'situations'],
          additionalProperties: false,
        },
      ],
    },
  },
  required: ['ready', 'reply', 'missing', 'brief'],
  additionalProperties: false,
};

const CLARIFY_SYSTEM = `Ты — часть тренажёра слов. Твоя работа на этом шаге одна: довести запрос человека до задачи, из которой можно собрать конкретный набор слов. Слова ты пока не подбираешь.

Задача считается конкретной, когда одновременно известно всё это:
1. ЯЗЫК слов. Какой язык человек хочет пополнить. Это может быть и его родной язык.
2. СИТУАЦИЯ. Где, когда и с кем он будет эти слова использовать. «В жизни», «в общении» — этого мало.
3. СМЫСЛ. Что именно он хочет уметь сказать и не может сейчас. Какого рода мысли у него не выражаются.

Пока хотя бы один пункт неизвестен — ready=false, brief=null.

Правила:
- Не додумывай за человека. Если он не назвал язык, не решай, что это английский.
- Задавай ровно ОДИН вопрос за раз — самый важный из недостающего. Не выдавай список вопросов.
- Если запрос общий («хочу выучить английский», «хочу расширить словарный запас»), прямо скажи, чего в нём не хватает, и спроси об этом.
- Если человек уже назвал ситуацию и смысл, но не язык — спроси только про язык.
- Если человек отвечает уклончиво второй раз подряд, предложи ему 2–3 конкретных варианта на выбор, чтобы было проще ответить.
- reply: 1–3 коротких предложения. Сначала чего не хватает, потом вопрос. Без приветствий, без «отличный вопрос», без похвалы.
- missing: короткие пункты, чего не хватает («язык», «ситуация»). Пусто, когда ready=true.
- Когда всё известно: ready=true, brief заполнен, reply — одна фраза, пересказывающая задачу человека его словами, чтобы он мог узнать себя и согласиться.
- summary в brief — одно предложение: что человек хочет уметь сказать, где и на каком языке.
- Отвечай на том языке, на котором пишет человек.`;

export function clarifyGoal(history) {
  return ask({
    system: CLARIFY_SYSTEM,
    messages: history,
    schema: CLARIFY_SCHEMA,
    effort: 'low',
    maxTokens: 2000,
  });
}

// ------------------------------------------------------------ подбор набора

const WORDS_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          word: { type: 'string' },
          meaning: { type: 'string' },
          example: { type: 'string' },
          example_gap: { type: 'string' },
          paraphrase: { type: 'string' },
        },
        required: ['word', 'meaning', 'example', 'example_gap', 'paraphrase'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

const WORDS_SYSTEM = `Ты подбираешь набор слов под конкретную задачу человека. Не бери слова из готовых списков и учебных тем — подбирай ровно то, чего человеку не хватает именно в его ситуации.

Правила набора:
- Ровно ${WORDS_PER_SET} позиций.
- Позиция — это слово или устойчивое выражение на целевом языке. Выражение бери, если оно точнее одиночного слова.
- Никаких синонимов-дублей: каждая позиция должна закрывать свой оттенок смысла, а не повторять соседнюю.
- Порядок: от самых нужных и частотных к более тонким и редким.
- Если целевой язык совпадает с родным, это нормально: человеку не хватает точности в своём же языке. Бери слова, которые он узнаёт, но сам не использует.

Правила полей:
- word — сама позиция, в словарной форме.
- meaning — на родном языке человека, до 8 слов, живым языком. Не словарная статья: не «сущ., книжн.», а чем этот оттенок отличается от соседних.
- example — одна живая фраза от первого лица, ровно из той ситуации, которую описал человек. Не учебное предложение. Слово должно стоять в естественной для фразы форме.
- example_gap — та же фраза, где целевое слово (в той же форме, что в example) заменено на ровно три подчёркивания ___. Остальное посимвольно совпадает с example.
- paraphrase — та же мысль, что в example, сказанная проще и другими словами. Целевого слова и однокоренных в ней быть не должно. На целевом языке. Это подсказка-задание: по ней человек должен вспомнить точное слово.

Отвечай на языках, указанных в задаче: meaning — на родном, остальное — на целевом.`;

// --------------------------------------------------------- проверка набора

/**
 * Слово выдано, если оно стоит в тексте целиком или заметной частью.
 * Однокоренные так не поймать, но самые обидные промахи — «пропуск», в котором
 * слово осталось, и подсказка, называющая ответ, — отсекаются.
 */
function leaks(word, text) {
  const haystack = text.toLowerCase();
  return word
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((part) => part.length >= 4)
    .concat(word.toLowerCase())
    .some((part) => haystack.includes(part));
}

/** Позиция годится, если из неё выйдут две честные карточки. */
function isUsable(item) {
  const fields = ['word', 'meaning', 'example', 'example_gap', 'paraphrase'];
  if (!fields.every((name) => String(item?.[name] ?? '').trim())) return false;

  const word = item.word.trim();
  if (!item.example_gap.includes('___')) return false; // прятать слово нечем
  return !leaks(word, item.example_gap) && !leaks(word, item.paraphrase);
}

export async function proposeWords(brief) {
  const task = [
    `Задача человека: ${brief.summary}`,
    `Целевой язык (язык слов): ${brief.language}`,
    `Родной язык (язык пояснений): ${brief.native_language}`,
    `Ситуации использования: ${brief.situations.join('; ')}`,
  ].join('\n');

  const { items } = await ask({
    system: WORDS_SYSTEM,
    messages: [{ role: 'user', content: task }],
    schema: WORDS_SCHEMA,
    effort: 'medium',
    maxTokens: 8000,
  });

  // Неполный или испорченный набор — это сорвавшийся подбор: показывать его нельзя,
  // человеку предложат попробовать ещё раз.
  const usable = (Array.isArray(items) ? items : []).filter(isUsable);
  if (usable.length < WORDS_PER_SET) {
    console.warn(
      `[words] набор не прошёл проверку: годных ${usable.length} из ${items?.length ?? 0}`,
    );
    return { items: [] };
  }
  return { items: usable.slice(0, WORDS_PER_SET) };
}
