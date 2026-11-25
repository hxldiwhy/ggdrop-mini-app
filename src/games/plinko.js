/**
 * Плинко: шарик падает по пирамиде, каждая развилка 50/50.
 * Вероятность корзины i = C(rows, i) / 2^rows.
 * Таблицы множителей стандартные, RTP масштабируется процентом казино.
 */
import { binom } from '../utils.js';

export const RISKS = {
  // Низкий риск: центр и обе соседние корзины проигрышные, RTP сохраняется за счёт краёв.
  low: {
    8: [7.3, 2.75, 1.45, 0.9, 0.2, 0.9, 1.45, 2.75, 7.3],
    10: [11.15, 3.75, 1.75, 1.4, 0.9, 0.2, 0.9, 1.4, 1.75, 3.75, 11.15],
    12: [12.15, 3.65, 1.95, 1.7, 1.35, 0.9, 0.2, 0.9, 1.35, 1.7, 1.95, 3.65, 12.15],
    14: [12.35, 3.6, 2, 1.8, 1.35, 1.25, 0.9, 0.2, 0.9, 1.25, 1.35, 1.8, 2, 3.6, 12.35],
    16: [18.75, 10.55, 2.35, 1.65, 1.65, 1.4, 1.3, 0.9, 0.2, 0.9, 1.3, 1.4, 1.65, 1.65, 2.35, 10.55, 18.75],
  },
  medium: {
    8: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
    10: [22, 5, 2, 1.4, 0.6, 0.4, 0.6, 1.4, 2, 5, 22],
    12: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
    14: [58, 15, 7, 4, 1.9, 1, 0.5, 0.2, 0.5, 1, 1.9, 4, 7, 15, 58],
    16: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
  },
  high: {
    8: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
    10: [76, 10, 3, 0.9, 0.3, 0.2, 0.3, 0.9, 3, 10, 76],
    12: [170, 24, 8, 5, 1.5, 0.2, 0.2, 0.2, 1.5, 5, 8, 24, 170],
    14: [420, 56, 18, 5, 1.9, 0.3, 0.2, 0.2, 0.2, 0.3, 1.9, 5, 18, 56, 420],
    16: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
  },
};

export const ROWS = [8, 10, 12, 14, 16];
export const MAX_BALLS = 10;

export function clampBalls(count) {
  const n = Math.round(Number(count));
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_BALLS, Math.max(1, n));
}

export function bucketProbability(rows, i) {
  return binom(rows, i) / 2 ** rows;
}

export function baseRtp(rows, risk) {
  const table = RISKS[risk]?.[rows];
  if (!table) return 0;
  return table.reduce((sum, m, i) => sum + m * bucketProbability(rows, i), 0);
}

export function multipliersFor(rows, risk, edge = 0.03) {
  const table = RISKS[risk]?.[rows];
  if (!table) throw new Error('PLINKO_CONFIG');
  const rtp = baseRtp(rows, risk);
  const factor = rtp > 0 ? (1 - edge) / rtp : 1;
  return table.map((m) => Math.round(m * factor * 100) / 100);
}

export function dropBall({ amount, rows, risk, rng, edge = 0.03 }) {
  const n = Math.round(rows);
  const r = RISKS[risk]?.[n] ? risk : 'medium';
  if (!RISKS[r][n]) throw new Error('PLINKO_CONFIG');
  const path = [];
  let bucket = 0;
  for (let i = 0; i < n; i++) {
    const right = rng() < 0.5;
    path.push(right ? 1 : 0);
    if (right) bucket += 1;
  }
  const table = RISKS[r][n];
  const exact = (table[bucket] * (1 - edge)) / baseRtp(n, r);
  const multiplier = Math.round(exact * 100) / 100;
  const payout = Math.round(Number(amount) * exact);
  return {
    rows: n,
    risk: r,
    path,
    bucket,
    multipliers: multipliersFor(n, r, edge),
    multiplier,
    payout,
    profit: payout - Number(amount),
    win: payout > Number(amount),
    chance: bucketProbability(n, bucket),
  };
}

/** Несколько независимых шариков в одном раунде. Лимит — на суммарную ставку. */
export function dropBalls({ amount, rows, risk, count = 1, rng, edge = 0.03 }) {
  const ballsCount = clampBalls(count);
  const perBet = Math.round(Number(amount));
  const balls = [];
  for (let i = 0; i < ballsCount; i++) {
    balls.push(dropBall({ amount: perBet, rows, risk, rng, edge }));
  }
  const totalBet = perBet * ballsCount;
  const payout = balls.reduce((sum, b) => sum + b.payout, 0);
  return {
    rows: balls[0].rows,
    risk: balls[0].risk,
    count: ballsCount,
    perBet,
    totalBet,
    balls,
    multipliers: balls[0].multipliers,
    buckets: balls.map((b) => b.bucket),
    payout,
    profit: payout - totalBet,
    win: payout > totalBet,
  };
}
