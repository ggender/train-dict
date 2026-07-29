import { test as base, expect } from '@playwright/test';

import { startApp } from '../test-harness/app.js';
import { startModelStub } from '../test-harness/model-stub.js';

/**
 * Каждому тесту — своя подставная модель и своё приложение во временном каталоге.
 * Тесты не делят состояние и не трогают рабочие данные человека.
 */
export const test = base.extend({
  stub: async ({}, use) => {
    const stub = await startModelStub();
    await use(stub);
    await stub.stop();
  },
  app: async ({ stub }, use) => {
    const app = await startApp({ stubUrl: stub.url });
    await use(app);
    await app.stop();
  },
});

export { expect };

/** Открыть тренажёр и дождаться, пока он покажет экран. */
export async function open(page, app) {
  await page.goto(app.url);
  await expect(page.locator('#app')).toBeVisible();
}

/** Написать в разговор о задаче и дождаться ответа. */
export async function sayGoal(page, text) {
  await page.locator('#goal-input').fill(text);
  await page.locator('#goal-form button[type=submit]').click();
  await expect(page.locator('#busy')).toBeHidden();
}

/** Дойти до экрана с набором слов. */
export async function reachProposal(page, app, stub) {
  await open(page, app);
  await sayGoal(page, 'Хочу говорить с партнёром о чувствах по-английски');
  await page.locator('#btn-propose').click();
  await expect(page.locator('#screen-proposal')).toBeVisible();
}

/** Подложить состояние и открыть тренажёр на карточках. */
export async function openStudy(page, app, state) {
  await app.seed(state);
  await open(page, app);
  await expect(page.locator('#screen-study')).toBeVisible();
}

/** Подложить состояние и открыть тренажёр на экране «на сегодня всё». */
export async function openDone(page, app, state) {
  await app.seed(state);
  await open(page, app);
  await expect(page.locator('#screen-done')).toBeVisible();
}

/** Оценить открытую карточку. */
export async function grade(page, ok) {
  await page.locator('#btn-reveal').click();
  await page.locator(ok ? '#btn-ok' : '#btn-fail').click();
  await expect(page.locator('#busy')).toBeHidden();
}

/** Текст задания на карточке, которая сейчас перед человеком. */
export const currentPrompt = (page) => page.locator('#card-prompt').innerText();
