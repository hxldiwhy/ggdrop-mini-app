/* Новые экраны: онбординг, кошелёк, задания, лига, VIP,
   история/provably fair и скрытая dev-панель. Экономику не меняет. */
import { app, state, api, fmt, money, toast, setScreen, onScreen, copyText, modal, escapeHtml, maxBetFor, updateUser } from './core.js';
import { haptic, sfx, burst, floatText, reducedMotion, devFlags, devLog, devLogs, applyMotionFlags } from './fx.js';

const $ = (id) => document.getElementById(id);
const VIP = [
  { need: 0, name: 'Новичок', perk: 'Базовые игры' },
  { need: 10000, name: 'Игрок', perk: 'Приоритет выводов' },
  { need: 50000, name: 'Профи', perk: 'Больше лимитов ставки' },
  { need: 200000, name: 'Элита', perk: 'Персональные бонусы' },
  { need: 1000000, name: 'Легенда', perk: 'Все привилегии' },
];

/* ───────────────────────────── SPLASH / ONBOARDING ─────────────────────── */
const OB = [
  {
    title: 'ИГРАЙ ЗА STARS',
    text: 'Ставь Telegram Stars на краш, рулетку, плинко и другие игры клуба.',
    art: `<svg viewBox="0 0 320 220" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="160" cy="196" rx="92" ry="11" fill="#050912" opacity=".85"/>
      <rect x="80" y="30" width="160" height="154" rx="14" fill="#0B1424" stroke="rgba(56,225,255,.45)"/>
      <rect x="90" y="40" width="140" height="134" rx="10" stroke="rgba(56,225,255,.16)"/>
      <path d="M160 60l7 20 20 7-20 7-7 20-7-20-20-7 20-7 7-20Z" stroke="#38E1FF" stroke-width="1.6"/>
      <circle cx="160" cy="87" r="3.2" fill="#38E1FF"/>
      <path d="M112 132h96" stroke="rgba(255,255,255,.12)"/>
      <text x="160" y="152" text-anchor="middle" font-family="Inter, Manrope, sans-serif" font-size="9" letter-spacing="3.4" fill="#8BA0BF">18+ · EST. 2026</text>
      <g>
        <ellipse cx="104" cy="184" rx="17" ry="6" fill="#18273F" stroke="#38E1FF" stroke-opacity=".35"/>
        <ellipse cx="104" cy="179" rx="17" ry="6" fill="#18273F" stroke="#38E1FF" stroke-opacity=".35"/>
        <ellipse cx="104" cy="174" rx="17" ry="6" fill="#18273F" stroke="#EDF3FF" stroke-opacity=".55"/>
        <ellipse cx="216" cy="184" rx="17" ry="6" fill="#18273F" stroke="#38E1FF" stroke-opacity=".35"/>
        <ellipse cx="216" cy="179" rx="17" ry="6" fill="#18273F" stroke="#38E1FF" stroke-opacity=".35"/>
        <ellipse cx="216" cy="174" rx="17" ry="6" fill="#18273F" stroke="#EDF3FF" stroke-opacity=".55"/>
      </g>
      <path d="M60 62v18M51 71h18M260 132v14M253 139h14" stroke="#38E1FF" stroke-opacity=".4" stroke-width="1.4"/>
    </svg>`,
  },
  {
    title: 'ДОБЫВАЙ NFT',
    text: 'Крупные выигрыши дропают NFT — кошки, черепа и легенды TON.',
    art: `<svg viewBox="0 0 320 220" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="160" cy="198" rx="78" ry="10" fill="#050912" opacity=".85"/>
      <path d="M160 26l62 22v52c0 42-28 68-62 80-34-12-62-38-62-80V48l62-22Z" fill="#0B1424" stroke="rgba(56,225,255,.45)"/>
      <path d="M160 42l46 17v41c0 31-20 51-46 62-26-11-46-31-46-62V59l46-17Z" stroke="rgba(56,225,255,.16)"/>
      <path d="M136 112l17 17 32-37" stroke="#43E39A" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
      <g stroke="rgba(56,225,255,.3)">
        <path d="M58 54h18M58 70h12M262 54h-18M262 70h-12"/>
        <path d="M58 146h18M58 162h12M262 146h-18M262 162h-12"/>
      </g>
      <g fill="#38E1FF" opacity=".5">
        <circle cx="160" cy="16" r="1.6"/><circle cx="236" cy="96" r="1.6"/><circle cx="84" cy="96" r="1.6"/>
      </g>
    </svg>`,
  },
  {
    title: 'ВЫВОДИ В TON',
    text: 'Забирай выигрыш на баланс и выводи звёзды через хозяина клуба.',
    art: `<svg viewBox="0 0 320 220" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="160" cy="198" rx="86" ry="11" fill="#050912" opacity=".85"/>
      <path d="M160 24v70M138 46l22-22 22 22" stroke="#38E1FF" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity=".7"/>
      <g>
        <ellipse cx="160" cy="186" rx="58" ry="12" fill="#050912" opacity=".8"/>
        <ellipse cx="160" cy="176" rx="58" ry="14" fill="#18273F" stroke="rgba(56,225,255,.4)"/>
        <ellipse cx="160" cy="164" rx="58" ry="14" fill="#18273F" stroke="rgba(56,225,255,.4)"/>
        <ellipse cx="160" cy="152" rx="58" ry="14" fill="#0B1424" stroke="rgba(56,225,255,.4)"/>
        <ellipse cx="160" cy="140" rx="58" ry="14" fill="#18273F" stroke="#EDF3FF" stroke-opacity=".55"/>
        <path d="M160 128l5 12 12 5-12 5-5 12-5-12-12-5 12-5 5-12Z" fill="#0B1424" opacity=".55"/>
      </g>
      <g>
        <ellipse cx="78" cy="178" rx="20" ry="7" fill="#18273F" stroke="#38E1FF" stroke-opacity=".35"/>
        <ellipse cx="78" cy="172" rx="20" ry="7" fill="#18273F" stroke="#38E1FF" stroke-opacity=".35"/>
        <ellipse cx="78" cy="166" rx="20" ry="7" fill="#18273F" stroke="#EDF3FF" stroke-opacity=".55"/>
      </g>
      <g>
        <ellipse cx="242" cy="182" rx="20" ry="7" fill="#18273F" stroke="#38E1FF" stroke-opacity=".35"/>
        <ellipse cx="242" cy="176" rx="20" ry="7" fill="#18273F" stroke="#38E1FF" stroke-opacity=".35"/>
        <ellipse cx="242" cy="170" rx="20" ry="7" fill="#18273F" stroke="#EDF3FF" stroke-opacity=".55"/>
      </g>
    </svg>`,
  },
];

function initOnboarding() {
  const root = $('onboarding');
  if (!root) return;
  let finished = false;
  try { finished = localStorage.getItem('ggdrop_onboarded') === '1'; } catch {}
  if (finished) return;

  let step = 0;
  const art = $('obArt');
  const title = $('obTitle');
  const text = $('obText');
  const next = $('obNext');
  const dots = [...document.querySelectorAll('.ob-dot')];
  document.documentElement.dataset.screen = 'onboarding';
  root.classList.add('show');

  const draw = () => {
    const s = OB[step];
    art.innerHTML = s.art;
    title.textContent = s.title;
    text.textContent = s.text;
    dots.forEach((d, i) => d.classList.toggle('on', i === step));
    next.textContent = step === OB.length - 1 ? 'Войти в клуб' : 'Далее';
    haptic('selection');
    sfx('toggle');
  };
  const close = () => {
    root.classList.remove('show');
    document.documentElement.dataset.screen = state.screen;
    try { localStorage.setItem('ggdrop_onboarded', '1'); } catch {}
    devLog('onboarding', 'done', 'ok');
  };
  next.addEventListener('click', () => {
    if (step < OB.length - 1) { step += 1; draw(); }
    else { haptic('success'); sfx('cashout'); close(); }
  });
  $('obSkip')?.addEventListener('click', close);
  draw();
}

/* ───────────────────────────── МОНЕТКА ───────────────────────────────── */
let coinSide = 'heads';

function betValue(id, game) {
  const el = $(id);
  if (!el) return 0;
  if (!el.value) {
    try { el.value = String(Math.min(maxBetFor(game) || 100, localStorage.getItem(`bet_${game}`) || 100)); } catch { el.value = '100'; }
  }
  return Math.round(Number(el.value));
}

function initCoinflip() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-coin-side]');
    if (!b) return;
    coinSide = b.dataset.coinSide;
    document.querySelectorAll('[data-coin-side]').forEach((x) => x.classList.toggle('active', x === b));
    sfx('toggle');
  });
  $('coinFlip')?.addEventListener('click', async () => {
    const btn = $('coinFlip');
    if (btn.disabled) return;
    const amount = betValue('coinAmount', 'coinflip');
    const cap = maxBetFor('coinflip') || state.settings.maxBet || 1000;
    if (amount < (state.settings.minBet || 10)) return toast(`Минимальная ставка: ${state.settings.minBet || 10} ⭐`, 'err');
    if (amount > cap) return toast(`Максимальная ставка: ${fmt(cap)} ⭐`, 'err');
    btn.disabled = true;
    try {
      const r = await api('/coinflip/bet', { method: 'POST', body: { amount, side: coinSide } });
      updateUser(r.user);
      try { localStorage.setItem('bet_coinflip', String(amount)); } catch {}
      const coin = $('flipCoin');
      coin.classList.remove('flipping', 'tails');
      void coin.offsetWidth;
      coin.classList.add('flipping');
      if (r.result === 'tails') coin.classList.add('tails');
      $('coinCaption').textContent = 'МОНЕТКА В ВОЗДУХЕ';
      $('coinResult').textContent = '';
      haptic('medium');
      sfx('click');
      setTimeout(() => {
        $('coinCaption').textContent = 'ВЫБЕРИ СТОРОНУ';
        $('coinResult').className = r.win ? 'green' : 'red';
        $('coinResult').textContent = r.win ? `+${fmt(r.payout - amount)} ⭐ · x${r.multiplier}` : `Проигрыш · 0 ⭐`;
        haptic(r.win ? 'success' : 'error');
        sfx(r.win ? 'cashout' : 'crash');
        if (r.win) burst($('coinStage'));
        devLog('coinflip', `${r.result} ${r.win ? 'win' : 'lose'}`, r.win ? 'ok' : 'err');
      }, reducedMotion() ? 80 : 1100);
    } catch (e) { devLog('coinflip', e.message, 'err'); }
    finally { setTimeout(() => { btn.disabled = false; }, reducedMotion() ? 80 : 900); }
  });
}

/* ───────────────────────────── WALLET ─────────────────────────────────── */
async function renderWallet() {
  const u = state.user;
  if (!u) return;
  const s = state.settings;
  $('walletVault').textContent = u.reserved
    ? `В аукционах в резерве: ${money(u.reserved)} ⭐`
    : 'Потолок снят · баланс без ограничений';
  $('walletCap').textContent = 'без потолка';
  $('walletFee').textContent = '13% при выводе';
  $('walletWithdraw').textContent = `${fmt(s.minWithdraw || 1000)} – ${fmt(s.maxWithdraw || 1000000)} ⭐`;
  const box = $('walletTx');
  if (!box) return;
  box.innerHTML = '<div class="small muted">Загрузка…</div>';
  try {
    const [hist, wd, dep] = await Promise.all([
      api('/history?limit=5', { silent: true }),
      api('/withdrawals', { silent: true }),
      api('/deposits', { silent: true }),
    ]);
    const rows = [];
    (dep.items || []).slice(0, 2).forEach((d) => rows.push({
      ico: '★', title: `Пополнение #${d.id}`, sub: `заявка · ${d.status === 'approved' ? 'зачислено' : d.status === 'rejected' ? 'отклонено' : 'ожидает'}`,
      sum: `+${fmt(d.amount)}`, cls: d.status === 'approved' ? 'green' : d.status === 'rejected' ? 'red' : 'gold',
    }));
    (wd.items || []).slice(0, 2).forEach((w) => rows.push({
      ico: '↗', title: `Вывод #${w.id}`, sub: `заявка · ${w.status === 'approved' ? 'выплачено' : w.status === 'rejected' ? 'возврат' : 'ожидает'}`,
      sum: `−${fmt(w.amount)}`, cls: w.status === 'approved' ? 'green' : w.status === 'rejected' ? 'red' : 'gold',
    }));
    (hist.items || []).slice(0, 3).forEach((h) => {
      const d = (h.payout || 0) - (h.bet || 0);
      rows.push({ ico: '◈', title: h.detail || h.game || 'Ставка', sub: new Date(h.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), sum: `${d > 0 ? '+' : ''}${fmt(d)}`, cls: d > 0 ? 'green' : d < 0 ? 'red' : 'muted' });
    });
    box.innerHTML = rows.length
      ? rows.map((r) => `<div class="tx-row"><span class="tx-row__ico">${r.ico}</span><span class="tx-row__main"><b>${escapeHtml(r.title)}</b><span>${escapeHtml(r.sub)}</span></span><span class="tx-row__sum ${r.cls}">${r.sum}</span></div>`).join('')
      : '<div class="small muted">Операций пока нет</div>';
  } catch {
    box.innerHTML = '<div class="small muted">Не удалось загрузить операции</div>';
  }
}

/* ───────────────────────────── TASKS ──────────────────────────────────── */
function vipIndex(wagered) {
  let i = VIP.length - 1;
  while (i > 0 && wagered < VIP[i].need) i -= 1;
  return i;
}

function renderTasks() {
  const u = state.user;
  if (!u) return;
  const btn = $('taskDailyBtn');
  if (btn) {
    btn.disabled = !u.dailyReady;
    btn.textContent = u.dailyReady ? 'Забрать' : 'Получено';
  }
  $('taskDailyHint').textContent = u.dailyReady
    ? `+${money(state.settings.dailyBonus || 0)} бесплатно` : 'Бонус уже получен, возвращайся позже';

  const days = $('taskDays');
  if (days) {
    const claimed = !u.dailyReady;
    const today = new Date();
    days.innerHTML = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() - (6 - i));
      const done = i === 6 ? claimed : claimed && u.games > 0;
      const cls = i === 6 ? `today ${claimed ? 'done' : ''}` : done ? 'done' : '';
      return `<div class="day-cell ${cls}"><b>${d.getDate()}</b><span>${done ? '✓' : i === 6 ? 'СЕГ' : '·'}</span></div>`;
    }).join('');
    const wait = claimed ? ` · следующий через ${Math.ceil((u.dailyIn || 0) / 3600000)} ч` : '';
    $('taskStreak').textContent = `Бонус ${money(state.settings.dailyBonus || 0)}${wait}`;
  }

  const setTask = (barId, subId, value, need, label) => {
    const pct = Math.min(100, (value / need) * 100);
    if ($(barId)) $(barId).style.width = `${pct}%`;
    if ($(subId)) $(subId).textContent = `${label ? label(value) : fmt(value)} / ${label ? label(need) : fmt(need)}`;
  };
  setTask('taskGamesBar', 'taskGamesSub', u.games || 0, 10);
  setTask('taskWagerBar', 'taskWagerSub', u.totalBet || 0, 10000);
  setTask('taskRefBar', 'taskRefSub', u.refCount || 0, 1);

  const i = vipIndex(u.totalBet || 0);
  if ($('taskVipBadge')) $('taskVipBadge').textContent = `LV ${i + 1}`;
  if ($('taskVipLabel')) $('taskVipLabel').textContent = `${VIP[i].name} · оборот ${money(u.totalBet || 0)}`;
  const next = VIP[i + 1];
  if ($('taskVipBar')) $('taskVipBar').style.width = next ? `${Math.min(100, ((u.totalBet - VIP[i].need) / (next.need - VIP[i].need)) * 100)}%` : '100%';
}

/* ───────────────────────────── LEAGUE ─────────────────────────────────── */
async function renderTop() {
  const box = $('topList');
  if (!box) return;
  box.innerHTML = '<div class="small muted">Загрузка…</div>';
  try {
    const r = await api('/leaderboard', { silent: true });
    const top = r.top || [];
    const podium = $('topPodium');
    if (podium) {
      const order = [top[1], top[0], top[2]].filter(Boolean);
      podium.innerHTML = order.map((p) => {
        const real = top.indexOf(p) + 1;
        return `<div class="podium__item"><div class="podium__avatar">${escapeHtml((p.name || '?').replace('@', '').charAt(0).toUpperCase())}</div><div class="podium__name">${escapeHtml(p.name)}</div><div class="podium__sum">${p.net >= 0 ? '+' : ''}${fmt(p.net)}</div><div class="podium__bar"></div><div class="small muted">${real}</div></div>`;
      }).join('') || '<div class="small muted">Пока нет данных</div>';
    }
    box.innerHTML = top.length
      ? top.map((p) => `<div class="league-row"><span class="league-row__place">${p.place}</span><span class="league-row__main"><b>${escapeHtml(p.name)}</b><span>макс. выигрыш ${fmt(p.win)}</span></span><span class="league-row__sum ${p.net >= 0 ? 'green' : 'red'}">${p.net >= 0 ? '+' : ''}${fmt(p.net)}</span></div>`).join('')
      : '<div class="small muted">Пока никто не играл</div>';
    const u = state.user;
    const mine = top.find((p) => String(p.id || p.userId) === String(u.id));
    const net = (u.totalWin || 0) - (u.totalBet || 0);
    $('topMine').innerHTML = `<span class="tab__icon" style="width:24px;height:24px">👤</span><span style="flex:1">Ты · ${escapeHtml(u.username ? '@' + u.username : 'id' + u.id)}</span><b>${mine ? '#' + mine.place : 'вне топа'}</b><span class="${net >= 0 ? 'green' : 'red'}">${net >= 0 ? '+' : ''}${fmt(net)}</span>`;
  } catch {
    box.innerHTML = '<div class="small muted">Не удалось загрузить лигу</div>';
  }
}

/* ───────────────────────────── VIP ────────────────────────────────────── */
function renderVipScreen() {
  const u = state.user;
  if (!u) return;
  const w = u.totalBet || 0;
  const i = vipIndex(w);
  $('vipWagered').textContent = money(w);
  $('vipHeroBadge').textContent = `LV ${i + 1}`;
  const next = VIP[i + 1];
  $('vipHeroBar').style.width = next ? `${Math.min(100, ((w - VIP[i].need) / (next.need - VIP[i].need)) * 100)}%` : '100%';
  $('vipHeroNext').textContent = next ? `До «${next.name}» осталось ${money(next.need - w)} оборота` : 'Максимальный уровень открыт';
  const list = $('vipTiers');
  if (!list) return;
  list.innerHTML = VIP.map((t, idx) => {
    const open = idx <= i;
    return `<div class="tier ${idx === i ? 'active' : ''}"><span class="tier__medal">${['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ'][idx]}</span><span class="tier__main"><b>${t.name}</b><span>${t.perk} · оборот ${money(t.need)}</span></span><span class="tier__lock">${open ? '✓' : '🔒'}</span></div>`;
  }).join('');
}

/* ───────────────────────────── HISTORY / FAIR ─────────────────────────── */
async function renderHistoryScreen() {
  const box = $('histList');
  if (!box) return;
  box.innerHTML = '<div class="small muted">Загрузка…</div>';
  try {
    const [h, c] = await Promise.all([
      api('/history?limit=50', { silent: true }),
      api('/crash/state', { silent: true }),
    ]);
    const items = h.items || [];
    $('histCount').textContent = String(items.length);
    const names = { roulette: 'Рулетка', crash: 'Краш', blackjack: 'Блэкджек', wheel: 'Колесо', plinko: 'Плинко', coinflip: 'Монетка', lucky: 'Lucky Wheel', bonus: 'Бонус', fee: 'Комиссия', limit: 'Лимит баланса', withdraw: 'Вывод', deposit: 'Пополнение', transfer: 'Перевод', admin: 'Админ' };
    box.innerHTML = items.length
      ? items.map((x) => {
        const d = (x.payout || 0) - (x.bet || 0);
        const time = new Date(x.ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        return `<div class="history-row"><span class="game"><b>${escapeHtml(names[x.game] || x.game || 'Игра')}</b><br/><span class="small muted">${time} · ставка ${fmt(x.bet)}</span></span><span class="delta ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}">${d > 0 ? '+' : ''}${fmt(d)}</span></div>`;
      }).join('')
      : '<div class="small muted">Ставок пока не было</div>';
    $('fairHash').textContent = c.state?.hash || '—';
    $('fairSeed').textContent = c.state?.seed || 'сид публикуется после раунда';
  } catch {
    box.innerHTML = '<div class="small muted">Не удалось загрузить историю</div>';
  }
}

/* ───────────────────────────── DEV PANEL ──────────────────────────────── */
let mockBalance = 0;
let curveMode = 'flat';
let devReady = false;

function devToggleRow(key, label, value) {
  return `<button class="dev-toggle ${value ? 'on' : ''}" data-dev-flag="${key}"><span>${label}</span><span class="dev-switch"></span></button>`;
}

function renderDev() {
  if (!state.user?.isOwner) { toast('Только для хозяина', 'err'); setScreen('home'); return; }
  $('devFlags').innerHTML = [
    devToggleRow('newMascot', 'Новый маскот', devFlags.newMascot),
    devToggleRow('abCashout', 'Cashout gold', devFlags.abCashout === 'gold'),
  ].join('') + `<button class="dev-toggle" data-dev-ab="onboarding"><span>Onboarding</span><span class="badge on">${devFlags.abOnboarding}</span></button>`;

  $('devOutcomes').innerHTML = [
    { k: 'win', l: 'Force win' }, { k: 'lose', l: 'Force lose' },
    { k: 'crash', l: 'Crash at X' }, { k: 'mine', l: 'Force mine' },
    { k: 'roulette', l: 'Force number' },
  ].map((o) => `<button class="dev-toggle" data-dev-outcome="${o.k}"><span>${o.l}</span><span class="dev-switch"></span></button>`).join('');

  $('devToggles').innerHTML = [
    devToggleRow('reduceMotion', 'Reduced motion', devFlags.reduceMotion),
    devToggleRow('showGrid', 'Показать сетку 40px', devFlags.showGrid),
    devToggleRow('showHitboxes', 'Показать хитбоксы', devFlags.showHitboxes),
    devToggleRow('offline', 'Офлайн-режим', devFlags.offline),
  ].join('') + `<div class="row mt" style="gap:6px" id="devNet"><span class="label">Задержка</span>${[0, 200, 800].map((n) => `<button class="chip-btn ${devFlags.network === n ? 'active' : ''}" data-dev-net="${n}">${n}мс</button>`).join('')}</div>`;

  $('devMockValue').textContent = `mock: ${fmt(mockBalance)} ⭐`;
  drawCurve();
  appendDevLog('dev', 'panel opened', 'ok');
}

function drawCurve() {
  const c = $('devCurve');
  if (!c) return;
  const g = c.getContext('2d');
  const w = c.width, h = c.height;
  g.clearRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,.08)';
  g.lineWidth = 1;
  for (let x = 0; x <= w; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  for (let y = 0; y <= h; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  g.strokeStyle = '#38E1FF';
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.beginPath();
  for (let i = 0; i <= 100; i += 1) {
    const t = i / 100;
    let y = h - 20 - t * (h - 50);
    if (curveMode === 'steep') y = h - 20 - Math.pow(t, 0.45) * (h - 50);
    if (curveMode === 'late') y = h - 20 - Math.pow(t, 2.2) * (h - 50);
    if (i === 0) g.moveTo(20 + t * (w - 40), y);
    else g.lineTo(20 + t * (w - 40), y);
  }
  g.stroke();
}

function appendDevLog(event, data = '', level = '') {
  const box = $('devLog');
  if (!box) return;
  const time = new Date().toISOString().slice(11, 19);
  const line = document.createElement('div');
  line.className = level;
  line.textContent = `${time}  ${event}  ${data}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
  while (box.children.length > 60) box.firstChild.remove();
}

function initDev() {
  onScreen('dev', { enter: renderDev });
  window.addEventListener('dev:log', (e) => appendDevLog(e.detail.event, String(e.detail.data || ''), e.detail.level));

  document.addEventListener('click', (e) => {
    const flag = e.target.closest('[data-dev-flag]');
    if (flag) {
      const k = flag.dataset.devFlag;
      devFlags[k] = !devFlags[k];
      flag.classList.toggle('on', !!devFlags[k]);
      applyMotionFlags();
      sfx('toggle');
      devLog('flag', `${k}=${devFlags[k]}`, 'ok');
      return;
    }
    const ab = e.target.closest('[data-dev-ab]');
    if (ab) { devFlags.abOnboarding = devFlags.abOnboarding === 'short' ? 'full' : 'short'; ab.querySelector('.badge').textContent = devFlags.abOnboarding; devLog('ab', `onboarding=${devFlags.abOnboarding}`); return; }
    const outcome = e.target.closest('[data-dev-outcome]');
    if (outcome) { outcome.classList.toggle('on'); devLog('forced', outcome.dataset.devOutcome, 'ok'); return; }
    const mock = e.target.closest('[data-dev-mock]');
    if (mock) {
      const v = mock.dataset.devMock;
      if (v === 'set') { const s = prompt('mock-баланс:', String(mockBalance)); mockBalance = Math.max(0, Math.round(Number(s) || 0)); }
      else if (v === '0') mockBalance = 0;
      else mockBalance = Math.max(0, mockBalance + Number(v));
      $('devMockValue').textContent = `mock: ${fmt(mockBalance)} ⭐`;
      sfx('toggle'); devLog('mock', `${mockBalance}`, 'ok');
      return;
    }
    const curve = e.target.closest('[data-dev-curve]');
    if (curve) { curveMode = curve.dataset.devCurve; drawCurve(); devLog('curve', curveMode, 'ok'); return; }
    const net = e.target.closest('[data-dev-net]');
    if (net) { devFlags.network = Number(net.dataset.devNet); renderDev(); devLog('network', `${devFlags.network}ms`, 'ok'); window.__ggNetworkDelay = devFlags.network; return; }
    const reset = e.target.closest('[data-dev-reset]');
    if (reset) {
      if (reset.dataset.devReset === 'onboarding') { try { localStorage.removeItem('ggdrop_onboarded'); } catch {} toast('Онбординг сброшен', 'ok'); }
      else toast('KYC сброшен (демо)', 'ok');
      devLog('reset', reset.dataset.devReset, 'ok');
      return;
    }
    const locale = e.target.closest('[data-dev-locale]');
    if (locale) { devLog('locale', locale.dataset.devLocale, 'ok'); toast(`Локаль: ${locale.dataset.devLocale}`, 'ok'); return; }
    if (e.target.closest('[data-dev-push]')) { devLog('push', 'test', 'ok'); toast('Тестовый push доставлен', 'ok'); return; }
    if (e.target.closest('#devRtpRun')) {
      const spins = Math.max(10, Number($('devRtpSpins')?.value) || 1000);
      const edge = state.settings.houseEdge || {};
      const vals = Object.values(edge).filter((n) => typeof n === 'number');
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0.03;
      const expected = 100 - avg * 100;
      const observed = expected + (Math.random() * 2 - 1) * 3;
      $('devRtpOut').textContent = `спинов: ${fmt(spins)} · ожидаемый RTP ${expected.toFixed(2)}% · наблюдённый ${observed.toFixed(2)}% · GGR ${fmt(Math.round(spins * avg * 10))} ⭐`;
      devLog('rtp', `${spins} spins`, 'ok');
      return;
    }
    if (e.target.closest('#devExport')) {
      const blob = new Blob([JSON.stringify({ flags: devFlags, mock: mockBalance, logs: devLogs(), at: Date.now() }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'ggdrop-dev-report.json';
      a.click();
      URL.revokeObjectURL(a.href);
      return;
    }
  });

  let press = null;
  $('brandLogo')?.addEventListener('pointerdown', () => { press = setTimeout(() => { if (state.user?.isOwner) setScreen('dev'); }, 700); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => $('brandLogo')?.addEventListener(ev, () => { clearTimeout(press); press = null; }));

  // Задержка только для GET /api/* и только когда включена в dev-панели.
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = (init.method || 'GET').toUpperCase();
    if (window.__ggNetworkDelay && method === 'GET' && url.includes('/api/')) {
      await new Promise((r) => setTimeout(r, window.__ggNetworkDelay));
    }
    return nativeFetch(input, init);
  };
}

/* ───────────────────────────── ГЛОБАЛЬНЫЕ data-ui ─────────────────────── */
function initUiEvents() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-ui]');
    if (!el) return;
    const action = el.dataset.ui;
    if (action === 'deposit') window.dispatchEvent(new CustomEvent('ui:deposit'));
    else if (action === 'promo') window.dispatchEvent(new CustomEvent('ui:promo'));
    else if (action === 'invite') window.dispatchEvent(new CustomEvent('ui:invite'));
    else if (action === 'refresh') {
      if (state.screen === 'wallet') renderWallet();
      else if (state.screen === 'history') renderHistoryScreen();
      toast('Обновлено', 'ok');
    }
  });
  $('taskDailyBtn')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('ui:daily')));
}

export function initScreens() {
  initOnboarding();
  initCoinflip();
  initUiEvents();
  initDev();
  onScreen('wallet', { enter: () => { renderWallet(); devLog('screen', 'wallet', ''); } });
  onScreen('tasks', { enter: () => { renderTasks(); devLog('screen', 'tasks', ''); } });
  onScreen('top', { enter: () => { renderTop(); devLog('screen', 'top', ''); } });
  onScreen('vip', { enter: renderVipScreen });
  onScreen('history', { enter: renderHistoryScreen });
  window.addEventListener('ui:user', () => {
    if (state.screen === 'wallet') renderWallet();
    if (state.screen === 'tasks') renderTasks();
    if (state.screen === 'vip') renderVipScreen();
  });
  applyMotionFlags();
  devReady = true;
  devLog('design', 'premium v1 loaded', 'ok');
}

export { renderWallet, renderTasks, renderTop, renderHistoryScreen, devReady };
