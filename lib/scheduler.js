import { createEmptyCard, fsrs, generatorParameters, Rating, State } from 'ts-fsrs';

const engine = fsrs(
  generatorParameters({
    enable_fuzz: true, // разводит одинаковые карточки по разным дням
    enable_short_term: true,
    // Один шаг обучения вместо стандартных двух: если человек справился с первого
    // раза, карточка сразу уходит на дни. Иначе первый заход заканчивался бы
    // предложением «приходи через 10 минут», что для этого тренажёра бессмысленно.
    learning_steps: ['1m'],
    // Не справился — карточка возвращается в этом же заходе, через несколько карточек.
    relearning_steps: ['5m'],
  }),
);

export { State };

/** Сколько новых карточек показываем в один день. Человек это не настраивает. */
export const NEW_PER_DAY = 12;

function serialize(card) {
  return {
    ...card,
    due: card.due.toISOString(),
    last_review: card.last_review ? card.last_review.toISOString() : null,
  };
}

export function freshCard(now = new Date()) {
  return serialize(createEmptyCard(now));
}

/**
 * Единственная оценка, которую даёт человек: справился или нет.
 * Больше градаций нет — это осознанное упрощение первой версии.
 */
export function grade(cardState, ok, now = new Date()) {
  const { card } = engine.next(cardState, now, ok ? Rating.Good : Rating.Again);
  return serialize(card);
}

export const isDue = (cardState, now) => new Date(cardState.due) <= now;
export const isNew = (cardState) => cardState.state === State.New;
