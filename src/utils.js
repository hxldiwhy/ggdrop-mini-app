import crypto from 'node:crypto';

/** Криптостойкий генератор [0,1) */
export function rng() {
  return crypto.randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
}

export function rngInt(min, max) {
  return crypto.randomInt(min, max + 1);
}

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const roundMoney = (n) => Math.max(0, Math.round(Number(n) || 0));
export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export function fmtMoney(n, currency = '') {
  const num = Math.round(Number(n) || 0);
  const s = num.toLocaleString('ru-RU').replace(/\u00a0/g, ' ');
  return currency ? `${s} ${currency}` : s;
}

export function fmtMult(m) {
  const n = Number(m) || 0;
  return `${n >= 100 ? n.toFixed(0) : n.toFixed(2)}x`;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Комбинаторика без зависимостей */
export function binom(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let res = 1;
  for (let i = 1; i <= k; i++) res = (res * (n - k + i)) / i;
  return res;
}

export const escapeHtml = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const shortName = (u) => (u.username ? `@${u.username}` : u.firstName || `id${u.id}`);
