const $ = (id) => document.getElementById(id);

const el = {
  app: $('app'),
  splash: $('splash'),
  busy: $('busy'),
  busyNote: $('busy-note'),
  toast: $('toast'),

  screens: {
    goal: $('screen-goal'),
    proposal: $('screen-proposal'),
    study: $('screen-study'),
    done: $('screen-done'),
  },

  thread: $('thread'),
  goalForm: $('goal-form'),
  goalInput: $('goal-input'),
  goalReady: $('goal-ready'),
  goalBrief: $('goal-brief'),
  btnPropose: $('btn-propose'),

  proposalSub: $('proposal-sub'),
  proposalList: $('proposal-list'),
  btnConfirm: $('btn-confirm'),
  btnRegenerate: $('btn-regenerate'),

  cardKind: $('card-kind'),
  cardExtra: $('card-extra'),
  cardCounter: $('card-counter'),
  cardPrompt: $('card-prompt'),
  cardAnswer: $('card-answer'),
  answerPhrase: $('answer-phrase'),
  answerWord: $('answer-word'),
  answerMeaning: $('answer-meaning'),
  btnReveal: $('btn-reveal'),
  gradeRow: $('grade-row'),
  btnFail: $('btn-fail'),
  btnOk: $('btn-ok'),
  btnEnough: $('btn-enough'),

  doneWhen: $('done-when'),
  doneProgress: $('done-progress'),
  doneDock: $('done-dock'),
  btnAgain: $('btn-again'),
};

let current = null; // карточка, которую человек видит прямо сейчас
let comebackTimer = null;

// ------------------------------------------------------------------- сеть

let inflight = 0;

async function api(path, body, note = '') {
  inflight += 1;
  el.busyNote.textContent = note;
  el.busy.hidden = false;
  try {
    const res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error ?? `Ошибка ${res.status}`);
      err.stale = res.status === 409; // окно отстало от жизни: дальше оно себя догонит
      throw err;
    }
    return data;
  } finally {
    inflight -= 1;
    if (inflight === 0) {
      el.busy.hidden = true;
      el.busyNote.textContent = '';
    }
  }
}

let toastTimer = null;
function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), 5000);
}

const guard = (fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (err) {
    toast(err.message);
    // Окну отказали, потому что человек ушёл вперёд в другом окне: покажем, где он сейчас.
    if (err.stale) await resync().catch(() => {});
  }
};

async function resync() {
  await render(await api('/api/state'));
}

// -------------------------------------------------------------- отрисовка

function show(name) {
  for (const [key, node] of Object.entries(el.screens)) node.hidden = key !== name;
  el.splash.hidden = true;
  el.app.hidden = false;
}

function renderGoal(state) {
  el.thread.replaceChildren();

  if (state.goal.messages.length === 0) {
    const intro = document.createElement('div');
    intro.className = 'msg msg-bot';
    intro.textContent =
      'Напиши одной фразой, зачем тебе слова. Я уточню детали и соберу набор под твою задачу.';
    el.thread.append(intro);
  }

  for (const message of state.goal.messages) {
    const node = document.createElement('div');
    node.className = `msg ${message.role === 'user' ? 'msg-user' : 'msg-bot'}`;
    node.textContent = message.content;
    el.thread.append(node);
  }

  if (state.goal.missing?.length) {
    const row = document.createElement('div');
    row.className = 'missing';
    for (const item of state.goal.missing) {
      const chip = document.createElement('span');
      chip.textContent = `не хватает: ${item}`;
      row.append(chip);
    }
    el.thread.append(row);
  }

  const ready = Boolean(state.goal.brief);
  el.goalReady.hidden = !ready;
  el.goalForm.hidden = ready;
  if (ready) el.goalBrief.textContent = state.goal.brief.summary;

  el.thread.scrollTop = el.thread.scrollHeight;
  show('goal');
}

function renderProposal(state) {
  const items = state.proposal.items;
  el.proposalSub.textContent = `${items.length} ${plural(items.length, 'слово', 'слова', 'слов')} под твою задачу. Посмотри и подтверди.`;

  el.proposalList.replaceChildren();
  for (const item of items) {
    const node = document.createElement('div');
    node.className = 'word';

    const title = document.createElement('b');
    title.textContent = item.word;

    const meaning = document.createElement('p');
    meaning.className = 'meaning';
    meaning.textContent = item.meaning;

    const example = document.createElement('p');
    example.className = 'example';
    example.textContent = item.example;

    node.append(title, meaning, example);
    el.proposalList.append(node);
  }

  el.proposalList.scrollTop = 0;
  show('proposal');
}

const KIND = {
  cloze: 'Закончи фразу',
  paraphrase: 'Скажи то же другими словами',
};

function renderStudy(view) {
  clearTimeout(comebackTimer);
  current = view.card;

  if (!current) {
    el.doneWhen.textContent = comeback(view.nextDueAt);
    const { touched, total } = view.progress;
    el.doneProgress.textContent = `Пройдено карточек: ${touched} из ${total}`;
    // Ждать следующего дня необязательно — пройденное можно пройти ещё раз.
    el.doneDock.hidden = touched === 0;
    scheduleRecheck(view.nextDueAt);
    show('done');
    return;
  }

  el.cardKind.textContent = KIND[current.type];
  el.cardExtra.hidden = !view.extra;
  el.btnEnough.hidden = !view.extra;
  el.cardCounter.textContent = `осталось ${view.remaining}`;
  el.cardPrompt.textContent = current.prompt;

  el.answerPhrase.textContent = current.example;
  el.answerWord.textContent = current.word;
  el.answerMeaning.textContent = current.meaning;

  el.cardAnswer.hidden = true;
  el.btnReveal.hidden = false;
  el.gradeRow.hidden = true;
  show('study');
}

function render(state) {
  if (state.picking) return waitForProposal();
  if (state.stage === 'goal') return renderGoal(state);
  if (state.stage === 'proposal') return state.proposal ? renderProposal(state) : renderGoal(state);
  return refreshStudy();
}

const PICKING_NOTE = 'Подбираю слова под твою задачу. Это займёт до минуты.';

/**
 * Подбор идёт на сервере. Ждём его молча, а не показываем кнопку «подобрать» заново:
 * иначе перезагруженная страница потеряет уже начатый подбор и запустит второй.
 */
async function waitForProposal() {
  el.busyNote.textContent = PICKING_NOTE;
  el.busy.hidden = false;
  try {
    for (let i = 0; i < 120; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const state = await fetch('/api/state').then((res) => res.json());
      if (!state.picking) return await render(state);
    }
    throw new Error('Подбор затянулся. Попробуй ещё раз.');
  } finally {
    if (inflight === 0) {
      el.busy.hidden = true;
      el.busyNote.textContent = '';
    }
  }
}

// ----------------------------------------------------------- когда прийти

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function comeback(iso) {
  if (!iso) return 'Заходи, когда захочешь.';

  const due = new Date(iso);
  const now = new Date();
  const minutes = Math.round((due - now) / 60000);
  if (minutes <= 1) return 'Приходи через минуту.';
  if (minutes < 60) return `Приходи через ${minutes} ${plural(minutes, 'минуту', 'минуты', 'минут')}.`;

  const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((midnight(due) - midnight(now)) / 86400000);
  const time = due.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  if (days === 0) return `Приходи сегодня к ${time}.`;
  if (days === 1) return 'Приходи завтра.';
  if (days === 2) return 'Приходи послезавтра.';
  if (days <= 6) return `Приходи через ${days} ${plural(days, 'день', 'дня', 'дней')}.`;
  return `Приходи ${due.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}.`;
}

/** Если ближайшая карточка совсем скоро, сами обновимся — человеку не надо перезагружать. */
function scheduleRecheck(iso) {
  if (!iso) return;
  const wait = new Date(iso) - Date.now();
  if (wait <= 0 || wait > 10 * 60_000) return;
  comebackTimer = setTimeout(() => void guard(refreshStudy)(), wait + 1000);
}

// -------------------------------------------------------------- действия

async function refreshStudy() {
  renderStudy(await api('/api/study'));
}

el.goalForm.addEventListener(
  'submit',
  guard(async (event) => {
    event.preventDefault();
    const text = el.goalInput.value.trim();
    if (!text) return;
    el.goalInput.value = '';
    resize();
    try {
      await render(await api('/api/goal', { text }, 'Думаю над твоей задачей…'));
    } catch (err) {
      el.goalInput.value = text; // ответить не удалось — набирать заново не надо
      resize();
      el.goalInput.focus();
      throw err;
    }
  }),
);

el.goalInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    el.goalForm.requestSubmit();
  }
});

function resize() {
  el.goalInput.style.height = 'auto';
  el.goalInput.style.height = `${el.goalInput.scrollHeight}px`;
}
el.goalInput.addEventListener('input', resize);

const propose = guard(async () => render(await api('/api/words', {}, PICKING_NOTE)));

el.btnPropose.addEventListener('click', propose);
el.btnRegenerate.addEventListener('click', propose);

el.btnConfirm.addEventListener(
  'click',
  guard(async () => renderStudy(await api('/api/words/confirm', {}))),
);

el.btnReveal.addEventListener('click', () => {
  el.cardAnswer.hidden = false;
  el.btnReveal.hidden = true;
  el.gradeRow.hidden = false;
});

const answer = (ok) =>
  guard(async () => {
    const card = current;
    if (!card) return; // нажали ещё раз: эту карточку уже отправили, второй оценки не будет
    current = null;

    // Номер показа отсекает вторую оценку, если она всё же дойдёт — например, из другого окна.
    try {
      renderStudy(await api('/api/study/answer', { id: card.id, ok, reps: card.reps }));
    } catch (err) {
      current = card; // не дошло — пусть человек оценит ту же карточку снова
      throw err;
    }
  });

el.btnOk.addEventListener('click', answer(true));
el.btnFail.addEventListener('click', answer(false));

// Лишний заход: пройти уже пройденное, не дожидаясь следующего дня.
el.btnAgain.addEventListener(
  'click',
  guard(async () => renderStudy(await api('/api/study/again', {}))),
);

el.btnEnough.addEventListener(
  'click',
  guard(async () => renderStudy(await api('/api/study/again/stop', {}))),
);

// Пробел показывает ответ, 1 / 2 оценивают — для тех, кто с клавиатуры.
// event.repeat: зажатая клавиша не должна сыпать оценками.
document.addEventListener('keydown', (event) => {
  if (el.screens.study.hidden || event.metaKey || event.ctrlKey || event.repeat) return;
  if ((event.key === ' ' || event.code === 'Space') && !el.btnReveal.hidden) {
    event.preventDefault();
    el.btnReveal.click();
  } else if (!el.gradeRow.hidden && (event.key === '1' || event.key === '2')) {
    (event.key === '1' ? el.btnFail : el.btnOk).click();
  }
});

/**
 * Человек вернулся к странице, которую не закрывал: за это время мог подойти срок.
 * Проверяем только на экране «на сегодня всё» — там нечего терять, а начатую
 * карточку из-под человека выдёргивать нельзя.
 */
function recheckOnReturn() {
  if (el.screens.done.hidden || document.hidden || inflight > 0) return;
  void guard(refreshStudy)();
}

document.addEventListener('visibilitychange', recheckOnReturn);
window.addEventListener('pageshow', recheckOnReturn);
window.addEventListener('focus', recheckOnReturn);

// ------------------------------------------------------------------ старт

try {
  await render(await api('/api/state'));
} catch (err) {
  el.splash.textContent = '';
  const message = document.createElement('p');
  message.className = 'hint';
  message.textContent = `Не удалось загрузить: ${err.message}`;
  el.splash.append(message);
}
