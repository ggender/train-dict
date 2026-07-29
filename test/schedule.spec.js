import { WORDS_SET_A } from '../test-harness/fixtures.js';
import { emptyStudyState, markReviewed, minutes, studyState } from '../test-harness/state.js';
import { currentPrompt, expect, grade, open, openDone, openStudy, test } from './support.js';

// specs/schedule.md — Расписание повторений

const HOUR = minutes(60);
const DAY = HOUR * 24;

test('заход из двенадцати карточек: «на сегодня всё», «приходи завтра», видно пройденное [3.1, 4.3, 4.6, 4.7, 5.6]', async ({
  page,
  app,
}) => {
  await openStudy(page, app, studyState());

  for (let i = 0; i < 12; i += 1) {
    // весь первый день — только «вставь слово в готовую фразу»
    await expect(page.locator('#card-kind')).toHaveText('Закончи фразу');
    await grade(page, true);
  }

  await expect(page.locator('#screen-done')).toBeVisible();
  await expect(page.locator('.done-title')).toHaveText('На сегодня всё');
  // «Приходи завтра» доказывает, что справился-с-первого-раза увёл сроки на дни, а не на минуты
  await expect(page.locator('#done-when')).toHaveText('Приходи завтра.');
  await expect(page.locator('#done-progress')).toHaveText('Пройдено карточек: 12 из 24');
});

test('есть и просроченное, и новое: сначала идут просроченные, по срокам [4.1]', async ({
  page,
  app,
}) => {
  const state = studyState({
    arrange: (cards) => {
      markReviewed(cards[3], { dueMs: -2 * HOUR, seenMs: -25 * HOUR });
      markReviewed(cards[5], { dueMs: -1 * HOUR, seenMs: -25 * HOUR });
    },
  });
  await openStudy(page, app, state);

  expect(await currentPrompt(page), 'первой — та, чей срок наступил раньше').toBe(
    WORDS_SET_A.items[3].example_gap,
  );
  await grade(page, true);

  expect(await currentPrompt(page)).toBe(WORDS_SET_A.items[5].example_gap);
  await grade(page, true);

  expect(await currentPrompt(page), 'новые — после просроченных').toBe(
    WORDS_SET_A.items[0].example_gap,
  );
});

test('дневная норма выбрана: новые больше не появляются, остаются только повторения [4.3]', async ({
  page,
  app,
}) => {
  const state = studyState({
    arrange: (cards) => {
      // двенадцать новых карточек человек уже увидел сегодня
      for (let i = 0; i < 12; i += 1) {
        markReviewed(cards[i], { dueMs: 2 * DAY, seenMs: -2 * HOUR });
      }
      // и одно повторение, которому подошёл срок
      markReviewed(cards[12], { dueMs: -1 * HOUR, seenMs: -25 * HOUR });
    },
  });
  await openStudy(page, app, state);

  await expect(page.locator('#card-counter'), 'только просроченное повторение').toHaveText(
    'осталось 1',
  );
  expect(await currentPrompt(page)).toBe(WORDS_SET_A.items[0].paraphrase);

  await grade(page, true);

  await expect(page.locator('#screen-done'), 'новые сегодня больше не приходят').toBeVisible();
});

test('наступил новый день: счёт новых карточек начинается заново [4.4]', async ({ page, app }) => {
  const state = studyState({
    arrange: (cards) => {
      // вчера человек прошёл дневную норму — двенадцать карточек
      for (let i = 0; i < 12; i += 1) {
        markReviewed(cards[i], { dueMs: DAY, seenMs: -25 * HOUR });
      }
    },
  });
  await openStudy(page, app, state);

  await expect(page.locator('#card-counter')).toHaveText('осталось 12');
  await expect(page.locator('#card-kind')).toHaveText('Скажи то же другими словами');
});

test('провалил последнюю карточку: она возвращается в этом же заходе [4.5]', async ({
  page,
  app,
}) => {
  await openStudy(page, app, studyState({ items: WORDS_SET_A.items.slice(0, 1) }));

  await grade(page, true);
  const last = await currentPrompt(page);
  await grade(page, false);

  await expect(page.locator('#screen-study')).toBeVisible();
  await expect(page.locator('#screen-done')).toBeHidden();
  expect(await currentPrompt(page)).toBe(last);
});

test('следующее повторение совсем скоро: экран сам обновится, без перезагрузки [4.8]', async ({
  page,
  app,
}) => {
  const state = studyState({
    arrange: (cards) => {
      cards.forEach((card) => markReviewed(card, { dueMs: 3 * DAY, seenMs: -25 * HOUR }));
      markReviewed(cards[0], { dueMs: minutes(0.1), seenMs: -25 * HOUR }); // через ~6 секунд
    },
  });
  await app.seed(state);
  await open(page, app);

  await expect(page.locator('#screen-done')).toBeVisible();
  await expect(page.locator('#done-when')).toHaveText('Приходи через минуту.');

  // страницу не трогаем — ждём, что тренажёр сам покажет карточку
  await expect(page.locator('#screen-study')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#card-prompt')).toHaveText(WORDS_SET_A.items[0].example_gap);
});

test('вернулся к оставленной открытой странице: она сама показывает подошедшее [4.10]', async ({
  page,
  app,
}) => {
  const later = (cards) =>
    cards.forEach((card) => markReviewed(card, { dueMs: 3 * DAY, seenMs: -25 * HOUR }));

  // всё повторяется через три дня: ждать этого экран сам не станет
  await app.seed(studyState({ arrange: later }));
  await open(page, app);
  await expect(page.locator('#screen-done')).toBeVisible();
  await expect(page.locator('#done-when')).toContainText('Приходи');

  // метка переживёт что угодно, кроме перезагрузки страницы
  await page.evaluate(() => (window.__открыто = true));

  // человек ушёл, а пока его не было, срок подошёл
  await app.seed(
    studyState({
      arrange: (cards) => {
        later(cards);
        markReviewed(cards[0], { dueMs: -minutes(1), seenMs: -25 * HOUR });
      },
    }),
  );

  // Вернулся к вкладке. Спрятать страницу в headless нельзя, поэтому возврат имитируем
  // тем же событием, которое в этот момент шлёт браузер.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

  await expect(page.locator('#screen-study')).toBeVisible();
  await expect(page.locator('#card-prompt')).toHaveText(WORDS_SET_A.items[0].example_gap);
  expect(await page.evaluate(() => window.__открыто), 'страницу не перезагружали').toBe(true);
});

test('повторять больше нечего: «заходи, когда захочешь» [4.9]', async ({ page, app }) => {
  await app.seed(emptyStudyState());
  await open(page, app);

  await expect(page.locator('#screen-done')).toBeVisible();
  await expect(page.locator('#done-when')).toHaveText('Заходи, когда захочешь.');
  await expect(page.locator('#done-progress')).toHaveText('Пройдено карточек: 0 из 0');
});

// --------------------------------------------- пройти ещё раз, не дожидаясь дня

/** Всё пройдено, следующее повторение — через три дня. */
const passedState = (words) =>
  studyState({
    items: WORDS_SET_A.items.slice(0, words),
    arrange: (cards) =>
      cards.forEach((card) => markReviewed(card, { dueMs: 3 * DAY, seenMs: -25 * HOUR })),
  });

test('пройти слова ещё раз: те же карточки прямо сейчас, сроки на месте [4.11, 4.12]', async ({
  page,
  app,
}) => {
  await openDone(page, app, passedState(2));
  await expect(page.locator('#done-when')).toHaveText('Приходи через 3 дня.');

  await page.locator('#btn-again').click();

  await expect(page.locator('#screen-study')).toBeVisible();
  await expect(page.locator('#card-counter'), 'все четыре пройденные карточки').toHaveText(
    'осталось 4',
  );
  expect(await currentPrompt(page)).toBe(WORDS_SET_A.items[0].example_gap);

  for (let i = 0; i < 4; i += 1) await grade(page, true);

  await expect(page.locator('#screen-done')).toBeVisible();
  await expect(page.locator('#done-when'), 'лишний заход не сдвинул сроки').toHaveText(
    'Приходи через 3 дня.',
  );
  await expect(page.locator('#done-progress')).toHaveText('Пройдено карточек: 4 из 4');
});

test('лишний заход не открывает новых слов сверх дневной нормы [4.13]', async ({ page, app }) => {
  const state = studyState({
    arrange: (cards) => {
      // сегодня человек уже прошёл дневную норму — двенадцать «закончи фразу»
      for (let i = 0; i < 12; i += 1) markReviewed(cards[i], { dueMs: 2 * DAY, seenMs: -2 * HOUR });
    },
  });
  await openDone(page, app, state);
  await expect(page.locator('#done-progress')).toHaveText('Пройдено карточек: 12 из 24');

  await page.locator('#btn-again').click();

  await expect(page.locator('#card-counter'), 'только уже виденные').toHaveText('осталось 12');
  for (let i = 0; i < 12; i += 1) {
    await expect(page.locator('#card-kind'), 'новых слов в лишнем заходе нет').toHaveText(
      'Закончи фразу',
    );
    await grade(page, true);
  }

  await expect(page.locator('#screen-done')).toBeVisible();
  await expect(page.locator('#done-progress'), 'новых карточек человек так и не трогал').toHaveText(
    'Пройдено карточек: 12 из 24',
  );
  await expect(page.locator('#done-when')).toHaveText('Приходи завтра.');
});

test('не справился в лишнем заходе: карточка вернётся, срок не изменится [4.14]', async ({
  page,
  app,
}) => {
  await openDone(page, app, passedState(2));
  await page.locator('#btn-again').click();
  await expect(page.locator('#screen-study')).toBeVisible();

  const failed = await currentPrompt(page);
  await grade(page, false);
  expect(await currentPrompt(page), 'провал не идёт следующим').not.toBe(failed);

  for (let i = 0; i < 3; i += 1) await grade(page, true);

  expect(await currentPrompt(page), 'провал вернулся в конце захода').toBe(failed);
  await expect(page.locator('#card-counter')).toHaveText('осталось 1');

  await grade(page, true);
  await expect(page.locator('#screen-done')).toBeVisible();
  await expect(page.locator('#done-when'), 'провал в лишнем заходе не двигает срок').toHaveText(
    'Приходи через 3 дня.',
  );
});

test('человеку хватит: возвращается к «на сегодня всё» с тем же сроком [4.15]', async ({
  page,
  app,
}) => {
  await openDone(page, app, passedState(2));
  await page.locator('#btn-again').click();
  await expect(page.locator('#screen-study')).toBeVisible();
  await grade(page, true);

  await page.locator('#btn-enough').click();

  await expect(page.locator('#screen-done')).toBeVisible();
  await expect(page.locator('#done-when')).toHaveText('Приходи через 3 дня.');
  await expect(page.locator('#done-progress')).toHaveText('Пройдено карточек: 4 из 4');
});

test('проходить ещё нечего: пройти ещё раз не предлагают [4.16]', async ({ page, app }) => {
  await openDone(page, app, emptyStudyState());

  await expect(page.locator('#btn-again')).toBeHidden();
});
