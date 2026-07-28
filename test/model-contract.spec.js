import { CLARIFY_NEEDS_TWO, CLARIFY_READY, WORDS_SET_A } from '../test-harness/fixtures.js';
import { expect, open, reachProposal, sayGoal, test } from './support.js';

/**
 * Замена платному прогону живой модели.
 *
 * Подставная модель отвечает тем, что в неё положили, поэтому качество её ответов
 * здесь проверить нельзя. Что проверить можно — это границу: какое задание продукт
 * отправляет модели и доходит ли туда задача человека целиком. Если правило из
 * specs/ пропадёт из задания, модель перестанет его соблюдать — эти тесты и ловят
 * такую пропажу.
 */

test('задание на уточнение несёт правила разговора о задаче [1.1, 1.4, 1.5, 1.6, 1.7, 1.10]', async ({
  page,
  app,
  stub,
}) => {
  stub.setClarify(CLARIFY_NEEDS_TWO);
  await open(page, app);
  await sayGoal(page, 'Хочу расширить словарный запас');

  const [request] = stub.requestsOf('clarify');
  const task = request.system;

  expect(task, 'нужны все три вещи: язык, ситуация, смысл').toContain('ЯЗЫК');
  expect(task).toContain('СИТУАЦИЯ');
  expect(task).toContain('СМЫСЛ');
  expect(task, '[1.1] на общий запрос — назвать недостающее и спросить').toContain(
    'чего в нём не хватает',
  );
  expect(task, '[1.4] ровно один вопрос за раз').toContain('ОДИН вопрос');
  expect(task, '[1.5] на уклончивый ответ — предложить варианты').toContain(
    'конкретных варианта на выбор',
  );
  expect(task, '[1.6] не додумывать язык').toContain('не решай, что это английский');
  expect(task, '[1.7] спрашивать только про недостающее').toContain('спроси только про язык');
  expect(task, '[1.10] отвечать на языке человека').toContain(
    'на том языке, на котором пишет человек',
  );
});

test('продукт показывает недостающее и пересказ задачи так, как их вернула модель [1.1, 1.2]', async ({
  page,
  app,
  stub,
}) => {
  stub.setClarify(CLARIFY_NEEDS_TWO);
  await open(page, app);
  await sayGoal(page, 'Хочу расширить словарный запас');

  await expect(page.locator('#thread .missing')).toContainText('не хватает: язык');
  await expect(page.locator('#thread .missing')).toContainText('не хватает: ситуация');
  await expect(page.locator('#thread')).toContainText(CLARIFY_NEEDS_TWO.reply);
  await expect(page.locator('#btn-propose')).toBeHidden();

  stub.setClarify(CLARIFY_READY);
  await sayGoal(page, 'Английский, с партнёром, про чувства');

  await expect(page.locator('#goal-brief')).toHaveText(CLARIFY_READY.brief.summary);
  await expect(page.locator('#btn-propose')).toBeVisible();
});

test('задача человека уходит в подбор целиком: язык, родной язык и ситуации [2.1, 2.3]', async ({
  page,
  app,
  stub,
}) => {
  stub.setClarify(CLARIFY_READY);
  stub.setWords(WORDS_SET_A);
  await reachProposal(page, app, stub);

  const [request] = stub.requestsOf('words');
  const task = JSON.stringify(request.messages);
  const { brief } = CLARIFY_READY;

  expect(task, 'подбор идёт под задачу человека, а не под общую тему').toContain(brief.summary);
  expect(task).toContain(brief.language);
  expect(task, '[2.3] родной язык нужен для пояснений').toContain(brief.native_language);
  for (const situation of brief.situations) expect(task).toContain(situation);
});

test('задание на подбор несёт правила набора [2.1, 2.2, 2.4, 2.5, 3.3]', async ({
  page,
  app,
  stub,
}) => {
  stub.setClarify(CLARIFY_READY);
  stub.setWords(WORDS_SET_A);
  await reachProposal(page, app, stub);

  const task = stub.requestsOf('words')[0].system;

  expect(task, '[2.1] ровно двенадцать позиций').toContain('Ровно 12 позиций');
  expect(task, '[2.2] без синонимов-дублей').toContain('Никаких синонимов-дублей');
  expect(task, '[2.3] родной язык тоже можно пополнять').toContain(
    'целевой язык совпадает с родным',
  );
  expect(task, '[2.4] пример от первого лица из ситуации человека').toContain('от первого лица');
  expect(task, '[2.4] пример не учебный').toContain('Не учебное предложение');
  expect(task, '[2.5] пояснение короткое').toContain('до 8 слов');
  expect(task, '[2.5] пояснение не словарное').toContain('Не словарная статья');
  expect(task, '[3.3] в подсказке нет слова и однокоренных').toContain('однокоренных');
});
