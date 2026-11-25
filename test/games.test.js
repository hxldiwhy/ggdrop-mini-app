import test from 'node:test';
import assert from 'node:assert/strict';
import { playRoulette, payoutMultiplier, colorOf, spinWheel } from '../src/games/roulette.js';
import { playDice, diceChance, diceMultiplier, rollDice } from '../src/games/dice.js';
import { crashPointFromSeed, multiplierAt, timeForMultiplier, verifyCrash, newRoundSeed } from '../src/games/crash.js';
import { handValue, newShoe, draw, playDealer, dealerShouldHit } from '../src/games/blackjack.js';
import { WHEEL_SEGMENTS, WHEEL_BASE_RTP, spinWheelGame, pickSegment } from '../src/games/wheel.js';
import { RISKS, ROWS, MAX_BALLS, clampBalls, dropBall, dropBalls, baseRtp, multipliersFor, bucketProbability } from '../src/games/plinko.js';

const fixed = (v) => () => v;

test('рулетка: цвет и лунка', () => {
  assert.equal(spinWheel(fixed(0)), 0);
  assert.equal(spinWheel(fixed(0.5)), 18);
  assert.equal(spinWheel(fixed(0.999)), 36);
  assert.equal(colorOf(0), 'green');
  assert.equal(colorOf(1), 'red');
  assert.equal(colorOf(2), 'black');
});

test('рулетка: выплаты по типам ставок', () => {
  assert.equal(payoutMultiplier('number', 18, 18), 36);
  assert.equal(payoutMultiplier('number', 18, 17), 0);
  assert.equal(payoutMultiplier('red', null, 18), 2);
  assert.equal(payoutMultiplier('black', null, 18), 0);
  assert.equal(payoutMultiplier('even', null, 18), 2);
  assert.equal(payoutMultiplier('odd', null, 19), 2);
  assert.equal(payoutMultiplier('low', null, 18), 2);
  assert.equal(payoutMultiplier('high', null, 18), 0);
  assert.equal(payoutMultiplier('dozen1', null, 12), 3);
  assert.equal(payoutMultiplier('dozen2', null, 13), 3);
  assert.equal(payoutMultiplier('column3', null, 36), 3);
  assert.equal(payoutMultiplier('column1', null, 1), 3);
  // зеро съедает все внешние ставки
  for (const t of ['red', 'black', 'even', 'odd', 'low', 'high', 'dozen1', 'dozen2', 'dozen3']) {
    assert.equal(payoutMultiplier(t, null, 0), 0, `зеро не должно платить за ${t}`);
  }
});

test('рулетка: раунд с несколькими ставками', () => {
  const r = playRoulette({ bets: [{ type: 'number', value: 18, amount: 100 }, { type: 'red', amount: 100 }], rng: fixed(0.5) });
  assert.equal(r.result, 18);
  assert.equal(r.totalBet, 200);
  assert.equal(r.payout, 3600 + 200);
  assert.equal(r.profit, 3600);
});

test('рулетка: невалидные ставки', () => {
  assert.throws(() => playRoulette({ bets: [], rng: fixed(0.5) }), /BETS_REQUIRED/);
  assert.throws(() => playRoulette({ bets: [{ type: 'nope', amount: 10 }], rng: fixed(0.5) }), /BET_TYPE_INVALID/);
  assert.throws(() => playRoulette({ bets: [{ type: 'number', value: 99, amount: 10 }], rng: fixed(0.5) }), /BET_NUMBER_INVALID/);
  assert.throws(() => playRoulette({ bets: [{ type: 'red', amount: 1 }], rng: fixed(0.5), minBet: 10 }), /BET_AMOUNT_INVALID/);
});

test('кости: шанс, множитель и результат', () => {
  assert.equal(rollDice(fixed(0)), 1);
  assert.equal(rollDice(fixed(0.99)), 100);
  assert.equal(diceChance(50, true), 0.5);
  assert.equal(diceChance(50, false), 0.49);
  assert.ok(Math.abs(diceMultiplier(50, true, 0.03) - 1.94) < 0.02);
  const over = playDice({ amount: 100, target: 50, over: true, rng: fixed(0.6), edge: 0.03 });
  assert.equal(over.roll, 61);
  assert.equal(over.win, true);
  assert.equal(over.payout, 194);
  const under = playDice({ amount: 100, target: 50, over: false, rng: fixed(0.6), edge: 0.03 });
  assert.equal(under.win, false);
  assert.equal(under.payout, 0);
});

test('краш: детерминизм и распределение', () => {
  const seed = 'a'.repeat(64);
  const a = crashPointFromSeed(seed, 7, 0.03);
  const b = crashPointFromSeed(seed, 7, 0.03);
  assert.equal(a, b);
  assert.ok(a >= 1);
  assert.ok(verifyCrash(seed, 7, a));
  assert.notEqual(crashPointFromSeed(seed, 8, 0.03), a);

  let ge2 = 0;
  const N = 20000;
  const s2 = newRoundSeed();
  for (let i = 0; i < N; i++) if (crashPointFromSeed(s2, i, 0.03) >= 2) ge2++;
  const p = ge2 / N;
  assert.ok(p > 0.45 && p < 0.52, `P(x>=2) = ${p}`);
});

test('краш: рост множителя', () => {
  assert.equal(multiplierAt(0), 1);
  const t = timeForMultiplier(2);
  assert.ok(Math.abs(multiplierAt(t) - 2) < 0.02);
  const t10 = timeForMultiplier(10);
  assert.ok(t10 > t);
  assert.ok(multiplierAt(t10) >= 9.9 && multiplierAt(t10) <= 10.1);
  // медленный старт и резкий разгон вдалеке
  assert.ok(multiplierAt(6000) - multiplierAt(5000) < multiplierAt(11000) - multiplierAt(10000));
  assert.ok(t > 1500);
});

test('блэкджек: подсчёт очков и дилер', () => {
  const A = { r: 'A', s: '♠' }, K = { r: 'K', s: '♥' }, nine = { r: '9', s: '♦' }, six = { r: '6', s: '♣' };
  assert.equal(handValue([A, K]).total, 21);
  assert.equal(handValue([A, K]).blackjack, true);
  assert.equal(handValue([A, six]).total, 17);
  assert.equal(handValue([A, six]).soft, true);
  assert.equal(handValue([A, A, nine]).total, 21);
  assert.equal(handValue([K, nine, nine]).total, 28);
  assert.equal(dealerShouldHit([{ r: '10', s: '♠' }]), true);
  assert.equal(dealerShouldHit([{ r: '10', s: '♠' }, { r: '7', s: '♠' }]), false);
  const shoe = newShoe(2);
  assert.equal(shoe.length, 104);
  const dealer = playDealer(shoe, [{ r: '10', s: '♠' }, six]);
  assert.ok(handValue(dealer).total >= 17);
});

test('колесо: веса, границы и RTP', () => {
  const total = WHEEL_SEGMENTS.reduce((s, x) => s + x.weight, 0);
  assert.ok(Math.abs(total - 100) < 0.01, `сумма весов ${total}`);
  assert.ok(WHEEL_BASE_RTP > 0.9 && WHEEL_BASE_RTP < 1);
  assert.equal(pickSegment(() => 0), 0);
  assert.equal(pickSegment(() => 0.9999999), WHEEL_SEGMENTS.length - 1);

  const zero = spinWheelGame({ amount: 100, rng: () => 0, edge: 0.04 });
  assert.equal(zero.multiplier, 0);
  assert.equal(zero.payout, 0);

  let bet = 0;
  let paid = 0;
  for (let i = 0; i < 60000; i++) {
    const r = spinWheelGame({ amount: 100, rng: Math.random, edge: 0.04 });
    bet += 100;
    paid += r.payout;
  }
  const rtp = paid / bet;
  assert.ok(rtp > 0.9 && rtp < 1.0, `RTP колеса ${rtp.toFixed(3)}`);
});

test('плинко: таблицы, вероятности, путь шарика', () => {
  for (const rows of ROWS) {
    for (const risk of Object.keys(RISKS)) {
      const table = RISKS[risk][rows];
      assert.equal(table.length, rows + 1, `${rows}/${risk}: ${table.length} корзин`);
      assert.ok(baseRtp(rows, risk) > 0.9, `${rows}/${risk} base ${baseRtp(rows, risk)}`);
      assert.equal(multipliersFor(rows, risk, 0.03).length, rows + 1);
      assert.ok(multipliersFor(rows, risk, 0.03)[0] > 1);
    }
  }
  let sum = 0;
  for (let i = 0; i <= 12; i++) sum += bucketProbability(12, i);
  assert.ok(Math.abs(sum - 1) < 1e-9);

  const allRight = dropBall({ amount: 100, rows: 8, risk: 'high', rng: () => 0.1, edge: 0.03 });
  assert.equal(allRight.path.length, 8);
  assert.equal(allRight.bucket, 8);
  assert.equal(allRight.multiplier, multipliersFor(8, 'high', 0.03)[8]);

  const allLeft = dropBall({ amount: 100, rows: 8, risk: 'high', rng: () => 0.9, edge: 0.03 });
  assert.equal(allLeft.bucket, 0);

  let bet = 0;
  let paid = 0;
  for (let i = 0; i < 40000; i++) {
    const r = dropBall({ amount: 100, rows: 12, risk: 'high', rng: Math.random, edge: 0.03 });
    bet += 100;
    paid += r.payout;
  }
  const rtp = paid / bet;
  assert.ok(rtp > 0.9 && rtp < 1.04, `RTP плинко ${rtp.toFixed(3)}`);
});

test('плинко: остался только высокий риск', () => {
  assert.deepEqual(Object.keys(RISKS), ['high']);
  assert.equal(RISKS.low, undefined);
  assert.equal(RISKS.medium, undefined);
  for (const rows of ROWS) {
    const table = RISKS.high[rows];
    const center = rows / 2;
    assert.equal(table[center], 0.2, `${rows}: центр`);
    assert.ok(table[center - 1] < 1 && table[center + 1] < 1, `${rows}: соседи должны быть минусовыми`);
    assert.ok(table[0] > 20, `${rows}: край должен быть крупным`);
    assert.ok(baseRtp(rows, 'high') > 0.9, `${rows}: RTP ${baseRtp(rows, 'high')}`);
  }
});

test('плинко: несколько шариков и общая ставка', () => {
  assert.equal(clampBalls(999), MAX_BALLS);
  assert.equal(clampBalls(0), 1);
  assert.equal(clampBalls('3'), 3);

  const r = dropBalls({ amount: 100, rows: 12, risk: 'high', count: 5, rng: fixed(0.4), edge: 0.03 });
  assert.equal(r.balls.length, 5);
  assert.equal(r.totalBet, 500);
  assert.equal(r.perBet, 100);
  assert.equal(r.payout, r.balls.reduce((sum, b) => sum + b.payout, 0));
  assert.equal(r.buckets.length, 5);
  assert.ok(r.balls.every((b) => b.path.length === 12));
  assert.equal(r.multipliers.length, 13);
});
