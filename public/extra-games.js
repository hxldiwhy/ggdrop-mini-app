/* Колесо фортуны и Плинко — canvas-игры мини-приложения. */
import { app, state, api, toast, fmt, money, mult, readBet, setBet, rememberBet, lastBet, onScreen, maxBetFor as cashMaxBet } from './core.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isDark(hex) {
  const c = String(hex).replace('#', '');
  if (c.length < 6) return true;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b < 130;
}

let info = null;
async function gamesInfo() {
  if (info) return info;
  try {
    info = await api('/games-info', { silent: true });
  } catch {
    info = { wheel: null, plinko: null };
  }
  return info;
}

/* ══════════════════════════════ КОЛЕСО ══════════════════════════════ */
const wheel = { sectors: [], rotation: 0, spinning: false, ready: false };

export function initWheel() {
  const canvas = $('wheelCanvas');
  const ctx = canvas.getContext && canvas.getContext('2d');
  wheel.canvas = canvas;
  wheel.ctx = ctx;

  document.querySelectorAll('[data-wheel-amt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.wheelAmt;
      if (v === 'max') setBet('wheelAmount', maxBet('wheel'));
      else setBet('wheelAmount', v);
      rememberBet('wheel', readBet('wheelAmount'));
    });
  });
  $('wheelAmount').value = String(lastBet('wheel', 100));
  $('wheelSpin').addEventListener('click', spinWheelNow);

  loadWheel().then(() => {
    if (state.screen === 'wheel') drawWheel();
  });

  onScreen('wheel', {
    enter: () => {
      if (!wheel.ready) loadWheel().then(() => drawWheel());
      else drawWheel();
    },
  });
}

function maxBet(game) {
  return Math.max(1, Math.min(state.user?.balance || 0, cashMaxBet(game)));
}

async function loadWheel() {
  const data = await gamesInfo();
  if (!data.wheel) return;
  wheel.sectors = data.wheel.sectors;
  wheel.ready = true;
  const rtp = $('wheelRtp');
  if (rtp) rtp.textContent = `RTP ${(data.wheel.rtp * 100).toFixed(1)}%`;
  renderWheelSectors();
  drawWheel();
}

function renderWheelSectors() {
  const box = $('wheelSectors');
  if (!box) return;
  const count = $('wheelSectorCount');
  if (count) count.textContent = `${wheel.sectors.length} секторов`;
  box.innerHTML = wheel.sectors
    .map(
      (s) => `<div class="sector">
        <span class="sector__dot" style="background:${s.color}"></span>
        <span>${s.label}</span>
        <span class="sector__p">${s.chance.toFixed(1)}%</span>
        <span class="sector__m">x${s.multiplier}</span>
      </div>`
    )
    .join('');
}

function drawWheel() {
  const ctx = wheel.ctx;
  if (!ctx || !wheel.sectors.length) return;
  const size = wheel.canvas.width;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 12;
  ctx.clearRect(0, 0, size, size);

  // внешний обод
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 - 2, 0, Math.PI * 2);
  ctx.fillStyle = '#050912';
  ctx.fill();

  let angle = -Math.PI / 2;
  for (const s of wheel.sectors) {
    const span = (s.chance / 100) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, angle, angle + span);
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // подпись: горизонтальная, размер зависит от ширины сектора
    const mid = angle + span / 2;
    const spanDeg = (span * 180) / Math.PI;
    const label = s.label.replace('x', '');
    if (spanDeg >= 3) {
      const big = spanDeg >= 24;
      const small = spanDeg < 10;
      const radius = R * (small ? 0.9 : big ? 0.72 : 0.82);
      const fs = small ? 12 : big ? Math.round(size * 0.045) : 17;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isDark(s.color) ? '#EDF3FF' : '#050912';
      ctx.font = `800 ${fs}px "Segoe UI", sans-serif`;
      ctx.fillText(small && spanDeg < 5 ? '★' : label, cx + Math.cos(mid) * radius, cy + Math.sin(mid) * radius);
      ctx.restore();
    }

    angle += span;
  }

  // золотые точки по ободу
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * (size / 2 - 6), cy + Math.sin(a) * (size / 2 - 6), 3.2, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 ? 'rgba(255,199,106,.85)' : 'rgba(255,199,106,.35)';
    ctx.fill();
  }
}

function spinTo(centerPercent) {
  const canvas = wheel.canvas;
  const target = -((centerPercent / 100) * 360);
  const currentMod = ((wheel.rotation % 360) + 360) % 360;
  const targetMod = ((target % 360) + 360) % 360;
  let delta = targetMod - currentMod;
  if (delta < 0) delta += 360;
  wheel.rotation += delta + 360 * 6;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  canvas.style.transition = reduce ? 'transform 80ms linear' : 'transform 2800ms cubic-bezier(.22,1,.36,1)';
  canvas.style.transform = `rotate(${wheel.rotation}deg)`;
}

async function spinWheelNow() {
  if (wheel.spinning) return;
  if (!wheel.ready) return toast('Загружаю колесо…', '');
  const amount = readBet('wheelAmount');
  if (!amount) return toast('Укажи ставку', 'err');
  rememberBet('wheel', amount);
  wheel.spinning = true;
  const btn = $('wheelSpin');
  btn.disabled = true;
  $('wheelResult').textContent = '';
  try {
    const res = await api('/wheel/spin', { method: 'POST', body: { amount } });
    let acc = 0;
    for (let i = 0; i < res.index; i++) acc += wheel.sectors[i].chance;
    const span = wheel.sectors[res.index].chance;
    const center = acc + span / 2 + (Math.random() - 0.5) * span * 0.5;
    spinTo(center);
    await sleep(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 100 : 2900);
    const profit = res.payout - amount;
    const el = $('wheelResult');
    if (res.multiplier > 1) {
      el.innerHTML = `<span class="gold">x${res.multiplier}</span> · +${fmt(profit)} ⭐`;
      toast(`Выигрыш ${money(res.payout)}!`, 'ok');
      app.haptic('success');
    } else if (res.multiplier > 0) {
      el.innerHTML = `<span class="muted">x${res.multiplier}</span> · ${fmt(profit)} ⭐`;
      toast(`Вернулось ${money(res.payout)}`, '');
    } else {
      el.innerHTML = `<span class="red">x0</span> · −${fmt(amount)} ⭐`;
      toast('Пустой сектор', 'err');
      app.haptic('error');
    }
  } catch {
    /* показано тостом */
  } finally {
    wheel.spinning = false;
    btn.disabled = false;
  }
}

/* ══════════════════════════════ ПЛИНКО ══════════════════════════════ */
const PLINKO_MAX_BALLS = 100;

const plinko = {
  rows: 12,
  risk: 'high',
  ballsCount: 1,
  table: null,
  allTables: null,
  animating: false,
  balls: [],
  canvas: null,
  ctx: null,
  W: 840,
  H: 700,
  hitBucket: -1,
  hitBuckets: [],
};

export function initPlinko() {
  plinko.canvas = $('plinkoCanvas');
  plinko.ctx = plinko.canvas?.getContext ? plinko.canvas.getContext('2d') : null;
  plinko.W = plinko.canvas.width;
  plinko.H = plinko.canvas.height;

  document.querySelectorAll('[data-risk]').forEach((btn) => {
    btn.addEventListener('click', () => {
      plinko.risk = btn.dataset.risk;
      document.querySelectorAll('[data-risk]').forEach((b) => b.classList.toggle('active', b === btn));
      refreshPlinkoTable().then(() => drawPlinko());
    });
  });
  $('plinkoRows').addEventListener('change', () => {
    plinko.rows = Number($('plinkoRows').value);
    refreshPlinkoTable().then(() => drawPlinko());
  });
  document.querySelectorAll('[data-plinko-balls]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setPlinkoBalls(Number(btn.dataset.plinkoBalls));
    });
  });
  const ballsInput = $('plinkoBallsInput');
  if (ballsInput) {
    ballsInput.addEventListener('input', () => {
      const n = Number(ballsInput.value);
      if (Number.isFinite(n) && n >= 1) setPlinkoBalls(n, false);
    });
    ballsInput.addEventListener('change', () => setPlinkoBalls(ballsInput.value));
  }
  document.querySelectorAll('[data-plinko-amt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.plinkoAmt;
      if (v === 'max') setBet('plinkoAmount', maxBet('plinko'));
      else setBet('plinkoAmount', v);
      rememberBet('plinko', readBet('plinkoAmount'));
    });
  });
  $('plinkoAmount').value = String(lastBet('plinko', 100));
  $('plinkoAmount').addEventListener('input', renderPlinkoTotal);
  $('plinkoAmount').addEventListener('change', renderPlinkoTotal);
  $('plinkoDrop').addEventListener('click', dropPlinko);

  setPlinkoBalls(1);
  refreshPlinkoTable().then(() => drawPlinko());

  onScreen('plinko', {
    enter: () => {
      if (!plinko.table) refreshPlinkoTable().then(() => drawPlinko());
      else drawPlinko();
    },
  });
}

async function refreshPlinkoTable() {
  const data = await gamesInfo();
  const tables = data.plinko?.[plinko.rows] || data.plinko?.['12'];
  plinko.allTables = data.plinko;
  plinko.table = tables?.[plinko.risk] || tables?.high || null;
  const rtp = $('plinkoRtp');
  if (rtp && plinko.table) rtp.textContent = `RTP ${(100 - (state.settings.houseEdge?.plinko || 0.03) * 100).toFixed(0)}%`;
  renderPlinkoTotal();
}

function pluralBalls(count) {
  const n = Number(count) || 0;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} шарик`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} шарика`;
  return `${n} шариков`;
}

function setPlinkoBalls(count, syncInput = true) {
  const n = Math.min(PLINKO_MAX_BALLS, Math.max(1, Math.round(Number(count) || 1)));
  plinko.ballsCount = n;
  const input = $('plinkoBallsInput');
  if (syncInput && input) input.value = String(n);
  document.querySelectorAll('[data-plinko-balls]').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.plinkoBalls) === n);
  });
  renderPlinkoTotal();
}

function renderPlinkoTotal() {
  const count = Math.min(PLINKO_MAX_BALLS, Math.max(1, plinko.ballsCount || 1));
  const perBet = Math.max(0, readBet('plinkoAmount', 0));
  const total = perBet * count;
  const limit = maxBet('plinko');
  const el = $('plinkoTotal');
  if (el) {
    el.innerHTML = `<b>${pluralBalls(count)}</b> · ${fmt(perBet)} ⭐ за шарик = <b>${fmt(total)}</b> ⭐ · лимит ${fmt(limit)} ⭐`;
  }
  const btn = $('plinkoDrop');
  if (btn && !plinko.animating) {
    btn.textContent = count === 1 ? 'Запустить шарик' : `Запустить ${pluralBalls(count)}`;
  }
}

function bucketColor(m) {
  if (m <= 0) return '#18273F';
  if (m < 0.5) return '#8BA0BF';
  if (m < 2) return '#38E1FF';
  if (m < 10) return '#43E39A';
  return '#FFC76A';
}

function plinkoGeometry() {
  const { W, H } = plinko;
  const rows = plinko.rows;
  const top = 70;
  const pegsBottom = H - 150;
  const rowH = (pegsBottom - top) / Math.max(1, rows - 1);
  const spacing = Math.min(46, (W - 120) / (rows + 1));
  return { rows, top, rowH, spacing, bucketY: H - 92, centerX: W / 2 };
}

function drawPlinko() {
  const ctx = plinko.ctx;
  if (!ctx) return;
  const { rows, top, rowH, spacing, bucketY, centerX } = plinkoGeometry();
  const { W, H } = plinko;
  ctx.clearRect(0, 0, W, H);

  // фон
  ctx.fillStyle = '#0B1424';
  ctx.fillRect(0, 0, W, H);

  // колышки
  for (let level = 0; level < rows; level++) {
    const y = top + level * rowH;
    for (let k = 0; k <= level; k++) {
      const x = centerX + (k - level / 2) * spacing;
      ctx.beginPath();
      ctx.arc(x, y, 4.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(237,243,255,.85)';
      ctx.fill();
    }
  }

  // корзины
  const table = plinko.table || [];
  const bw = spacing * 0.92;
  const hitSet = new Set(
    (plinko.hitBuckets?.length ? plinko.hitBuckets : (plinko.hitBucket >= 0 ? [plinko.hitBucket] : []))
      .map((n) => Number(n)),
  );
  table.forEach((m, i) => {
    const x = centerX + (i - rows / 2) * spacing;
    const color = bucketColor(m);
    roundRect(ctx, x - bw / 2, bucketY, bw, 52, 9);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (hitSet.has(i)) {
      ctx.strokeStyle = '#FFC76A';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.fillStyle = '#EDF3FF';
    ctx.font = `800 ${bw < 46 ? 13 : 16}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = m >= 100 ? String(Math.round(m)) : m.toFixed(2).replace(/0$/, '');
    ctx.fillText(label, x, bucketY + 26);
  });

  // шарики
  const activeBalls = plinko.balls?.length ? plinko.balls : (plinko.ball ? [plinko.ball] : []);
  for (const b of activeBalls) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, 8.5, 0, Math.PI * 2);
    ctx.fillStyle = b.color || '#FFC76A';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function plinkoWaypoints(path) {
  const { rows, top, rowH, spacing, bucketY, centerX } = plinkoGeometry();
  const pts = [{ x: centerX, y: top - 46 }];
  let rights = 0;
  for (let s = 0; s < rows; s++) {
    if (path[s]) rights += 1;
    pts.push({ x: centerX + (rights - s / 2) * spacing, y: top + s * rowH + rowH * 0.55 });
  }
  const bucket = rights;
  pts.push({ x: centerX + (bucket - rows / 2) * spacing, y: bucketY + 18 });
  return { pts, bucket };
}

async function animateBalls(paths) {
  const segs = paths[0].pts.length - 1;
  const baseDuration = 900 + plinko.rows * 22;
  const delay = paths.length > 1 ? Math.max(12, Math.min(180, Math.round(900 / paths.length))) : 0;
  const totalMs = baseDuration + delay * (paths.length - 1);
  const start = performance.now();
  const hits = new Set();
  const finalBuckets = [];

  return new Promise((resolve) => {
    const step = () => {
      const now = performance.now() - start;
      const active = [];
      paths.forEach((item, idx) => {
        const local = now - idx * delay;
        if (local < 0) return;
        const t = Math.min(1, local / baseDuration);
        const p = t * segs;
        const i = Math.min(segs - 1, Math.floor(p));
        const f = p - i;
        const a = item.pts[i];
        const b = item.pts[i + 1];
        const wobble = Math.sin(f * Math.PI) * 3.5 * (idx % 2 ? 1 : -1);
        active.push({
          x: a.x + (b.x - a.x) * f + wobble,
          y: a.y + (b.y - a.y) * f,
          color: item.color,
        });
        if (t >= 1 && !hits.has(idx)) {
          hits.add(idx);
          finalBuckets.push(item.bucket);
          plinko.hitBuckets = [...finalBuckets];
        }
      });
      plinko.balls = active;
      drawPlinko();
      if (now < totalMs) requestAnimationFrame(step);
      else {
        plinko.balls = [];
        plinko.hitBuckets = paths.map((p) => p.bucket);
        drawPlinko();
        resolve(plinko.hitBuckets);
      }
    };
    requestAnimationFrame(step);
  });
}

function ballColor(multiplier) {
  if (multiplier < 1) return '#FF5C7A';
  if (multiplier < 2) return '#38E1FF';
  if (multiplier < 10) return '#43E39A';
  return '#FFC76A';
}

async function dropPlinko() {
  if (plinko.animating) return;
  const amount = readBet('plinkoAmount');
  const count = Math.min(PLINKO_MAX_BALLS, Math.max(1, plinko.ballsCount || 1));
  if (!amount) return toast('Укажи ставку', 'err');
  const total = amount * count;
  const limit = maxBet('plinko');
  if (total > limit) return toast(`Суммарная ставка ${fmt(total)} ⭐ выше лимита ${fmt(limit)} ⭐`, 'err');
  if ((state.user?.balance || 0) < total) return toast('Недостаточно ⭐ на все шарики', 'err');

  rememberBet('plinko', amount);
  plinko.animating = true;
  const btn = $('plinkoDrop');
  btn.disabled = true;
  btn.textContent = 'Шарики летят...';
  $('plinkoResult').textContent = '';
  try {
    const res = await api('/plinko/drop', {
      method: 'POST',
      body: { amount, rows: plinko.rows, risk: plinko.risk, count },
    });
    plinko.table = res.multipliers;
    plinko.hitBucket = -1;
    plinko.hitBuckets = [];
    const balls = res.balls || [{ path: res.path, bucket: res.bucket, multiplier: res.multiplier, payout: res.payout }];
    const paths = balls.map((ball) => ({
      ...plinkoWaypoints(ball.path),
      color: ballColor(ball.multiplier),
      ball,
    }));
    await animateBalls(paths);

    const profit = res.profit;
    const el = $('plinkoResult');
    const list = balls.slice(0, 20).map((b) => {
      const color = b.multiplier < 1 ? '#FF5C7A' : b.multiplier < 2 ? '#EDF3FF' : '#FFC76A';
      return `<span style="color:${color}">x${b.multiplier}</span>`;
    }).join(' · ') + (balls.length > 20 ? ` · … ещё ${balls.length - 20}` : '');

    if (profit > 0) {
      el.innerHTML = `<div class="plinko-result-list">${list}</div><div class="gold mt">+${fmt(profit)} ⭐</div>`;
      toast(`Выигрыш ${money(res.payout)}!`, 'ok');
      app.haptic('success');
    } else {
      el.innerHTML = `<div class="plinko-result-list">${list}</div><div class="muted mt">−${fmt(Math.abs(profit))} ⭐</div>`;
      toast(`−${money(Math.abs(profit))}`, 'err');
    }
  } catch {
  } finally {
    plinko.animating = false;
    btn.disabled = false;
    renderPlinkoTotal();
  }
}
