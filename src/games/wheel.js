/**
 * Колесо фортуны: 12 секторов. Вес сектора = вероятность выпадения.
 * Базовая RTP считается из таблицы, дальше масштабируется процентом казино.
 */
export const WHEEL_SEGMENTS = [
  { key: 'zero', m: 0, weight: 20.1, color: '#050912', label: '0x' },
  { key: 'x02', m: 0.2, weight: 13, color: '#121F35', label: 'x0.2' },
  { key: 'x05', m: 0.5, weight: 12, color: '#18273F', label: 'x0.5' },
  { key: 'x1', m: 1, weight: 12, color: '#38E1FF', label: 'x1' },
  { key: 'x15', m: 1.5, weight: 9, color: '#43E39A', label: 'x1.5' },
  { key: 'x2', m: 2, weight: 6, color: '#8BA0BF', label: 'x2' },
  { key: 'x3', m: 3, weight: 4, color: '#FFC76A', label: 'x3' },
  { key: 'x5', m: 5, weight: 2.5, color: '#EDF3FF', label: 'x5' },
  { key: 'zero2', m: 0, weight: 20.1, color: '#0B1424', label: '0x' },
  { key: 'x10', m: 10, weight: 1, color: '#FF5C7A', label: 'x10' },
  { key: 'x50', m: 50, weight: 0.3, color: '#8BA0BF', label: 'x50' },
];

const TOTAL_WEIGHT = WHEEL_SEGMENTS.reduce((s, x) => s + x.weight, 0);

/** Базовая RTP таблицы (без масштабирования) */
export const WHEEL_BASE_RTP = WHEEL_SEGMENTS.reduce((s, x) => s + x.m * x.weight, 0) / TOTAL_WEIGHT;

export function wheelMultiplierFor(segment, edge = 0.04) {
  const factor = (1 - edge) / WHEEL_BASE_RTP;
  return segment.m * factor;
}

export function pickSegment(rng) {
  let roll = rng() * TOTAL_WEIGHT;
  for (let i = 0; i < WHEEL_SEGMENTS.length; i++) {
    roll -= WHEEL_SEGMENTS[i].weight;
    if (roll < 0) return i;
  }
  return WHEEL_SEGMENTS.length - 1;
}

export function spinWheelGame({ amount, rng, edge = 0.04 }) {
  const index = pickSegment(rng);
  const segment = WHEEL_SEGMENTS[index];
  const exact = wheelMultiplierFor(segment, edge);
  const multiplier = Math.round(exact * 100) / 100;
  const payout = Math.round(Number(amount) * exact);
  return {
    index,
    key: segment.key,
    multiplier,
    payout,
    profit: payout - Number(amount),
    win: payout > Number(amount),
    sectors: WHEEL_SEGMENTS.map((s) => ({
      key: s.key,
      label: s.label,
      color: s.color,
      weight: Math.round((s.weight / TOTAL_WEIGHT) * 1000) / 10,
    })),
  };
}
