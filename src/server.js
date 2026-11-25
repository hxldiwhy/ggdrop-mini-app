import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import tls from 'node:tls';
import { CONFIG, assertConfig } from './config.js';
import { Store } from './store.js';
import { Engine } from './engine.js';
import { Bot } from './bot.js';
import { WiftgramApi, ApiError } from './wiftgram.js';
import { createHttpServer, publicUser, publicSettings } from './http.js';
import { fmtMoney } from './utils.js';

const T = () => new Date().toISOString().slice(11, 19);
const log = {
  info: (...a) => console.log(`[${T()}]`, ...a),
  warn: (...a) => console.warn(`[${T()}] ⚠`, ...a),
  error: (...a) => console.error(`[${T()}] ✖`, ...a),
};

process.on('unhandledRejection', (e) => log.error('unhandledRejection:', e?.message || e));
process.on('uncaughtException', (e) => log.error('uncaughtException:', e?.stack || e));

function lanIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

function readUrlFile(file) {
  try {
    if (!fs.existsSync(file)) return '';
    const s = fs.readFileSync(file, 'utf8').trim();
    return /^https?:\/\/[^\s]+$/i.test(s) ? s.replace(/\/+$/, '') : '';
  } catch {
    return '';
  }
}

async function main() {
  const problems = assertConfig();
  if (problems.length) {
    for (const p of problems) log.error(p);
    process.exit(1);
  }

  const store = new Store();
  const engine = new Engine(store);
  const capped = engine.enforceBalanceCaps();
  if (capped.users) {
    log.info(`Лимит баланса ${store.balanceCap()}: у ${capped.users} игроков ${capped.moved} ⭐ перенесено в банк`);
  }
  const api = new WiftgramApi();
  const bot = new Bot({ engine, store, api, log });
  const botEnabled = CONFIG.botMode !== 'off';

  let me;
  if (botEnabled) {
    try {
      me = await api.getMe();
      log.info(`Бот: @${me.username || '?'} (id ${me.id}, ${me.first_name || ''})`);
    } catch (err) {
      log.error('Не удалось подключиться к Wiftgram API:', err.message);
      if (err instanceof ApiError && err.code === 401) log.error('Проверь BOT_TOKEN в .env');
      process.exit(1);
    }
  } else {
    log.warn('BOT_MODE=off — бот не запущен, доступен только локальный веб-интерфейс');
  }

  if (!store.settings.ownerId && CONFIG.ownerId) {
    store.settings = { ownerId: CONFIG.ownerId };
  }

  const handler = createHttpServer({
    engine,
    api,
    store,
    onWebhook: (update) => bot.handleWebhook(update),
  });

  const httpServer = http.createServer(handler);
  httpServer.listen(CONFIG.httpPort, CONFIG.host, () => {
    log.info(`HTTP   http://127.0.0.1:${CONFIG.httpPort}/app`);
    for (const ip of lanIps()) log.info(`       http://${ip}:${CONFIG.httpPort}/app`);
  });
  httpServer.on('error', (e) => log.error('HTTP сервер:', e.message));

  let httpsServer = null;
  let httpsInfo = '';
  if (fs.existsSync(CONFIG.pfxPath)) {
    try {
      const pfx = fs.readFileSync(CONFIG.pfxPath);
      tls.createSecureContext({ pfx, passphrase: CONFIG.pfxPass });
      httpsServer = https.createServer({ pfx, passphrase: CONFIG.pfxPass }, handler);
      httpsServer.listen(CONFIG.httpsPort, CONFIG.host, () => {
        httpsInfo = `https://127.0.0.1:${CONFIG.httpsPort}/app`;
        log.info(`HTTPS  ${httpsInfo}`);
        for (const ip of lanIps()) log.info(`       https://${ip}:${CONFIG.httpsPort}/app`);
      });
      httpsServer.on('error', (e) => log.error('HTTPS сервер:', e.message));
    } catch (err) {
      log.warn('Сертификат не подошёл, HTTPS выключен:', err.message);
    }
  } else {
    log.warn('HTTPS-сертификат не найден (scripts/make-cert.ps1). Для мини-приложения нужен публичный HTTPS — запусти scripts/tunnel.ps1');
  }

  // Комиссия за хранение применяется и к тем, кто просто не заходил в приложение.
  const feeTimer = setInterval(() => {
    const s = store.settings;
    if (!s.storageFee?.enabled) return;
    for (const u of store.users()) {
      if (engine.isOwner(u.id) || u.banned || u.balance <= (s.storageFee.threshold || 0)) continue;
      try { engine.applyStorageFee(u); } catch (e) { log.warn('Комиссия хранилища:', e.message); }
    }
  }, 30 * 60 * 1000);
  feeTimer.unref?.();

  engine.startCrash();
  engine.on('crash:crash', (st) => {
    if (process.env.LOG_CRASH === '1') log.info(`Краш x${st.crashPoint} (раунд ${st.roundId})`);
  });

  // ─── отслеживание публичного адреса туннеля ───
  let lastTunnel = '';
  const urlTimer = setInterval(() => {
    const tunnel = readUrlFile(CONFIG.tunnelUrlFile);
    if (tunnel && tunnel !== lastTunnel) {
      lastTunnel = tunnel;
      const manual = store.settings.publicUrl && store.settings.publicUrl !== tunnel && !/trycloudflare\.com|tunnel|ngrok|loca\.lt/i.test(store.settings.publicUrl);
      if (!store.settings.publicUrl || !manual) {
        store.settings = { publicUrl: tunnel };
        store.save();
        log.info(`Публичный адрес обновлён из туннеля: ${tunnel}`);
        const oid = Number(store.settings.ownerId || 0);
        if (oid) {
          bot.setupMenuButton?.(oid, oid).catch(() => {});
          bot.sendApp(
            oid,
            `🌐 <b>Новый публичный адрес поднят</b>\n<code>${tunnel}/app</code>\nДизайн обновлён: тёмно-синий приватный клуб, 7 игр без слотов.`
          ).catch(() => {});
        }
      }
    }
    const manualUrl = readUrlFile(CONFIG.publicUrlFile);
    if (manualUrl && manualUrl !== store.settings.publicUrl) {
      store.settings = { publicUrl: manualUrl };
      store.save();
      log.info(`Публичный адрес из public-url.txt: ${manualUrl}`);
    }
  }, 3000);
  urlTimer.unref?.();

  if (botEnabled) await bot.start();

  if (!botEnabled) {
    // веб-интерфейс работает без бота
  } else if (CONFIG.botMode === 'webhook') {
    const base = store.settings.publicUrl || CONFIG.publicUrl;
    if (base) {
      try {
        await api.setWebhook(`${base}/webhook/${CONFIG.webhookSecret || 'wiftgram'}`, CONFIG.webhookSecret || undefined);
        log.info('Вебхук установлен:', `${base}/webhook/...`);
      } catch (err) {
        log.warn('Не удалось установить вебхук:', err.message);
      }
    } else {
      log.warn('BOT_MODE=webhook, но публичный адрес не задан — остаюсь на long polling');
    }
  } else {
    try { await api.deleteWebhook(); } catch {}
  }

  const ownerId = Number(store.settings.ownerId || 0);
  const publicUrl = store.settings.publicUrl || 'не задан';
  log.info('─'.repeat(64));
  log.info(`Хозяин казино: ${ownerId ? `${ownerId}${store.user(ownerId)?.username ? ' @' + store.user(ownerId).username : ''}` : 'ещё не назначен (напиши боту /start)'}`);
  log.info(`Публичный адрес: ${publicUrl}`);
  log.info(`Мини-приложение: ${publicUrl !== 'не задан' ? publicUrl + '/app' : `http://127.0.0.1:${CONFIG.httpPort}/app`}`);
  log.info(`Валюта: ${store.settings.currency} · ставки ${store.settings.minBet}–${store.settings.maxBet}`);
  log.info(`Баланс: потолок ${store.balanceCap()} · комиссия ${store.settings.storageFee?.percentPerDay || 0}%/сутки сверх ${store.settings.storageFee?.threshold || 0}`);
  log.info(`Проверка аккаунта: ${CONFIG.strictAuth ? 'включена (initData)' : 'совместимый режим (без initData)'}`);
  log.info('─'.repeat(64));

  if (botEnabled && ownerId && !store.settings.publicUrl) {
    bot.send(
      ownerId,
      '👑 <b>Казино запущено локально</b>\n\n' +
        `Сервер работает: <code>http://127.0.0.1:${CONFIG.httpPort}/app</code>\n\n` +
        'Для мини-приложения в Wiftgram нужен <b>публичный HTTPS</b>.\n' +
        'Запусти в отдельном окне <code>scripts\\tunnel.ps1</code> — он поднимет туннель и пришлёт сюда адрес автоматически.'
    ).catch(() => {});
  }

  let closing = false;
  const shutdown = async (sig) => {
    if (closing) return;
    closing = true;
    log.info(`Остановка (${sig})…`);
    clearInterval(urlTimer);
    clearInterval(feeTimer);
    engine.stopCrash();
    await bot.stop().catch(() => {});
    store.flushSync();
    httpServer.close();
    httpsServer?.close();
    setTimeout(() => process.exit(0), 300).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  log.error('Фатальная ошибка:', e?.stack || e);
  process.exit(1);
});
