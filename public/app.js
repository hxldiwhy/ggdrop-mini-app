import {
  app,
  state,
  api,
  toast,
  setScreen,
  updateUser,
  renderHeader,
  fmt,
  money,
  modal,
  onScreen,
  copyText,
  spinner,
  lastBet,
  escapeHtml,
  maxBetFor,
  lastGame,
} from './core.js';
import { initGames } from './games.js';
import { initAdmin } from './admin.js';
import { initScreens } from './screens.js';
import { initLucky } from './lucky.js';
import { initAuction } from './auction.js';

const $ = (id) => document.getElementById(id);

function showFatal(title, text) {
  document.getElementById('app').innerHTML = `
    <div class="error-screen">
      <div>
        <div class="emoji">🎰</div>
        <h2>${title}</h2>
        <p>${text}</p>
      </div>
    </div>`;
}

async function bootstrap() {
  try { app.ready(); app.expand(); } catch {}

  const t = state.bootstrapQuery.get('t');
  const initData = app.initData || '';
  const unsafe = app.initDataUnsafe || {};
  let ok = false;
  let sessionError = null;

  if (t || initData) {
    try {
      const session = await api('/session', { method: 'POST', body: { t, initData, unsafe } });
      state.token = session.token;
      localStorage.setItem('ggdrop_token', session.token);
      state.user = session.user;
      state.settings = session.settings;
      ok = true;
    } catch (e) {
      sessionError = e;
    }
  }

  if (!ok && state.token) {
    try {
      const me = await api('/me');
      state.user = me.user;
      state.settings = me.settings;
      ok = true;
    } catch {}
  }

  if (!ok) {
    const diag = `initData: ${initData ? `${initData.length} симв.` : 'нет'} · webApp id: ${unsafe?.user?.id || '—'} · код: ${sessionError?.code || '—'}`;
    showFatal(
      'Нужен вход через бота',
      'Открой казино кнопкой «Открыть казино» в чате с ботом — она выдаёт одноразовый доступ.' +
        `<br/><span class="small muted">${diag}</span>`
    );
    return;
  }

  if (state.user?.banned) {
    showFatal('Аккаунт заблокирован', 'Хозяин казино ограничил доступ. Если это ошибка — напиши ему в чат бота.');
    return;
  }

  renderHeader();
  renderHome();
  renderProfile();
  renderWithdraw();
  initGames();
  initAdmin();
  initScreens();
  initLucky();
  initAuction();
  wireRouter();
  wireGlobal();
  wireUiEvents();
  initLobby();

  const hash = location.hash.slice(1);
  if (state.bootstrapQuery.get('admin') === '1' && state.user?.isOwner) setScreen('admin', { push: false });
  else if (state.bootstrapQuery.get('view') === 'dev' || hash === 'dev') setScreen('dev', { push: false });
  else if (state.bootstrapQuery.get('view') === 'withdraw') setScreen('withdraw', { push: false });
  else setScreen(hash || 'home', { push: false });
  refreshMe();
  if (state.bootstrapQuery.get('view') === 'topup') setTimeout(() => depositModal(), 350);
}

/* ─── глобальные обработчики ─────────────────────────────────────────────── */
function wireRouter() {
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-go]');
    if (!target) return;
    const dest = target.dataset.go;
    if (dest) setScreen(dest);
  });

  document.querySelectorAll('[data-admin-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-admin-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      ['overview', 'players', 'settings', 'promos', 'broadcast', 'deposits', 'withdrawals'].forEach((k) => {
        $('admin' + k[0].toUpperCase() + k.slice(1))?.classList.toggle('hidden', k !== btn.dataset.adminTab);
      });
      window.dispatchEvent(new CustomEvent('admin-tab', { detail: btn.dataset.adminTab }));
    });
  });

  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1) || 'home';
    setScreen(h, { push: false });
  });
}

function wireGlobal() {
  $('balancePill')?.addEventListener('click', () => setScreen('profile'));
  $('resumeGame')?.addEventListener('click', () => {
    const last = lastGame();
    if (last) setScreen(last);
  });
  $('homeDaily')?.addEventListener('click', daily);
  $('homePromo')?.addEventListener('click', promoModal);
  $('homeTop')?.addEventListener('click', topModal);
  $('homeHistory')?.addEventListener('click', historyModal);
  $('profileDaily')?.addEventListener('click', daily);
  $('promoApply')?.addEventListener('click', applyPromo);
  $('promoInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyPromo(); });
  $('referralCopy')?.addEventListener('click', referralCopy);
  $('inviteCopy')?.addEventListener('click', referralCopy);
  $('profileTopupHero')?.addEventListener('click', depositModal);
  document.addEventListener('click', (e) => {
    const tile = e.target.closest('[data-profile-action]');
    if (!tile) return;
    const action = tile.dataset.profileAction;
    if (action === 'history') historyModal();
    else if (action === 'top') topModal();
    else if (action === 'promo') promoModal();
    else if (action === 'friends' || action === 'invite') referralCopy();
    else if (action === 'withdraw') setScreen('withdraw');
    else if (action === 'support') supportChat();
    else if (action === 'daily') daily();
    else if (action === 'vip') $('vipCard')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  $('adminRefresh')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('admin-refresh')));
  $('topupBtn')?.addEventListener('click', depositModal);
  $('heroTopup')?.addEventListener('click', depositModal);
  $('profileTopup')?.addEventListener('click', depositModal);
  $('heroDeposit')?.addEventListener('click', depositModal);
  $('wdSubmit')?.addEventListener('click', submitWithdraw);
  $('wdRefresh')?.addEventListener('click', loadWithdrawals);
  $('wdPresets')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-wd]');
    if (!btn) return;
    $('wdPresets').querySelectorAll('[data-wd]').forEach((b) => b.classList.toggle('active', b === btn));
    const max = Math.min(Number(state.settings.maxWithdraw) || 150000, Number(state.settings.maxBalance) || 150000);
    const v = btn.dataset.wd === 'max' ? Math.min(max, state.user?.balance || 0) : Number(btn.dataset.wd);
    $('wdAmount').value = String(v);
  });
}

function wireUiEvents() {
  window.addEventListener('ui:deposit', depositModal);
  window.addEventListener('ui:promo', promoModal);
  window.addEventListener('ui:invite', referralCopy);
  window.addEventListener('ui:daily', daily);
}

async function refreshMe() {
  try {
    const me = await api('/me', { silent: true });
    updateUser(me.user);
    state.settings = me.settings;
    renderHome();
    renderProfile();
  } catch {}
}

/* ─── главная ────────────────────────────────────────────────────────────── */
const RESUME_NAMES = {
  crash: 'Краш', roulette: 'Рулетка', dice: 'Кости', blackjack: 'Блэкджек',
  wheel: 'Колесо', plinko: 'Плинко', coinflip: 'Монетка',
};

function renderHome() {
  const edge = state.settings.houseEdge?.roulette;
  const e = $('rouletteEdge');
  if (e && edge) e.textContent = `RTP ${(100 - edge * 100).toFixed(1)}%`;
  const lim = $('homeLimits');
  if (lim) lim.textContent = `${state.settings.minBet}–${state.settings.maxBet}`;

  const card = $('resumeGame');
  const last = lastGame();
  if (card) {
    card.classList.toggle('hidden', !last);
    if (last) {
      $('resumeName').textContent = RESUME_NAMES[last] || last;
      const icon = $('resumeIcon')?.querySelector('use');
      if (icon) icon.setAttribute('href', `#ic_game_${last}`);
    }
  }
}

/* ─── лобби: live-лента и плитки ──────────────────────────────────────────── */
const FEED_NAMES = {
  crash: 'Краш', dice: 'Кости', roulette: 'Рулетка',
  blackjack: 'Блэкджек', wheel: 'Колесо', plinko: 'Плинко', coinflip: 'Монетка', lucky: 'Lucky Wheel',
};
const maskName = (n) => {
  const bare = String(n || 'player').replace(/^@/, '').trim() || 'player';
  return bare.length <= 3 ? bare : `${bare.slice(0, 3)}***`;
};

let lobbyStarted = false;

function initLobby() {
  if (lobbyStarted) return;
  lobbyStarted = true;

  // Live-лента выигрышей (реальные данные /api/feed)
  const feedTrack = $('liveFeedTrack');
  let feedSignature = '';
  const loadFeed = async () => {
    if (!feedTrack) return;
    try {
      const r = await api('/feed?limit=30', { silent: true });
      const seen = new Set();
      const items = (r.items || [])
        .filter((x) => (x.payout || 0) > (x.bet || 0) && (x.profit || 0) >= 10)
        .sort((a, b) => (b.profit || 0) - (a.profit || 0))
        .filter((x) => {
          const key = `${x.name}|${x.game}|${x.profit}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 8);
      if (!items.length) return;
      const signature = items.map((x) => `${x.name}:${x.game}:${x.profit}`).join('|');
      if (signature === feedSignature) return;
      feedSignature = signature;
      const html = items
        .map((x) => `<span class="live-feed__item"><b>${escapeHtml(maskName(x.name))}</b> выиграл <i>+${fmt(x.profit)} ⭐</i> <em>${escapeHtml(FEED_NAMES[x.game] || x.game)}</em></span>`)
        .join('');
      feedTrack.innerHTML = html + html; // дубль для бесшовного marquee
      feedTrack.style.setProperty('--feed-duration', `${Math.max(24, items.length * 4.5)}s`);
    } catch (e) {
      if (e?.code !== 'NETWORK') console.warn('[feed]', e?.message || e);
    }
  };
  loadFeed();
  // Первый повтор быстрый: сессия могла ещё не успеть выдать токен.
  setTimeout(loadFeed, 2500);
  setInterval(loadFeed, 12000);

  // «В игре» — живые псевдо-счётчики (джиттер вокруг базы)
  const players = [...document.querySelectorAll('.station__players')];
  players.forEach((el) => { el.dataset.base = el.dataset.players || '100'; });
  setInterval(() => {
    players.forEach((el) => {
      const base = Number(el.dataset.base) || 100;
      const v = Math.max(20, Math.round(base * (0.9 + Math.random() * 0.25)));
      el.textContent = fmt(v);
    });
  }, 6000);

  // 3D-tilt на игровых плитках (pointer-only, без overhead на touch)
  document.querySelectorAll('.station').forEach((tile) => {
    tile.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const r = tile.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      tile.style.setProperty('--mx', `${(x + 0.5) * 100}%`);
      tile.style.setProperty('--my', `${(y + 0.5) * 100}%`);
      tile.style.transform = `perspective(520px) rotateY(${x * 10}deg) rotateX(${-y * 8}deg) translateZ(6px) scale(1.015)`;
    });
    tile.addEventListener('pointerleave', () => {
      tile.style.transform = '';
      tile.style.removeProperty('--mx');
      tile.style.removeProperty('--my');
    });
  });
}

/* ─── профиль ────────────────────────────────────────────────────────────── */
let historyCache = [];

const VIP_LEVELS = [
  { need: 0, name: 'Новичок' },
  { need: 10000, name: 'Игрок' },
  { need: 50000, name: 'Профи' },
  { need: 200000, name: 'Элита' },
  { need: 1000000, name: 'Легенда' },
];

function renderVip(u) {
  if (!$('vipLevel')) return;
  const wagered = Math.max(0, Number(u.totalBet || 0));
  let i = VIP_LEVELS.length - 1;
  while (i > 0 && wagered < VIP_LEVELS[i].need) i -= 1;
  const level = i + 1;
  const cur = VIP_LEVELS[i];
  const next = VIP_LEVELS[i + 1];
  $('vipLevel').textContent = `LV ${level}`;
  $('vipLabel').textContent = `Уровень ${level} · ${cur.name} · оборот ${money(wagered)}`;
  const bar = $('vipProgress');
  if (next) {
    const from = cur.need;
    const pct = Math.max(0, Math.min(100, ((wagered - from) / (next.need - from)) * 100));
    if (bar) bar.style.width = `${pct}%`;
    $('vipNext').textContent = `До уровня ${level + 1} «${next.name}» осталось ${money(Math.max(0, next.need - wagered))} ⭐ оборота`;
  } else {
    if (bar) bar.style.width = '100%';
    $('vipNext').textContent = 'Максимальный уровень открыт';
  }
}

function renderProfile() {
  const u = state.user;
  if (!u) return;
  const name = u.username ? `@${u.username}` : u.firstName || `id${u.id}`;
  $('profileName').textContent = name;
  $('profileAvatar').textContent = (u.firstName || u.username || '?').trim().charAt(0).toUpperCase();
  $('profileId').textContent = `id ${u.id}`;
  $('profileOwner').classList.toggle('hidden', !u.isOwner);

  $('statBalance').textContent = fmt(u.balance);
  const profit = (u.totalWin || 0) - (u.totalBet || 0);
  const profitEl = $('statProfit');
  profitEl.textContent = `${profit >= 0 ? '+' : ''}${fmt(profit)}`;
  profitEl.className = `stat__value ${profit > 0 ? 'pos' : profit < 0 ? 'neg' : ''}`;
  $('statGames').textContent = fmt(u.games || 0);
  $('statWinrate').textContent = u.games ? `${Math.round(((u.wins || 0) / u.games) * 100)}%` : '0%';

  // Новая карточка профиля (стиль присланных референсов)
  if ($('heroBalanceValue')) $('heroBalanceValue').textContent = fmt(u.balance);
  if ($('friendsCount')) $('friendsCount').textContent = fmt(u.refCount || 0);
  renderVip(u);

  const cap = Number(state.settings.maxBalance) || 150000;
  const fee = state.settings.storageFee || {};
  $('statVault').textContent = money(u.vault || 0);
  $('statFeePaid').textContent = money(u.feePaid || 0);
  $('walletHint').textContent = `Потолок баланса ${money(cap)} · излишек уходит в банк`;
  if ($('heroVaultLine')) $('heroVaultLine').textContent = `В банке: ${money(u.vault || 0)} · потолок ${money(cap)}`;
  window.__renderNfts?.();
  $('statFee').textContent = fee.enabled ? `${fee.percentPerDay || 0}%/сутки сверх ${fmt(fee.threshold || 0)}` : 'выключена';
  $('feeHint').textContent = fee.enabled
    ? `Комиссия начисляется раз в сутки только на сумму сверх ${fmt(fee.threshold || 0)} ⭐ и отображается в истории.`
    : 'Комиссия за хранение отключена хозяином.';

  const bar = $('walletBar');
  if (bar) {
    bar.style.width = `${Math.max(0, Math.min(100, ((u.balance || 0) / cap) * 100))}%`;
    bar.classList.toggle('hot', (u.balance || 0) > cap * 0.85);
  }

  const dailyBtn = $('profileDaily');
  if (dailyBtn) {
    if (u.dailyReady) {
      dailyBtn.disabled = false;
      dailyBtn.textContent = 'Забрать';
      $('dailyHint').textContent = `+${money(state.settings.dailyBonus)} бесплатно`;
    } else {
      dailyBtn.disabled = true;
      const h = Math.ceil((u.dailyIn || 0) / 3600000);
      dailyBtn.textContent = h >= 1 ? `через ${h} ч` : 'скоро';
      $('dailyHint').textContent = 'Бонус уже получен, возвращайся позже';
    }
  }
  const topupHint = $('topupHint');
  if (topupHint) topupHint.textContent = `Через @${state.settings.cashierUsername || 'crypt'} · заявка`;
  renderHistory();
  renderDeposits();
}

async function renderHistory() {
  const box = $('historyList');
  if (!box) return;
  try {
    const data = await api('/history?limit=25', { silent: true });
    historyCache = data.items || [];
  } catch {
    return;
  }
  const names = {
    roulette: '🎡 Рулетка', crash: '🚀 Краш', dice: '🎲 Кости',
    blackjack: '🃏 Блэкджек', coinflip: '◐ Монетка', bonus: '🎁 Бонус', transfer: '💸 Перевод', admin: '👑 Админ',
    fee: '🏦 Комиссия', limit: '🧱 Лимит', withdraw: '💸 Вывод', deposit: '⭐ Пополнение', wheel: '🍀 Колесо', plinko: '🔻 Плинко', lucky: '🎡 Lucky Wheel',
  };
  $('historyCount').textContent = historyCache.length ? `${historyCache.length}` : '';
  if (!historyCache.length) {
    box.innerHTML = '<div class="small muted">Пока пусто</div>';
    return;
  }
  box.innerHTML = historyCache
    .map((h) => {
      const delta = (h.payout || 0) - (h.bet || 0);
      const cls = delta > 0 ? 'pos' : delta < 0 ? 'neg' : '';
      const sign = delta > 0 ? '+' : '';
      const time = new Date(h.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      return `<div class="history-row">
        <span class="game">${names[h.game] || h.game}</span>
        <span class="small muted">${time}</span>
        <span class="delta ${cls}">${sign}${fmt(delta)}</span>
      </div>`;
    })
    .join('');
}

/* ─── действия ───────────────────────────────────────────────────────────── */
async function daily() {
  try {
    const r = await api('/daily', { method: 'POST' });
    toast(`Бонус +${money(r.amount)}`, 'ok');
    app.haptic('success');
    updateUser(r.user);
    renderProfile();
  } catch {}
}

function promoModal() {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <label class="field">Промокод</label>
    <input type="text" id="modalPromoInput" placeholder="НАПРИМЕР: WELCOME" style="text-transform:uppercase" />
    <div class="small muted mt">Коды раздаёт хозяин казино в чате бота.</div>`;
  const close = modal({
    title: '🎟 Активировать промокод',
    content: wrap,
    actions: [
      {
        text: 'Активировать',
        async onClick() {
          const code = wrap.querySelector('#modalPromoInput').value.trim();
          if (!code) { toast('Введи код', 'err'); return false; }
          try {
            const r = await api('/promo', { method: 'POST', body: { code } });
            toast(`Промокод принят: +${money(r.amount)}`, 'ok');
            updateUser(r.user);
            renderProfile();
          } catch { return false; }
          return true;
        },
      },
    ],
  });
  setTimeout(() => wrap.querySelector('#modalPromoInput')?.focus(), 250);
  return close;
}

async function applyPromo() {
  const input = $('promoInput');
  const code = input?.value.trim();
  if (!code) return toast('Введи код', 'err');
  try {
    const r = await api('/promo', { method: 'POST', body: { code } });
    toast(`Промокод принят: +${money(r.amount)}`, 'ok');
    updateUser(r.user);
    input.value = '';
    renderProfile();
  } catch {}
}

/* ─── пополнение звёзд ───────────────────────────────────────────────────── */
let depositsCache = [];

function depositModal() {
  const min = state.settings.minDeposit || 100;
  const cashier = state.settings.cashierUsername || 'crypt';
  const presets = [100, 250, 500, 1000, 2500, 5000].filter((v) => v >= min);
  if (!presets.length) presets.push(min);
  const def = presets[Math.min(2, presets.length - 1)];

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="row row--between mb">
      <span class="small muted">Текущий баланс</span>
      <b class="gold">${money(state.user?.balance || 0)}</b>
    </div>
    <div class="cap-note">Потолок баланса ${money(state.settings.maxBalance || 150000)}. Всё сверху автоматически уходит в банк — это видно в профиле.</div>
    <label class="field">Сумма пополнения</label>
    <div class="bet-input">
      <input type="number" id="depAmount" value="${def}" min="${min}" inputmode="numeric" />
      <span class="hint">⭐</span>
    </div>
    <div class="amount-grid" id="depPresets">
      ${presets
        .map((v) => `<button class="chip-btn ${v === def ? 'active' : ''}" data-dep="${v}">${fmt(v)}</button>`)
        .join('')}
    </div>
    <div class="deposit-steps">
      <div class="deposit-step"><span class="num">1</span><span>Напиши <b>@${escapeHtml(cashier)}</b> и отправь оффер/подарок со звёздами на нужную сумму.</span></div>
      <div class="deposit-step"><span class="num">2</span><span>Создай заявку — получишь номер, укажи его в сообщении хозяину.</span></div>
      <div class="deposit-step"><span class="num">3</span><span>Хозяин подтвердит заявку — звёзды сразу придут на баланс.</span></div>
    </div>
    <div class="cashier-card">
      <div class="ava">@</div>
      <div style="flex:1"><div class="who">@${escapeHtml(cashier)}</div><div class="sub">кассир · хозяин казино</div></div>
      <button class="btn btn--sm btn--ghost" id="depCopy">Копировать</button>
    </div>
    <div class="small muted mt">Минимум ${money(min)} за заявку. Заявку видит только хозяин.</div>
  `;

  const close = modal({
    title: '⭐ Пополнить звёзды',
    sub: 'Пополнение идёт через хозяина казино',
    content: wrap,
    actions: [
      {
        text: 'Создать заявку',
        async onClick() {
          const amount = Math.round(Number(wrap.querySelector('#depAmount')?.value));
          if (!amount || amount < min) {
            toast(`Минимальная сумма: ${money(min)}`, 'err');
            return false;
          }
          try {
            const r = await api('/deposit', { method: 'POST', body: { amount } });
            const dep = r.deposit;
            wrap.innerHTML = `
              <div class="center" style="padding:8px 0 4px">
                <div style="font-size:44px;line-height:1">✅</div>
                <div style="font-size:19px;font-weight:900;margin-top:6px">Заявка #${escapeHtml(dep.id)}</div>
                <div class="muted small" style="margin-top:4px">на ${money(dep.amount)} · ожидает подтверждения</div>
              </div>
              <div class="cashier-card">
                <div class="ava">@</div>
                <div style="flex:1"><div class="who">@${escapeHtml(cashier)}</div><div class="sub">напиши и отправь оффер на ${money(dep.amount)}</div></div>
                <button class="btn btn--sm btn--ghost" id="depCopy2">Копировать</button>
              </div>
              <div class="small muted mt">Не забудь указать номер <b>#${escapeHtml(dep.id)}</b> в сообщении — так хозяин быстрее найдёт заявку.</div>
            `;
            wrap.querySelector('#depCopy2')?.addEventListener('click', () => {
              copyText(`@${cashier}`);
              toast('Ник скопирован', 'ok');
            });
            toast('Заявка создана, ждём подтверждения', 'ok');
            app.haptic('success');
            renderDeposits();
            return false;
          } catch {
            return false;
          }
        },
      },
    ],
  });

  wrap.querySelector('#depCopy')?.addEventListener('click', () => {
    copyText(`@${cashier}`);
    toast('Ник скопирован', 'ok');
  });
  wrap.querySelector('#depPresets')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-dep]');
    if (!btn) return;
    wrap.querySelectorAll('[data-dep]').forEach((b) => b.classList.toggle('active', b === btn));
    wrap.querySelector('#depAmount').value = btn.dataset.dep;
  });
  return close;
}

async function renderDeposits() {
  const box = $('depositList');
  if (!box) return;
  try {
    const r = await api('/deposits', { silent: true });
    depositsCache = r.items || [];
  } catch {
    return;
  }
  const labels = { pending: 'ждёт', approved: 'зачислено', rejected: 'отклонено' };
  if (!depositsCache.length) {
    box.innerHTML = '<div class="small muted">Заявок пока нет</div>';
    return;
  }
  box.innerHTML = depositsCache
    .slice(0, 6)
    .map(
      (d) => `<div class="deposit-row">
        <span class="dep-id">#${escapeHtml(d.id)}</span>
        <span>${money(d.amount)}</span>
        <span class="st ${d.status}">${labels[d.status] || d.status}</span>
      </div>`
    )
    .join('');
}

/* ─── вывод звёзд ─────────────────────────────────────────────────────────── */
let withdrawCache = [];

function renderWithdraw() {
  const u = state.user;
  if (!u) return;
  const s = state.settings;
  const cap = Number(s.maxBalance) || 150000;
  const min = Number(s.minWithdraw) || 1000;
  const max = Math.min(Number(s.maxWithdraw) || cap, cap);
  $('wdBalance').textContent = fmt(u.balance);
  $('wdVaultLine').textContent = `В банке: ${money(u.vault || 0)}`;
  $('wdCap').textContent = `до ${fmt(cap)} ⭐`;
  $('wdLimit').textContent = `Лимит: ${fmt(min)} – ${fmt(max)} ⭐ за заявку`;
  $('wdFeeNote').textContent = s.storageFee?.enabled
    ? `Комиссия хранилища: ${s.storageFee.percentPerDay || 0}%/сутки сверх ${fmt(s.storageFee.threshold || 0)} ⭐ · указана в истории`
    : 'Комиссия за хранение выключена';
  $('wdCashierName').textContent = `@${s.cashierUsername || 'crypt'}`;
  const input = $('wdAmount');
  if (input && !input.value) input.value = String(Math.min(max, Math.max(min, 5000)));
  const pct = Math.max(0, Math.min(100, (u.balance / cap) * 100));
  $('wdProgress').style.width = `${pct}%`;
  $('wdProgress').classList.toggle('hot', pct > 80);
  loadWithdrawals();
}

async function loadWithdrawals() {
  const box = $('wdList');
  if (!box) return;
  try {
    const r = await api('/withdrawals', { silent: true });
    withdrawCache = r.items || [];
  } catch {
    return;
  }
  const labels = { pending: 'ждёт', approved: 'выплачено', rejected: 'возврат' };
  $('wdCount').textContent = withdrawCache.length ? String(withdrawCache.length) : '';
  if (!withdrawCache.length) {
    box.innerHTML = '<div class="small muted">Заявок пока нет</div>';
    return;
  }
  box.innerHTML = withdrawCache
    .slice(0, 8)
    .map(
      (w) => `<div class="deposit-row">
        <span class="dep-id">#${escapeHtml(w.id)}</span>
        <span>${money(w.amount)}</span>
        <span class="st ${w.status}">${labels[w.status] || w.status}</span>
      </div>`
    )
    .join('');
}

async function submitWithdraw() {
  const btn = $('wdSubmit');
  const amount = Math.round(Number($('wdAmount')?.value));
  const contact = ($('wdContact')?.value || '').trim();
  if (!amount || amount < (Number(state.settings.minWithdraw) || 1000)) {
    toast(`Минимальная сумма: ${money(state.settings.minWithdraw || 1000)}`, 'err');
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Создаём…'; }
  try {
    const r = await api('/withdraw', { method: 'POST', body: { amount, contact } });
    const wd = r.withdrawal;
    toast(`Заявка #${wd.id} создана`, 'ok');
    app.haptic('success');
    $('wdAmount').value = '';
    $('wdContact').value = '';
    updateUser({ ...state.user, balance: state.user.balance - amount });
    renderWithdraw();
  } catch {} finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Создать заявку 💸'; }
  }
}

async function topModal() {
  const wrap = document.createElement('div');
  wrap.innerHTML = spinner();
  modal({ title: '🏆 Топ игроков', content: wrap });
  try {
    const data = await api('/leaderboard', { silent: true });
    if (!data.top.length) {
      wrap.innerHTML = '<div class="small muted">Пока никто не играл.</div>';
      return;
    }
    wrap.innerHTML = data.top
      .map((p) => {
        const medal = ['🥇', '🥈', '🥉'][p.place - 1] || `${p.place}.`;
        const cls = p.net > 0 ? 'pos' : p.net < 0 ? 'neg' : '';
        return `<div class="user-row">
          <div style="width:26px;text-align:center;font-weight:800">${medal}</div>
          <div class="info"><div class="name">${escapeHtml(p.name)}</div><div class="sub">макс. выигрыш ${fmt(p.win)}</div></div>
          <div class="bal ${cls}">${p.net >= 0 ? '+' : ''}${fmt(p.net)}</div>
        </div>`;
      })
      .join('');
  } catch {
    wrap.innerHTML = '<div class="small muted">Не удалось загрузить топ.</div>';
  }
}

async function historyModal() {
  const wrap = document.createElement('div');
  wrap.innerHTML = spinner();
  modal({ title: '🧾 История ставок', content: wrap });
  try {
    const data = await api('/history?limit=50', { silent: true });
    if (!data.items.length) {
      wrap.innerHTML = '<div class="small muted">Ставок пока не было.</div>';
      return;
    }
    wrap.innerHTML = data.items
      .map((h) => {
        const delta = (h.payout || 0) - (h.bet || 0);
        const cls = delta > 0 ? 'pos' : delta < 0 ? 'neg' : '';
        const d = new Date(h.ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        return `<div class="user-row">
          <div class="info"><div class="name">${h.detail || h.game}</div><div class="sub">${d} · ставка ${fmt(h.bet)}</div></div>
          <div class="bal ${cls}">${delta > 0 ? '+' : ''}${fmt(delta)}</div>
        </div>`;
      })
      .join('');
  } catch {
    wrap.innerHTML = '<div class="small muted">Не удалось загрузить историю.</div>';
  }
}

function referralCopy() {
  const bot = state.settings.botUsername || '';
  const text = bot
    ? `Заходи в казино: @${bot} → напиши /start ${state.user.id}`
    : `Заходи в казино и напиши боту /start ${state.user.id}`;
  copyText(text).then(() => toast('Ссылка скопирована', 'ok'));
}

function supportChat() {
  const bot = state.settings.botUsername || '';
  if (bot && app.openTelegramLink) {
    app.openTelegramLink(`https://t.me/${bot.replace(/^@/, '')}`);
    return;
  }
  copyText(bot ? `@${bot}` : 'Напиши хозяину казино в Wiftgram').then(() =>
    toast('Контакт скопирован — напиши хозяину', 'ok')
  );
}

onScreen('profile', { enter: () => { renderProfile(); } });
onScreen('home', { enter: () => renderHome() });
onScreen('withdraw', { enter: () => renderWithdraw() });

bootstrap();
