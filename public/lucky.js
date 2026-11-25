/* Lucky Wheel (бесплатный спин раз в 24ч) + NFT-коллекция в профиле. */
import { app, state, api, toast, fmt, money, onScreen, escapeHtml } from './core.js';
import { haptic, sfx, burst, reducedMotion, devLog } from './fx.js';

const $ = (id) => document.getElementById(id);

/* Зеркало src/games/wheel.js — только для отрисовки колеса */
const SECTORS = [
  { m: 0, color: '#050912' }, { m: 0.2, color: '#121F35' }, { m: 0.5, color: '#18273F' },
  { m: 1, color: '#38E1FF' }, { m: 1.5, color: '#43E39A' }, { m: 2, color: '#8BA0BF' },
  { m: 3, color: '#FFC76A' }, { m: 5, color: '#EDF3FF' }, { m: 0, color: '#0B1424' },
  { m: 10, color: '#FF5C7A' }, { m: 50, color: '#FFC76A' },
];
const SEG = 360 / SECTORS.length;

const NFT_EMOJI = {
  'Космокот': '🐱', 'Звёздный пёс': '🐶', 'Милый череп': '💀', 'Неоновая рыбка': '🐟',
  'Кибер-лис': '🦊', 'Кристальный кит': '🐋', 'Робо-обезьяна': '🐒',
  'Обезьяна-маг': '🦍', 'Кибер-дракон': '🐉', 'Звёздный самурай': '⚔️',
  'Крипто-кот OG': '😼', 'Король черепов': '👑', 'Легенда TON': '💎',
};
const RARITY_LABEL = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };

const lucky = { rotation: 0, busy: false, timer: null };

function buildWheel() {
  const el = $('luckyWheel');
  if (!el || el.dataset.built) return;
  el.dataset.built = '1';
  const stops = SECTORS.map((s, i) => `${s.color} ${i * SEG}deg ${(i + 1) * SEG}deg`).join(', ');
  el.style.background = `conic-gradient(from 0deg, ${stops})`;
  // насечки секторов
  el.style.boxShadow = '0 0 0 6px #0B1424, 0 0 0 7px rgba(255,255,255,.08), 0 12px 32px rgba(0,0,0,.45)';
}

function renderLuckyState() {
  const u = state.user;
  const btn = $('luckySpinBtn');
  const hint = $('luckyHint');
  const cd = $('luckyCooldown');
  if (!u || !btn) return;
  if (u.luckyReady) {
    btn.disabled = false;
    btn.textContent = 'Крутить';
    hint.textContent = 'Бесплатный спин доступен';
    if (cd) cd.textContent = '';
  } else {
    btn.disabled = true;
    btn.textContent = 'Жди';
    hint.textContent = 'Бесплатное колесо раз в 24 часа';
    const h = Math.ceil((u.luckyIn || 0) / 3600000);
    if (cd) cd.textContent = `следующий спин через ~${h} ч`;
  }
}

async function spinLucky() {
  if (lucky.busy) return;
  const u = state.user;
  if (u && !u.luckyReady) return toast(`Колесо обновится через ${Math.ceil((u.luckyIn || 0) / 3600000)} ч`, 'err');
  lucky.busy = true;
  const btn = $('luckySpinBtn');
  btn.disabled = true;
  try {
    const r = await api('/lucky/spin', { method: 'POST' });
    const wheel = $('luckyWheel');
    buildWheel();
    // Целевая позиция: центр сектора index должен оказаться под указателем (top = 0deg)
    const segCenter = r.index * SEG + SEG / 2;
    const delta = ((360 - segCenter) % 360 + 360) % 360;
    lucky.rotation += 360 * 5 + delta - (lucky.rotation % 360);
    wheel.style.transition = reducedMotion() ? 'none' : 'transform 4.4s cubic-bezier(.12,.72,.08,1)';
    wheel.style.transform = `rotate(${lucky.rotation}deg)`;
    $('luckyHub').textContent = '…';
    haptic('medium');
    sfx('click');
    await new Promise((res) => setTimeout(res, reducedMotion() ? 50 : 4500));
    $('luckyHub').textContent = 'GO';
    const prizeEl = $('luckyPrize');
    prizeEl.textContent = r.prize > 0 ? `+${fmt(r.prize)} ⭐` : 'Мимо…';
    prizeEl.className = `lucky-prize ${r.prize > 0 ? 'win' : ''}`;
    if (r.prize > 0) {
      haptic('success');
      sfx('cashout');
      burst(wheel);
      if ((r.prize || 0) >= 3000) { coinsRainSmall(); }
    } else {
      haptic('light');
      sfx('error');
    }
    if (r.nft) {
      toast(`NFT-дроп: ${r.nft.name} [${RARITY_LABEL[r.nft.rarity] || r.nft.rarity}]`, 'ok');
    }
    devLog('lucky', `spin → ${r.label} +${r.prize}`, r.prize > 0 ? 'ok' : '');
    if (window.__renderNfts) window.__renderNfts();
  } catch (e) {
    devLog('lucky', e.message, 'err');
  } finally {
    lucky.busy = false;
    renderLuckyState();
  }
}

function coinsRainSmall() {
  const host = document.createElement('div');
  host.className = 'coins-rain';
  for (let i = 0; i < 26; i++) {
    const c = document.createElement('span');
    c.className = 'coin-drop';
    c.style.left = `${Math.random() * 100}%`;
    c.style.animationDuration = `${1.5 + Math.random() * 1.5}s`;
    c.style.animationDelay = `${Math.random() * 0.6}s`;
    host.appendChild(c);
  }
  document.body.appendChild(host);
  setTimeout(() => host.remove(), 3600);
}

export function renderNfts() {
  const grid = $('nftGrid');
  const count = $('nftCount');
  const nfts = state.user?.nfts || [];
  if (count) count.textContent = nfts.length ? `${nfts.length}` : '';
  if (!grid) return;
  if (!nfts.length) {
    grid.innerHTML = '<div class="nft-empty">Пока пусто — крупные выигрыши дропают NFT</div>';
    return;
  }
  grid.innerHTML = nfts.map((n) => `
    <div class="nft-card" data-rarity="${escapeHtml(n.rarity || 'common')}" data-nft="${escapeHtml(n.id)}">
      <span class="nft-card__emoji">${NFT_EMOJI[n.name] || ({ legendary: '👑', epic: '💜', rare: '💎', common: '✨' }[n.rarity] || '✨')}</span>
      <span class="nft-card__name">${escapeHtml(n.name)}</span>
      <span class="nft-card__rarity">${RARITY_LABEL[n.rarity] || n.rarity}</span>
    </div>`).join('');
}

function wireNftTilt() {
  const grid = $('nftGrid');
  if (!grid || grid.dataset.tilt) return;
  grid.dataset.tilt = '1';
  grid.addEventListener('pointermove', (e) => {
    const card = e.target.closest('.nft-card');
    if (!card || reducedMotion()) return;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    card.style.transform = `perspective(400px) rotateY(${x * 18}deg) rotateX(${-y * 18}deg) translateZ(4px)`;
  });
  grid.addEventListener('pointerleave', () => {
    grid.querySelectorAll('.nft-card').forEach((c) => { c.style.transform = ''; });
  });
}

export function initLucky() {
  buildWheel();
  wireNftTilt();
  $('luckySpinBtn')?.addEventListener('click', spinLucky);
  window.__renderNfts = renderNfts;
  renderNfts();
  renderLuckyState();
  clearInterval(lucky.timer);
  lucky.timer = setInterval(() => {
    if (state.screen === 'profile') renderLuckyState();
  }, 60000);
  onScreen('profile', { enter() { renderNfts(); renderLuckyState(); } });
}
