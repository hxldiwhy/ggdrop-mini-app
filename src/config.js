import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  const raw = fs.readFileSync(file, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq < 1) continue;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnv(path.join(ROOT, '.env'));

const bool = (v, def = false) => (v === undefined || v === '' ? def : /^(1|true|yes|on)$/i.test(String(v)));

const dataDir = path.join(ROOT, 'data');
const pagesUrlRaw = (process.env.GITHUB_PAGES_URL || '').trim();

export const CONFIG = {
  root: ROOT,
  dataDir,
  publicDir: path.join(ROOT, 'public'),
  token: (process.env.BOT_TOKEN || '').trim(),
  apiBase: (process.env.API_BASE || 'https://api.wiftgram.ru').replace(/\/+$/, ''),
  apiTimeoutMs: Number(process.env.API_TIMEOUT_MS || 60000),
  ownerId: Number(process.env.OWNER_ID || 0),
  publicUrl: (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, ''),
  /** Стабильный адрес на GitHub Pages: страница перенаправляет на текущий бэкенд. */
  pagesUrl: pagesUrlRaw ? `${pagesUrlRaw.replace(/\/+$/, '')}/` : '',
  host: process.env.HOST || '0.0.0.0',
  httpPort: Number(process.env.PORT || 8080),
  httpsPort: Number(process.env.HTTPS_PORT || 8443),
  botMode: (process.env.BOT_MODE || 'polling').toLowerCase(),
  webhookSecret: (process.env.WEBHOOK_SECRET || '').trim(),
  pfxPath: process.env.PFX_PATH ? path.resolve(process.env.PFX_PATH) : path.join(dataDir, 'certs', 'casino.pfx'),
  pfxPass: process.env.PFX_PASS || 'wiftgram',
  dbFile: path.join(dataDir, 'db.json'),
  secretFile: path.join(dataDir, 'secret.key'),
  tunnelUrlFile: path.join(dataDir, 'tunnel-url.txt'),
  publicUrlFile: path.join(dataDir, 'public-url.txt'),
  logErrors: bool(process.env.LOG_ERRORS, true),
  currency: process.env.CURRENCY || 'WFT',
  /** Проверка аккаунта: мини-приложение обязано подтвердить initData того же user_id,
   *  что и в ссылке-токене. Иначе ссылкой можно играть за чужой аккаунт. */
  strictAuth: bool(process.env.STRICT_ACCOUNT_CHECK, true),
  /** initData считается свежим только если он не старше этого времени. */
  initDataMaxAgeMs: Number(process.env.AUTH_MAX_AGE_MS || 30 * 60 * 1000),
  sessionTtlMs: Number(process.env.SESSION_TTL_MS || 12 * 60 * 60 * 1000),
};

export function assertConfig() {
  const problems = [];
  if (!CONFIG.token) problems.push('BOT_TOKEN не задан (см. .env.example)');
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(CONFIG.token)) problems.push('BOT_TOKEN имеет неверный формат');
  if (!Number.isFinite(CONFIG.httpPort)) problems.push('PORT должен быть числом');
  return problems;
}
