import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Engine } from '../src/engine.js';
import { createHttpServer } from '../src/http.js';
import { signToken } from '../src/auth.js';

async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-http-'));
  const store = new Store(path.join(dir, 'db.json'));
  const engine = new Engine(store);
  store.settings = { ownerId: 1001 };
  const owner = store.ensureUser({ id: 1001, first_name: 'Host' });
  store.credit(owner, 1_000_000);
  const user = store.ensureUser({ id: 2002, username: 'player', first_name: 'Player' });
  store.credit(user, 100_000);

  // Тесты API работают с «сырыми» токенами; проверка initData тестируется отдельно.
  const handler = createHttpServer({ engine, api: null, store, requireInitData: false });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (p, { method = 'GET', token, body } = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  try {
    await fn({ base, call, store, engine, owner, user });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('health', async () => {
  await withServer(async ({ call }) => {
    const r = await call('/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
  });
});

test('сессия по подписанному токену', async () => {
  await withServer(async ({ call, user }) => {
    const token = signToken(user.id);
    const r = await call('/api/session', { method: 'POST', body: { t: token } });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.id, user.id);
    assert.ok(r.data.token);
    assert.ok(r.data.settings.minBet > 0);
  });
});

test('без токена — 401', async () => {
  await withServer(async ({ call }) => {
    const r = await call('/api/session', { method: 'POST', body: { t: 'bad' } });
    assert.equal(r.status, 401);
    const me = await call('/api/me');
    assert.equal(me.status, 401);
  });
});

test('профиль и ставка в кости', async () => {
  await withServer(async ({ call, user }) => {
    const token = signToken(user.id);
    const me = await call('/api/me', { token });
    assert.equal(me.data.user.balance, 100_000);
    const bet = await call('/api/dice/bet', { method: 'POST', token, body: { amount: 500, target: 50, over: true } });
    assert.equal(bet.status, 200);
    assert.ok(bet.data.roll >= 1 && bet.data.roll <= 100);
    assert.equal(bet.data.user.balance, 100_000 - 500 + bet.data.payout);
  });
});

test('рулетка через API', async () => {
  await withServer(async ({ call, user }) => {
    const token = signToken(user.id);
    const r = await call('/api/roulette/bet', {
      method: 'POST',
      token,
      body: { bets: [{ type: 'red', amount: 200 }, { type: 'dozen1', amount: 100 }] },
    });
    assert.equal(r.status, 200);
    assert.ok(r.data.result >= 0 && r.data.result <= 36);
    assert.equal(r.data.totalBet, 300);
  });
});

test('админка: игроку нельзя, хозяину можно', async () => {
  await withServer(async ({ call, user, owner }) => {
    const userToken = signToken(user.id);
    const ownerToken = signToken(owner.id);
    const forbidden = await call('/api/admin/overview', { token: userToken });
    assert.equal(forbidden.status, 403);
    const ok = await call('/api/admin/overview', { token: ownerToken });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.data.ownerId, 1001);
    assert.ok(ok.data.data.users >= 2);
  });
});

test('админка: выдача фишек и настройки', async () => {
  await withServer(async ({ call, user, owner }) => {
    const ownerToken = signToken(owner.id);
    const r = await call('/api/admin/user', { method: 'POST', token: ownerToken, body: { id: user.id, action: 'credit', amount: 7000 } });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.balance, 107_000);
    const st = await call('/api/admin/settings', { method: 'POST', token: ownerToken, body: { minBet: 25, maxBet: 5000 } });
    assert.equal(st.data.settings.minBet, 25);
  });
});

test('статика отдаётся', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/app?t=x`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('GGDROP CASINO'));
    assert.ok(html.includes('app.js'));
  });
});

test('неизвестный метод API — 404', async () => {
  await withServer(async ({ call, user }) => {
    const token = signToken(user.id);
    const r = await call('/api/nope', { token });
    assert.equal(r.status, 404);
    assert.equal(r.data.ok, false);
  });
});

test('games-info: секторы колеса и таблицы плинко', async () => {
  await withServer(async ({ call, user }) => {
    const token = signToken(user.id);
    const r = await call('/api/games-info', { token });
    assert.equal(r.status, 200);
    assert.equal(r.data.wheel.sectors.length, 11);
    const chance = r.data.wheel.sectors.reduce((s, x) => s + x.chance, 0);
    assert.ok(Math.abs(chance - 100) < 0.2);
    for (const rows of [8, 12, 16]) {
      assert.equal(r.data.plinko[rows].high.length, rows + 1);
    }
  });
});

test('колесо и плинко через API', async () => {
  await withServer(async ({ call, user }) => {
    const token = signToken(user.id);
    const w = await call('/api/wheel/spin', { method: 'POST', token, body: { amount: 300 } });
    assert.equal(w.status, 200);
    assert.ok(w.data.index >= 0);
    assert.ok(w.data.user.balance >= 0);

    const p = await call('/api/plinko/drop', { method: 'POST', token, body: { amount: 200, rows: 16, risk: 'high' } });
    assert.equal(p.status, 200);
    assert.equal(p.data.rows, 16);
    assert.equal(p.data.path.length, 16);
  });
});

test('пополнение: создание заявки и подтверждение хозяином', async () => {
  await withServer(async ({ call, user, owner }) => {
    const userToken = signToken(user.id);
    const ownerToken = signToken(owner.id);
    const dep = await call('/api/deposit', { method: 'POST', token: userToken, body: { amount: 700 } });
    assert.equal(dep.status, 200);
    assert.equal(dep.data.deposit.status, 'pending');
    assert.equal(dep.data.cashier, 'crypt');

    const list = await call('/api/admin/deposits', { token: ownerToken });
    assert.equal(list.status, 200);
    assert.equal(list.data.deposits.length, 1);

    const bad = await call('/api/admin/deposit', { method: 'POST', token: userToken, body: { id: dep.data.deposit.id, approve: true } });
    assert.equal(bad.status, 403);

    const before = (await call('/api/me', { token: userToken })).data.user.balance;
    const ok = await call('/api/admin/deposit', { method: 'POST', token: ownerToken, body: { id: dep.data.deposit.id, approve: true } });
    assert.equal(ok.status, 200);
    const after = (await call('/api/me', { token: userToken })).data.user.balance;
    assert.equal(after, before + 700);
  });
});
