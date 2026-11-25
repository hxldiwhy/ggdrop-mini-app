/**
 * Европейская рулетка: 37 лунок (0–36), выплаты как в казино.
 * Преимущество казино уже «зашито» в зеро, поэтому коэффициенты честные.
 */
export const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const RED = new Set(RED_NUMBERS);

export const BET_TYPES = {
  number: { label: 'Число', mult: 36 },
  red: { label: 'Красное', mult: 2 },
  black: { label: 'Чёрное', mult: 2 },
  even: { label: 'Чёт', mult: 2 },
  odd: { label: 'Нечет', mult: 2 },
  low: { label: '1–18', mult: 2 },
  high: { label: '19–36', mult: 2 },
  dozen1: { label: '1-я дюжина', mult: 3 },
  dozen2: { label: '2-я дюжина', mult: 3 },
  dozen3: { label: '3-я дюжина', mult: 3 },
  column1: { label: '1-я колонка', mult: 3 },
  column2: { label: '2-я колонка', mult: 3 },
  column3: { label: '3-я колонка', mult: 3 },
};

export function spinWheel(rng) {
  return Math.floor(rng() * 37);
}

export function colorOf(n) {
  if (n === 0) return 'green';
  return RED.has(n) ? 'red' : 'black';
}

/** Возвращает коэффициент выплаты (включая ставку) или 0, если ставка проиграла. */
export function payoutMultiplier(type, value, result) {
  switch (type) {
    case 'number':
      return Number(value) === result ? 36 : 0;
    case 'red':
      return result !== 0 && RED.has(result) ? 2 : 0;
    case 'black':
      return result !== 0 && !RED.has(result) ? 2 : 0;
    case 'even':
      return result !== 0 && result % 2 === 0 ? 2 : 0;
    case 'odd':
      return result !== 0 && result % 2 === 1 ? 2 : 0;
    case 'low':
      return result >= 1 && result <= 18 ? 2 : 0;
    case 'high':
      return result >= 19 && result <= 36 ? 2 : 0;
    case 'dozen1':
      return result >= 1 && result <= 12 ? 3 : 0;
    case 'dozen2':
      return result >= 13 && result <= 24 ? 3 : 0;
    case 'dozen3':
      return result >= 25 && result <= 36 ? 3 : 0;
    case 'column1':
      return result > 0 && result % 3 === 1 ? 3 : 0;
    case 'column2':
      return result > 0 && result % 3 === 2 ? 3 : 0;
    case 'column3':
      return result > 0 && result % 3 === 0 ? 3 : 0;
    default:
      return 0;
  }
}

export function normalizeBets(bets, minBet, maxTotal) {
  if (!Array.isArray(bets) || bets.length === 0) throw new Error('BETS_REQUIRED');
  if (bets.length > 20) throw new Error('TOO_MANY_BETS');
  const out = [];
  let total = 0;
  for (const raw of bets) {
    const type = String(raw.type || '');
    if (!BET_TYPES[type]) throw new Error('BET_TYPE_INVALID');
    const amount = Math.round(Number(raw.amount));
    if (!Number.isFinite(amount) || amount < minBet) throw new Error('BET_AMOUNT_INVALID');
    let value = null;
    if (type === 'number') {
      value = Number(raw.value);
      if (!Number.isInteger(value) || value < 0 || value > 36) throw new Error('BET_NUMBER_INVALID');
    }
    total += amount;
    if (total > maxTotal) throw new Error('BET_TOTAL_TOO_HIGH');
    out.push({ type, value, amount, label: BET_TYPES[type].label });
  }
  return { bets: out, total };
}

export function playRoulette({ bets, rng, minBet = 1, maxTotal = 1e9 }) {
  const { bets: list, total } = normalizeBets(bets, minBet, maxTotal);
  const result = spinWheel(rng);
  const color = colorOf(result);
  let winTotal = 0;
  const breakdown = list.map((b) => {
    const mult = payoutMultiplier(b.type, b.value, result);
    const win = Math.round(b.amount * mult);
    winTotal += win;
    return { ...b, mult, win };
  });
  return {
    result,
    color,
    bets: breakdown,
    totalBet: total,
    payout: winTotal,
    profit: winTotal - total,
    win: winTotal > 0,
  };
}

export function rouletteLabel(b) {
  if (b.type === 'number') return `Число ${b.value}`;
  return BET_TYPES[b.type]?.label || b.type;
}
