/**
 * Кости: бросок 1..100, ставка «больше» или «меньше» цели.
 * Множитель = (1 - edge) / вероятность выигрыша.
 */
export const MIN_TARGET = 2;
export const MAX_TARGET = 99;

export function rollDice(rng) {
  return 1 + Math.floor(rng() * 100);
}

export function diceChance(target, over) {
  const t = Math.round(target);
  if (t < MIN_TARGET || t > MAX_TARGET) return 0;
  return over ? (100 - t) / 100 : (t - 1) / 100;
}

export function diceMultiplier(target, over, edge = 0.03) {
  const chance = diceChance(target, over);
  if (chance <= 0) return 0;
  return Math.max(1.01, Math.round(((1 - edge) / chance) * 100) / 100);
}

export function playDice({ amount, target, over, rng, edge = 0.03 }) {
  const roll = rollDice(rng);
  const t = Math.round(Number(target));
  if (!Number.isInteger(t) || t < MIN_TARGET || t > MAX_TARGET) throw new Error('TARGET_INVALID');
  const dir = over ? 'over' : 'under';
  const win = over ? roll > t : roll < t;
  const chance = diceChance(t, over);
  const multiplier = diceMultiplier(t, over, edge);
  const payout = win ? Math.round(Number(amount) * multiplier) : 0;
  return {
    roll,
    target: t,
    direction: dir,
    chance,
    multiplier: win ? multiplier : 0,
    win,
    payout,
    profit: payout - Number(amount),
  };
}
