/* Haptic / sound / motion — единый слой эффектов. Никаких blur-фильтров. */
import { app, state } from './core.js';

export const devFlags = {
  reduceMotion: false,
  showGrid: false,
  showHitboxes: false,
  network: 0,
  offline: false,
  abOnboarding: 'short',
  abCashout: 'gold',
  newMascot: true,
};

const log = [];
export function devLog(event, data = '', level = '') {
  const line = { t: new Date().toISOString().slice(11, 19), event, data, level };
  log.push(line);
  if (log.length > 200) log.shift();
  window.__ggdevLog = log;
  window.dispatchEvent(new CustomEvent('dev:log', { detail: line }));
}
export function devLogs() { return log.slice(); }

export function reducedMotion() {
  try {
    return devFlags.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch { return devFlags.reduceMotion; }
}

export function haptic(kind = 'light') {
  try { app.haptic(kind); } catch {}
}

let ctx = null;
let audioReady = false;
export function initAudio() {
  if (audioReady) return;
  audioReady = true;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  } catch { ctx = null; }
}
window.addEventListener('pointerdown', initAudio, { once: true, passive: true });

function tone(freq, duration, type = 'sine', gain = 0.045, delay = 0) {
  if (!ctx || state.settings?.muted) return;
  try {
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration / 1000);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration / 1000 + 0.02);
  } catch {}
}

export function sfx(name) {
  if (reducedMotion() && name !== 'error') return;
  if (name === 'click') tone(880, 40, 'sine', 0.04);
  else if (name === 'tick') tone(1200, 25, 'triangle', 0.03);
  else if (name === 'cashout') { tone(660, 90, 'sine', 0.05); tone(880, 90, 'sine', 0.05, 0.07); tone(1320, 120, 'sine', 0.05, 0.14); }
  else if (name === 'crash') { tone(180, 160, 'sine', 0.045); tone(90, 120, 'triangle', 0.03, 0.05); }
  else if (name === 'error') tone(220, 120, 'sine', 0.035);
  else if (name === 'toggle') tone(1000, 18, 'sine', 0.025);
}

export function ripple(host, event) {
  if (reducedMotion() || !host) return;
  const r = document.createElement('span');
  r.className = 'fx-ring';
  const box = host.getBoundingClientRect();
  r.style.left = `${(event?.clientX || box.left + box.width / 2) - box.left - 12}px`;
  r.style.top = `${(event?.clientY || box.top + box.height / 2) - box.top - 12}px`;
  host.appendChild(r);
  setTimeout(() => r.remove(), 340);
}

export function burst(host) {
  if (reducedMotion() || !host) return;
  const n = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i += 1) {
    const c = document.createElement('span');
    c.className = 'fx-coin';
    c.style.left = `${host.clientWidth / 2 - 5 + (Math.random() * 40 - 20)}px`;
    c.style.top = `${host.clientHeight / 2 - 5 + (Math.random() * 20 - 10)}px`;
    c.style.setProperty('--dx', `${Math.random() * 120 - 60}px`);
    c.style.setProperty('--dy', `${-60 - Math.random() * 90}px`);
    host.appendChild(c);
    setTimeout(() => c.remove(), 520);
  }
}

export function floatText(host, text, kind = 'win') {
  if (!host) return;
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = `position:absolute;left:0;right:0;top:38%;text-align:center;font-size:22px;font-weight:800;letter-spacing:-.04em;color:${kind === 'lose' ? 'var(--danger)' : 'var(--success)'};pointer-events:none;animation:floatUp 700ms var(--ease-out) forwards;z-index:5`;
  if (!document.getElementById('fxFloatKeyframes')) {
    const st = document.createElement('style');
    st.id = 'fxFloatKeyframes';
    st.textContent = '@keyframes floatUp{from{opacity:0;transform:translateY(10px) scale(.9)}25%{opacity:1}to{opacity:0;transform:translateY(-56px) scale(1.02)}}';
    document.head.appendChild(st);
  }
  host.appendChild(el);
  setTimeout(() => el.remove(), 720);
}

export function applyMotionFlags() {
  document.body.classList.toggle('reduce-motion', reducedMotion());
  document.body.classList.toggle('show-grid', devFlags.showGrid);
  document.body.classList.toggle('show-hitboxes', devFlags.showHitboxes);
}
