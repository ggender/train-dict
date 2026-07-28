import { startApp } from '../test-harness/app.js';
import {
  CLARIFY_READY,
  WORDS_EMPTY,
  WORDS_GAP_NOT_HIDDEN,
  WORDS_HINT_LEAKS_WORD,
  WORDS_SET_A,
  WORDS_SET_B,
  WORDS_TOO_FEW,
} from '../test-harness/fixtures.js';
import { goalReadyState } from '../test-harness/state.js';
import { expect, open, reachProposal, sayGoal, test } from './support.js';

// specs/word-set.md — Набор слов под задачу

test.beforeEach(async ({ stub }) => {
  stub.setClarify(CLARIFY_READY);
  stub.setWords(WORDS_SET_A);
});

test('человек смотрит набор: видны все слова со смыслом и примером к каждому [2.6]', async ({
  page,
  app,
  stub,
}) => {
  await reachProposal(page, app, stub);

  const words = page.locator('#proposal-list .word');
  await expect(words).toHaveCount(12);

  for (let i = 0; i < 12; i += 1) {
    await expect(words.nth(i).locator('b')).not.toBeEmpty();
    await expect(words.nth(i).locator('.meaning')).not.toBeEmpty();
    await expect(words.nth(i).locator('.example')).not.toBeEmpty();
  }
  await expect(words.first()).toContainText(WORDS_SET_A.items[0].word);
});

test('набор не нравится: система подбирает новый, ничего не спрашивая заново [2.7]', async ({
  page,
  app,
  stub,
}) => {
  await reachProposal(page, app, stub);
  const clarifyCallsBefore = stub.requestsOf('clarify').length;

  stub.setWords(WORDS_SET_B);
  await page.locator('#btn-regenerate').click();
  await expect(page.locator('#busy')).toBeHidden();

  await expect(page.locator('#proposal-list .word').first()).toContainText(WORDS_SET_B.items[0].word);
  await expect(page.locator('#screen-proposal')).toBeVisible();
  expect(
    stub.requestsOf('clarify').length,
    'заново про задачу спрашивать не должны',
  ).toBe(clarifyCallsBefore);
});

test('человек взял набор: сразу начинается тренировка [2.8]', async ({ page, app, stub }) => {
  await reachProposal(page, app, stub);

  await page.locator('#btn-confirm').click();

  await expect(page.locator('#screen-study')).toBeVisible();
  await expect(page.locator('#card-prompt')).not.toBeEmpty();
});

test('идёт подбор: видно, что система занята, и сказано, что это займёт до минуты [2.9]', async ({
  page,
  app,
  stub,
}) => {
  await open(page, app);
  await sayGoal(page, 'Хочу говорить с партнёром о чувствах по-английски');

  stub.setDelay(1500);
  await page.locator('#btn-propose').click();

  await expect(page.locator('#busy')).toBeVisible();
  await expect(page.locator('#busy-note')).toContainText('займёт до минуты');
});

test('слова подобрать не удалось: система говорит об этом и оставляет человека на месте [2.10]', async ({
  page,
  app,
  stub,
}) => {
  stub.setWords(WORDS_EMPTY);
  await open(page, app);
  await sayGoal(page, 'Хочу говорить с партнёром о чувствах по-английски');

  await page.locator('#btn-propose').click();
  await expect(page.locator('#busy')).toBeHidden();

  await expect(page.locator('#toast')).toContainText('Не удалось подобрать слова');
  await expect(page.locator('#toast')).toContainText('Попробуй ещё раз');
  await expect(page.locator('#btn-propose')).toBeVisible();
});

test('сервис не настроен на работу с моделью: сказано, что именно нужно настроить [2.11]', async ({
  page,
}) => {
  const app = await startApp({ withKey: false });
  try {
    await app.seed(goalReadyState());
    await open(page, app);

    await page.locator('#btn-propose').click();
    await expect(page.locator('#busy')).toBeHidden();

    await expect(page.locator('#toast')).toContainText('ANTHROPIC_API_KEY');
    await expect(page.locator('#toast')).toContainText('.env');
  } finally {
    await app.stop();
  }
});

test('модель молчит слишком долго: ожидание обрывается, человек остаётся на месте [2.12]', async ({
  page,
  stub,
}) => {
  stub.setDelay(3000);
  const app = await startApp({ stubUrl: stub.url, env: { MODEL_TIMEOUT_MS: '500' } });
  try {
    await app.seed(goalReadyState());
    await open(page, app);

    await page.locator('#btn-propose').click();

    await expect(page.locator('#busy'), 'экран не остаётся запертым').toBeHidden({ timeout: 15_000 });
    await expect(page.locator('#toast')).toContainText('не ответила вовремя');
    await expect(page.locator('#screen-goal')).toBeVisible();
    await expect(page.locator('#btn-propose'), 'можно попробовать ещё раз').toBeVisible();
  } finally {
    await app.stop();
  }
});

test('перезагрузил страницу во время подбора: снова видно занятость, набор тот же [2.13]', async ({
  page,
  app,
  stub,
}) => {
  await open(page, app);
  await sayGoal(page, 'Хочу говорить с партнёром о чувствах по-английски');

  stub.setDelay(2500);
  await page.locator('#btn-propose').click();
  await expect(page.locator('#busy')).toBeVisible();

  await page.reload();

  await expect(page.locator('#busy'), 'после перезагрузки видно, что подбор идёт').toBeVisible();
  await expect(page.locator('#busy-note')).toContainText('займёт до минуты');

  await expect(page.locator('#screen-proposal')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#proposal-list .word')).toHaveCount(12);
  expect(stub.requestsOf('words'), 'подбор не запускается заново').toHaveLength(1);
});

test('запустил подбор второй раз, не дождавшись первого: второй не уходит в модель [2.14]', async ({
  page,
  app,
  stub,
  context,
}) => {
  await app.seed(goalReadyState());
  await open(page, app);
  const second = await context.newPage();
  await open(second, app);

  stub.setDelay(2500);
  await page.locator('#btn-propose').click();
  await second.locator('#btn-propose').click();

  await expect(page.locator('#screen-proposal')).toBeVisible({ timeout: 20_000 });
  await expect(second.locator('#screen-proposal'), 'второе окно дожидается того же набора').toBeVisible(
    { timeout: 20_000 },
  );
  expect(stub.requestsOf('words'), 'подбор уходит в модель один раз').toHaveLength(1);
});

test('в задании виден ответ: такой набор человеку не показывают [2.15]', async ({
  page,
  app,
  stub,
}) => {
  stub.setWords(WORDS_GAP_NOT_HIDDEN);
  await app.seed(goalReadyState());
  await open(page, app);

  await page.locator('#btn-propose').click();
  await expect(page.locator('#busy')).toBeHidden();

  await expect(page.locator('#toast')).toContainText('Не удалось подобрать слова');
  await expect(page.locator('#screen-proposal')).toBeHidden();
  await expect(page.locator('#btn-propose')).toBeVisible();
});

test('подсказка выдаёт слово: такой набор человеку не показывают [2.16]', async ({
  page,
  app,
  stub,
}) => {
  stub.setWords(WORDS_HINT_LEAKS_WORD);
  await app.seed(goalReadyState());
  await open(page, app);

  await page.locator('#btn-propose').click();
  await expect(page.locator('#busy')).toBeHidden();

  await expect(page.locator('#toast')).toContainText('Не удалось подобрать слова');
  await expect(page.locator('#screen-proposal')).toBeHidden();
});

test('слов пришло меньше двенадцати: такой набор человеку не показывают [2.17]', async ({
  page,
  app,
  stub,
}) => {
  stub.setWords(WORDS_TOO_FEW);
  await app.seed(goalReadyState());
  await open(page, app);

  await page.locator('#btn-propose').click();
  await expect(page.locator('#busy')).toBeHidden();

  await expect(page.locator('#toast')).toContainText('Не удалось подобрать слова');
  await expect(page.locator('#screen-proposal')).toBeHidden();
});
