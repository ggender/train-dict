import { CLARIFY_NEEDS_LANGUAGE, CLARIFY_READY } from '../test-harness/fixtures.js';
import { expect, open, sayGoal, test } from './support.js';

// specs/goal.md — Разговор о задаче

test('чего-то не хватает: рядом с разговором видны пометки о недостающем [1.8]', async ({
  page,
  app,
  stub,
}) => {
  stub.setClarify(CLARIFY_NEEDS_LANGUAGE);
  await open(page, app);

  await sayGoal(page, 'Хочу расширить словарный запас');

  await expect(page.locator('#thread .missing')).toContainText('не хватает: язык');
  await expect(page.locator('#thread')).toContainText('На каком языке тебе не хватает слов?');
  await expect(page.locator('#goal-ready')).toBeHidden();
});

test('задача принята: пометки исчезают, видна формулировка и кнопка перейти к словам [1.9]', async ({
  page,
  app,
  stub,
}) => {
  stub.setClarify(CLARIFY_READY);
  await open(page, app);

  await sayGoal(page, 'Не могу по-английски говорить с партнёром о чувствах');

  await expect(page.locator('#thread .missing')).toHaveCount(0);
  await expect(page.locator('#goal-brief')).toHaveText(CLARIFY_READY.brief.summary);
  await expect(page.locator('#btn-propose')).toBeVisible();
  await expect(page.locator('#goal-form')).toBeHidden();
});

test('пустое сообщение система не принимает [1.12]', async ({ page, app, stub }) => {
  await open(page, app);

  await page.locator('#goal-input').fill('   ');
  await page.locator('#goal-form button[type=submit]').click();
  await page.waitForTimeout(300);

  expect(stub.requests, 'пустая строка не должна уходить в модель').toHaveLength(0);
  await expect(page.locator('#thread .msg')).toHaveCount(1); // только приветствие

  const res = await page.request.post(`${app.url}/api/goal`, { data: { text: '   ' } });
  expect(res.status()).toBe(400);
});

test('не удалось ответить: система говорит об этом, разговор остаётся как был [1.11]', async ({
  page,
  app,
  stub,
}) => {
  stub.setClarify(CLARIFY_NEEDS_LANGUAGE);
  stub.failOnce();
  await open(page, app);

  await sayGoal(page, 'Хочу подтянуть язык');

  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#toast')).not.toBeEmpty();

  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#thread')).not.toContainText('Хочу подтянуть язык');
  await expect(page.locator('#thread .msg')).toHaveCount(1);

  // и человек может отправить сообщение снова
  await sayGoal(page, 'Хочу подтянуть язык');
  await expect(page.locator('#thread')).toContainText('Хочу подтянуть язык');
  await expect(page.locator('#thread .missing')).toContainText('не хватает: язык');
});

test('не удалось ответить: набранный текст остаётся в поле ввода [1.13]', async ({
  page,
  app,
  stub,
}) => {
  stub.setClarify(CLARIFY_NEEDS_LANGUAGE);
  stub.failOnce();
  await open(page, app);
  const written = 'Хочу говорить с женой о том, что чувствую, а выходит только «I am fine»';

  await page.locator('#goal-input').fill(written);
  await page.locator('#goal-form button[type=submit]').click();
  await expect(page.locator('#toast')).toBeVisible();

  await expect(page.locator('#goal-input'), 'набирать заново не нужно').toHaveValue(written);

  // и та же реплика уходит со второй попытки
  await page.locator('#goal-form button[type=submit]').click();
  await expect(page.locator('#busy')).toBeHidden();
  await expect(page.locator('#thread')).toContainText(written);
  await expect(page.locator('#goal-input')).toHaveValue('');
});

test('подбор слов до того, как задача стала конкретной, отклоняется [1.3]', async ({ page, app }) => {
  await open(page, app);

  const res = await page.request.post(`${app.url}/api/words`, { data: {} });

  expect(res.status()).toBe(409);
  expect((await res.json()).error).toContain('Задача ещё не определена');
});
