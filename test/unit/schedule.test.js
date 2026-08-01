import { describe, expect, it } from 'vitest';

import { freshCard, grade, State } from '../../lib/scheduler.js';
import { queue } from '../../lib/session.js';

/**
 * Два правила расписания, которые экран доказывает лишь косвенно.
 *
 * Всё остальное про расписание проверяется через экран (test/schedule.spec.js);
 * здесь только границы по времени: их через экран пришлось бы ждать сутками,
 * а разброс сроков (fuzz) сделал бы такую проверку мигающей.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe('справился с первого раза', () => {
  it('назначает следующий показ на дни, а не на минуты [4.6]', () => {
    const now = new Date();

    // сроки разводятся случайно, поэтому проверяем правило много раз
    for (let i = 0; i < 20; i += 1) {
      const next = grade(freshCard(now), true, now);
      const waitMs = new Date(next.due) - now;

      expect(waitMs, `прогон ${i + 1}: срок должен быть не меньше суток`).toBeGreaterThanOrEqual(DAY);
    }
  });
});

describe('заход не обрывается на минутах', () => {
  const cardDueIn = (id, ms, now) => ({
    id,
    wordId: id,
    type: 'cloze',
    word: id,
    meaning: '',
    example: '',
    prompt: '',
    fsrs: {
      ...freshCard(now),
      state: State.Learning,
      due: new Date(now.getTime() + ms).toISOString(),
    },
    firstSeenAt: new Date(now.getTime() - MINUTE).toISOString(),
    reps: 1,
    fails: 1,
  });

  it('дотягивает до конца захода карточку, которая вернётся в ближайшие двадцать минут [4.5]', () => {
    const now = new Date();
    const state = { cards: [cardDueIn('через-10-минут', 10 * MINUTE, now)], words: [] };

    const view = queue(state, now);

    expect(view.card?.id).toBe('через-10-минут');
    expect(view.remaining).toBe(2);
  });

  it('не втягивает в заход то, что вернётся заметно позже [4.5]', () => {
    const now = new Date();
    const state = { cards: [cardDueIn('через-25-минут', 25 * MINUTE, now)], words: [] };

    const view = queue(state, now);

    expect(view.card).toBe(null);
    expect(view.nextDueAt).not.toBe(null);
  });
});
