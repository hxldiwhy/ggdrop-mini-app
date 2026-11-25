/* Игры мини-приложения: рулетка, краш, блэкджек, колесо, плинко, монетка. */
import {
  app, state, api, toast, fmt, money, mult, modal, onScreen, maxBetFor,
  readBet, setBet, rememberBet, lastBet,
} from './core.js';
import { initWheel, initPlinko } from './extra-games.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');
const edge = (key, def) => Number(state.settings.houseEdge?.[key] ?? def);

export function initGames() {
  initRoulette();
  initCrash();
  initBlackjack();
  initWheel();
  initPlinko();
}

/* ══════════════════════════════ РУЛЕТКА ══════════════════════════════ */
let rouletteBets = [];
let rouletteChip = 50;
let rouletteBusy = false;

function initRoulette() {
  const grid = $('rouletteNumbers');
  grid.innerHTML = '';
  const zero = document.createElement('button');
  zero.className = 'num-cell green';
  zero.textContent = '0';
  zero.dataset.number = '0';
  grid.appendChild(zero);
  for (let i = 1; i <= 36; i++) {
    const b = document.createElement('button');
    b.className = `num-cell ${colorOf(i)}`;
    b.textContent = i;
    b.dataset.number = String(i);
    grid.appendChild(b);
  }
  grid.addEventListener('click', (e) => {
    const cell = e.target.closest('[data-number]');
    if (!cell) return;
    addRouletteBet('number', Number(cell.dataset.number));
  });
  $('rouletteOutside').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-bet]');
    if (!btn) return;
    addRouletteBet(btn.dataset.bet, null);
  });
  $('rouletteChips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-chip]');
    if (!btn) return;
    rouletteChip = Number(btn.dataset.chip);
    $('rouletteChips').querySelectorAll('[data-chip]').forEach((b) => b.classList.toggle('active', b === btn));
  });
  $('rouletteClear').addEventListener('click', () => { rouletteBets = []; renderRouletteBets(); });
  $('rouletteSpin').addEventListener('click', spinRoulette);
  renderRouletteBets();
}

function addRouletteBet(type, value) {
  if (rouletteBusy) return;
  const amount = rouletteChip;
  const key = `${type}:${value ?? ''}`;
  const existing = rouletteBets.find((b) => `${b.type}:${b.value ?? ''}` === key);
  const total = rouletteBets.reduce((s, b) => s + b.amount, 0);
  const max = maxBetFor('roulette');
  if (total + amount > max) return toast(`Максимум на раунд: ${money(max)}`, 'err');
  if (state.user && total + amount > state.user.balance) return toast('Недостаточно средств', 'err');
  if (existing) existing.amount += amount;
  else rouletteBets.push({ type, value, amount, label: labelOf(type, value) });
  renderRouletteBets();
  app.haptic('light');
}

function labelOf(type, value) {
  if (type === 'number') return `Число ${value}`;
  const map = {
    red: 'Красное', black: 'Чёрное', even: 'Чёт', odd: 'Нечет', low: '1–18', high: '19–36',
    dozen1: '1-я дюжина', dozen2: '2-я дюжина', dozen3: '3-я дюжина',
    column1: '1-я колонка', column2: '2-я колонка', column3: '3-я колонка',
  };
  return map[type] || type;
}

function renderRouletteBets() {
  const box = $('rouletteBets');
  const total = rouletteBets.reduce((s, b) => s + b.amount, 0);
  $('rouletteTotal').textContent = fmt(total);
  $('rouletteMax').textContent = fmt(maxBetFor('roulette'));
  if (!rouletteBets.length) {
    box.innerHTML = '<div class="small muted">Выбери число или поле — ставка добавится сюда</div>';
    return;
  }
  box.innerHTML = rouletteBets
    .map(
      (b, i) => `<div class="bet-item">
        <span>${esc(b.label)}</span>
        <b class="gold">${fmt(b.amount)}</b>
        <button data-remove="${i}" aria-label="Убрать">✕</button>
      </div>`
    )
    .join('');
  box.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.onclick = () => {
      rouletteBets.splice(Number(btn.dataset.remove), 1);
      renderRouletteBets();
    };
  });
}

async function spinRoulette() {
  if (rouletteBusy) return;
  if (!rouletteBets.length) return toast('Сначала добавь ставку', 'err');
  rouletteBusy = true;
  const btn = $('rouletteSpin');
  btn.disabled = true;
  const betsPayload = rouletteBets.map((b) => ({ type: b.type, value: b.value, amount: b.amount }));
  const totalBet = rouletteBets.reduce((s, b) => s + b.amount, 0);
  try {
    const res = await api('/roulette/bet', { method: 'POST', body: { bets: betsPayload } });
    const wheel = $('rouletteWheel');
    const num = $('rouletteNum');
    wheel.classList.add('spin');
    await sleep(1500);
    wheel.classList.remove('spin');
    num.textContent = res.result;
    num.className = `roulette-wheel__num ${res.color}`;
    document.querySelectorAll('.num-cell.hit').forEach((c) => c.classList.remove('hit'));
    document.querySelector(`[data-number="${res.result}"]`)?.classList.add('hit');
    const profit = res.payout - totalBet;
    if (res.win) {
      toast(`Выпало ${res.result} · выигрыш ${money(res.payout)}`, 'ok');
      app.haptic('success');
    } else {
      toast(`Выпало ${res.result} · −${money(totalBet)}`, 'err');
    }
    $('rouletteBets').insertAdjacentHTML(
      'beforeend',
      `<div class="small ${profit >= 0 ? 'green' : 'red'} mt center">${profit >= 0 ? '+' : ''}${fmt(profit)} ${state.settings.currency} за раунд</div>`
    );
    rouletteBets = [];
    renderRouletteBets();
  } catch {
    /* ошибка уже показана */
  } finally {
    rouletteBusy = false;
    btn.disabled = false;
  }
}

/* ══════════════════════════════ КРАШ ══════════════════════════════ */
// Кривая синхронизирована с src/games/crash.js: медленный старт, разгон вдалеке.
const CRASH_MAX = 10000;
const CRASH_MS = 12000;
const CRASH_ACCEL = 1.7;
const CRASH_LOG_MAX = Math.log(CRASH_MAX);
const crash = {
  sync: null,
  myBet: null,
  timer: null,
  raf: null,
  lastResult: null,
};

function initCrash() {
  $('crashAction').addEventListener('click', onCrashAction);
  document.querySelectorAll('[data-crash-amt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.crashAmt;
      if (v === 'max') setBet('crashAmount', Math.max(1, Math.min(state.user?.balance || 0, maxBetFor('crash'))));
      else setBet('crashAmount', v);
      rememberBet('crash', readBet('crashAmount'));
    });
  });
  $('crashAmount').value = String(lastBet('crash', 100));
  const canvas = $('crashCanvas');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(300, rect.width || 440) * dpr;
  canvas.height = 190 * dpr;
  const ctx = canvas.getContext ? canvas.getContext('2d') : null;
  if (ctx) ctx.scale(dpr, dpr);
  crash.ctx = ctx;
  crash.w = canvas.width / dpr;
  crash.h = canvas.height / dpr;

  onScreen('crash', {
    enter() {
      startCrashPolling();
      if (!crash.raf) crash.raf = requestAnimationFrame(crashFrame);
    },
    leave() {
      stopCrashPolling();
    },
  });
}

function startCrashPolling() {
  if (crash.timer) return;
  const tick = async () => {
    if (state.screen !== 'crash') return stopCrashPolling();
    try {
      const data = await api('/crash/state', { silent: true });
      crash.sync = { ...data.state, at: performance.now() };
      crash.myBet = data.myBet;
      if (data.balance !== undefined) state.user.balance = data.balance;
      renderCrashMeta(data.state);
      renderCrashButton(data.state);
      renderCrashPlayers(data.state);
    } catch {}
  };
  tick();
  crash.timer = setInterval(tick, 450);
}

function stopCrashPolling() {
  if (crash.timer) clearInterval(crash.timer);
  crash.timer = null;
}

const crashAt = (ms) => {
  const u = Math.min(1, Math.max(0, (Number(ms) || 0) / CRASH_MS));
  return Math.min(CRASH_MAX, Math.exp(CRASH_LOG_MAX * Math.pow(u, CRASH_ACCEL)));
};
const crashTime = (m) => CRASH_MS * Math.pow(Math.log(Math.max(1, Math.min(CRASH_MAX, m))) / CRASH_LOG_MAX, 1 / CRASH_ACCEL);

function crashMultiplier() {
  const s = crash.sync;
  if (!s) return 1;
  if (s.phase === 'running') {
    const elapsed = (s.elapsedMs || 0) + (performance.now() - s.at);
    return crashAt(elapsed);
  }
  if (s.phase === 'crashed') return s.crashPoint || 1;
  return 1;
}

function crashFrame() {
  if (!crash.sync) {
    crash.raf = requestAnimationFrame(crashFrame);
    return;
  }
  const m = crashMultiplier();
  const el = $('crashMult');
  if (el) {
    el.textContent = `${m >= 100 ? m.toFixed(0) : m.toFixed(2)}x`;
    el.className = `crash-mult ${crash.sync.phase === 'crashed' ? 'crashed' : crash.myBet?.cashedOut ? 'cashed' : ''}`;
  }
  const status = $('crashStatus');
  if (status && crash.sync.phase === 'running' && !crash.myBet?.cashedOut) {
    status.textContent = m < 2 ? 'Медленный старт…' : m < 20 ? 'Разгоняется — забирай вовремя!' : 'Уже вдалеке! Держись, пока не упал';
  }
  drawCrashGraph(m);
  crash.raf = requestAnimationFrame(crashFrame);
}

function drawCrashGraph(m) {
  const { ctx, w, h } = crash;
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);

  // Перспективное поле: трасса уходит в точку схода справа вверху.
  const horizon = { x: w * 0.86, y: 22 };
  ctx.strokeStyle = 'rgba(255,255,255,0.055)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = h - 12 - (i * (h - 40)) / 5;
    ctx.beginPath();
    ctx.moveTo(8, y);
    ctx.lineTo(horizon.x, y - (y - horizon.y) * 0.22);
    ctx.stroke();
  }
  for (let i = 0; i <= 6; i++) {
    const x = 10 + (i * (w - 20)) / 6;
    ctx.beginPath();
    ctx.moveTo(x, h - 12);
    ctx.lineTo(horizon.x, horizon.y);
    ctx.stroke();
  }

  // Траектория: сначала ползёт, потом уходит вдаль всё быстрее.
  const progress = Math.min(1, crashTime(m) / CRASH_MS);
  const pointAt = (q) => {
    const u = Math.min(1, Math.max(0, q));
    const depth = Math.pow(u, 1.3);
    const rise = Math.pow(u, CRASH_ACCEL);
    return [12 + depth * (w - 34), h - 14 - rise * (h - 46)];
  };

  const crashed = crash.sync.phase === 'crashed';
  const crashColor = crashed ? '#FF5C7A' : '#FFC76A';
  const areaColor = crashed ? 'rgba(255,92,122,.10)' : 'rgba(255,199,106,.10)';

  const steps = 72;
  ctx.beginPath();
  ctx.moveTo(12, h - 14);
  for (let i = 0; i <= steps; i++) {
    const [x, y] = pointAt((progress * i) / steps);
    ctx.lineTo(x, y);
  }
  const last = pointAt(progress);
  ctx.lineTo(last[0], h - 14);
  ctx.closePath();
  ctx.fillStyle = areaColor;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(12, h - 14);
  for (let i = 0; i <= steps; i++) {
    const [x, y] = pointAt((progress * i) / steps);
    ctx.lineTo(x, y);
  }
  ctx.strokeStyle = crashColor;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  // Маркер: чем дальше раунд, тем сильнее разгон.
  ctx.beginPath();
  ctx.arc(last[0], last[1], 7, 0, Math.PI * 2);
  ctx.fillStyle = crashed ? 'rgba(255,92,122,.16)' : 'rgba(255,199,106,.16)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(last[0], last[1], 3.5, 0, Math.PI * 2);
  ctx.fillStyle = '#EDF3FF';
  ctx.fill();
}

function renderCrashMeta(s) {
  $('crashRound').textContent = `#${s.roundId}`;
  $('crashHash').textContent = s.hash ? `${s.hash.slice(0, 24)}…` : '—';
  const hist = $('crashHistory');
  hist.innerHTML = (s.history || [])
    .slice(0, 12)
    .map((h) => `<span class="history-chip ${h.crashPoint >= 10 ? 'hot' : h.crashPoint <= 1.5 ? 'low' : ''}">${h.crashPoint.toFixed(2)}x</span>`)
    .join('');
  const status = $('crashStatus');
  if (s.phase === 'betting') {
    status.textContent = `Приём ставок · ${Math.max(0, Math.ceil(s.startsInMs / 1000))} c`;
  } else if (s.phase === 'running') {
    status.textContent = crash.myBet?.cashedOut ? `Ты забрал на x${crash.myBet.cashoutMultiplier}` : 'Раунд идёт — забирай вовремя!';
  } else if (s.phase === 'crashed') {
    status.textContent = `Краш на x${(s.crashPoint || 0).toFixed(2)} · новый раунд через ${Math.max(0, Math.ceil(s.startsInMs / 1000))} c`;
  }
}

function renderCrashButton(s) {
  const btn = $('crashAction');
  const hint = $('crashHint');
  if (crash.myBet && !crash.myBet.cashedOut && s.phase === 'running') {
    btn.textContent = `ЗАБРАТЬ ${mult(crashMultiplier())}`;
    btn.disabled = false;
    btn.className = 'btn btn--green btn--block btn--lg mt';
    hint.textContent = `Ставка ${money(crash.myBet.amount)}${crash.myBet.autoCashout ? ` · авто x${crash.myBet.autoCashout}` : ''}`;
    return;
  }
  if (crash.myBet && (crash.myBet.cashedOut || s.phase === 'crashed')) {
    btn.textContent = crash.myBet.cashedOut ? `Забрано: +${fmt(crash.myBet.payout)}` : 'Проиграла';
    btn.disabled = true;
    btn.className = 'btn btn--block btn--lg mt btn--ghost';
    hint.textContent = '';
    return;
  }
  btn.className = 'btn btn--block btn--lg mt';
  btn.disabled = s.phase !== 'betting';
  btn.textContent = s.phase === 'betting' ? 'Сделать ставку' : 'Ставки закрыты';
  hint.textContent = s.phase === 'betting' ? 'Успей до старта раунда' : '';
}

function renderCrashPlayers(s) {
  const box = $('crashPlayers');
  const players = s.players || [];
  $('crashPlayersCount').textContent = players.length ? `${players.length}` : '';
  if (!players.length) {
    box.innerHTML = '<div class="small muted">Пока никого…</div>';
    return;
  }
  box.innerHTML = players
    .map(
      (p) => `<div class="player-row ${p.cashedOut ? 'win' : ''} ${p.userId === state.user?.id ? 'me' : ''}">
        <span class="name">${esc(p.name)}</span>
        <span class="amount">${p.cashedOut ? `+${fmt(p.payout)} · x${p.cashoutMultiplier}` : fmt(p.amount)}</span>
      </div>`
    )
    .join('');
}

async function onCrashAction() {
  const s = crash.sync;
  if (!s) return;
  const btn = $('crashAction');
  if (crash.myBet && !crash.myBet.cashedOut && s.phase === 'running') {
    btn.disabled = true;
    try {
      const r = await api('/crash/cashout', { method: 'POST' });
      toast(`Забрал ${money(r.payout)} на x${r.multiplier}`, 'ok');
      app.haptic('success');
      crash.myBet = { ...crash.myBet, cashedOut: true, payout: r.payout, cashoutMultiplier: r.multiplier };
      renderCrashButton(s);
    } catch {
      btn.disabled = false;
    }
    return;
  }
  if (s.phase !== 'betting') return;
  const amount = readBet('crashAmount');
  const auto = Number($('crashAuto').value) || 0;
  rememberBet('crash', amount);
  btn.disabled = true;
  try {
    const r = await api('/crash/bet', { method: 'POST', body: { amount, autoCashout: auto } });
    toast(`Ставка ${money(amount)} принята`, 'ok');
    crash.myBet = { amount, autoCashout: auto, cashedOut: false, payout: 0, cashoutMultiplier: 0 };
    crash.sync = { ...r.state, at: performance.now() };
    renderCrashButton(r.state);
  } catch {
    btn.disabled = false;
  }
}

/* Кости удалены по требованию владельца. */

/* ══════════════════════════════ БЛЭКДЖЕК ══════════════════════════════ */
const bj = { game: null, busy: false };

function initBlackjack() {
  $('bjStart').addEventListener('click', startBlackjack);
  $('bjHit').addEventListener('click', () => bjAction('hit'));
  $('bjStand').addEventListener('click', () => bjAction('stand'));
  $('bjDouble').addEventListener('click', () => bjAction('double'));
  document.querySelectorAll('[data-bj-amt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.bjAmt;
      if (v === 'max') setBet('bjAmount', Math.max(1, Math.min(state.user?.balance || 0, maxBetFor('blackjack'))));
      else setBet('bjAmount', v);
      rememberBet('blackjack', readBet('bjAmount'));
    });
  });
  $('bjAmount').value = String(lastBet('blackjack', 100));
}

function cardHtml(card, hidden) {
  if (hidden) return `<div class="card back">?</div>`;
  const red = card.s === '♥' || card.s === '♦';
  return `<div class="card ${red ? 'red' : ''}">
    <span>${card.r}</span>
    <span class="suit">${card.s}</span>
  </div>`;
}

function renderBlackjack(g) {
  bj.game = g.status === 'playing' ? g : bj.game;
  $('bjDealer').innerHTML = (g.dealer || []).map((c) => cardHtml(c, c.r === '?')).join('') || '<div class="small muted">—</div>';
  $('bjPlayer').innerHTML = (g.player || []).map((c) => cardHtml(c)).join('') || '<div class="small muted">—</div>';
  $('bjDealerTotal').textContent = g.status === 'playing' ? '' : `(${g.dealerTotal ?? ''})`;
  $('bjPlayerTotal').textContent = g.playerTotal ? `(${g.playerTotal})` : '';
  $('bjBetLabel').textContent = g.bet ? `${money(g.bet)}` : '';
  $('bjEmptyNote')?.classList.toggle('hidden', !!(g.player && g.player.length));

  const done = g.status === 'done';
  $('bjBetPanel').classList.toggle('hidden', g.status === 'playing');
  $('bjActions').classList.toggle('hidden', !(g.status === 'playing' && g.player?.length));
  $('bjHit').disabled = !g.canHit;
  $('bjDouble').disabled = !g.canDouble;

  const resEl = $('bjResult');
  if (done) {
    const map = {
      win: ['Победа!', 'win'], lose: ['Дилер сильнее', 'lose'], bust: ['Перебор', 'lose'],
      push: ['Ничья, ставка возвращена', 'push'], blackjack: ['Блэкджек! 3:2', 'win'],
    };
    const [text, cls] = map[g.result] || ['Раунд окончен', ''];
    resEl.className = `bj-result ${cls}`;
    resEl.textContent = `${text}${g.payout ? ` · ${money(g.payout)}` : ''}`;
    resEl.classList.remove('hidden');
    bj.game = null;
  } else {
    resEl.classList.add('hidden');
  }
}

async function startBlackjack() {
  if (bj.busy) return;
  const amount = readBet('bjAmount');
  rememberBet('blackjack', amount);
  bj.busy = true;
  try {
    const g = await api('/blackjack/start', { method: 'POST', body: { amount } });
    renderBlackjack(g);
    app.haptic('light');
  } catch {
  } finally {
    bj.busy = false;
  }
}

async function bjAction(action) {
  if (bj.busy || !bj.game) return;
  bj.busy = true;
  try {
    const g = await api('/blackjack/action', { method: 'POST', body: { id: bj.game.id, action } });
    renderBlackjack(g);
    if (g.status === 'done') {
      if (['win', 'blackjack'].includes(g.result)) { toast(`Выигрыш ${money(g.payout)}`, 'ok'); app.haptic('success'); }
      else if (g.result === 'push') toast('Ничья', '');
      else toast('Проигрыш', 'err');
    }
  } catch {
  } finally {
    bj.busy = false;
  }
}
