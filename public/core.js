/* Ядро мини-приложения: состояние, API, роутер, тосты, модалки. */

export const app = window.WiftgramApp || { ready() {}, expand() {}, haptic() {} };

/** Идентификатор этого клиента: ссылку из бота нельзя открыть под другим аккаунтом. */
export function deviceId() {
  try {
    let id = localStorage.getItem('ggdrop_device');
    if (!id) {
      id = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 80);
      localStorage.setItem('ggdrop_device', id);
    }
    return id;
  } catch {
    return 'unknown-device';
  }
}

export const state = {
  token: localStorage.getItem('ggdrop_token') || '',
  user: null,
  settings: {
    currency: 'WFT', minBet: 10, maxBet: 25000, limits: {}, dailyBonus: 0,
    maxBalance: 0, storageFee: { enabled: false, threshold: 100000, percentPerDay: 0 },
    minWithdraw: 1000, maxWithdraw: 1000000,
  },
  screen: 'home',
  bootstrapQuery: new URLSearchParams(location.search),
  busy: false,
};

const hooks = {};
const GAME_SCREENS = new Set(['crash', 'roulette', 'blackjack', 'wheel', 'plinko', 'coinflip']);

export function onScreen(name, handlers) {
  hooks[name] = handlers;
}

/** Последняя игра — для быстрого возврата из лобби (паттерн TG mini apps). */
export function lastGame() {
  try {
    const name = localStorage.getItem('ggdrop_last_game') || '';
    return GAME_SCREENS.has(name) && document.getElementById(`screen-${name}`) ? name : '';
  } catch { return ''; }
}

const nf = new Intl.NumberFormat('ru-RU');
export const fmt = (n) => nf.format(Math.round(Number(n) || 0)).replace(/\u00a0/g, ' ');
export const money = (n) => `${fmt(n)} ${state.settings.currency || 'WFT'}`;
export const mult = (n) => `${Number(n).toFixed(n >= 100 ? 0 : 2)}x`;

/** Максимальная ставка: общий лимит и лимит конкретной игры. */
export function maxBetFor(game) {
  const s = state.settings || {};
  const values = [
    Number(s.maxBet) || 0,
    Number(game ? s.limits?.[game] : s.maxBet) || Number(s.maxBet) || 0,
  ];
  return Math.max(0, Math.min(...values.filter((v) => v > 0)));
}
export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class ApiFail extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body, silent = false } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
        ...(app.initData ? { 'X-Wiftgram-Init-Data': app.initData } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    if (!silent) toast('Нет связи с сервером', 'err');
    throw new ApiFail('Нет связи с сервером', 'NETWORK', 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    throw new ApiFail('Некорректный ответ сервера', 'BAD_JSON', res.status);
  }
  if (!data || !data.ok) {
    const err = new ApiFail(data?.description || data?.error || 'Ошибка', data?.error, res.status);
    if (res.status === 401) {
      if (err.code === 'ACCOUNT_MISMATCH' || err.code === 'ACCOUNT_CHECK') {
        sessionExpired('Не свой аккаунт', 'Эта ссылка из бота привязана к другому игроку. Открой казино кнопкой в своём Wiftgram.');
      } else {
        sessionExpired();
      }
    }
    if (!silent) toast(err.message, 'err');
    throw err;
  }
  if (data.user) updateUser(data.user);
  if (data.settings) state.settings = { ...state.settings, ...data.settings };
  if (data.balance !== undefined && state.user) state.user.balance = data.balance;
  return data;
}

/* ─── UI helpers ─────────────────────────────────────────────────────────── */
export function toast(text, kind = '') {
  const root = document.getElementById('toasts');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  const icon = kind === 'err' ? '⚠️' : kind === 'ok' ? '✅' : 'ℹ️';
  el.innerHTML = `<span>${icon}</span><span></span>`;
  el.lastElementChild.textContent = text;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), 260);
  }, 2600);
}

export function updateUser(user) {
  if (!user) return;
  const prev = state.user?.balance;
  state.user = { ...(state.user || {}), ...user };
  renderHeader();
  if (prev !== undefined && prev !== user.balance) flashBalance();
  if (state.screen === 'profile') renderProfile();
  window.dispatchEvent(new CustomEvent('ui:user', { detail: user }));
}

export function renderHeader() {
  const u = state.user;
  if (!u) return;
  const el = document.getElementById('balanceValue');
  if (el) el.textContent = fmt(u.balance);
  document.querySelectorAll('[data-balance]').forEach((n) => { n.textContent = fmt(u.balance); });
  const adminTab = document.getElementById('tabAdmin');
  if (adminTab) adminTab.classList.toggle('hidden', !u.isOwner);
  const limits = document.getElementById('homeLimits');
  if (limits) limits.textContent = `${state.settings.minBet}–${fmt(maxBetFor())}`;
  const streakPill = document.getElementById('streakPill');
  if (streakPill) {
    const days = Number(u.streak) || 0;
    streakPill.classList.toggle('hidden', days < 1);
    const sd = document.getElementById('streakDays');
    if (sd) sd.textContent = fmt(days);
  }
  document.getElementById('rouletteMax') && (document.getElementById('rouletteMax').textContent = fmt(maxBetFor('roulette')));
}

function flashBalance() {
  const pill = document.getElementById('balancePill');
  if (!pill) return;
  pill.classList.remove('flash');
  void pill.offsetWidth;
  pill.classList.add('flash');
}

export function setScreen(name, { push = true } = {}) {
  if (!document.getElementById(`screen-${name}`)) name = 'home';
  const prev = state.screen;
  if (prev === name) return;
  if (hooks[prev]?.leave) hooks[prev].leave();
  state.screen = name;
  if (GAME_SCREENS.has(name)) {
    try { localStorage.setItem('ggdrop_last_game', name); } catch {}
  }
  document.documentElement.dataset.screen = name;
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.dataset.screen === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.go === name));
  window.dispatchEvent(new CustomEvent('screenchange', { detail: name }));
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (push && location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  if (hooks[name]?.enter) hooks[name].enter();
}

export function sessionExpired(title = 'Сессия истекла', text = 'Открой казино заново из бота — кнопка «Открыть казино» в сообщении.') {
  const old = document.getElementById('session-error');
  if (old) old.remove();
  const root = document.getElementById('app');
  if (!root) return;
  root.innerHTML = `
    <div class="error-screen" id="session-error">
      <div>
        <div class="emoji">🔒</div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(text)}</p>
      </div>
    </div>`;
}

/* Модалка-шторка */
export function modal({ title, sub = '', content, actions = [] }) {
  const root = document.getElementById('modalRoot');
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.innerHTML = `<div class="sheet__title"></div>${sub ? '<div class="sheet__sub"></div>' : ''}<div class="sheet__body"></div>`;
  sheet.querySelector('.sheet__title').textContent = title;
  if (sub) sheet.querySelector('.sheet__sub').textContent = sub;
  const bodyEl = sheet.querySelector('.sheet__body');
  if (typeof content === 'string') bodyEl.innerHTML = content;
  else if (content) bodyEl.appendChild(content);

  const close = () => {
    overlay.style.opacity = '0';
    sheet.style.transform = 'translateY(100%)';
    setTimeout(() => overlay.remove(), 240);
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  actions.forEach((a) => {
    const btn = document.createElement('button');
    btn.className = `btn ${a.className || ''} btn--block`;
    btn.style.marginTop = '8px';
    btn.textContent = a.text;
    btn.onclick = async () => {
      if (a.onClick) {
        const keep = await a.onClick();
        if (keep === false) return;
      }
      close();
    };
    bodyEl.appendChild(btn);
  });

  overlay.appendChild(sheet);
  root.appendChild(overlay);
  return close;
}

export function confirmDialog(title, text, okText = 'Подтвердить') {
  return new Promise((resolve) => {
    let done = false;
    const close = modal({
      title,
      sub: text,
      content: '',
      actions: [
        { text: okText, className: 'btn--red', onClick: () => { done = true; resolve(true); } },
        { text: 'Отмена', className: 'btn--ghost', onClick: () => { if (!done) resolve(false); } },
      ],
    });
    const overlay = document.querySelector('.overlay:last-child');
    if (overlay) {
      const mo = new MutationObserver(() => {
        if (!document.body.contains(overlay)) {
          mo.disconnect();
          if (!done) resolve(false);
        }
      });
      mo.observe(document.getElementById('modalRoot'), { childList: true });
    }
  });
}

export function spinner() {
  const d = document.createElement('div');
  d.className = 'center muted small';
  d.style.padding = '18px';
  d.textContent = 'Загрузка…';
  return d;
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  return fallbackCopy(text);
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch {}
  ta.remove();
  return Promise.resolve();
}

/* Ставка: сумма из input или последняя сохранённая */
export function readBet(inputId, fallback = 100) {
  const el = document.getElementById(inputId);
  const v = Math.round(Number(el?.value));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function setBet(inputId, value) {
  const el = document.getElementById(inputId);
  if (el) el.value = String(Math.max(1, Math.round(value)));
}

export function rememberBet(key, value) {
  try { localStorage.setItem(`bet_${key}`, String(value)); } catch {}
}
export function lastBet(key, fallback = 100) {
  const v = Number(localStorage.getItem(`bet_${key}`));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
