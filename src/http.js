import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.js';
import { CasinoError, ERRORS } from './errors.js';
import { verifyToken, parseInitData, signToken } from './auth.js';
import { WHEEL_SEGMENTS, wheelMultiplierFor } from './games/wheel.js';
import { RISKS, ROWS, multipliersFor } from './games/plinko.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
};

const MAX_BODY = 2 * 1024 * 1024;

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new CasinoError('BODY_TOO_LARGE', 'Слишком большой запрос', 413));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new CasinoError('BAD_JSON', 'Некорректный JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function publicUser(engine, u) {
  const s = engine.settings;
  const dailyIn = Math.max(0, (u.lastDaily || 0) + s.dailyCooldownMs - Date.now());
  return {
    id: u.id,
    username: u.username || '',
    firstName: u.firstName || '',
    balance: u.balance,
    isOwner: engine.isOwner(u.id),
    banned: !!u.banned,
    vault: u.vault || 0,
    feePaid: u.feePaid || 0,
    games: u.games || 0,
    wins: u.wins || 0,
    losses: u.losses || 0,
    totalBet: u.totalBet || 0,
    totalWin: u.totalWin || 0,
    biggestWin: u.biggestWin || 0,
    createdAt: u.createdAt,
    refCount: u.refCount || 0,
    streak: u.streak || 0,
    nfts: (u.nfts || []).slice(-12).reverse(),
    luckyReady: Math.max(0, (u.lastLucky || 0) + 86400000 - Date.now()) <= 0,
    luckyIn: Math.max(0, (u.lastLucky || 0) + 86400000 - Date.now()),
    dailyIn,
    dailyReady: dailyIn <= 0,
  };
}

export function publicSettings(engine) {
  const s = engine.settings;
  return {
    currency: s.currency,
    minBet: s.minBet,
    maxBet: s.maxBet,
    limits: s.limits,
    maintenance: s.maintenance,
    dailyBonus: s.dailyBonus,
    welcomeBonus: s.welcomeBonus,
    crash: s.crash,
    houseEdge: s.houseEdge,
    publicUrl: s.publicUrl,
    botUsername: s.botUsername || '',
    cashierUsername: s.cashierUsername || '',
    minDeposit: s.minDeposit,
    maxDeposit: s.maxDeposit,
    maxPendingDeposits: s.maxPendingDeposits,
    maxBalance: engine.store.balanceCap(),
    storageFee: s.storageFee,
    minWithdraw: s.minWithdraw,
    maxWithdraw: s.maxWithdraw,
  };
}

export function createHttpServer({ engine, api, store, onWebhook, requireInitData = CONFIG.strictAuth }) {
  const rate = new Map();
  function limit(userId) {
    const t = Date.now();
    const arr = (rate.get(userId) || []).filter((x) => t - x < 2000);
    arr.push(t);
    rate.set(userId, arr);
    if (arr.length > 40) throw new CasinoError('RATE_LIMIT', 'Слишком много запросов, притормози', 429);
    if (rate.size > 5000) rate.clear();
  }

  function auth(req) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const data = verifyToken(token);
    if (!data) throw new CasinoError('UNAUTHORIZED', 'Сессия истекла, открой казино заново', 401);
    const user = store.user(data.userId);
    if (!user) throw new CasinoError('USER_NOT_FOUND', 'Пользователь не найден', 401);
    // Токен из кнопки бота привязан к конкретному client-запросу Wiftgram.
    // Подменить ссылку чужим аккаунтом не получится: initData подписан ботом.
    if (requireInitData) {
      const raw = String(req.headers['x-wiftgram-init-data'] || '');
      // initData выдаётся при открытии WebApp и не обновляется, поэтому свежесть
      // проверяем только на входе; здесь важна только подпись и совпадение user_id.
      const client = parseInitData(raw, CONFIG.token, 0);
      if (!client || Number(client.user.id) !== data.userId) {
        throw new CasinoError('ACCOUNT_MISMATCH', 'Сессия привязана к другому аккаунту. Открой казино заново из бота', 401);
      }
      // Новые токены дополнительно привязаны к конкретному запросу Wiftgram.
      if (data.sessionId && client.queryId !== data.sessionId) {
        throw new CasinoError('ACCOUNT_MISMATCH', 'Сессия привязана к другому аккаунту. Открой казино заново из бота', 401);
      }
    }
    engine.applyStorageFee(user);
    return user;
  }

  function serveStatic(req, res, urlPath) {
    let rel = decodeURIComponent(urlPath.split('?')[0]);
    if (rel === '/' || rel === '/app' || rel === '/index' || rel === '/admin') rel = '/index.html';
    const filePath = path.join(CONFIG.publicDir, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!filePath.startsWith(CONFIG.publicDir)) return sendText(res, 403, 'Forbidden');
    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) return sendText(res, 404, 'Not found');
      const ext = path.extname(filePath).toLowerCase();
      const fresh = ['.html', '.js', '.mjs', '.css', '.webmanifest'].includes(ext);
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': fresh ? 'no-store, no-cache, must-revalidate' : 'public, max-age=3600',
        'Pragma': fresh ? 'no-cache' : 'public',
        'Expires': fresh ? '0' : '',
      });
      fs.createReadStream(filePath).pipe(res);
    });
  }

  return async function handler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'OPTIONS') {
      res.writeHead(204, { Allow: 'GET, POST, OPTIONS' });
      return res.end();
    }

    try {
      if (p === '/api/health') {
        return sendJson(res, 200, { ok: true, ts: Date.now(), phase: engine.crash.phase });
      }

      // ─── вебхук Wiftgram ───
      if (p.startsWith('/webhook/') && req.method === 'POST') {
        if (CONFIG.webhookSecret && p !== `/webhook/${CONFIG.webhookSecret}`) {
          return sendJson(res, 403, { ok: false });
        }
        const update = await readJson(req);
        if (onWebhook) onWebhook(update).catch((e) => console.error('[webhook]', e));
        return sendJson(res, 200, { ok: true });
      }

      // ─── сессия ───
      if (p === '/api/session' && req.method === 'POST') {
        const body = await readJson(req);
        const rawInit = String(body.initData || '');
        const client = parseInitData(rawInit, CONFIG.token, CONFIG.initDataMaxAgeMs);
        const linked = body.t ? verifyToken(String(body.t)) : null;
        const unsafe = body.unsafe && typeof body.unsafe === 'object' ? body.unsafe : null;
        const unsafeId = Number(unsafe?.user?.id || 0);

        if (requireInitData && !client) {
          let why = 'пусто';
          if (rawInit) {
            const params = new URLSearchParams(rawInit);
            why = params.has('hash') ? 'плохая подпись или старый auth_date' : 'нет hash';
          }
          console.warn(`[session] initData отклонён: ${why}; длина=${rawInit.length}; tokenLen=${CONFIG.token.length}`);
          throw new CasinoError('ACCOUNT_CHECK', 'Нужна проверка аккаунта: открой казино кнопкой в Wiftgram', 401);
        }
        if (client && linked && Number(client.user.id) !== linked.userId) {
          console.warn(`[session] несовпадение аккаунта: client=${client.user.id}, token=${linked.userId}, query=${client.queryId || '-'}`);
          throw new CasinoError('ACCOUNT_MISMATCH', 'Эта ссылка выдана другому аккаунту. Открой казино из своего бота', 401);
        }
        // Wiftgram не шлёт подписанный initData. Если клиент всё же отдал id
        // через WebApp — проверяем его, чтобы скопированную ссылку не подхватил другой игрок.
        if (!client && linked && unsafeId && unsafeId !== linked.userId) {
          console.warn(`[session] несовпадение webApp id: unsafe=${unsafeId}, token=${linked.userId}`);
          throw new CasinoError('ACCOUNT_MISMATCH', 'Эта ссылка выдана другому аккаунту. Открой казино из своего бота', 401);
        }
        if (!client && linked) {
          console.warn(`[session] совместимый вход без initData: token=${linked.userId}, webApp id=${unsafeId || '-'}`);
        }

        const from = client?.user || null;
        let userId = from ? Number(from.id) : linked?.userId || 0;
        if (!userId) throw new CasinoError('UNAUTHORIZED', 'Ссылка устарела. Открой казино заново из бота', 401);
        let user = store.user(userId);
        if (!user) {
          if (!from) throw new CasinoError('UNAUTHORIZED', 'Сначала нажми /start в боте', 401);
          user = store.ensureUser(from);
        }
        if (user.banned) throw new CasinoError('BANNED', ERRORS.BANNED, 403);
        engine.applyStorageFee(user);
        // приветственный бонус, если игрок зашёл сразу в мини-приложение
        if (!user.welcomed && user.balance === 0 && store.settings.welcomeBonus > 0) {
          store.credit(user, store.settings.welcomeBonus, 'welcome');
          user.welcomed = true;
          store.save();
        }
        user.verifiedAt = Date.now();
        store.save();
        return sendJson(res, 200, {
          ok: true,
          token: signToken(user.id, CONFIG.sessionTtlMs, client?.queryId || ''),
          user: publicUser(engine, user),
          settings: publicSettings(engine),
          storeName: store.settings.currency,
        });
      }

      if (p.startsWith('/api/')) {
        const user = auth(req);
        limit(user.id);
        const body = req.method === 'POST' ? await readJson(req) : {};
        const s = store.settings;
        const stop = () => {
          if (user.banned) throw new CasinoError('BANNED', ERRORS.BANNED, 403);
        };

        // ── профиль ──
        if (p === '/api/games-info' && req.method === 'GET') {
          const edge = engine.settings.houseEdge;
          const total = WHEEL_SEGMENTS.reduce((s, x) => s + x.weight, 0);
          const sectors = WHEEL_SEGMENTS.map((s) => ({
            key: s.key,
            label: s.label,
            color: s.color,
            chance: Math.round((s.weight / total) * 1000) / 10,
            multiplier: s.m === 0 ? 0 : Math.round(wheelMultiplierFor(s, edge.wheel) * 100) / 100,
          }));
          const plinko = {};
          for (const rows of ROWS) {
            plinko[rows] = {};
            for (const risk of Object.keys(RISKS)) plinko[rows][risk] = multipliersFor(rows, risk, edge.plinko);
          }
          return sendJson(res, 200, {
            ok: true,
            wheel: { sectors, rtp: Math.round((1 - edge.wheel) * 1000) / 1000 },
            plinko,
          });
        }
        if (p === '/api/me' && req.method === 'GET') {
          return sendJson(res, 200, { ok: true, user: publicUser(engine, user), settings: publicSettings(engine) });
        }
        if (p === '/api/daily' && req.method === 'POST') {
          const r = engine.daily(user.id);
          return sendJson(res, 200, { ok: true, ...r, user: publicUser(engine, store.user(user.id)) });
        }
        if (p === '/api/promo' && req.method === 'POST') {
          const r = engine.redeemPromo(user.id, body.code);
          return sendJson(res, 200, { ok: true, ...r, user: publicUser(engine, store.user(user.id)) });
        }
        if (p === '/api/transfer' && req.method === 'POST') {
          const r = engine.transfer(user.id, Number(body.toId), body.amount);
          return sendJson(res, 200, { ok: true, ...r });
        }
        if (p === '/api/history' && req.method === 'GET') {
          const limitN = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20));
          return sendJson(res, 200, { ok: true, items: engine.detailHistory(user.id, limitN) });
        }
        if (p === '/api/leaderboard') {
          const top = store.leaderboard(10).map((u, i) => ({
            place: i + 1,
            id: u.id,
            name: u.username ? `@${u.username}` : u.firstName || `id${u.id}`,
            net: (u.totalWin || 0) - (u.totalBet || 0),
            win: u.biggestWin || 0,
          }));
          return sendJson(res, 200, { ok: true, top });
        }

        // ── игры ──
        if (p === '/api/roulette/bet' && req.method === 'POST') {
          stop();
          const r = engine.spinRoulette(user.id, body.bets);
          return sendJson(res, 200, { ok: true, ...r, user: publicUser(engine, user) });
        }
        if (p === '/api/dice/bet' && req.method === 'POST') {
          stop();
          const r = engine.rollDice(user.id, { amount: body.amount, target: body.target, over: !!body.over });
          return sendJson(res, 200, { ok: true, ...r, user: publicUser(engine, user) });
        }
        if (p === '/api/wheel/spin' && req.method === 'POST') {
          stop();
          const r = engine.spinWheel(user.id, body.amount);
          return sendJson(res, 200, { ok: true, ...r, user: publicUser(engine, user) });
        }
        if (p === '/api/plinko/drop' && req.method === 'POST') {
          stop();
          const r = engine.dropPlinko(user.id, {
            amount: body.amount,
            rows: body.rows,
            risk: body.risk,
            count: body.count,
          });
          return sendJson(res, 200, { ok: true, ...r, user: publicUser(engine, user) });
        }
        if (p === '/api/coinflip/bet' && req.method === 'POST') {
          stop();
          const r = engine.playCoinflip(user.id, { amount: body.amount, side: body.side });
          return sendJson(res, 200, { ok: true, ...r, user: publicUser(engine, user) });
        }
        if (p === '/api/lucky/spin' && req.method === 'POST') {
          const r = engine.luckySpin(user.id);
          return sendJson(res, 200, { ok: true, ...r, user: publicUser(engine, store.user(user.id)) });
        }
        if (p === '/api/feed' && req.method === 'GET') {
          const limitN = Math.min(30, Math.max(1, Number(url.searchParams.get('limit')) || 20));
          return sendJson(res, 200, { ok: true, items: engine.winFeed(limitN) });
        }

        // ── аукцион ──
        if (p === '/api/auction' && req.method === 'GET') {
          return sendJson(res, 200, { ok: true, ...engine.auctionPublic(user.id) });
        }
        if (p === '/api/auction/create' && req.method === 'POST') {
          const r = engine.auctionCreate(user.id, body);
          return sendJson(res, 200, { ok: true, ...r, user: publicUser(engine, user) });
        }
        if (p === '/api/auction/bid' && req.method === 'POST') {
          const r = engine.auctionBid(user.id, body);
          return sendJson(res, 200, { ok: true, ...r, user: publicUser(engine, user) });
        }
        if (p === '/api/auction/finish' && req.method === 'POST') {
          const r = engine.auctionFinish(user.id, body.lotId);
          return sendJson(res, 200, { ok: true, ...r, user: publicUser(engine, user) });
        }
        if (p === '/api/auction/cancel' && req.method === 'POST') {
          const r = engine.auctionCancel(user.id, body.lotId);
          return sendJson(res, 200, { ok: true, ...r, user: publicUser(engine, user) });
        }

        // ── пополнение звёзд ──
        if (p === '/api/deposit' && req.method === 'POST') {
          const dep = engine.createDeposit(user.id, body.amount);
          return sendJson(res, 200, { ok: true, deposit: dep, cashier: engine.settings.cashierUsername });
        }
        if (p === '/api/deposits' && req.method === 'GET') {
          return sendJson(res, 200, {
            ok: true,
            items: engine.depositsFor(user.id),
            cashier: engine.settings.cashierUsername,
            min: engine.settings.minDeposit,
          });
        }
        if (p === '/api/withdraw' && req.method === 'POST') {
          const wd = engine.createWithdrawal(user.id, { amount: body.amount, contact: body.contact });
          return sendJson(res, 200, { ok: true, withdrawal: wd, cashier: engine.settings.cashierUsername });
        }
        if (p === '/api/withdrawals' && req.method === 'GET') {
          return sendJson(res, 200, {
            ok: true,
            items: engine.withdrawalsFor(user.id),
            cashier: engine.settings.cashierUsername,
            min: engine.settings.minWithdraw,
            max: engine.settings.maxWithdraw,
          });
        }
        if (p === '/api/blackjack/start' && req.method === 'POST') {
          stop();
          const r = engine.startBlackjack(user.id, body.amount);
          return sendJson(res, 200, { ok: true, ...r, user: publicUser(engine, user) });
        }
        if (p === '/api/blackjack/action' && req.method === 'POST') {
          const r = engine.actionBlackjack(user.id, body.id, body.action);
          return sendJson(res, 200, { ok: true, ...r, user: publicUser(engine, user) });
        }
        if (p === '/api/crash/state') {
          const st = engine.crashPublicState();
          const my = engine.crash.bets.get(user.id) || null;
          return sendJson(res, 200, {
            ok: true,
            state: st,
            myBet: my ? { amount: my.amount, autoCashout: my.autoCashout, cashedOut: my.cashedOut, cashoutMultiplier: my.cashoutMultiplier, payout: my.payout } : null,
            balance: user.balance,
          });
        }
        if (p === '/api/crash/bet' && req.method === 'POST') {
          stop();
          const r = engine.crashBet(user.id, { amount: body.amount, autoCashout: body.autoCashout });
          return sendJson(res, 200, { ok: true, ...r, user: publicUser(engine, user) });
        }
        if (p === '/api/crash/cashout' && req.method === 'POST') {
          const r = engine.crashCashout(user.id);
          return sendJson(res, 200, { ok: true, ...r, user: publicUser(engine, store.user(user.id)) });
        }

        // ── админ ──
        if (p.startsWith('/api/admin/')) {
          engine.assertOwner(user.id);
          if (p === '/api/admin/overview' && req.method === 'GET') {
            return sendJson(res, 200, { ok: true, data: engine.adminStats(user.id) });
          }
          if (p === '/api/admin/users' && req.method === 'GET') {
            const q = (url.searchParams.get('q') || '').toLowerCase().trim();
            const list = store.users()
              .filter((u) => !q || String(u.id).includes(q) || (u.username || '').toLowerCase().includes(q) || (u.firstName || '').toLowerCase().includes(q))
              .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
              .slice(0, 60)
              .map((u) => publicUser(engine, u));
            return sendJson(res, 200, { ok: true, users: list });
          }
          if (p === '/api/admin/user' && req.method === 'POST') {
            const r = engine.adminUserAction(user.id, Number(body.id), String(body.action), body.amount);
            return sendJson(res, 200, { ok: true, user: publicUser(engine, r.user) });
          }
          if (p === '/api/admin/settings' && req.method === 'POST') {
            engine.adminSetSettings(user.id, body);
            return sendJson(res, 200, { ok: true, settings: publicSettings(engine) });
          }
          if (p === '/api/admin/promo' && req.method === 'POST') {
            if (body.delete) {
              engine.adminDeletePromo(user.id, body.code);
              return sendJson(res, 200, { ok: true, promos: Object.values(store.data.promos) });
            }
            const promo = engine.adminCreatePromo(user.id, body);
            return sendJson(res, 200, { ok: true, promo, promos: Object.values(store.data.promos) });
          }
          if (p === '/api/admin/broadcast' && req.method === 'POST') {
            const r = engine.adminBroadcast(user.id, body.text);
            return sendJson(res, 200, { ok: true, ...r });
          }
          if (p === '/api/admin/deposits' && req.method === 'GET') {
            return sendJson(res, 200, {
              ok: true,
              deposits: engine.pendingDeposits(50),
              history: engine.store.data.deposits
                .filter((d) => d.status !== 'pending')
                .sort((a, b) => b.decidedAt - a.decidedAt)
                .slice(0, 20),
            });
          }
          if (p === '/api/admin/deposit' && req.method === 'POST') {
            const dep = engine.decideDeposit(user.id, body.id, !!body.approve);
            return sendJson(res, 200, { ok: true, deposit: dep });
          }
          if (p === '/api/admin/withdrawals' && req.method === 'GET') {
            return sendJson(res, 200, {
              ok: true,
              withdrawals: engine.pendingWithdrawals(50),
              history: store.data.withdrawals
                .filter((w) => w.status !== 'pending')
                .sort((a, b) => b.decidedAt - a.decidedAt)
                .slice(0, 20),
            });
          }
          if (p === '/api/admin/withdraw' && req.method === 'POST') {
            const wd = engine.decideWithdrawal(user.id, body.id, !!body.approve, body.note);
            return sendJson(res, 200, { ok: true, withdrawal: wd });
          }
          if (p === '/api/admin/auction' && req.method === 'POST') {
            const r = engine.auctionCreate(user.id, body);
            return sendJson(res, 200, { ok: true, ...r });
          }
          if (p === '/api/admin/auction/finish' && req.method === 'POST') {
            const r = engine.auctionFinish(user.id, body.lotId);
            return sendJson(res, 200, { ok: true, ...r });
          }
          if (p === '/api/admin/auction/cancel' && req.method === 'POST') {
            const r = engine.auctionCancel(user.id, body.lotId);
            return sendJson(res, 200, { ok: true, ...r });
          }
          if (p === '/api/admin/give' && req.method === 'POST') {
            const amount = Math.round(Number(body.amount));
            const targets = store.users().filter((u) => (body.all ? !u.banned : true));
            for (const t of body.all ? targets : [store.user(Number(body.id))].filter(Boolean)) {
              store.credit(t, amount, 'admin-give');
            }
            return sendJson(res, 200, { ok: true, count: body.all ? targets.length : 1 });
          }
        }

        throw new CasinoError('NOT_FOUND', 'Неизвестный метод API', 404);
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        return serveStatic(req, res, p);
      }

      return sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });
    } catch (err) {
      if (err instanceof CasinoError) {
        return sendJson(res, err.http || 400, { ok: false, error: err.code, description: err.message });
      }
      console.error('[http]', err);
      return sendJson(res, 500, { ok: false, error: 'INTERNAL', description: 'Сбой на сервере' });
    }
  };
}
