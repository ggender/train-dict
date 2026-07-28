import { WORDS_SET_A } from '../test-harness/fixtures.js';
import { markReviewed, minutes, studyState } from '../test-harness/state.js';
import { currentPrompt, expect, grade, open, openStudy, test } from './support.js';

// specs/study.md — Тренировка

const FIRST_WORD = WORDS_SET_A.items[0];
const DAY = minutes(60) * 24;

test('первый день: сначала карточки «закончи фразу», видно тип задания и остаток [3.2, 3.6]', async ({
  page,
  app,
}) => {
  await openStudy(page, app, studyState());

  await expect(page.locator('#card-kind')).toHaveText('Закончи фразу');
  await expect(page.locator('#card-counter')).toHaveText('осталось 12');
  await expect(page.locator('#card-prompt')).toHaveText(FIRST_WORD.example_gap);
});

test('карточка открылась: видно только задание, ответа на экране нет [3.4]', async ({ page, app }) => {
  await openStudy(page, app, studyState());

  await expect(page.locator('#card-prompt')).toBeVisible();
  await expect(page.locator('#card-answer')).toBeHidden();
  await expect(page.locator('#btn-reveal')).toBeVisible();
  await expect(page.locator('#grade-row')).toBeHidden();
});

test('человек попросил ответ: видит фразу целиком, само слово и его смысл [3.5]', async ({
  page,
  app,
}) => {
  await openStudy(page, app, studyState());

  await page.locator('#btn-reveal').click();

  await expect(page.locator('#card-answer')).toBeVisible();
  await expect(page.locator('#answer-phrase')).toHaveText(FIRST_WORD.example);
  await expect(page.locator('#answer-word')).toHaveText(FIRST_WORD.word);
  await expect(page.locator('#answer-meaning')).toHaveText(FIRST_WORD.meaning);
});

test('система не просит ничего вводить и ничего не сверяет — только две оценки [3.7]', async ({
  page,
  app,
}) => {
  await openStudy(page, app, studyState());
  await page.locator('#btn-reveal').click();

  await expect(page.locator('#screen-study input, #screen-study textarea')).toHaveCount(0);
  await expect(page.locator('#grade-row button')).toHaveCount(2);
  await expect(page.locator('#btn-fail')).toHaveText('Не справился');
  await expect(page.locator('#btn-ok')).toHaveText('Справился');
});

test('справился: система переходит к следующей карточке [3.8]', async ({ page, app }) => {
  await openStudy(page, app, studyState());
  const first = await currentPrompt(page);

  await grade(page, true);

  expect(await currentPrompt(page)).not.toBe(first);
  await expect(page.locator('#card-counter')).toHaveText('осталось 11');
  await expect(page.locator('#card-answer')).toBeHidden();
});

test('не справился: карточка возвращается в этом же заходе, но не следующей [3.9, 4.2]', async ({
  page,
  app,
}) => {
  await openStudy(page, app, studyState());
  const failed = await currentPrompt(page);

  await grade(page, false);

  const next = await currentPrompt(page);
  expect(next, 'провал не должен возвращаться сразу же').not.toBe(failed);

  let cardsBetween = 1;
  let returned = false;
  for (let i = 0; i < 15; i += 1) {
    if ((await currentPrompt(page)) === failed) {
      returned = true;
      break;
    }
    await grade(page, true);
    cardsBetween += 1;
  }

  expect(returned, 'провал должен вернуться в этом же заходе').toBe(true);
  expect(cardsBetween, 'между показами должны пройти другие карточки').toBeGreaterThan(1);
});

test('пробел на карточке с закрытым ответом открывает ответ [3.10]', async ({ page, app }) => {
  await openStudy(page, app, studyState());

  await page.keyboard.press('Space');

  await expect(page.locator('#card-answer')).toBeVisible();
  await expect(page.locator('#grade-row')).toBeVisible();
});

test('«1» и «2» ставят оценку «не справился» и «справился» [3.11]', async ({ page, app }) => {
  await openStudy(page, app, studyState());

  // «1» — не справился: карточка остаётся в заходе, счёт не уменьшается
  await page.keyboard.press('Space');
  await page.keyboard.press('1');
  await expect(page.locator('#busy')).toBeHidden();
  await expect(page.locator('#card-counter')).toHaveText('осталось 12');

  // «2» — справился: карточка уходит из захода
  await page.keyboard.press('Space');
  await page.keyboard.press('2');
  await expect(page.locator('#busy')).toBeHidden();
  await expect(page.locator('#card-counter')).toHaveText('осталось 11');
});

test('нажал оценку несколько раз подряд: карточка получает одну оценку [3.12]', async ({
  page,
  app,
}) => {
  await openStudy(page, app, studyState());

  const sent = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/study/answer')) sent.push(r.postData());
  });
  // ответ приходит не мгновенно — как на телефоне со слабой связью
  await page.route('**/api/study/answer', async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });

  const first = await currentPrompt(page);
  await page.keyboard.press('Space');
  await page.keyboard.press('2');
  await page.keyboard.press('2');
  await page.keyboard.press('2');
  await expect(page.locator('#busy')).toBeHidden();

  expect(sent, 'три нажатия — одна оценка').toHaveLength(1);
  expect(await currentPrompt(page), 'человек продвинулся на одну карточку').not.toBe(first);
  await expect(page.locator('#card-counter')).toHaveText('осталось 11');
});

test('ту же карточку оценили из другого окна: оценка не удваивается [3.13]', async ({
  page,
  app,
  context,
}) => {
  const state = studyState({
    arrange: (cards) => {
      // на сегодня оставляем ровно одну карточку: по ней и видно, уехал ли срок
      cards.slice(1).forEach((card) => markReviewed(card, { dueMs: 3 * DAY, seenMs: -25 * 60 * 60_000 }));
    },
  });
  await openStudy(page, app, state);

  const forgotten = await context.newPage();
  await open(forgotten, app);
  await expect(forgotten.locator('#card-prompt')).toHaveText(await currentPrompt(page));

  await grade(page, true);
  await expect(page.locator('#screen-done')).toBeVisible();
  const scheduled = await (await page.request.get(`${app.url}/api/study`)).json();

  await grade(forgotten, true); // та же карточка, второе окно

  const after = await (await page.request.get(`${app.url}/api/study`)).json();
  expect(after.nextDueAt, 'вторая оценка не должна сдвигать срок').toBe(scheduled.nextDueAt);
  await expect(forgotten.locator('#screen-done'), 'окно показывает, что на сегодня всё').toBeVisible();
});
