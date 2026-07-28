import { createEmptyCard, State } from 'ts-fsrs';

import { BRIEF, WORDS_SET_A } from './fixtures.js';

/**
 * Заготовки сохранённого состояния.
 *
 * Часами сервера снаружи управлять нельзя, поэтому «вчера», «просрочено» и
 * «карточка вот-вот» делаются датами в самих данных, а не подкруткой времени.
 */

export const minutes = (n) => n * 60_000;
export const at = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

const serialize = (card) => ({
  ...card,
  due: card.due.toISOString(),
  last_review: card.last_review ? card.last_review.toISOString() : null,
});

/** Карточки из набора — той же раскладкой, что делает сам продукт: сначала все «закончи фразу». */
function build(items) {
  const words = items.map((item, index) => ({
    id: `w${index + 1}`,
    word: item.word,
    meaning: item.meaning,
    example: item.example,
    exampleGap: item.example_gap,
    paraphrase: item.paraphrase,
  }));

  const make = (word, type) => ({
    id: `${word.id}-${type}`,
    wordId: word.id,
    type,
    word: word.word,
    meaning: word.meaning,
    example: word.example,
    prompt: type === 'cloze' ? word.exampleGap : word.paraphrase,
    fsrs: serialize(createEmptyCard(new Date())),
    firstSeenAt: null,
    reps: 0,
    fails: 0,
  });

  const cards = [
    ...words.map((w) => make(w, 'cloze')),
    ...words.map((w) => make(w, 'paraphrase')),
  ];
  return { words, cards };
}

/** Карточку уже проходили: она в повторении и придёт в назначенный срок. */
export function markReviewed(card, { dueMs, seenMs }) {
  card.fsrs.state = State.Review;
  card.fsrs.due = at(dueMs);
  card.fsrs.last_review = at(seenMs);
  card.fsrs.reps = 1;
  card.fsrs.stability = 3;
  card.fsrs.difficulty = 5;
  card.fsrs.scheduled_days = 1;
  card.firstSeenAt = at(seenMs);
  card.reps = 1;
  return card;
}

/**
 * Состояние на шаге тренировки.
 * @param {object} [options]
 * @param {Array} [options.items] набор слов
 * @param {(cards: Array) => void} [options.arrange] как разложить карточки во времени
 */
export function studyState({ items = WORDS_SET_A.items, arrange } = {}) {
  const { words, cards } = build(items);
  if (arrange) arrange(cards);
  return {
    version: 1,
    stage: 'study',
    goal: {
      messages: [
        { role: 'user', content: 'Хочу говорить с партнёром о чувствах по-английски' },
        { role: 'assistant', content: 'Тебе не хватает английских слов о чувствах.' },
      ],
      brief: BRIEF,
      missing: [],
    },
    proposal: null,
    words,
    cards,
  };
}

/** Пустой набор: слов нет вовсе. */
export function emptyStudyState() {
  return studyState({ items: [] });
}

/** Задача уже принята, набор ещё не подбирали. */
export function goalReadyState() {
  return {
    version: 1,
    stage: 'proposal',
    goal: {
      messages: [
        { role: 'user', content: 'Хочу говорить с партнёром о чувствах по-английски' },
        { role: 'assistant', content: 'Тебе не хватает английских слов о чувствах.' },
      ],
      brief: BRIEF,
      missing: [],
    },
    proposal: null,
    words: [],
    cards: [],
  };
}

export { State };
