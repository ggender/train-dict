/**
 * Заготовленные ответы модели и данные для тестов.
 * Всё выдумано: живая модель в бесплатном прогоне не участвует.
 */

export const BRIEF = {
  summary: 'Хочу по-английски говорить с партнёром о своих чувствах',
  language: 'английский',
  native_language: 'русский',
  situations: ['разговоры с партнёром вечером', 'ссоры и примирения'],
};

/** Модель ещё не собрала задачу: не хватает языка. */
export const CLARIFY_NEEDS_LANGUAGE = {
  ready: false,
  reply: 'Не назван язык. На каком языке тебе не хватает слов?',
  missing: ['язык'],
  brief: null,
};

/** Модель не собрала ни языка, ни ситуации. */
export const CLARIFY_NEEDS_TWO = {
  ready: false,
  reply: 'Не хватает языка и ситуации. На каком языке ты хочешь говорить?',
  missing: ['язык', 'ситуация'],
  brief: null,
};

/** Модель собрала задачу целиком. */
export const CLARIFY_READY = {
  ready: true,
  reply: 'Тебе не хватает английских слов, чтобы говорить с партнёром о чувствах.',
  missing: [],
  brief: BRIEF,
};

const WORDS_A = [
  ['resent', 'тихо злишься и держишь в себе', 'I resent that you decided without me.', 'сержусь и молчу об этом'],
  ['overwhelmed', 'накрыло, не справляешься', "I'm overwhelmed and I need a minute.", 'слишком много всего сразу'],
  ['dismissed', 'тебя отмахнулись, как от пустяка', 'I felt dismissed when you laughed.', 'мою тревогу не приняли всерьёз'],
  ['drained', 'выжат, сил не осталось', "I'm completely drained tonight.", 'сил на разговор нет совсем'],
  ['vulnerable', 'открыт и потому уязвим', 'I feel vulnerable saying this out loud.', 'страшно говорить это вслух'],
  ['reassured', 'тебя успокоили, стало легче', 'I felt reassured after we talked.', 'после разговора стало спокойнее'],
  ['on edge', 'на взводе, всё раздражает', "I've been on edge all evening.", 'весь вечер всё меня задевает'],
  ['let down', 'обманутые ожидания', 'I was let down when you cancelled.', 'ты пообещал и не сделал'],
  ['appreciated', 'тебя заметили и оценили', 'I feel appreciated when you notice.', 'приятно, что ты это увидел'],
  ['distant', 'рядом, но будто далеко', "You've seemed distant this week.", 'ты будто не со мной эту неделю'],
  ['guilty', 'виноват и грызёшь себя', 'I feel guilty about how I snapped.', 'мне стыдно, что я сорвался'],
  ['relieved', 'отпустило, груз упал', "I'm relieved we finally talked.", 'наконец стало легко'],
];

const WORDS_B = [
  ['anxious', 'тревожно, тянет внутри', "I'm anxious about tomorrow.", 'внутри всё сжимается от завтрашнего'],
  ['content', 'спокойно и достаточно', "I'm content just sitting here with you.", 'мне хорошо просто рядом'],
  ['irritated', 'мелко раздражён', "I'm irritated by the noise.", 'этот шум меня доводит'],
  ['grateful', 'благодарен по-настоящему', "I'm grateful you stayed.", 'спасибо, что не ушёл'],
  ['lonely', 'одиноко даже рядом', 'I feel lonely even when you are here.', 'мне одиноко, хотя ты близко'],
  ['hopeful', 'веришь, что станет лучше', "I'm hopeful about us.", 'верю, что у нас получится'],
  ['ashamed', 'стыдно за себя', "I'm ashamed of what I said.", 'мне стыдно за свои слова'],
  ['restless', 'не сидится, тянет двигаться', "I'm restless tonight.", 'не могу усидеть на месте'],
  ['secure', 'спокоен за нас', 'I feel secure with you.', 'рядом с тобой спокойно'],
  ['torn', 'разрываешься между двумя', "I'm torn about the move.", 'не могу выбрать ни одно из двух'],
  ['numb', 'ничего не чувствуешь', 'I just feel numb right now.', 'внутри сейчас пусто'],
  ['seen', 'тебя по-настоящему поняли', 'I feel seen when you listen.', 'ты меня правда понимаешь'],
];

const toItems = (rows) =>
  rows.map(([word, meaning, example, paraphrase]) => ({
    word,
    meaning,
    example,
    example_gap: example.replace(new RegExp(word, 'i'), '___'),
    paraphrase,
  }));

/** Первый набор из двенадцати слов. */
export const WORDS_SET_A = { items: toItems(WORDS_A) };

/** Второй набор — для сценария «подобрать другой». */
export const WORDS_SET_B = { items: toItems(WORDS_B) };

/** Подбор сорвался: модель вернула пустой набор. */
export const WORDS_EMPTY = { items: [] };

const spoil = (index, patch) => ({
  items: WORDS_SET_A.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
});

/** Испорченный набор: во фразе с пропуском слово осталось на месте. */
export const WORDS_GAP_NOT_HIDDEN = spoil(4, { example_gap: WORDS_SET_A.items[4].example });

/** Испорченный набор: подсказка выдаёт само слово. */
export const WORDS_HINT_LEAKS_WORD = spoil(7, {
  paraphrase: `when I am ${WORDS_SET_A.items[7].word} I go quiet`,
});

/** Набор пришёл неполным. */
export const WORDS_TOO_FEW = { items: WORDS_SET_A.items.slice(0, 5) };
