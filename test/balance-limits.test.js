import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Engine } from '../src/engine.js';
import { publicSettings } from '../src/http.js';

function makeEngine() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-limits-'));
  const store = new Store(path.join(dir, 'db.json'));
  const engine = new Engine(store);
  const owner = store.ensureUser({ id: 1, first_name: 'Owner' });
  const user = store.ensureUser({ id: 2, first_name: 'Player' });
  store.credit(user, 10000);
  return { dir, store, engine, owner, user };
}

test('выплата не ограничивается кассой: старые настройки банкролла игнорируются', () => {
  const { store, engine, user } = makeEngine();
  store.settings.bankroll = {
    enabled: true, amount: 1000, maxBetPercent: 2, maxPayoutPercent: 5,
    dailyProfitPercent: 2, dailyHouseCapPercent: 20, exposureLimit: 20,
  };
  const r = engine.settle(user, 'wheel', 100, 10000, 'тест');
  assert.equal(r.payout, 10000);
  assert.equal(r.profit, 9900);
  assert.equal(r.entry.detail, 'тест');
  assert.equal(engine.assertBet(user, 20, 'wheel'), 20);
});

test('лимит ставки по игре остаётся, лимит кассы больше не проверяется', () => {
  const { store, engine, user } = makeEngine();
  store.settings.limits = { ...store.settings.limits, wheel: 100 };
  assert.throws(() => engine.assertBet(user, 101, 'wheel'), /лимита/i);
  assert.equal(engine.assertBet(user, 100, 'wheel'), 100);
});

test('после перезапуска хозяин не забанен и старый лимит 150000 не применяется', () => {
  const { dir, store } = makeEngine();
  store.data.settings.ownerId = 1;
  store.data.settings.maxWithdraw = 150000;
  store.data.users[1].banned = true;
  store.save();
  const reloaded = new Store(path.join(dir, 'db.json'));
  assert.equal(reloaded.data.users[1].banned, false);
  assert.equal(reloaded.settings.maxWithdraw, 1000000);
});

test('база сохраняется сразу, без ожидания таймера', () => {
  const { dir, store, user } = makeEngine();
  store.credit(user, 123);
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
  assert.equal(raw.users[user.id].balance, 10123);
});

test('потолок баланса снят: весь выигрыш остаётся доступным', () => {
  const { store, user } = makeEngine();
  store.credit(user, 200000);
  assert.equal(user.balance, 210000);
  assert.equal(user.vault, 0);
  assert.equal(store.balanceCap(), Infinity);
});

test('банкролл не передаётся игроку и не возвращается в статистике хозяина', () => {
  const { engine, store, owner } = makeEngine();
  store.settings.ownerId = owner.id;
  assert.equal('bankroll' in publicSettings(engine), false);
  assert.equal('bankroll' in engine.adminStats(owner.id), false);
});

test('при загрузке базы старые поля кассы удаляются', () => {
  const { dir } = makeEngine();
  const file = path.join(dir, 'old.json');
  fs.writeFileSync(file, JSON.stringify({
    settings: { ownerId: 1, bankroll: { enabled: true, amount: 90000 } },
    meta: { dailyPaid: 123, dailyPaidDate: '2026-01-01' },
    users: { 2: { id: 2, balance: 10, dailyProfit: 5, dailyProfitDate: '2026-01-01' } },
  }));
  const store = new Store(file);
  assert.equal('bankroll' in store.settings, false);
  assert.equal('dailyPaid' in store.data.meta, false);
  assert.equal('dailyProfit' in store.user(2), false);
});
