import { freshCard, isDue, isNew, NEW_PER_DAY, State } from './scheduler.js';

/**
 * Карточку, с которой человек не справился, FSRS возвращает через минуты.
 * Ждать их молча — значит выгонять человека с фразой «приходи через 5 минут».
 * Поэтому такие карточки дотягиваем до конца текущего захода: сроки на дни
 * по-прежнему считает FSRS, а этот запас — только про «здесь и сейчас».
 */
const SAME_SESSION_WINDOW_MS = 20 * 60_000;

const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const startOfTomorrow = (now) => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d;
};

/**
 * Из набора слов получаются карточки двух видов.
 * Сначала идут все «закончи фразу», потом все «скажи то же другими словами»:
 * так человек сперва встречает слово в готовой фразе, а вспоминать его
 * с нуля начинает на следующий день.
 */
export function buildCards(items, now = new Date()) {
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
    fsrs: freshCard(now),
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

/** Что человеку показывать прямо сейчас и когда прийти в следующий раз. */
export function queue(state, now = new Date()) {
  const introducedToday = state.cards.filter(
    (c) => c.firstSeenAt && sameDay(new Date(c.firstSeenAt), now),
  ).length;
  const allowance = Math.max(0, NEW_PER_DAY - introducedToday);

  const started = state.cards
    .filter((c) => !isNew(c.fsrs) && isDue(c.fsrs, now))
    .sort((a, b) => new Date(a.fsrs.due) - new Date(b.fsrs.due));

  const untouched = state.cards.filter((c) => isNew(c.fsrs));
  const fresh = untouched.slice(0, allowance);

  // Недавние провалы — в самый конец захода, чтобы между показами прошли другие карточки.
  const horizon = now.getTime() + SAME_SESSION_WINDOW_MS;
  const retry = state.cards
    .filter(
      (c) =>
        (c.fsrs.state === State.Learning || c.fsrs.state === State.Relearning) &&
        !isDue(c.fsrs, now) &&
        new Date(c.fsrs.due).getTime() <= horizon,
    )
    .sort((a, b) => new Date(a.fsrs.due) - new Date(b.fsrs.due));

  const due = [...started, ...fresh, ...retry];
  if (due.length > 0) return { card: due[0], remaining: due.length, nextDueAt: null };

  const upcoming = state.cards.filter((c) => !isNew(c.fsrs)).map((c) => new Date(c.fsrs.due));
  if (untouched.length > 0) upcoming.push(startOfTomorrow(now));

  const nextDueAt = upcoming.length ? new Date(Math.min(...upcoming)) : null;
  return { card: null, remaining: 0, nextDueAt: nextDueAt ? nextDueAt.toISOString() : null };
}

export function progress(state) {
  const total = state.cards.length;
  const touched = state.cards.filter((c) => c.firstSeenAt).length;
  return { total, touched, words: state.words.length };
}
