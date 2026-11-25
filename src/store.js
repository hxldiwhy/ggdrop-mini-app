import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.js';

export const DEFAULT_SETTINGS = {
  ownerId: 0,
  publicUrl: '',
  botUsername: '',
  /** РљР°СЃСЃРёСЂ вЂ” РєРѕРјСѓ РїРёСЃР°С‚СЊ РґР»СЏ РїРѕРїРѕР»РЅРµРЅРёСЏ Р·РІС‘Р·Рґ */
  cashierUsername: 'crypt',
  currency: 'в­ђ',
  welcomeBonus: 5000,
  dailyBonus: 1000,
  refBonus: 250,
  minBet: 10,
  maxBet: 25000,
  minDeposit: 100,
  maxDeposit: 1000000,
  maxPendingDeposits: 3,
  /** Р—Р°СЏРІРєРё РЅР° РІС‹РІРѕРґ Р·РІС‘Р·Рґ */
  minWithdraw: 1000,
  maxWithdraw: 150000,
  maintenance: false,
  /** Р”РѕР»СЏ РєР°Р·РёРЅРѕ РІ РєР°Р¶РґРѕР№ РёРіСЂРµ (0.03 = 3%) */
  houseEdge: { roulette: 0.027, dice: 0.03, blackjack: 0.012, crash: 0.03, wheel: 0.04, plinko: 0.03, coinflip: 0.03 },
  /** Р›РёРјРёС‚С‹ РЅР° РѕРґРЅСѓ СЃС‚Р°РІРєСѓ РїРѕ РёРіСЂРµ */
  limits: { roulette: 50000, dice: 25000, blackjack: 25000, crash: 25000, wheel: 25000, plinko: 25000, coinflip: 25000, auction: 25000 },
  dailyCooldownMs: 24 * 60 * 60 * 1000,
  /** РљСЂР°С€: РІСЂРµРјСЏ РїСЂРёС‘РјР° СЃС‚Р°РІРѕРє Рё РїР°СѓР·С‹ РјРµР¶РґСѓ СЂР°СѓРЅРґР°РјРё */
  crash: { bettingMs: 8000, cooldownMs: 5000 },
  /** РћРіСЂР°РЅРёС‡РµРЅРёСЏ РґР»СЏ РЅРѕРІС‹С… Р°РєРєР°СѓРЅС‚РѕРІ */
  newUserMaxBet: 5000,
  /** РњРёРЅРёРјР°Р»СЊРЅР°СЏ СЃС‚Р°РІРєР° РґР»СЏ РІС‹РІРѕРґР° РІ С‚РѕРї */
  topBy: 'totalWin',
  /** РџРѕС‚РѕР»РѕРє Р±Р°Р»Р°РЅСЃР°. Р’СЃС‘ СЃРІРµСЂС…Сѓ СѓС…РѕРґРёС‚ РІ РІРёРґРёРјС‹Р№ В«Р±Р°РЅРєВ» РёРіСЂРѕРєР°. */
  maxBalance: 150000,
  /** РЇРІРЅР°СЏ РєРѕРјРёСЃСЃРёСЏ Р·Р° С…СЂР°РЅРµРЅРёРµ СЃРІРµСЂС… РїРѕСЂРѕРіР° вЂ” РёРіСЂРѕРє РІРёРґРёС‚ РµС‘ РІ РїСЂРѕС„РёР»Рµ Рё РёСЃС‚РѕСЂРёРё. */
  storageFee: { enabled: true, threshold: 100000, percentPerDay: 0.5, intervalMs: 24 * 60 * 60 * 1000 },
  updatedAt: 0,
};

const DEFAULT_DB = () => ({
  version: 1,
  seq: 1000,
  createdAt: Date.now(),
  settings: structuredClone(DEFAULT_SETTINGS),
  users: {},
  promos: {},
  history: [],
  deposits: [],
  withdrawals: [],
  /** РћРґРёРЅ Р°РєС‚РёРІРЅС‹Р№ Р»РѕС‚ РїР»СЋСЃ Р·Р°РІРµСЂС€С‘РЅРЅС‹Рµ Р°СѓРєС†РёРѕРЅС‹. */
  auctions: [],
  meta: { totalBets: 0, totalWagered: 0, totalPaid: 0, totalFees: 0, totalBurned: 0, rounds: {}, usedLoginNonces: [] },
});

const MAX_HISTORY = 5000;

export class Store {
  constructor(file = CONFIG.dbFile) {
    this.file = file;
    this.data = DEFAULT_DB();
    this._dirty = false;
    this._timer = null;
    this._flushing = false;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data = { ...DEFAULT_DB(), ...raw };
        this.data.meta = { ...DEFAULT_DB().meta, ...(raw.meta || {}) };
        this.data.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
        this.data.settings.houseEdge = { ...DEFAULT_SETTINGS.houseEdge, ...((raw.settings || {}).houseEdge || {}) };
        this.data.settings.limits = { ...DEFAULT_SETTINGS.limits, ...((raw.settings || {}).limits || {}) };
        this.data.settings.crash = { ...DEFAULT_SETTINGS.crash, ...((raw.settings || {}).crash || {}) };
        this.data.settings.storageFee = { ...DEFAULT_SETTINGS.storageFee, ...((raw.settings || {}).storageFee || {}) };
        // РЎС‚Р°СЂС‹Рµ РЅР°СЃС‚СЂРѕР№РєРё Р·Р°С‰РёС‚С‹ РєР°СЃСЃС‹ Р±РѕР»СЊС€Рµ РЅРµ РёСЃРїРѕР»СЊР·СѓСЋС‚СЃСЏ вЂ” С‡РёСЃС‚РёРј РёС… РёР· Р±Р°Р·С‹.
        delete this.data.settings.bankroll;
        delete this.data.meta.dailyPaid;
        delete this.data.meta.dailyPaidDate;
        delete this.data.meta.jackpot;
        // РЈРґР°Р»С‘РЅРЅС‹Рµ РёРіСЂС‹ РЅРµ РґРѕР»Р¶РЅС‹ РѕСЃС‚Р°РІР°С‚СЊСЃСЏ РІ РЅР°СЃС‚СЂРѕР№РєР°С…, СЃС‡С‘С‚С‡РёРєР°С… Рё РёСЃС‚РѕСЂРёРё.
        const removedGames = new Set(['mines', 'case', 'slots']);
        for (const key of removedGames) {
          delete this.data.settings.houseEdge[key];
          delete this.data.settings.limits[key];
          delete this.data.meta.rounds[key];
        }
        this.data.history = (this.data.history || []).filter((h) => !removedGames.has(h.game));
        for (const u of Object.values(this.data.users)) {
          delete u.dailyProfit;
          delete u.dailyProfitDate;
        }
        this.save();
        this.data.users ||= {};
        this.data.promos ||= {};
        this.data.history ||= [];
        this.data.deposits ||= [];
        this.data.withdrawals ||= [];
        this.data.auctions ||= [];
        this.data.meta.totalBurned ||= 0;
        this.data.meta.usedLoginNonces ||= [];
      } else {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        this.flushNow();
      }
    } catch (err) {
      const backup = `${this.file}.broken-${Date.now()}`;
      try { fs.renameSync(this.file, backup); } catch {}
      console.error('[store] РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРѕС‡РёС‚Р°С‚СЊ Р±Р°Р·Сѓ, СЃРѕР·РґР°СЋ РЅРѕРІСѓСЋ. Р‘СЌРєР°Рї:', backup, err.message);
      this.data = DEFAULT_DB();
      this.flushNow();
    }
    // РҐРѕР·СЏРёРЅ РёР· .env РёРјРµРµС‚ РїСЂРёРѕСЂРёС‚РµС‚ С‚РѕР»СЊРєРѕ РїСЂРё РїРµСЂРІРѕРј Р·Р°РїСѓСЃРєРµ
    if (CONFIG.ownerId && !this.data.settings.ownerId) {
      this.data.settings.ownerId = CONFIG.ownerId;
      const u = this.ensureUser({ id: CONFIG.ownerId, first_name: 'РҐРѕР·СЏРёРЅ' });
      if (u) u.isOwner = true;
      this.save();
    }
    if (CONFIG.publicUrl && !this.data.settings.publicUrl) {
      this.data.settings.publicUrl = CONFIG.publicUrl;
      this.save();
    }
  }

  get settings() { return this.data.settings; }
  set settings(patch) {
    this.data.settings = { ...this.data.settings, ...patch, updatedAt: Date.now() };
    this.save();
  }

  nextId() { return ++this.data.seq; }

  ensureUser(from = {}) {
    const id = Number(from.id);
    if (!id) return null;
    let u = this.data.users[id];
    if (u) {
      if (from.username !== undefined && u.username !== from.username) u.username = from.username;
      if (from.first_name !== undefined && u.firstName !== from.first_name) u.firstName = from.first_name;
      u.lastSeen = Date.now();
      return u;
    }
    const now = Date.now();
      u = {
        id,
        username: from.username || '',
        firstName: from.first_name || from.firstName || '',
        lastName: from.last_name || '',
        photo: '',
        balance: 0,
        /** РР·Р»РёС€РµРє СЃРІРµСЂС… maxBalance вЂ” РІРёРґРµРЅ РёРіСЂРѕРєСѓ Рё РјРѕР¶РµС‚ Р±С‹С‚СЊ РІС‹РґР°РЅ С…РѕР·СЏРёРЅРѕРј. */
        vault: 0,
        lastFeeAt: 0,
        feePaid: 0,
        isOwner: id === Number(this.data.settings.ownerId || 0),
        banned: false,
        createdAt: now,
        lastSeen: now,
        lastDaily: 0,
        streak: 0,
        lastLucky: 0,
        nfts: [],
        totalBet: 0,
        totalWin: 0,
        wins: 0,
        losses: 0,
        biggestWin: 0,
        games: 0,
        refBy: 0,
        refCount: 0,
        refEarned: 0,
        promoUsed: [],
        notes: '',
      };
    this.data.users[id] = u;
    this.save();
    return u;
  }

  user(id) { return this.data.users[Number(id)] || null; }
  users() { return Object.values(this.data.users); }

  /** Р–С‘СЃС‚РєРёР№ РїРѕС‚РѕР»РѕРє Р±Р°Р»Р°РЅСЃР°: Р»РёС€РЅРµРµ РЅРµ РїСЂРѕРїР°РґР°РµС‚, Р° СѓС…РѕРґРёС‚ РІ РІРёРґРёРјС‹Р№ Р±Р°РЅРє РёРіСЂРѕРєР°. */
  balanceCap() {
    return Math.max(1000, Math.round(Number(this.settings.maxBalance) || 150000));
  }

  applyBalanceCap(u) {
    if (!u) return 0;
    const cap = this.balanceCap();
    if (u.balance > cap) {
      const extra = Math.round(u.balance - cap);
      u.balance = cap;
      u.vault = Math.round((u.vault || 0) + extra);
      return extra;
    }
    return 0;
  }

  credit(user, amount, reason = '') {
    const u = typeof user === 'object' ? user : this.user(user);
    if (!u) return 0;
    const amt = Math.round(Number(amount) || 0);
    u.balance = Math.max(0, Math.round(u.balance + amt));
    this.applyBalanceCap(u);
    if (amt > 0 && reason === 'welcome') u.welcomed = true;
    this.save();
    return u.balance;
  }

  /** РџРµСЂРµРІРµСЃС‚Рё С‡Р°СЃС‚СЊ РІРёРґРёРјРѕРіРѕ Р±Р°РЅРєР° РЅР° Р±Р°Р»Р°РЅСЃ (РЅРµ Р±РѕР»СЊС€Рµ СЃРІРѕР±РѕРґРЅРѕРіРѕ РјРµСЃС‚Р° РґРѕ РїРѕС‚РѕР»РєР°). */
  fromVault(user, amount = Infinity) {
    const u = typeof user === 'object' ? user : this.user(user);
    if (!u) return 0;
    const room = Math.max(0, this.balanceCap() - u.balance);
    const amt = Math.min(room, Math.max(0, Math.round(Number(amount) || 0)), Math.round(u.vault || 0));
    if (amt > 0) {
      u.vault = Math.round((u.vault || 0) - amt);
      u.balance += amt;
      this.save();
    }
    return amt;
  }

  take(user, amount) {
    const u = typeof user === 'object' ? user : this.user(user);
    const amt = Math.round(Number(amount) || 0);
    if (!u || amt <= 0 || u.balance < amt) return false;
    u.balance -= amt;
    u.totalBet += amt;
    this.save();
    return true;
  }

  payWin(user, amount, bet, game) {
    const u = typeof user === 'object' ? user : this.user(user);
    if (!u) return 0;
    const payout = Math.max(0, Math.round(Number(amount) || 0));
    u.balance += payout;
    this.applyBalanceCap(u);
    u.totalWin += payout;
    u.games += 1;
    if (payout > bet) u.wins += 1;
    else u.losses += 1;
    if (payout - bet > u.biggestWin) u.biggestWin = Math.max(0, payout - bet);
    this.data.meta.totalBets += 1;
    this.data.meta.totalWagered += bet;
    this.data.meta.totalPaid += payout;
    this.data.meta.rounds[game] = (this.data.meta.rounds[game] || 0) + 1;
    this.save();
    return u.balance;
  }

  history(entry) {
    const item = {
      id: this.nextId(),
      ts: Date.now(),
      balanceAfter: 0,
      ...entry,
    };
    this.data.history.push(item);
    if (this.data.history.length > MAX_HISTORY) {
      this.data.history.splice(0, this.data.history.length - MAX_HISTORY);
    }
    this.save();
    return item;
  }

  recent(userId, limit = 20) {
    const out = [];
    for (let i = this.data.history.length - 1; i >= 0 && out.length < limit; i--) {
      const h = this.data.history[i];
      if (h.userId === Number(userId)) out.push(h);
    }
    return out;
  }

  leaderboard(limit = 10) {
    return this.users()
      .filter((u) => !u.banned && u.games > 0)
      .sort((a, b) => (b.totalWin - b.totalBet) - (a.totalWin - a.totalBet))
      .slice(0, limit);
  }

  stats() {
    const users = this.users();
    const balances = users.reduce((s, u) => s + u.balance, 0);
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const gameNames = new Set(['roulette', 'crash', 'dice', 'blackjack', 'wheel', 'plinko', 'coinflip', 'lucky', 'auction']);
    const today = this.data.history.filter((h) => h.ts >= todayStart && gameNames.has(h.game));
    return {
      users: users.length,
      active: users.filter((u) => Date.now() - u.lastSeen < 86400000).length,
      banned: users.filter((u) => u.banned).length,
      balances,
      wagered: this.data.meta.totalWagered,
      paid: this.data.meta.totalPaid,
      ggr: this.data.meta.totalWagered - this.data.meta.totalPaid,
      rounds: this.data.meta.rounds,
      todayBets: today.length,
      todayWagered: today.reduce((s, h) => s + (h.bet || 0), 0),
      todayPaid: today.reduce((s, h) => s + (h.payout || 0), 0),
      totalBets: this.data.meta.totalBets,
    };
  }

  /** РћРґРЅРѕСЂР°Р·РѕРІС‹Р№ РІС…РѕРґ РїРѕ РєРЅРѕРїРєРµ: СЃРєРѕРїРёСЂРѕРІР°РЅРЅСѓСЋ СЃСЃС‹Р»РєСѓ РЅРµР»СЊР·СЏ РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ РїРѕРІС‚РѕСЂРЅРѕ. */
  consumeLoginNonce(nonce) {
    if (!nonce) return true;
    const key = String(nonce).slice(0, 80);
    const used = (this.data.meta.usedLoginNonces ||= []);
    if (used.includes(key)) return false;
    used.push(key);
    if (used.length > 2000) used.splice(0, used.length - 2000);
    this.save();
    return true;
  }

  save() {
    this._dirty = true;
    if (this._timer || this._flushing) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flushNow();
    }, 250);
  }

  flushNow() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
      fs.renameSync(tmp, this.file);
      this._dirty = false;
    } catch (err) {
      console.error('[store] РћС€РёР±РєР° СЃРѕС…СЂР°РЅРµРЅРёСЏ:', err.message);
    }
  }

  flushSync() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this.flushNow();
  }
}
