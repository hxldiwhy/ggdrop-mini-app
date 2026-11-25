import crypto from 'node:crypto';

/**
 * Crash: множитель растёт со временем, раунд «взрывается» в заранее
 * вычисленной точке. Точка детерминирована от serverSeed + roundId,
 * поэтому её можно проверить после раунда (provably fair).
 */

/**
 * Разгоняющаяся кривая: в начале множитель ползёт медленно,
 * а на дальних рубежах (в «далеке») ускоряется очень резко.
 * m(t) = MAX ^ (t / ROUND_MS) ^ ACCEL
 * ACCEL > 1 — чем дальше raунд, тем быстрее растёт множитель.
 */
export const MAX_MULTIPLIER = 10000;
export const ROUND_MS = 12000;   // время до x10000
export const ACCEL = 1.7;        // медленный старт → быстрый финиш
const LOG_MAX = Math.log(MAX_MULTIPLIER);

export function multiplierAt(elapsedMs) {
  const t = Math.max(0, Number(elapsedMs) || 0);
  const u = Math.min(1, t / ROUND_MS);
  return Math.max(1, Math.round(Math.exp(LOG_MAX * Math.pow(u, ACCEL)) * 100) / 100);
}

export function timeForMultiplier(mult) {
  const m = Math.max(1, Math.min(MAX_MULTIPLIER, Number(mult) || 1));
  return ROUND_MS * Math.pow(Math.log(m) / LOG_MAX, 1 / ACCEL);
}

export function crashPointFromSeed(seedHex, roundId, edge = 0.03) {
  const h = crypto.createHmac('sha256', seedHex).update(`round:${roundId}`).digest();
  // Берём 52 бита → [0,1)
  const int = h.readUIntBE(0, 6) * 2 ** 16 + h.readUIntBE(6, 2);
  const u = int / 2 ** 64;
  const raw = (1 - edge) / (1 - u);
  const point = Math.floor(raw * 100) / 100;
  return Math.max(1, Math.min(10000, point));
}

export function newRoundSeed() {
  return crypto.randomBytes(32).toString('hex');
}

export function seedHash(seedHex) {
  return crypto.createHash('sha256').update(seedHex).digest('hex');
}

export function verifyCrash(seedHex, roundId, expected, edge = 0.03) {
  return crashPointFromSeed(seedHex, roundId, edge) === expected;
}
