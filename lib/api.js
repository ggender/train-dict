import { AppError } from './claude.js';
import { clarifyGoal, proposeWords } from './prompts.js';
import { grade } from './scheduler.js';
import { buildCards, progress, queue } from './session.js';
import * as store from './store.js';

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

export const routes = {
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
