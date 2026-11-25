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
  const r = engine.settle(user, 'dice', 100, 10000, 'тест');
  assert.equal(r.payout, 10000);
  assert.equal(r.profit, 9900);
  assert.equal(r.entry.detail, 'тест');
  assert.equal(engine.assertBet(user, 20, 'dice'), 20);
});

test('лимит ставки по игре остаётся, лимит кассы больше не проверяется', () => {
  const { store, engine, user } = makeEngine();
  store.settings.limits = { ...store.settings.limits, dice: 100 };
  assert.throws(() => engine.assertBet(user, 101, 'dice'), /лимита/i);
  assert.equal(engine.assertBet(user, 100, 'dice'), 100);
});

test('потолок баланса: излишек уходит в видимый банк', () => {
  const { store, user } = makeEngine();
  store.credit(user, 200000);
  assert.equal(user.balance, store.balanceCap());
  assert.equal(user.vault, 200000 + 10000 - store.balanceCap());
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
