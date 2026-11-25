import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Engine } from '../src/engine.js';
import { CasinoError } from '../src/errors.js';
import { timeForMultiplier } from '../src/games/crash.js';

const errCode = (code) => (err) => {
  assert.equal(err.code, code, `ожидали ${code}, получили ${err.code}: ${err.message}`);
  return true;
};

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-test-'));
  const store = new Store(path.join(dir, 'db.json'));
  const engine = new Engine(store);
  store.settings = { ownerId: 1001 };
  const owner = store.ensureUser({ id: 1001, first_name: 'Host' });
  store.credit(owner, 1_000_000);
  const user = store.ensureUser({ id: 2002, username: 'player', first_name: 'Player' });
  store.credit(user, 100_000);
  return { store, engine, owner, user };
}

test('баланс: ставка и выигрыш сходятся', () => {
  const { engine, user } = setup();
  const before = user.balance;
  const r = engine.spinRoulette(user.id, [{ type: 'red', amount: 500 }, { type: 'number', value: 7, amount: 100 }]);
  assert.equal(r.totalBet, 600);
  assert.equal(user.balance, before - 600 + r.payout);
  assert.ok(r.payout === 0 || r.payout >= 500);
});

test('ставки: лимиты и баланс', () => {
  const { engine, user } = setup();
  assert.throws(() => engine.spinWheel(user.id, 1), errCode('BET_TOO_LOW'));
  assert.throws(() => engine.spinWheel(user.id, 999999), errCode('BET_TOO_HIGH'));
  user.balance = 5;
  assert.throws(() => engine.spinWheel(user.id, 100), errCode('BALANCE_LOW'));
});

test('колесо: выплата и история', () => {
  const { engine, store, user } = setup();
  const r = engine.spinWheel(user.id, 100);
  assert.ok(r.payout >= 0);
  const hist = store.recent(user.id, 5);
  assert.ok(hist.some((h) => h.game === 'wheel'));
});

test('блэкджек: раздача и завершение раунда', () => {
  const { engine, user } = setup();
  let state = null;
  for (let i = 0; i < 30; i++) {
    state = engine.startBlackjack(user.id, 200);
    if (state.status === 'playing') break;
  }
  assert.equal(state.status, 'playing');
  assert.equal(state.player.length, 2);
  assert.equal(state.dealer.length, 2);
  assert.equal(state.dealer[1].r, '?');
  const done = engine.actionBlackjack(user.id, state.id, 'stand');
  assert.equal(done.status, 'done');
  assert.ok(done.dealerTotal >= 17 || done.result === 'bust');
  assert.equal(engine.blackjacks.size, 0);
});

test('бонус: раз в сутки', () => {
  const { engine, user } = setup();
  const r = engine.daily(user.id);
  assert.ok(r.amount > 0);
  assert.throws(() => engine.daily(user.id), errCode('DAILY_WAIT'));
});

test('промокоды: активация и лимит', () => {
  const { engine, owner, user } = setup();
  engine.adminCreatePromo(owner.id, { code: 'welcome', amount: 5000, uses: 1 });
  const r = engine.redeemPromo(user.id, 'WELCOME');
  assert.equal(r.amount, 5000);
  assert.throws(() => engine.redeemPromo(user.id, 'welcome'), (e) => e.code === 'PROMO_USED' || e.code === 'PROMO_EXHAUSTED');
  assert.throws(() => engine.redeemPromo(user.id, 'nope'), errCode('PROMO_INVALID'));
});

test('переводы между игроками', () => {
  const { engine, store, user } = setup();
  const other = store.ensureUser({ id: 3003, username: 'friend' });
  const r = engine.transfer(user.id, other.id, 1000);
  assert.equal(other.balance, 1000);
  assert.equal(r.balance, user.balance);
  assert.throws(() => engine.transfer(user.id, user.id, 10), errCode('INVALID_ACTION'));
  assert.throws(() => engine.transfer(user.id, other.id, user.balance + 1), errCode('BALANCE_LOW'));
});

test('админ: только хозяин, выдача и бан', () => {
  const { engine, store, owner, user } = setup();
  assert.throws(() => engine.adminUserAction(user.id, owner.id, 'credit', 100), errCode('NOT_OWNER'));
  engine.adminUserAction(owner.id, user.id, 'credit', 5000);
  assert.ok(user.balance >= 5000);
  engine.adminUserAction(owner.id, user.id, 'ban');
  assert.throws(() => engine.spinWheel(user.id, 100), errCode('BANNED'));
  engine.adminUserAction(owner.id, user.id, 'unban');
  const ok = engine.spinWheel(user.id, 100);
  assert.ok(Number.isFinite(ok.multiplier));
});

test('админ не может забанить хозяина', () => {
  const { engine, owner } = setup();
  assert.throws(() => engine.adminUserAction(owner.id, owner.id, 'ban'), errCode('INVALID_ACTION'));
  assert.equal(engine.store.user(owner.id).banned, false);
});

test('админ: настройки и лимиты', () => {
  const { engine, owner } = setup();
  const s = engine.adminSetSettings(owner.id, { minBet: 50, maxBet: 1000, houseEdge: { wheel: 0.05 }, maintenance: true });
  assert.equal(s.minBet, 50);
  assert.equal(s.maxBet, 1000);
  assert.equal(s.houseEdge.wheel, 0.05);
  assert.equal(s.maintenance, true);
  assert.throws(() => engine.adminSetSettings(2002, { minBet: 1 }), errCode('NOT_OWNER'));
});

test('техобслуживание блокирует игроков, но не хозяина', () => {
  const { engine, owner, user } = setup();
  engine.adminSetSettings(owner.id, { maintenance: true });
  assert.throws(() => engine.spinWheel(user.id, 100), errCode('MAINTENANCE'));
  const r = engine.spinWheel(owner.id, 100);
  assert.ok(Number.isFinite(r.multiplier));
});

test('краш: ставка, кэшаут по времени, проигрыш при взрыве', () => {
  const { engine, user } = setup();
  engine._beginCrashRound();
  assert.equal(engine.crash.phase, 'betting');
  const bet = engine.crashBet(user.id, { amount: 1000, autoCashout: 0 });
  assert.ok(bet.balance === user.balance);
  assert.throws(() => engine.crashBet(user.id, { amount: 100 }), errCode('ALREADY_BET'));

  engine.crash.phase = 'running';
  engine.crash.startedAt = Date.now() - 500;
  engine.crash.crashPoint = 10;
  engine.crash.crashDuration = timeForMultiplier(10);
  const cash = engine.crashCashout(user.id);
  assert.ok(cash.multiplier > 1);
  assert.equal(cash.payout, Math.round(1000 * cash.multiplier));
  assert.throws(() => engine.crashCashout(user.id), errCode('INVALID_ACTION'));
});

test('краш: мгновенный взрыв забирает ставку', () => {
  const { engine, store, user } = setup();
  engine._beginCrashRound();
  const other = store.ensureUser({ id: 4004 });
  store.credit(other, 10000);
  engine.crashBet(other.id, { amount: 1000, autoCashout: 0 });
  engine.crash.phase = 'running';
  engine.crash.startedAt = Date.now() - 100;
  engine.crash.crashPoint = 1;
  engine.crash.crashDuration = timeForMultiplier(1);
  engine._crashCrash();
  assert.equal(engine.crash.phase, 'crashed');
  assert.equal(store.user(4004).balance, 9000);
});

test('колесо и плинко: списание и выплата', () => {
  const { engine, user } = setup();
  const before = user.balance;
  const w = engine.spinWheel(user.id, 300);
  assert.equal(w.totalBet, 300);
  assert.equal(user.balance, before - 300 + w.payout);
  assert.ok(w.sectors.length > 0);

  const before2 = user.balance;
  const p = engine.dropPlinko(user.id, { amount: 200, rows: 12, risk: 'high' });
  assert.equal(p.rows, 12);
  assert.equal(p.path.length, 12);
  assert.equal(user.balance, before2 - 200 + p.payout);
  assert.throws(() => engine.dropPlinko(user.id, { amount: 1, rows: 12, risk: 'high' }), errCode('BET_TOO_LOW'));
});

test('плинко: залп из нескольких шариков и лимит на суммарную ставку', () => {
  const { engine, user } = setup();
  const before = user.balance;
  const p = engine.dropPlinko(user.id, { amount: 100, rows: 12, risk: 'high', count: 5 });
  assert.equal(p.count, 5);
  assert.equal(p.totalBet, 500);
  assert.equal(p.balls.length, 5);
  assert.equal(user.balance, before - 500 + p.payout);
  assert.equal(p.payout, p.balls.reduce((sum, b) => sum + b.payout, 0));

  assert.throws(
    () => engine.dropPlinko(user.id, { amount: 6000, rows: 12, risk: 'high', count: 5 }),
    errCode('BET_TOO_HIGH'),
  );
});

test('пополнение: заявка и подтверждение хозяином', () => {
  const { engine, user, owner } = setup();
  const dep = engine.createDeposit(user.id, 500);
  assert.equal(dep.status, 'pending');
  assert.equal(engine.pendingDeposits().length, 1);
  assert.throws(() => engine.decideDeposit(user.id, dep.id, true), errCode('NOT_OWNER'));

  const before = user.balance;
  const done = engine.decideDeposit(owner.id, dep.id, true);
  assert.equal(done.status, 'approved');
  assert.equal(user.balance, before + 500);
  assert.equal(engine.pendingDeposits().length, 0);
  assert.throws(() => engine.decideDeposit(owner.id, dep.id, true), errCode('INVALID_ACTION'));
});

test('пополнение: отказ и ограничения', () => {
  const { engine, user, owner } = setup();
  const dep = engine.createDeposit(user.id, 300);
  const before = user.balance;
  assert.equal(engine.decideDeposit(owner.id, dep.id, false).status, 'rejected');
  assert.equal(user.balance, before);

  assert.throws(() => engine.createDeposit(user.id, 1), errCode('DEPOSIT_TOO_LOW'));
  assert.throws(() => engine.createDeposit(user.id, 10_000_000), errCode('DEPOSIT_TOO_HIGH'));
  for (let i = 0; i < 3; i++) engine.createDeposit(user.id, 200);
  assert.throws(() => engine.createDeposit(user.id, 200), errCode('DEPOSIT_LIMIT'));
});
