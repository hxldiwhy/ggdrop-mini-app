import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Engine } from '../src/engine.js';

const errCode = (code) => (err) => {
  assert.equal(err.code, code, `ожидали ${code}, получили ${err.code}: ${err.message}`);
  return true;
};

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auction-test-'));
  const store = new Store(path.join(dir, 'db.json'));
  const engine = new Engine(store);
  store.settings = { ownerId: 1001 };
  const owner = store.ensureUser({ id: 1001, first_name: 'Host' });
  const alice = store.ensureUser({ id: 2002, username: 'alice' });
  const bob = store.ensureUser({ id: 3003, username: 'bob' });
  store.credit(owner, 1000);
  store.credit(alice, 1000);
  store.credit(bob, 1000);
  return { store, engine, owner, alice, bob };
}

const createLot = (engine, patch = {}) =>
  engine.auctionCreate(1001, { title: 'Тестовый подарок', minBid: 100, step: 50, minutes: 5, ...patch });

test('аукцион: перебитая ставка сгорает и не возвращается', () => {
  const { store, engine, alice, bob } = setup();
  createLot(engine);
  engine.auctionBid(2002, { amount: 100 });
  const bid = engine.auctionBid(3003, { amount: 150 });

  assert.equal(alice.balance, 900, 'проигравшая ставка не возвращается');
  assert.equal(bob.balance, 850);
  assert.equal(store.data.meta.totalBurned, 100);
  assert.equal(bid.lot.currentBid, 150);
  assert.equal(bid.lot.leader.id, 3003);
  assert.equal(bid.lot.bids.filter((b) => b.burned).length, 1);
  assert.match(store.recent(2002, 5)[0].detail, /сгорела/);
});

test('аукцион: победитель получает подарок, ставка уходит организатору', () => {
  const { store, engine, owner, bob } = setup();
  createLot(engine);
  engine.auctionBid(2002, { amount: 100 });
  engine.auctionBid(3003, { amount: 150 });
  const done = engine.auctionFinish(1001);

  assert.equal(done.lot.status, 'sold');
  assert.equal(done.lot.winner.id, 3003);
  assert.equal(owner.balance, 1150);
  assert.equal(store.data.meta.totalBurned, 100);
  assert.equal(store.recent(3003, 5)[0].profit, -150);
  assert.ok(bob.nfts.length >= 1, 'в профиле остаётся памятный дроп подарка');
  assert.equal(engine.auctionPublic(2002).lot, null);
  assert.equal(engine.auctionPublic(2002).history[0].id, done.lot.id);
});

test('аукцион: минимальная ставка, шаг и запрет ставки хозяина', () => {
  const { engine, alice } = setup();
  createLot(engine);

  assert.throws(() => engine.auctionBid(2002, { amount: 99 }), errCode('BET_TOO_LOW'));
  assert.throws(() => engine.auctionBid(1001, { amount: 100 }), errCode('INVALID_ACTION'));
  engine.auctionBid(2002, { amount: 100 });
  assert.throws(() => engine.auctionBid(3003, { amount: 120 }), errCode('BET_TOO_LOW'));
  engine.auctionBid(3003, { amount: 150 });
  assert.equal(alice.balance, 900);
});

test('аукцион: отмена лота возвращает последнюю ставку', () => {
  const { store, engine, alice, bob } = setup();
  createLot(engine);
  engine.auctionBid(2002, { amount: 100 });
  engine.auctionBid(3003, { amount: 150 });
  const done = engine.auctionCancel(1001);

  assert.equal(done.lot.status, 'canceled');
  assert.equal(bob.balance, 1000, 'последняя ставка возвращается');
  assert.equal(alice.balance, 900, 'перебитая ставка уже сгорела');
  assert.equal(store.data.meta.totalBurned, 100);
  assert.equal(engine.auctionPublic(2002).lot, null);
});

test('аукцион: истёкшее время завершает лот при чтении', () => {
  const { store, engine } = setup();
  createLot(engine);
  engine.auctionBid(2002, { amount: 100 });
  store.data.auctions[0].endsAt = Date.now() - 1;
  store.save();

  const pub = engine.auctionPublic(2002);
  assert.equal(pub.lot, null);
  assert.equal(pub.history[0].status, 'sold');
  assert.equal(pub.history[0].winner.id, 2002);
});

test('аукцион: ставка на финише продлевает лот', () => {
  const { store, engine } = setup();
  createLot(engine);
  const before = Date.now() + 4000;
  store.data.auctions[0].endsAt = before;
  store.save();
  engine.auctionBid(2002, { amount: 100 });

  assert.ok(store.data.auctions[0].endsAt > before + 20000, 'анти-снайпинг продлил лот');
  assert.equal(engine.auctionPublic(2002).lot.status, 'active');
});

test('аукцион: несколько активных лотов, каждый ведёт свой организатор', () => {
  const { engine, owner, alice, bob } = setup();
  const a = engine.auctionCreate(2002, { title: 'Лот Алисы', minBid: 100, step: 50, minutes: 5 });
  const b = engine.auctionCreate(3003, { title: 'Лот Боба', minBid: 100, step: 50, minutes: 5 });

  const pub = engine.auctionPublic(1001);
  assert.equal(pub.lots.length, 2);
  assert.deepEqual(pub.lots.map((l) => l.id), [a.lot.id, b.lot.id]);
  assert.equal(pub.lots[0].hostId, 2002);
  assert.equal(pub.lots[1].hostId, 3003);
  assert.equal(pub.lots[0].canManage, true, 'хозяин может управлять любым лотом');

  assert.throws(() => engine.auctionBid(2002, { lotId: a.lot.id, amount: 100 }), errCode('INVALID_ACTION'));
  assert.throws(() => engine.auctionBid(3003, { lotId: b.lot.id, amount: 100 }), errCode('INVALID_ACTION'));
  assert.throws(() => engine.auctionCancel(3003, a.lot.id), errCode('NOT_OWNER'));

  engine.auctionBid(1001, { lotId: a.lot.id, amount: 100 });
  const done = engine.auctionFinish(2002, a.lot.id);

  assert.equal(done.lot.status, 'sold');
  assert.equal(done.lot.winner.id, 1001);
  assert.equal(alice.balance, 1100, 'ставка ушла организатору лота');
  assert.equal(owner.balance, 900);
  assert.equal(bob.balance, 1000);
  assert.equal(engine.auctionPublic(2002).lots.length, 1, 'второй лот остался активным');
  assert.equal(engine.auctionPublic(2002).lots[0].id, b.lot.id);
});
