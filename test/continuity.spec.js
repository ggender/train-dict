import {
  CLARIFY_NEEDS_LANGUAGE,
  CLARIFY_READY,
  WORDS_SET_A,
  WORDS_SET_B,
} from '../test-harness/fixtures.js';
import { studyState } from '../test-harness/state.js';
import { expect, open, openStudy, reachProposal, sayGoal, test } from './support.js';

// specs/continuity.md — Возврат к своему набору

test('ушёл посреди разговора: виден весь прежний разговор, можно продолжить [5.1]', async ({
  page,
  app,
  stub,
}) => {
  stub.setClarify(CLARIFY_NEEDS_LANGUAGE);
  await open(page, app);
  await sayGoal(page, 'Хочу расширить словарный запас');

  await page.reload();
  await expect(page.locator('#app')).toBeVisible();

  await expect(page.locator('#thread')).toContainText('Хочу расширить словарный запас');
  await expect(page.locator('#thread')).toContainText('На каком языке тебе не хватает слов?');
  await expect(page.locator('#thread .missing')).toContainText('не хватает: язык');

  await sayGoal(page, 'Английский');
  await expect(page.locator('#thread')).toContainText('Английский');
});

test('набор подобран, но не подтверждён: виден тот же набор, можно взять или просить другой [5.2]', async ({
  page,
  app,
  stub,
}) => {
  stub.setClarify(CLARIFY_READY);
  stub.setWords(WORDS_SET_A);
  await reachProposal(page, app, stub);

  await page.reload();
  await expect(page.locator('#app')).toBeVisible();

  await expect(page.locator('#screen-proposal')).toBeVisible();
  await expect(page.locator('#proposal-list .word')).toHaveCount(12);
  await expect(page.locator('#proposal-list .word').first()).toContainText(WORDS_SET_A.items[0].word);
  await expect(page.locator('#btn-confirm')).toBeVisible();
  await expect(page.locator('#btn-regenerate')).toBeVisible();
});

test('ушёл посреди тренировки: сразу попадает на карточки [5.3]', async ({ page, app }) => {
  await openStudy(page, app, studyState());
  await page.locator('#btn-reveal').click();

  await page.reload();
  await expect(page.locator('#app')).toBeVisible();

  await expect(page.locator('#screen-study')).toBeVisible();
  await expect(page.locator('#screen-goal')).toBeHidden();
  await expect(page.locator('#card-prompt')).not.toBeEmpty();
});

test('закрыл окно сразу после оценки: при следующем заходе оценка учтена [5.4]', async ({
  page,
  app,
  context,
}) => {
  await openStudy(page, app, studyState());

  await page.locator('#btn-reveal').click();
  const saved = page.waitForResponse((r) => r.url().includes('/api/study/answer'));
  await page.locator('#btn-ok').click();
  await saved;
  await page.close();

  const next = await context.newPage();
  await open(next, app);
  await expect(next.locator('#card-counter')).toHaveText('осталось 11');
});

test('сервис прервали: после перезапуска сохранённое читается целиком [5.5]', async ({
  page,
  app,
}) => {
  await openStudy(page, app, studyState());
  const saved = page.waitForResponse((r) => r.url().includes('/api/study/answer'));
  await page.locator('#btn-reveal').click();
  await page.locator('#btn-ok').click();
  await saved;

  await app.restart();

  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#screen-study')).toBeVisible();
  await expect(page.locator('#card-counter')).toHaveText('осталось 11');
});

test('начать заново: человек попадает на пустой экран «зачем тебе слова» [5.7]', async ({
  page,
  app,
}) => {
  await openStudy(page, app, studyState());

  const res = await page.request.post(`${app.url}/api/reset`, { data: {} });
  expect(res.ok()).toBe(true);

  await page.reload();
  await expect(page.locator('#app')).toBeVisible();

  await expect(page.locator('#screen-goal')).toBeVisible();
  await expect(page.locator('#thread')).toContainText('Напиши одной фразой, зачем тебе слова');
  await expect(page.locator('#thread .msg')).toHaveCount(1);
  await expect(page.locator('#goal-ready')).toBeHidden();
});

test('в забытом окне подтверждают старый набор: карточки и история целы [5.9, 5.11]', async ({
  page,
  app,
  stub,
  context,
}) => {
  stub.setClarify(CLARIFY_READY);
  stub.setWords(WORDS_SET_A);
  await reachProposal(page, app, stub);
  const forgotten = page; // это окно человек оставил на экране с набором

  const active = await context.newPage();
  await open(active, app);
  await active.locator('#btn-confirm').click();
  await expect(active.locator('#screen-study')).toBeVisible();
  await active.locator('#btn-reveal').click();
  await active.locator('#btn-ok').click();
  await expect(active.locator('#card-counter')).toHaveText('осталось 11');

  await forgotten.locator('#btn-confirm').click();

  await expect(forgotten.locator('#screen-study'), 'окно догоняет жизнь').toBeVisible();
  await expect(forgotten.locator('#card-counter'), 'история повторений цела').toHaveText(
    'осталось 11',
  );

  await active.reload();
  await expect(active.locator('#card-counter')).toHaveText('осталось 11');
});

test('из забытого окна просят другой набор: новый поверх тренировки не собирается [5.10]', async ({
  page,
  app,
  stub,
  context,
}) => {
  stub.setClarify(CLARIFY_READY);
  stub.setWords(WORDS_SET_A);
  await reachProposal(page, app, stub);
  const forgotten = page;

  const active = await context.newPage();
  await open(active, app);
  await active.locator('#btn-confirm').click();
  await expect(active.locator('#screen-study')).toBeVisible();
  await active.locator('#btn-reveal').click();
  await active.locator('#btn-ok').click();
  await expect(active.locator('#card-counter')).toHaveText('осталось 11');
  const wordCallsBefore = stub.requestsOf('words').length;

  stub.setWords(WORDS_SET_B);
  await forgotten.locator('#btn-regenerate').click();

  await expect(forgotten.locator('#screen-study')).toBeVisible();
  await expect(forgotten.locator('#card-counter')).toHaveText('осталось 11');
  expect(stub.requestsOf('words').length, 'новый набор не собирается').toBe(wordCallsBefore);

  await active.reload();
  await expect(active.locator('#screen-study')).toBeVisible();
  await expect(active.locator('#card-prompt')).not.toContainText(WORDS_SET_B.items[0].word);
});

test('после сброса система не опирается на то, что человек говорил раньше [5.8]', async ({
  page,
  app,
  stub,
}) => {
  stub.setClarify(CLARIFY_NEEDS_LANGUAGE);
  await openStudy(page, app, studyState());
  await page.request.post(`${app.url}/api/reset`, { data: {} });
  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
  stub.reset();

  await sayGoal(page, 'Хочу читать статьи по работе');

  const [request] = stub.requestsOf('clarify');
  expect(request.messages, 'в модель уходит только новая реплика').toHaveLength(1);
  expect(JSON.stringify(request.messages)).not.toContain('партнёром');
  await expect(page.locator('#thread')).not.toContainText('партнёром');
  await expect(page.locator('#thread')).toContainText('Хочу читать статьи по работе');
});
