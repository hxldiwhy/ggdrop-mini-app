import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Engine } from '../src/engine.js';

function makeEngine() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-extra-'));
  const store = new Store(path.join(dir, 'db.json'));
  const engine = new Engine(store);
  const owner = store.ensureUser({ id: 1, first_name: 'Owner' });
  const user = store.ensureUser({ id: 2, first_name: 'Player' });
  store.credit(user, 10000);
  return { store, engine, owner, user };
}

test('монетка: исходы честные по правилам и баланс сходится', () => {
  const { engine, user } = makeEngine();
  const r = engine.playCoinflip(user.id, { amount: 100, side: 'heads' });
  assert.ok(['heads', 'tails'].includes(r.result));
  assert.equal(r.win, r.result === 'heads');
  assert.equal(r.totalBet, 100);
  assert.equal(r.multiplier, r.win ? 1.97 : 0);
  assert.equal(r.payout, r.win ? Math.round(100 * r.multiplier) : 0);
  assert.equal(user.balance, 10000 - 100 + r.payout);
  const last = engine.store.data.history.at(-1);
  assert.equal(last.game, 'coinflip');
});

test('монетка не зависит от старых лимитов кассы', () => {
  const { engine, store, user } = makeEngine();
  store.settings.bankroll = {
    enabled: true, amount: 1000, maxBetPercent: 2, maxPayoutPercent: 5,
    dailyProfitPercent: 2, dailyHouseCapPercent: 20, exposureLimit: 20,
  };
  assert.equal(engine.playCoinflip(user.id, { amount: 20, side: 'heads' }).totalBet, 20);
});
