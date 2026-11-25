import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Engine } from '../src/engine.js';
import { createHttpServer } from '../src/http.js';
import { CONFIG } from '../src/config.js';
import { signToken } from '../src/auth.js';

function makeInitData({ id, botToken = CONFIG.token, queryId = 'q_test_1', authDate = Math.floor(Date.now() / 1000) }) {
  const user = JSON.stringify({ id, first_name: 'Player' });
  const params = new URLSearchParams({ query_id: queryId, user, auth_date: String(authDate) });
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}

async function withStrictServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-secure-'));
  const store = new Store(path.join(dir, 'db.json'));
  const engine = new Engine(store);
  store.settings = { ownerId: 1001, maxBalance: 150000, storageFee: { enabled: false, threshold: 100000, percentPerDay: 1, intervalMs: 1000 } };
  const owner = store.ensureUser({ id: 1001, first_name: 'Host' });
  const user = store.ensureUser({ id: 2002, first_name: 'Player' });
  store.credit(user, 1000);

  const handler = createHttpServer({ engine, api: null, store, requireInitData: true });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (p, { method = 'GET', token, body, initData } = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(initData ? { 'X-Wiftgram-Init-Data': initData } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  try {
    await fn({ call, store, engine, owner, user });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('строгий вход: вход без кнопки бота не принимается', async () => {
  await withStrictServer(async ({ call }) => {
    const r = await call('/api/session', { method: 'POST', body: { initData: '' } });
    assert.equal(r.status, 401);
    assert.equal(r.data.error, 'ACCOUNT_CHECK');
  });
});

test('строгий вход: чужой initData не подходит к чужой ссылке', async () => {
  await withStrictServer(async ({ call, user }) => {
    const r = await call('/api/session', {
      method: 'POST',
      body: { t: signToken(user.id), initData: makeInitData({ id: 9999 }) },
    });
    assert.equal(r.status, 401);
    assert.equal(r.data.error, 'ACCOUNT_MISMATCH');
  });
});

test('строгий вход: свои initData + ссылка дают сессию, привязанную к query_id', async () => {
  await withStrictServer(async ({ call, user }) => {
    const initData = makeInitData({ id: user.id, queryId: 'q_mine_7' });
    const r = await call('/api/session', { method: 'POST', body: { t: signToken(user.id), initData } });
    assert.equal(r.status, 200);
    const token = r.data.token;
    assert.ok(token);

    const ok = await call('/api/me', { token, initData });
    assert.equal(ok.status, 200);

    const wrong = await call('/api/me', { token, initData: makeInitData({ id: user.id, queryId: 'q_other' }) });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.data.error, 'ACCOUNT_MISMATCH');
  });
});

test('строгий вход: Wiftgram без подписи пускает игрока по персональной кнопке', async () => {
  await withStrictServer(async ({ call, user }) => {
    const login = signToken(user.id);
    const r = await call('/api/session', {
      method: 'POST',
      body: { t: login, unsafe: { user: { id: user.id } } },
    });
    assert.equal(r.status, 200);
    assert.ok(r.data.token);

    const me = await call('/api/me', { token: r.data.token });
    assert.equal(me.status, 200);
    assert.equal(me.data.user.id, user.id);

    // Кнопку в меню бота можно нажать повторно без запроса /start.
    const again = await call('/api/session', {
      method: 'POST',
      body: { t: login, unsafe: { user: { id: user.id } } },
    });
    assert.equal(again.status, 200);
  });
});

test('строгий вход: Wiftgram без id клиента пускает только по кнопке бота', async () => {
  await withStrictServer(async ({ call, user }) => {
    const r = await call('/api/session', {
      method: 'POST',
      body: { t: signToken(user.id) },
    });
    assert.equal(r.status, 200);

    const me = await call('/api/me', { token: r.data.token });
    assert.equal(me.status, 200);
    assert.equal(me.data.user.id, user.id);

    const noToken = await call('/api/session', { method: 'POST', body: {} });
    assert.equal(noToken.status, 401);
    assert.equal(noToken.data.error, 'ACCOUNT_CHECK');
  });
});

test('строгий вход: чужой webApp id не открывает чужую кнопку', async () => {
  await withStrictServer(async ({ call, user }) => {
    const r = await call('/api/session', {
      method: 'POST',
      body: { t: signToken(user.id), unsafe: { user: { id: 9999 } } },
    });
    assert.equal(r.status, 401);
    assert.equal(r.data.error, 'ACCOUNT_MISMATCH');
  });
});

test('потолок баланса: излишек уходит в банк и виден в профиле', async () => {
  await withStrictServer(async ({ call, store, user }) => {
    store.credit(user, 200000);
    const r = await call('/api/me', { token: signToken(user.id), initData: makeInitData({ id: user.id }) });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.balance, 150000);
    assert.equal(r.data.user.vault, 51000);
    assert.equal(r.data.settings.maxBalance, 150000);
  });
});

test('комиссия за хранение списывается один раз и попадает в историю', async () => {
  await withStrictServer(async ({ engine, store, user }) => {
    store.settings = { storageFee: { enabled: true, threshold: 100000, percentPerDay: 1, intervalMs: 1000 } };
    store.credit(user, 200000);
    const fee = engine.applyStorageFee(user.id);
    assert.equal(fee, 500);
    assert.equal(engine.applyStorageFee(user.id), 0);
    const last = store.recent(user.id, 1)[0];
    assert.equal(last.game, 'fee');
    assert.equal(last.profit, -500);
  });
});

test('вывод: заявка резервирует сумму, отклонение возвращает её', async () => {
  await withStrictServer(async ({ engine, store, owner, user }) => {
    store.credit(user, 50000);
    const wd = engine.createWithdrawal(user.id, { amount: 10000, contact: '@crypt' });
    assert.equal(wd.status, 'pending');
    assert.equal(user.balance, 41000);
    assert.throws(() => engine.createWithdrawal(user.id, { amount: 999999 }), /Максимальный вывод/);

    engine.decideWithdrawal(owner.id, wd.id, false);
    assert.equal(user.balance, 51000);
    assert.equal(store.data.withdrawals[0].status, 'rejected');

    const wd2 = engine.createWithdrawal(user.id, { amount: 10000 });
    engine.decideWithdrawal(owner.id, wd2.id, true);
    assert.equal(user.balance, 41000);
    assert.equal(store.data.withdrawals[1].status, 'approved');
  });
});
