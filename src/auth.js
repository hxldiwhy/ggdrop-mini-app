import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.js';

function loadSecret() {
  try {
    if (fs.existsSync(CONFIG.secretFile)) {
      const s = fs.readFileSync(CONFIG.secretFile, 'utf8').trim();
      if (s.length >= 32) return s;
    }
  } catch {}
  const secret = crypto.randomBytes(48).toString('base64url');
  try {
    fs.mkdirSync(path.dirname(CONFIG.secretFile), { recursive: true });
    fs.writeFileSync(CONFIG.secretFile, secret, { mode: 0o600 });
  } catch (err) {
    console.error('[auth] Не удалось сохранить секрет:', err.message);
  }
  return secret;
}

export const SECRET = loadSecret();

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const unB64 = (s) => Buffer.from(s, 'base64url').toString('utf8');

export function hmac(data, key = SECRET) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

/** Подписанный токен входа в мини-приложение: <payload>.<sig>.
 *  sessionId — привязка к конкретному запросу Wiftgram (query_id), чтобы
 *  скопированную ссылку нельзя было открыть в другом клиенте. */
export function signToken(userId, ttlMs = 12 * 60 * 60 * 1000, sessionId = '', via = '') {
  const payload = b64(JSON.stringify({
    u: Number(userId),
    exp: Date.now() + ttlMs,
    n: crypto.randomBytes(6).toString('hex'),
    s: String(sessionId || '').slice(0, 128),
    v: String(via || '').slice(0, 16),
  }));
  const sig = hmac(payload).toString('base64url');
  return `${payload}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = hmac(payload).toString('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(unB64(payload));
    if (!data || !data.u || !data.exp || data.exp < Date.now()) return null;
    return {
      userId: Number(data.u),
      exp: data.exp,
      sessionId: String(data.s || ''),
      nonce: String(data.n || ''),
      via: String(data.v || ''),
    };
  } catch {
    return null;
  }
}

/** Проверка Telegram/Wiftgram initData (алгоритм как в Telegram WebApp).
 *  Возвращает userId + метаданные client-сессии. maxAgeMs > 0 — отбросить старые данные. */
export function parseInitData(initData, botToken = CONFIG.token, maxAgeMs = 0) {
  if (!initData || typeof initData !== 'string') return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (!safeCompare(calc, hash)) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (maxAgeMs > 0 && (!authDate || Date.now() - authDate * 1000 > maxAgeMs)) return null;
  let user;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    return null;
  }
  if (!user || !user.id) return null;
  return {
    user,
    authDate,
    queryId: params.get('query_id') || '',
    startParam: params.get('start_param') || '',
  };
}

/** Обратная совместимость: просто проверенный объект user. */
export function validateInitData(initData, botToken = CONFIG.token) {
  return parseInitData(initData, botToken)?.user || null;
}

/** Генерация ссылки на мини-приложение для конкретного пользователя. */
export function miniAppUrl(base, userId, pathSuffix = 'app') {
  if (!base) return '';
  const clean = base.replace(/\/+$/, '');
  const token = signToken(userId);
  return `${clean}/${pathSuffix}?t=${encodeURIComponent(token)}`;
}

export function safeCompare(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
