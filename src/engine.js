import { EventEmitter } from 'node:events';
import { CasinoError, ERRORS } from './errors.js';
import { playRoulette, rouletteLabel, normalizeBets } from './games/roulette.js';
import { playDice, diceChance } from './games/dice.js';
import { crashPointFromSeed, newRoundSeed, seedHash, multiplierAt, timeForMultiplier } from './games/crash.js';
import { newShoe, draw, handValue, playDealer, canDouble } from './games/blackjack.js';
import { spinWheelGame, pickSegment, WHEEL_SEGMENTS } from './games/wheel.js';
import { dropBalls, clampBalls, RISKS } from './games/plinko.js';
import { rng, round2, shortName, clamp } from './utils.js';

const now = () => Date.now();
const uid = () => `${now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const LUCKY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const LUCKY_BASE = 300; // приз = LUCKY_BASE × сектор.m
const AUCTION_ANTI_SNIPE_MS = 30000; // ставка в последние 30 секунд продлевает лот

const NFT_NAMES = {
  common: ['Космокот', 'Звёздный пёс', 'Милый череп', 'Неоновая рыбка'],
  rare: ['Кибер-лис', 'Кристальный кит', 'Робо-обезьяна'],
  epic: ['Обезьяна-маг', 'Кибер-дракон', 'Звёздный самурай'],
  legendary: ['Крипто-кот OG', 'Король черепов', 'Легенда TON'],
};
const NFT_CHANCE = { common: 0.8, rare: 0.6, epic: 0.4, legendary: 0.15 };
const NFT_MAX = 60;

export class Engine extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.blackjacks = new Map();
    this.crash = {
      phase: 'idle',
      roundId: 0,
      seed: '',
      hash: '',
      crashPoint: 0,
      bettingEndsAt: 0,
      startedAt: 0,
      crashedAt: 0,
      nextRoundAt: 0,
      bets: new Map(),
      history: [],
    };
    this._timer = null;
    this._lastCrashNotify = 0;
  }

  get settings() { return this.store.settings; }

  // ─── users ──────────────────────────────────────────────────────────────────
  user(userId) {
    const u = this.store.user(userId);
    if (!u) throw new CasinoError('USER_NOT_FOUND', ERRORS.USER_NOT_FOUND, 404);
    return u;
  }

  ensureUser(from) {
    return this.store.ensureUser(from);
  }

  isOwner(userId) {
    const oid = Number(this.settings.ownerId || 0);
    return !!oid && Number(userId) === oid;
  }

  checkPlayable(user) {
    if (user.banned) throw new CasinoError('BANNED', ERRORS.BANNED, 403);
    if (this.settings.maintenance && !this.isOwner(user.id)) {
      throw new CasinoError('MAINTENANCE', ERRORS.MAINTENANCE, 503);
    }
  }

  /** Раз в сутки списываем явную комиссию за хранение суммы сверх порога.
   *  Списание видно в истории игрока и в профиле — ничего «тихого» нет. */
  applyStorageFee(userId) {
    const u = typeof userId === 'object' ? userId : this.user(userId);
    if (!u || this.isOwner(u.id)) return 0;
    const f = this.settings.storageFee || {};
    if (!f.enabled) return 0;
    const interval = Math.max(60 * 60 * 1000, Number(f.intervalMs) || 86400000);
    const t = now();
    if (t - (u.lastFeeAt || 0) < interval) return 0;
    u.lastFeeAt = t;
    const threshold = Math.max(0, Number(f.threshold) || 0);
    const percent = Math.min(5, Math.max(0, Number(f.percentPerDay) || 0));
    const over = Math.max(0, u.balance - threshold);
    if (over <= 0 || percent <= 0) {
      this.store.save();
      return 0;
    }
    const fee = Math.min(u.balance, Math.max(1, Math.ceil((over * percent) / 100)));
    u.balance -= fee;
    u.feePaid = (u.feePaid || 0) + fee;
    this.store.data.meta.totalFees = (this.store.data.meta.totalFees || 0) + fee;
    this.store.save();
    this.store.history({
      userId: u.id,
      game: 'fee',
      bet: 0,
      payout: -fee,
      profit: -fee,
      detail: `Комиссия хранилища: ${fee} (${percent}% сверх ${threshold})`,
    });
    return fee;
  }

  /** Привести старые балансы к потолку: излишек переезжает в видимый банк. */
  enforceBalanceCaps() {
    let moved = 0;
    let users = 0;
    for (const u of this.store.users()) {
      const extra = this.store.applyBalanceCap(u);
      if (extra > 0) {
        users += 1;
        moved += extra;
        this.store.history({
          userId: u.id,
          game: 'limit',
          bet: 0,
          payout: -extra,
          profit: -extra,
          detail: `Лимит баланса ${this.store.balanceCap()}: ${extra} → банк`,
        });
      }
    }
    if (users) this.store.save();
    return { users, moved };
  }

  assertBet(user, amount, game) {
    this.checkPlayable(user);
    const amt = Math.round(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0) throw new CasinoError('BET_INVALID', ERRORS.BET_INVALID);
    if (amt < this.settings.minBet) throw new CasinoError('BET_TOO_LOW', `${ERRORS.BET_TOO_LOW} (${this.settings.minBet})`);
    if (amt > this.settings.maxBet) throw new CasinoError('BET_TOO_HIGH', `${ERRORS.BET_TOO_HIGH} (${this.settings.maxBet})`);
    const limit = Number(this.settings.limits?.[game] ?? this.settings.maxBet);
    if (amt > limit) throw new CasinoError('BET_TOO_HIGH', `${ERRORS.BET_TOO_HIGH} для этой игры (${limit})`);
    if (user.balance < amt) throw new CasinoError('BALANCE_LOW', ERRORS.BALANCE_LOW);
    return amt;
  }

  takeBet(user, amount) {
    if (!this.store.take(user, amount)) throw new CasinoError('BALANCE_LOW', ERRORS.BALANCE_LOW);
  }

  /** Начисление выигрыша. Единственный предел — потолок баланса (излишек уходит в банк). */
  settle(user, game, bet, payout, detail, extra = {}) {
    const final = Math.max(0, Math.round(Number(payout) || 0));
    this.store.payWin(user, final, bet, game);
    const entry = this.store.history({
      userId: user.id,
      game,
      bet,
      payout: final,
      profit: final - bet,
      detail,
      balanceAfter: user.balance,
      ...extra,
    });
    let nft = null;
    if (final > 0 && final >= Math.max(20000, bet * 15)) {
      this.emit('bigwin', { user, game, bet, payout: final });
      nft = this._rollNft(user, game, bet, final);
    }
    return { payout: final, profit: final - bet, entry, nft };
  }

  // ─── рулетка ────────────────────────────────────────────────────────────────
  spinRoulette(userId, bets) {
    const user = this.user(userId);
    const { bets: list, total } = normalizeBets(bets, this.settings.minBet, 1e12);
    if (total > this.settings.maxBet) throw new CasinoError('BET_TOO_HIGH', `${ERRORS.BET_TOO_HIGH} (${this.settings.maxBet})`);
    const limit = Number(this.settings.limits.roulette ?? this.settings.maxBet);
    if (total > limit) throw new CasinoError('BET_TOO_HIGH', `${ERRORS.BET_TOO_HIGH} для рулетки (${limit})`);
    this.checkPlayable(user);
    if (user.balance < total) throw new CasinoError('BALANCE_LOW', ERRORS.BALANCE_LOW);
    this.takeBet(user, total);

    const res = playRoulette({ bets: list, rng });
    const detail = res.bets.map((b) => `${rouletteLabel(b)} — ${b.amount} → ${b.win}`).join('; ');
    const settled = this.settle(user, 'roulette', total, res.payout, detail, { result: res.result, color: res.color });
    return {
      result: res.result,
      color: res.color,
      bets: res.bets,
      totalBet: total,
      payout: settled.payout,
      profit: settled.profit,
      win: settled.payout > total,
      balance: user.balance,
    };
  }

  // ─── кости ──────────────────────────────────────────────────────────────────
  rollDice(userId, { amount, target, over }) {
    const user = this.user(userId);
    const amt = this.assertBet(user, amount, 'dice');
    this.takeBet(user, amt);
    const res = playDice({ amount: amt, target, over, rng, edge: this.settings.houseEdge.dice });
    const detail = `Бросок ${res.roll} ${res.direction === 'over' ? '>' : '<'} ${res.target} (x${res.multiplier})`;
    const settled = this.settle(user, 'dice', amt, res.payout, detail, { roll: res.roll });
    return {
      ...res,
      payout: settled.payout,
      profit: settled.profit,
      balance: user.balance,
      totalBet: amt,
    };
  }

  // ─── блэкджек ───────────────────────────────────────────────────────────────
  startBlackjack(userId, amount) {
    const user = this.user(userId);
    const amt = this.assertBet(user, amount, 'blackjack');
    for (const [id, g] of this.blackjacks) if (g.userId === Number(userId)) this.blackjacks.delete(id);
    this.takeBet(user, amt);
    const shoe = newShoe(6);
    const game = {
      id: uid(),
      userId: Number(userId),
      bet: amt,
      doubled: false,
      shoe,
      player: [draw(shoe), draw(shoe)],
      dealer: [draw(shoe), draw(shoe)],
      status: 'playing',
      createdAt: now(),
    };
    const pv = handValue(game.player);
    const dv = handValue(game.dealer);
    if (pv.blackjack || dv.blackjack) {
      return this._finishBlackjack(game, user, true);
    }
    this.blackjacks.set(game.id, game);
    return this._bjState(game, user);
  }

  _bjState(game, user) {
    const pv = handValue(game.player);
    const dv = handValue(game.dealer);
    return {
      id: game.id,
      status: game.status,
      bet: game.bet,
      player: game.player,
      dealer: game.status === 'playing' ? [game.dealer[0], { r: '?', s: '?' }] : game.dealer,
      playerTotal: pv.total,
      dealerTotal: dv.total,
      canHit: game.status === 'playing' && pv.total < 21,
      canStand: game.status === 'playing',
      canDouble: game.status === 'playing' && canDouble(game.player, user.balance + game.bet, game.bet),
      payout: game.payout ?? 0,
      result: game.result ?? null,
      balance: user.balance,
    };
  }

  actionBlackjack(userId, id, action) {
    const game = this.blackjacks.get(id);
    if (!game) throw new CasinoError('GAME_NOT_FOUND', ERRORS.GAME_NOT_FOUND);
    if (game.userId !== Number(userId)) throw new CasinoError('NOT_YOUR_GAME', ERRORS.NOT_YOUR_GAME, 403);
    const user = this.user(userId);
    if (action === 'hit') {
      game.player.push(draw(game.shoe));
      const pv = handValue(game.player);
      if (pv.total > 21) return this._finishBlackjack(game, user);
      if (pv.total === 21) return this._finishBlackjack(game, user);
      return this._bjState(game, user);
    }
    if (action === 'double') {
      if (!canDouble(game.player, user.balance, game.bet)) throw new CasinoError('INVALID_ACTION', 'Удвоение недоступно');
      this.takeBet(user, game.bet);
      game.bet *= 2;
      game.doubled = true;
      game.player.push(draw(game.shoe));
      return this._finishBlackjack(game, user);
    }
    if (action === 'stand') {
      return this._finishBlackjack(game, user);
    }
    throw new CasinoError('INVALID_ACTION', ERRORS.INVALID_ACTION);
  }

  _finishBlackjack(game, user, instant = false) {
    game.status = 'done';
    const pv = handValue(game.player);
    let payout = 0;
    let result = 'lose';
    if (pv.blackjack && instant) {
      const dv = handValue(game.dealer);
      if (dv.blackjack) { payout = game.bet; result = 'push'; }
      else { payout = Math.round(game.bet * 2.5); result = 'blackjack'; }
    } else if (pv.total > 21) {
      payout = 0;
      result = 'bust';
    } else {
      game.dealer = playDealer(game.shoe, game.dealer);
      const dv = handValue(game.dealer);
      if (dv.total > 21 || pv.total > dv.total) { payout = game.bet * 2; result = 'win'; }
      else if (pv.total === dv.total) { payout = game.bet; result = 'push'; }
      else { payout = 0; result = 'lose'; }
    }
    const settled = this.settle(user, 'blackjack', game.bet, payout, `Блэкджек: ${result} (${pv.total})`, {});
    game.payout = settled.payout;
    game.result = result;
    this.blackjacks.delete(game.id);
    return this._bjState(game, user);
  }

  // ─── краш ───────────────────────────────────────────────────────────────────
  startCrash() {
    this._beginCrashRound();
    this._timer = setInterval(() => this._crashTick(), 100);
    if (this._timer.unref) this._timer.unref();
  }

  stopCrash() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  _beginCrashRound() {
    const c = this.crash;
    c.roundId += 1;
    c.seed = newRoundSeed();
    c.hash = seedHash(c.seed);
    c.crashPoint = crashPointFromSeed(c.seed, c.roundId, this.settings.houseEdge.crash);
    c.phase = 'betting';
    c.bettingEndsAt = now() + this.settings.crash.bettingMs;
    c.startedAt = 0;
    c.crashedAt = 0;
    c.bets = new Map();
    c.nextRoundAt = 0;
    this.emit('crash:round', this.crashPublicState());
  }

  _cashoutCrashBet(bet, multiplier) {
    const user = this.store.user(bet.userId);
    if (!user) return;
    const payout = Math.round(bet.amount * multiplier);
    bet.cashedOut = true;
    bet.cashoutMultiplier = multiplier;
    const settled = this.settle(user, 'crash', bet.amount, payout, `Краш: забрал на x${multiplier}`, {});
    bet.payout = settled.payout;
    this.emit('crash:cashout', { userId: bet.userId, payout: settled.payout, multiplier });
  }

  _crashTick() {
    const c = this.crash;
    const t = now();
    if (c.phase === 'betting' && t >= c.bettingEndsAt) {
      c.phase = 'running';
      c.startedAt = t;
      c.crashDuration = timeForMultiplier(c.crashPoint);
      this.emit('crash:start', this.crashPublicState());
      // мгновенный краш на 1.00x
      if (c.crashPoint <= 1) this._crashCrash();
      return;
    }
    if (c.phase === 'running') {
      const elapsed = t - c.startedAt;
      const m = multiplierAt(elapsed);
      for (const bet of c.bets.values()) {
        if (!bet.cashedOut && bet.autoCashout && m >= bet.autoCashout) {
          const at = Math.min(bet.autoCashout, c.crashPoint);
          if (at <= c.crashPoint) this._cashoutCrashBet(bet, at);
        }
      }
      if (m >= c.crashPoint || elapsed >= c.crashDuration) this._crashCrash();
      return;
    }
    if (c.phase === 'crashed' && t >= c.nextRoundAt) {
      this._beginCrashRound();
    }
  }

  _crashCrash() {
    const c = this.crash;
    c.phase = 'crashed';
    c.crashedAt = now();
    c.nextRoundAt = c.crashedAt + this.settings.crash.cooldownMs;
    for (const bet of c.bets.values()) {
      if (!bet.cashedOut) {
        const user = this.store.user(bet.userId);
        if (user) this.settle(user, 'crash', bet.amount, 0, `Краш x${c.crashPoint}`, {});
      }
    }
    c.history.unshift({
      roundId: c.roundId,
      crashPoint: c.crashPoint,
      seed: c.seed,
      hash: c.hash,
      at: c.crashedAt,
    });
    if (c.history.length > 30) c.history.length = 30;
    this.emit('crash:crash', this.crashPublicState());
  }

  crashPublicState() {
    const c = this.crash;
    const t = now();
    let elapsed = 0;
    let multiplier = 1;
    let startsIn = 0;
    if (c.phase === 'running') {
      elapsed = t - c.startedAt;
      multiplier = Math.min(multiplierAt(elapsed), c.crashPoint);
    }
    if (c.phase === 'betting') startsIn = Math.max(0, c.bettingEndsAt - t);
    if (c.phase === 'crashed') startsIn = Math.max(0, c.nextRoundAt - t);
    const players = [...c.bets.values()]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 20)
      .map((b) => ({
        userId: b.userId,
        name: b.name,
        amount: b.amount,
        cashedOut: !!b.cashedOut,
        cashoutMultiplier: b.cashoutMultiplier || 0,
        payout: b.payout || 0,
      }));
    return {
      phase: c.phase,
      roundId: c.roundId,
      hash: c.hash,
      multiplier,
      elapsedMs: elapsed,
      startsInMs: startsIn,
      crashPoint: c.phase === 'crashed' ? c.crashPoint : null,
      seed: c.phase === 'crashed' ? c.seed : null,
      players,
      history: c.history.map((h) => ({ roundId: h.roundId, crashPoint: h.crashPoint })),
      bettingMs: this.settings.crash.bettingMs,
    };
  }

  crashBet(userId, { amount, autoCashout }) {
    const c = this.crash;
    if (c.phase !== 'betting') throw new CasinoError('TOO_LATE', 'Ставки на этот раунд уже закрыты');
    const user = this.user(userId);
    if (c.bets.has(Number(userId))) throw new CasinoError('ALREADY_BET', ERRORS.ALREADY_BET);
    const amt = this.assertBet(user, amount, 'crash');
    let auto = Number(autoCashout) || 0;
    if (auto && auto < 1.01) auto = 0;
    if (auto > 1000) auto = 1000;
    this.takeBet(user, amt);
    c.bets.set(Number(userId), {
      userId: Number(userId),
      name: user.username ? `@${user.username}` : user.firstName || `id${user.id}`,
      amount: amt,
      autoCashout: auto ? round2(auto) : 0,
      cashedOut: false,
      cashoutMultiplier: 0,
      payout: 0,
    });
    return { balance: user.balance, state: this.crashPublicState() };
  }

  crashCashout(userId) {
    const c = this.crash;
    if (c.phase !== 'running') throw new CasinoError('TOO_LATE', ERRORS.TOO_LATE);
    const bet = c.bets.get(Number(userId));
    if (!bet) throw new CasinoError('GAME_NOT_FOUND', 'Ты не участвуешь в этом раунде');
    if (bet.cashedOut) throw new CasinoError('INVALID_ACTION', 'Ты уже забрал');
    const elapsed = now() - c.startedAt;
    const m = multiplierAt(elapsed);
    if (m >= c.crashPoint || elapsed >= c.crashDuration) throw new CasinoError('TOO_LATE', ERRORS.TOO_LATE);
    this._cashoutCrashBet(bet, m);
    const user = this.store.user(userId);
    return {
      multiplier: m,
      payout: bet.payout,
      profit: bet.payout - bet.amount,
      balance: user.balance,
    };
  }

  // ─── колесо ─────────────────────────────────────────────────────────────────
  spinWheel(userId, amount) {
    const user = this.user(userId);
    const amt = this.assertBet(user, amount, 'wheel');
    this.takeBet(user, amt);
    const res = spinWheelGame({ amount: amt, rng, edge: this.settings.houseEdge.wheel });
    const settled = this.settle(user, 'wheel', amt, res.payout, `Колесо: x${res.multiplier}`, {});
    return {
      ...res,
      payout: settled.payout,
      profit: settled.profit,
      totalBet: amt,
      balance: user.balance,
    };
  }

  // ─── плинко ─────────────────────────────────────────────────────────────────
  dropPlinko(userId, { amount, rows, risk, count = 1 } = {}) {
    const user = this.user(userId);
    const perBet = Math.round(Number(amount));
    const balls = clampBalls(count);
    // Лимит игры применяется к суммарной ставке за весь залп, а не к одному шарику.
    const totalBet = this.assertBet(user, perBet * balls, 'plinko');
    const r = RISKS[risk] ? risk : 'medium';
    const n = [8, 10, 12, 14, 16].includes(Number(rows)) ? Number(rows) : 12;
    this.takeBet(user, totalBet);
    const res = dropBalls({
      amount: perBet,
      rows: n,
      risk: r,
      count: balls,
      rng,
      edge: this.settings.houseEdge.plinko,
    });
    const first = res.balls[0];
    const summary = balls === 1
      ? `x${first.multiplier}`
      : `${balls} шариков: ${res.balls.map((b) => `x${b.multiplier}`).join(', ')}`;
    const settled = this.settle(user, 'plinko', totalBet, res.payout, `Плинко ${n} рядов (${r}): ${summary}`, {
      bucket: first.bucket,
      balls,
      buckets: res.buckets,
    });
    return {
      ...res,
      // Обратная совместимость с однозарядным клиентом и старыми тестами.
      ...(balls === 1
        ? { path: first.path, bucket: first.bucket, multiplier: first.multiplier, chance: first.chance }
        : {}),
      payout: settled.payout,
      profit: settled.profit,
      totalBet,
      balance: user.balance,
    };
  }

  /** Шанс дропа NFT за крупный выигрыш. Редкость зависит от размера выигрыша. */
  _rollNft(user, game, bet, payout) {
    const ratio = payout / Math.max(1, bet);
    const rarity = ratio >= 200 ? 'legendary' : ratio >= 60 ? 'epic' : ratio >= 20 ? 'rare' : 'common';
    if (rng() > (NFT_CHANCE[rarity] ?? 0)) return null;
    return this._grantNft(user, game, rarity);
  }

  _grantNft(user, game, rarity) {
    const names = NFT_NAMES[rarity] || NFT_NAMES.common;
    const nft = {
      id: `nft${this.store.nextId().toString(36)}`,
      name: names[Math.floor(rng() * names.length)],
      rarity,
      game,
      ts: now(),
    };
    user.nfts = user.nfts || [];
    user.nfts.push(nft);
    if (user.nfts.length > NFT_MAX) user.nfts.splice(0, user.nfts.length - NFT_MAX);
    this.store.save();
    return nft;
  }


  /** Лента крупных выигрышей всех игроков (для social-proof на главной). */
  winFeed(limit = 20) {
    const gameNames = new Set(['roulette', 'crash', 'dice', 'blackjack', 'wheel', 'plinko', 'coinflip', 'lucky']);
    const out = [];
    for (let i = this.store.data.history.length - 1; i >= 0 && out.length < limit; i--) {
      const h = this.store.data.history[i];
      if (!gameNames.has(h.game) || (h.payout || 0) <= (h.bet || 0)) continue;
      const u = this.store.user(h.userId);
      out.push({
        name: u ? (u.username ? `@${u.username}` : u.firstName || `id${u.id}`) : 'player',
        game: h.game,
        bet: h.bet || 0,
        payout: h.payout || 0,
        profit: (h.payout || 0) - (h.bet || 0),
        ts: h.ts,
      });
    }
    return out;
  }

  // ─── lucky wheel (бесплатно, раз в 24ч) ─────────────────────────────────────
  luckySpin(userId) {
    const user = this.user(userId);
    this.checkPlayable(user);
    const wait = (user.lastLucky || 0) + LUCKY_COOLDOWN_MS - now();
    if (wait > 0) {
      throw new CasinoError('LUCKY_WAIT', `Колесо обновится через ${Math.ceil(wait / 3600000)} ч.`, 429);
    }
    user.lastLucky = now();
    const idx = pickSegment(rng);
    const seg = WHEEL_SEGMENTS[idx];
    const prize = seg.m === 0 ? 30 : Math.round(LUCKY_BASE * seg.m);
    const settled = this.settle(user, 'lucky', 0, prize, `Lucky Wheel: сектор ${seg.label} → ${prize} ⭐`, {
      sector: seg.key,
      multiplier: seg.m,
    });
    let nft = null;
    if (prize >= 3000 && rng() < 0.35) nft = this._grantNft(user, 'lucky', 'rare');
    this.store.save();
    return {
      index: idx,
      label: seg.label,
      multiplier: seg.m,
      prize: settled.payout,
      balance: user.balance,
      nft,
      nextIn: LUCKY_COOLDOWN_MS,
    };
  }

  luckyState(userId) {
    const user = this.user(userId);
    const wait = Math.max(0, (user.lastLucky || 0) + LUCKY_COOLDOWN_MS - now());
    return { ready: wait <= 0, waitMs: wait };
  }

  // ─── монетка ────────────────────────────────────────────────────────────────
  playCoinflip(userId, { amount, side }) {
    const user = this.user(userId);
    this.checkPlayable(user);
    const chosen = side === 'tails' ? 'tails' : side === 'heads' ? 'heads' : '';
    if (!chosen) throw new CasinoError('INVALID_SIDE', 'Выбери орёл или решку');
    const amt = this.assertBet(user, amount, 'coinflip');
    this.takeBet(user, amt);
    const edge = Math.min(0.4, Math.max(0, Number(this.settings.houseEdge?.coinflip ?? 0.03)));
    const roll = rng();
    const win = roll < (1 - edge) / 2;
    const result = win ? chosen : chosen === 'heads' ? 'tails' : 'heads';
    const multiplier = win ? Math.floor((2 - edge) * 100) / 100 : 0;
    const rawPayout = win ? Math.round(amt * multiplier) : 0;
    const settled = this.settle(user, 'coinflip', amt, rawPayout, `Монетка: ${chosen} → ${result}`, { roll });
    return {
      side: chosen,
      result,
      win,
      roll,
      multiplier,
      payout: settled.payout,
      profit: settled.profit,
      totalBet: amt,
      balance: user.balance,
    };
  }

  // ─── пополнение звёзд ───────────────────────────────────────────────────────
  createDeposit(userId, amount) {
    const user = this.user(userId);
    if (user.banned) throw new CasinoError('BANNED', ERRORS.BANNED, 403);
    const amt = Math.round(Number(amount));
    const s = this.settings;
    if (!Number.isFinite(amt) || amt <= 0) throw new CasinoError('DEPOSIT_INVALID', 'Укажи сумму пополнения');
    if (amt < s.minDeposit) throw new CasinoError('DEPOSIT_TOO_LOW', `Минимальное пополнение: ${s.minDeposit} ⭐`);
    if (amt > s.maxDeposit) throw new CasinoError('DEPOSIT_TOO_HIGH', `Максимум за раз: ${s.maxDeposit} ⭐`);
    const pending = this.store.data.deposits.filter((d) => d.userId === user.id && d.status === 'pending');
    if (pending.length >= s.maxPendingDeposits) {
      throw new CasinoError('DEPOSIT_LIMIT', 'Слишком много открытых заявок — дождись ответа хозяина');
    }
    const deposit = {
      id: `D${this.store.nextId().toString(36).toUpperCase()}`,
      userId: user.id,
      userName: shortName(user),
      username: user.username || '',
      amount: amt,
      status: 'pending',
      createdAt: now(),
      decidedAt: 0,
      decidedBy: 0,
    };
    this.store.data.deposits.push(deposit);
    this.store.save();
    this.emit('deposit:new', deposit);
    return deposit;
  }

  depositsFor(userId, limit = 12) {
    return this.store.data.deposits
      .filter((d) => d.userId === Number(userId))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  pendingDeposits(limit = 30) {
    return this.store.data.deposits
      .filter((d) => d.status === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, limit);
  }

  findDeposit(id) {
    return this.store.data.deposits.find((d) => d.id === String(id)) || null;
  }

  decideDeposit(adminId, id, approve) {
    this.assertOwner(adminId);
    const dep = this.findDeposit(id);
    if (!dep) throw new CasinoError('DEPOSIT_NOT_FOUND', 'Заявка не найдена', 404);
    if (dep.status !== 'pending') throw new CasinoError('INVALID_ACTION', 'Заявка уже обработана');
    dep.status = approve ? 'approved' : 'rejected';
    dep.decidedAt = now();
    dep.decidedBy = Number(adminId);
    const user = this.store.user(dep.userId);
    if (approve && user) {
      this.store.credit(user, dep.amount, 'deposit');
      this.store.history({
        userId: user.id,
        game: 'deposit',
        bet: 0,
        payout: dep.amount,
        profit: dep.amount,
        detail: `Пополнение #${dep.id}`,
      });
    }
    this.store.save();
    this.emit('deposit:decided', dep);
    return dep;
  }

  // ─── вывод звёзд ────────────────────────────────────────────────────────────
  createWithdrawal(userId, { amount, contact }) {
    const user = this.user(userId);
    if (user.banned) throw new CasinoError('BANNED', ERRORS.BANNED, 403);
    const s = this.settings;
    const amt = Math.round(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0) throw new CasinoError('WITHDRAW_INVALID', 'Укажи сумму вывода');
    const min = Math.max(1, Number(s.minWithdraw) || 1000);
    const max = Math.min(Math.max(min, Number(s.maxWithdraw) || 150000), this.store.balanceCap());
    if (amt < min) throw new CasinoError('WITHDRAW_TOO_LOW', `Минимальный вывод: ${min} ⭐`);
    if (amt > max) throw new CasinoError('WITHDRAW_TOO_HIGH', `Максимальный вывод: ${max} ⭐`);
    if (user.balance < amt) throw new CasinoError('BALANCE_LOW', ERRORS.BALANCE_LOW);
    const pending = this.store.data.withdrawals.filter((w) => w.userId === user.id && w.status === 'pending');
    if (pending.length >= 3) throw new CasinoError('WITHDRAW_LIMIT', 'У тебя уже 3 заявки на вывод — дождись ответа');
    const cleanContact = String(contact || '').trim().slice(0, 200);

    // Деньги сразу резервируются: нельзя подать две заявки на один и тот же баланс.
    user.balance -= amt;
    this.store.save();
    this.store.history({
      userId: user.id,
      game: 'withdraw',
      bet: 0,
      payout: -amt,
      profit: -amt,
      detail: `Заявка на вывод (зарезервировано) ${amt} ⭐`,
    });
    const wd = {
      id: `W${this.store.nextId().toString(36).toUpperCase()}`,
      userId: user.id,
      userName: shortName(user),
      username: user.username || '',
      amount: amt,
      contact: cleanContact,
      status: 'pending',
      createdAt: now(),
      decidedAt: 0,
      decidedBy: 0,
      note: '',
    };
    this.store.data.withdrawals.push(wd);
    this.store.save();
    this.emit('withdraw:new', wd);
    return wd;
  }

  withdrawalsFor(userId, limit = 12) {
    return this.store.data.withdrawals
      .filter((w) => w.userId === Number(userId))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  pendingWithdrawals(limit = 30) {
    return this.store.data.withdrawals
      .filter((w) => w.status === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, limit);
  }

  findWithdrawal(id) {
    return this.store.data.withdrawals.find((w) => w.id === String(id)) || null;
  }

  decideWithdrawal(adminId, id, approve, note = '') {
    this.assertOwner(adminId);
    const wd = this.findWithdrawal(id);
    if (!wd) throw new CasinoError('WITHDRAW_NOT_FOUND', 'Заявка не найдена', 404);
    if (wd.status !== 'pending') throw new CasinoError('INVALID_ACTION', 'Заявка уже обработана');
    wd.status = approve ? 'approved' : 'rejected';
    wd.decidedAt = now();
    wd.decidedBy = Number(adminId);
    wd.note = String(note || '').trim().slice(0, 200);
    const user = this.store.user(wd.userId);
    if (!approve && user) {
      this.store.credit(user, wd.amount, 'withdraw-refund');
      this.store.history({
        userId: user.id,
        game: 'withdraw',
        bet: 0,
        payout: wd.amount,
        profit: wd.amount,
        detail: `Отклонена заявка #${wd.id} — возврат ${wd.amount} ⭐`,
      });
    }
    this.store.save();
    this.emit('withdraw:decided', wd);
    return wd;
  }

  // ─── бонусы ─────────────────────────────────────────────────────────────────
  daily(userId) {
    const user = this.user(userId);
    const s = this.settings;
    const wait = (user.lastDaily || 0) + s.dailyCooldownMs - now();
    if (wait > 0) {
      throw new CasinoError('DAILY_WAIT', `Бонус будет доступен через ${Math.ceil(wait / 60000)} мин.`);
    }
    const prev = user.lastDaily || 0;
    const t = now();
    // Стрик: ежедневный клейм не реже чем раз в ~48ч продлевает серию,
    // пропуск больше суток сбрасывает её. Показывается в лобби как «N дней подряд».
    user.streak = prev && t - prev <= s.dailyCooldownMs + 86400000 ? (user.streak || 0) + 1 : 1;
    user.lastDaily = t;
    this.store.credit(user, s.dailyBonus, 'daily');
    this.store.history({ userId: user.id, game: 'bonus', bet: 0, payout: s.dailyBonus, profit: s.dailyBonus, detail: `Ежедневный бонус · стрик ${user.streak} дн.` });
    return { amount: s.dailyBonus, balance: user.balance, nextIn: s.dailyCooldownMs, streak: user.streak };
  }

  redeemPromo(userId, code) {
    const user = this.user(userId);
    const key = String(code || '').trim().toLowerCase();
    if (!key) throw new CasinoError('PROMO_INVALID', ERRORS.PROMO_INVALID);
    const promo = this.store.data.promos[key];
    if (!promo) throw new CasinoError('PROMO_INVALID', ERRORS.PROMO_INVALID);
    if ((promo.usedBy || []).includes(user.id)) throw new CasinoError('PROMO_USED', ERRORS.PROMO_USED);
    if (promo.uses > 0 && (promo.usedBy || []).length >= promo.uses) throw new CasinoError('PROMO_EXHAUSTED', ERRORS.PROMO_EXHAUSTED);
    promo.usedBy = promo.usedBy || [];
    promo.usedBy.push(user.id);
    this.store.credit(user, promo.amount, 'promo');
    this.store.history({ userId: user.id, game: 'bonus', bet: 0, payout: promo.amount, profit: promo.amount, detail: `Промокод ${key}` });
    return { amount: promo.amount, balance: user.balance, code: key };
  }

  transfer(fromId, toId, amount) {
    const from = this.user(fromId);
    const to = this.store.user(toId);
    const amt = Math.round(Number(amount));
    if (!to) throw new CasinoError('USER_NOT_FOUND', 'Получатель не найден в казино');
    if (to.banned) throw new CasinoError('BANNED', 'Получатель заблокирован');
    if (fromId === toId) throw new CasinoError('INVALID_ACTION', 'Нельзя перевести самому себе');
    if (!Number.isFinite(amt) || amt < 1) throw new CasinoError('BET_INVALID', 'Сумма должна быть больше 0');
    if (from.balance < amt) throw new CasinoError('BALANCE_LOW', ERRORS.BALANCE_LOW);
    this.store.take(from, amt);
    this.store.credit(to, amt, 'transfer');
    this.store.history({ userId: from.id, game: 'transfer', bet: amt, payout: 0, profit: -amt, detail: `Перевод → ${to.username || to.id}` });
    this.store.history({ userId: to.id, game: 'transfer', bet: 0, payout: amt, profit: amt, detail: `Перевод ← ${from.username || from.id}` });
    return { balance: from.balance, to: { id: to.id, name: to.username || to.firstName, balance: to.balance } };
  }

  // ─── аукцион ────────────────────────────────────────────────────────────────
  _auctions() {
    return this.store.data.auctions || (this.store.data.auctions = []);
  }

  _activeAuctions() {
    return this._auctions().filter((a) => a.status === 'active');
  }

  _activeAuction(lotId) {
    const active = this._activeAuctions();
    if (!lotId) return active[0] || null;
    return active.find((a) => a.id === lotId) || null;
  }

  /** Имя в публичном ответе: своё и хозяину — полное, остальным — маска. */
  _auctionName(userId, viewerId) {
    const u = this.store.user(userId);
    const name = u ? shortName(u) : 'Игрок';
    if (Number(userId) === Number(viewerId) || this.isOwner(viewerId)) return name;
    return `@${String(name).replace(/^@/, '').slice(0, 3)}***`;
  }

  _auctionView(lot, viewerId) {
    if (!lot) return null;
    const hostId = Number(lot.hostId || this.settings.ownerId);
    const hostUser = this.store.user(hostId);
    return {
      id: lot.id,
      hostId,
      host: { id: hostId, name: hostUser ? shortName(hostUser) : 'Игрок' },
      isHost: Number(viewerId) === hostId,
      canManage: Number(viewerId) === hostId || this.isOwner(viewerId),
      title: lot.title,
      note: lot.note || '',
      emoji: lot.emoji || '🎁',
      status: lot.status,
      minBid: lot.minBid,
      step: lot.step,
      currentBid: lot.currentBid || 0,
      bidCount: lot.bidCount || (lot.bids || []).length,
      leader: lot.leader
        ? { id: lot.leader.id, name: this._auctionName(lot.leader.id, viewerId), amount: lot.currentBid }
        : null,
      winner: lot.winner
        ? { id: lot.winner.id, name: this._auctionName(lot.winner.id, viewerId), amount: lot.winner.amount }
        : null,
      startedAt: lot.startedAt,
      endsAt: lot.endsAt,
      finishedAt: lot.finishedAt || 0,
      burned: lot.burned || 0,
      bids: (lot.bids || []).slice(-12).reverse().map((b) => ({
        id: b.id,
        name: this._auctionName(b.userId, viewerId),
        amount: b.amount,
        ts: b.ts,
        burned: !!b.burned,
        mine: Number(b.userId) === Number(viewerId),
      })),
    };
  }

  /** Истёкшие лоты завершаются лениво — при любом обращении к аукциону. */
  _maybeFinishAuctions() {
    const finished = [];
    for (const lot of this._activeAuctions()) {
      if (lot.endsAt && now() >= lot.endsAt) finished.push(this._finishAuction('sold', lot.id));
    }
    return finished.filter(Boolean);
  }

  _finishAuction(status, lotId) {
    const lot = this._activeAuction(lotId);
    if (!lot) return null;
    const leader = lot.leader;
    const amount = lot.currentBid || 0;
    if (status === 'sold' && leader) {
      const winUser = this.store.user(leader.id);
      const hostId = Number(lot.hostId || this.settings.ownerId);
      const host = this.store.user(hostId) || this.store.users().find((u) => u.isOwner);
      if (winUser) {
        this.store.history({
          userId: winUser.id,
          game: 'auction',
          bet: amount,
          payout: 0,
          profit: -amount,
          detail: `Подарок «${lot.title}» — ставка передана организатору`,
        });
        // Подарок остаётся и в профиле: памятный дроп победителю лота.
        this._grantNft(winUser, 'auction', amount >= 15000 ? 'epic' : 'rare');
      }
      if (host && host.id !== leader.id) this.store.credit(host, amount, 'auction');
      lot.winner = { id: leader.id, amount };
    }
    if (status === 'canceled' && leader) {
      const user = this.store.user(leader.id);
      if (user) {
        this.store.credit(user, amount, 'auction-refund');
        this.store.history({
          userId: user.id,
          game: 'auction',
          bet: 0,
          payout: amount,
          profit: amount,
          detail: `Возврат ставки — лот «${lot.title}» отменён`,
        });
      }
    }
    lot.status = status;
    lot.finishedAt = now();
    this.store.save();
    this.emit('auction:end', {
      lot: this._auctionView(lot, lot.winner?.id || Number(lot.hostId || this.settings.ownerId)),
    });
    return lot;
  }

  auctionPublic(viewerId) {
    this._maybeFinishAuctions();
    const active = this._activeAuctions();
    const history = this._auctions()
      .filter((a) => a.status !== 'active')
      .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0))
      .slice(0, 8)
      .map((a) => this._auctionView(a, viewerId));
    const lots = active.map((a) => this._auctionView(a, viewerId));
    return {
      lots,
      lot: lots[0] || null,
      history,
      burned: this.store.data.meta.totalBurned || 0,
    };
  }

  auctionCreate(userId, body = {}) {
    this.checkPlayable(this.user(userId));
    this._maybeFinishAuctions();
    const title = String(body.title || '').trim().slice(0, 48);
    if (!title) throw new CasinoError('INVALID_ACTION', 'Укажи название подарка');
    const limit = Number(this.settings.limits?.auction ?? this.settings.maxBet);
    const minBid = clamp(Math.round(Number(body.minBid) || this.settings.minBet), this.settings.minBet, limit);
    const step = clamp(Math.round(Number(body.step) || 100), 1, limit);
    const minutes = clamp(Math.round(Number(body.minutes) || 5), 1, 1440);
    const lot = {
      id: `auc-${now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      hostId: Number(userId),
      title,
      note: String(body.note || '').trim().slice(0, 160),
      emoji: String(body.emoji || '').trim().slice(0, 8) || '🎁',
      minBid,
      step,
      currentBid: 0,
      bidCount: 0,
      leader: null,
      winner: null,
      bids: [],
      burned: 0,
      status: 'active',
      startedAt: now(),
      endsAt: now() + minutes * 60000,
      finishedAt: 0,
    };
    const all = this._auctions();
    all.push(lot);
    if (all.length > 60) all.splice(0, all.length - 60);
    this.store.save();
    this.emit('auction:new', { lot: this._auctionView(lot, userId) });
    return { lot: this._auctionView(lot, userId) };
  }

  auctionBid(userId, body = {}) {
    const user = this.user(userId);
    this._maybeFinishAuctions();
    const lot = this._activeAuction(body.lotId);
    if (!lot) throw new CasinoError('GAME_NOT_FOUND', 'Этот лот уже завершён');
    if (Number(user.id) === Number(lot.hostId || this.settings.ownerId)) {
      throw new CasinoError('INVALID_ACTION', 'Организатор не ставит на свой лот');
    }
    const amt = this.assertBet(user, body.amount, 'auction');
    const need = lot.leader ? Math.max(lot.currentBid + lot.step, lot.minBid) : lot.minBid;
    if (amt < need) throw new CasinoError('BET_TOO_LOW', `Нужно не меньше ${need} ⭐`);
    this.takeBet(user, amt);

    // Перебитая ставка не возвращается — она сгорает и уходит в видимый счётчик.
    if (lot.leader) {
      const prev = this.store.user(lot.leader.id);
      const prevBid = (lot.bids || []).find((b) => b.id === lot.leader.bidId);
      if (prevBid) prevBid.burned = true;
      if (prev) {
        lot.burned = (lot.burned || 0) + lot.currentBid;
        this.store.data.meta.totalBurned = (this.store.data.meta.totalBurned || 0) + lot.currentBid;
        this.store.history({
          userId: prev.id,
          game: 'auction',
          bet: lot.currentBid,
          payout: 0,
          profit: -lot.currentBid,
          detail: `Ставка сгорела — перебита в лоте «${lot.title}»`,
        });
      }
    }

    const bid = {
      id: `${user.id}-${now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      userId: user.id,
      amount: amt,
      ts: now(),
      burned: false,
    };
    lot.bids = lot.bids || [];
    lot.bids.push(bid);
    if (lot.bids.length > 30) lot.bids.splice(0, lot.bids.length - 30);
    lot.currentBid = amt;
    lot.leader = { id: user.id, bidId: bid.id };
    lot.bidCount = (lot.bidCount || 0) + 1;
    if (lot.endsAt - now() < AUCTION_ANTI_SNIPE_MS) lot.endsAt = now() + AUCTION_ANTI_SNIPE_MS;
    this.store.save();
    this.emit('auction:bid', { lot: this._auctionView(lot, user.id), amount: amt });
    return {
      lot: this._auctionView(lot, user.id),
      balance: user.balance,
      minNext: Math.max(amt + lot.step, lot.minBid),
    };
  }

  _assertAuctionManager(userId, lot) {
    const hostId = Number(lot.hostId || this.settings.ownerId);
    if (Number(userId) !== hostId && !this.isOwner(userId)) {
      throw new CasinoError('NOT_OWNER', 'Завершать лот может только его организатор', 403);
    }
  }

  auctionFinish(userId, lotId) {
    this._maybeFinishAuctions();
    const lot = this._activeAuction(lotId);
    if (!lot) throw new CasinoError('GAME_NOT_FOUND', 'Активного лота нет');
    this._assertAuctionManager(userId, lot);
    this._finishAuction('sold', lot.id);
    return { lot: this._auctionView(this._auctions().find((a) => a.id === lot.id), userId) };
  }

  auctionCancel(userId, lotId) {
    this._maybeFinishAuctions();
    const lot = this._activeAuction(lotId);
    if (!lot) throw new CasinoError('GAME_NOT_FOUND', 'Активного лота нет');
    this._assertAuctionManager(userId, lot);
    this._finishAuction('canceled', lot.id);
    return { lot: this._auctionView(this._auctions().find((a) => a.id === lot.id), userId) };
  }

  // ─── админ ──────────────────────────────────────────────────────────────────
  assertOwner(userId) {
    if (!this.isOwner(userId)) throw new CasinoError('NOT_OWNER', ERRORS.NOT_OWNER, 403);
  }

  adminUserAction(adminId, targetId, action, amount = 0) {
    this.assertOwner(adminId);
    const target = this.store.user(targetId);
    if (!target) throw new CasinoError('USER_NOT_FOUND', ERRORS.USER_NOT_FOUND, 404);
    const amt = Math.round(Number(amount) || 0);
    if (action === 'credit') this.store.credit(target, Math.abs(amt), 'admin');
    else if (action === 'debit') this.store.credit(target, -Math.abs(amt), 'admin');
    else if (action === 'set') {
      target.balance = Math.max(0, amt);
      this.store.applyBalanceCap(target);
    }
    else if (action === 'vault') this.store.fromVault(target, Math.abs(amt));
    else if (action === 'ban') target.banned = true;
    else if (action === 'unban') target.banned = false;
    else if (action === 'reset') {
      target.balance = 0;
      target.totalBet = 0;
      target.totalWin = 0;
      target.wins = 0;
      target.losses = 0;
      target.games = 0;
      target.biggestWin = 0;
    } else throw new CasinoError('INVALID_ACTION', ERRORS.INVALID_ACTION);
    this.store.save();
    this.store.history({ userId: target.id, game: 'admin', bet: 0, payout: action === 'credit' ? Math.abs(amt) : 0, profit: 0, detail: `Админ: ${action} ${amt}` });
    return { user: target };
  }

  adminSetSettings(adminId, patch) {
    this.assertOwner(adminId);
    const s = this.settings;
    const clean = {};
    const num = (v, min, max, def) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
    };
    if (patch.minBet !== undefined) clean.minBet = num(patch.minBet, 1, 1e6, s.minBet);
    if (patch.maxBet !== undefined) clean.maxBet = num(patch.maxBet, clean.minBet ?? s.minBet, 1e9, s.maxBet);
    if (patch.welcomeBonus !== undefined) clean.welcomeBonus = num(patch.welcomeBonus, 0, 1e9, s.welcomeBonus);
    if (patch.dailyBonus !== undefined) clean.dailyBonus = num(patch.dailyBonus, 0, 1e9, s.dailyBonus);
    if (patch.refBonus !== undefined) clean.refBonus = num(patch.refBonus, 0, 1e9, s.refBonus);
    if (patch.maintenance !== undefined) clean.maintenance = !!patch.maintenance;
    if (patch.publicUrl !== undefined) clean.publicUrl = String(patch.publicUrl || '').trim().replace(/\/+$/, '');
    if (patch.currency !== undefined) clean.currency = String(patch.currency || '⭐').slice(0, 8);
    if (patch.cashierUsername !== undefined) clean.cashierUsername = String(patch.cashierUsername || '').replace(/^@/, '').slice(0, 32);
    if (patch.minDeposit !== undefined) clean.minDeposit = num(patch.minDeposit, 1, 1e9, s.minDeposit);
    if (patch.maxDeposit !== undefined) clean.maxDeposit = num(patch.maxDeposit, clean.minDeposit ?? s.minDeposit, 1e9, s.maxDeposit);
    if (patch.maxBalance !== undefined) clean.maxBalance = num(patch.maxBalance, 1000, 1e9, s.maxBalance);
    if (patch.minWithdraw !== undefined) clean.minWithdraw = num(patch.minWithdraw, 1, 1e9, s.minWithdraw);
    if (patch.maxWithdraw !== undefined) clean.maxWithdraw = num(patch.maxWithdraw, clean.minWithdraw ?? s.minWithdraw, 1e9, s.maxWithdraw);
    if (patch.storageFee && typeof patch.storageFee === 'object') {
      const f = { ...(s.storageFee || {}) };
      if (patch.storageFee.enabled !== undefined) f.enabled = !!patch.storageFee.enabled;
      if (patch.storageFee.threshold !== undefined) {
        f.threshold = num(patch.storageFee.threshold, 0, clean.maxBalance ?? s.maxBalance, f.threshold);
      }
      if (patch.storageFee.percentPerDay !== undefined) {
        const v = Number(patch.storageFee.percentPerDay);
        f.percentPerDay = Number.isFinite(v) ? Math.min(5, Math.max(0, v)) : f.percentPerDay;
      }
      clean.storageFee = f;
    }
    if (patch.bettingMs !== undefined) clean.crash = { ...s.crash, bettingMs: num(patch.bettingMs, 3000, 30000, s.crash.bettingMs) };
    if (patch.cooldownMs !== undefined) clean.crash = { ...(clean.crash || s.crash), cooldownMs: num(patch.cooldownMs, 1000, 30000, s.crash.cooldownMs) };
    if (patch.houseEdge && typeof patch.houseEdge === 'object') {
      const edge = { ...s.houseEdge };
      for (const k of Object.keys(edge)) {
        if (patch.houseEdge[k] !== undefined) {
          const v = Number(patch.houseEdge[k]);
          if (Number.isFinite(v)) edge[k] = Math.min(0.25, Math.max(0, v));
        }
      }
      clean.houseEdge = edge;
    }
    if (patch.limits && typeof patch.limits === 'object') {
      const limits = { ...s.limits };
      for (const k of Object.keys(limits)) {
        if (patch.limits[k] !== undefined) limits[k] = num(patch.limits[k], 1, 1e9, limits[k]);
      }
      clean.limits = limits;
    }
    this.store.settings = clean;
    return this.settings;
  }

  adminCreatePromo(adminId, { code, amount, uses }) {
    this.assertOwner(adminId);
    const key = String(code || '').trim().toLowerCase();
    if (!/^[a-z0-9_-]{2,32}$/.test(key)) throw new CasinoError('BET_INVALID', 'Код: латиница/цифры, 2–32 символа');
    const amt = Math.round(Number(amount));
    if (!Number.isFinite(amt) || amt < 1) throw new CasinoError('BET_INVALID', 'Сумма должна быть > 0');
    const limit = Math.max(0, Math.round(Number(uses) || 0));
    this.store.data.promos[key] = { code: key, amount: amt, uses: limit, usedBy: [], createdAt: now() };
    this.store.save();
    return this.store.data.promos[key];
  }

  adminDeletePromo(adminId, code) {
    this.assertOwner(adminId);
    delete this.store.data.promos[String(code || '').toLowerCase()];
    this.store.save();
  }

  adminBroadcast(adminId, text) {
    this.assertOwner(adminId);
    const msg = String(text || '').trim();
    if (!msg) throw new CasinoError('INVALID_ACTION', 'Пустое сообщение');
    this.emit('broadcast', { text: msg, by: adminId });
    return { recipients: this.store.users().filter((u) => !u.banned).length };
  }

  adminStats(adminId) {
    this.assertOwner(adminId);
    const base = this.store.stats();
    const byGame = {};
    for (const u of this.store.users()) {
      for (const h of this.store.recent(u.id, 50)) {
        byGame[h.game] = byGame[h.game] || { bet: 0, payout: 0, rounds: 0 };
        byGame[h.game].bet += h.bet || 0;
        byGame[h.game].payout += h.payout || 0;
        byGame[h.game].rounds += 1;
      }
    }
    return {
      ...base,
      ownerId: this.settings.ownerId,
      publicUrl: this.settings.publicUrl,
      currency: this.settings.currency,
      minBet: this.settings.minBet,
      maxBet: this.settings.maxBet,
      maintenance: this.settings.maintenance,
      houseEdge: this.settings.houseEdge,
      limits: this.settings.limits,
      dailyBonus: this.settings.dailyBonus,
      welcomeBonus: this.settings.welcomeBonus,
      byGame,
      promos: Object.values(this.store.data.promos),
      cashierUsername: this.settings.cashierUsername,
      minDeposit: this.settings.minDeposit,
      maxDeposit: this.settings.maxDeposit,
      maxBalance: this.store.balanceCap(),
      storageFee: this.settings.storageFee,
      minWithdraw: this.settings.minWithdraw,
      maxWithdraw: this.settings.maxWithdraw,
      vaultTotal: this.store.users().reduce((s, u) => s + (u.vault || 0), 0),
      feesTotal: this.store.data.meta.totalFees || 0,
      burnedTotal: this.store.data.meta.totalBurned || 0,
      withdrawals: this.pendingWithdrawals(30),
      withdrawHistory: this.store.data.withdrawals
        .filter((w) => w.status !== 'pending')
        .sort((a, b) => b.decidedAt - a.decidedAt)
        .slice(0, 20),
      deposits: this.pendingDeposits(30),
      depositHistory: this.store.data.deposits
        .filter((d) => d.status !== 'pending')
        .sort((a, b) => b.decidedAt - a.decidedAt)
        .slice(0, 20),
      crashTimings: { bettingMs: this.settings.crash.bettingMs, cooldownMs: this.settings.crash.cooldownMs },
      crash: { phase: this.crash.phase, roundId: this.crash.roundId, crashPoint: this.crash.crashPoint },
    };
  }

  detailHistory(userId, limit = 25) {
    return this.store.recent(userId, limit);
  }
}
