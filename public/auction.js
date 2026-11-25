/* Аукцион: лоты любых игроков, ставки и сгоревшие перебитые ставки. */
import { app, state, api, toast, fmt, onScreen, escapeHtml } from './core.js';

const $ = (id) => document.getElementById(id);

let started = false;
let lots = [];
let lot = null;
let selectedId = '';
let clock = null;
let clockReloading = false;
let busy = false;

const STATUS_LABEL = { active: 'Лот активен', sold: 'Продан', canceled: 'Отменён' };
const viewerId = () => Number(state.user?.id || 0);

export function initAuction() {
  if (started) return;
  started = true;

  onScreen('auction', {
    enter: () => {
      load(true);
      if (clock) clearInterval(clock);
      clock = setInterval(refreshClock, 1000);
    },
    leave: () => {
      if (clock) clearInterval(clock);
      clock = null;
    },
  });

  $('aucRefresh')?.addEventListener('click', () => load(true));
  $('aucLotTabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-lot-id]');
    if (!tab) return;
    selectedId = tab.dataset.lotId || '';
    render({ lots, lot: selectedLot(), history: lastHistory, burned: lastBurned });
    refreshClock();
  });
  $('aucBidBtn')?.addEventListener('click', placeBid);
  $('aucAmount')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') placeBid(); });
  $('aucQuick')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-auc-quick]');
    if (!chip) return;
    const input = $('aucAmount');
    if (!input) return;
    input.value = chip.dataset.aucQuick;
    input.focus();
  });
  $('aucCreateBtn')?.addEventListener('click', createLot);
  $('aucFinishBtn')?.addEventListener('click', () => decide('finish'));
  $('aucCancelBtn')?.addEventListener('click', () => decide('cancel'));
}

let lastHistory = [];
let lastBurned = 0;
let lastReserved = 0;

function betLimit() {
  return Math.max(0, Math.min(
    Number(state.settings.maxBet) || 25000,
    Number(state.settings.limits?.auction) || 25000,
  ));
}

function minNext() {
  if (!lot) return Math.max(10, Number(state.settings.minBet) || 10);
  return lot.leader ? Math.max(lot.currentBid + lot.step, lot.minBid) : lot.minBid;
}

function selectedLot() {
  return lots.find((x) => x.id === selectedId) || lots[0] || null;
}

async function load(showError = false) {
  try {
    const data = await api('/auction', { silent: !showError });
    render(data);
  } catch (e) {
    if (showError && e?.code !== 'NETWORK') toast(e.message, 'err');
  }
}

function render(data) {
  lots = Array.isArray(data.lots)
    ? data.lots
    : data.lot ? [data.lot] : [];
  if (selectedId && !lots.some((x) => x.id === selectedId)) selectedId = '';
  lot = selectedLot();
  lastHistory = data.history || [];
  lastBurned = data.burned || 0;
  lastReserved = Number(data.reserved || lot?.reserved || 0);
  const reservedEl = $('aucReserved');
  if (reservedEl) {
    reservedEl.textContent = lastReserved > 0
      ? `В резерве: ${fmt(lastReserved)} ⭐ — деньги не сгорели, они вернутся при отмене лота.`
      : 'Деньги ставки лежат в резерве и не сгорают, пока ты лидируешь.';
  }

  renderTabs(lots);
  renderStage(lot);
  renderBids(lot?.bids || [], lastBurned);
  renderHistory(lastHistory);

  const min = minNext();
  const limit = betLimit();
  const hint = $('aucMinHint');
  if (hint) hint.textContent = lot ? `от ${fmt(min)} ⭐ · лимит ${fmt(limit)}` : `лимит ${fmt(limit)} ⭐`;

  const input = $('aucAmount');
  if (input) {
    input.min = String(min);
    input.max = String(limit);
    if (!input.value || Number(input.value) < min) input.value = String(min);
  }

  const quick = $('aucQuick');
  if (quick) {
    const step = lot?.step || Math.max(10, min);
    const values = lot
      ? [min, min + step * 2, min + step * 5, limit]
        .filter((v, i, arr) => v <= limit && arr.indexOf(v) === i)
        .slice(0, 4)
      : [];
    quick.innerHTML = values.map((v) => `<button type="button" data-auc-quick="${v}">${fmt(v)} ⭐</button>`).join('');
  }

  const own = !!lot && Number(lot.hostId) === viewerId();
  const bidBtn = $('aucBidBtn');
  if (bidBtn) {
    bidBtn.disabled = !lot || own;
    bidBtn.textContent = own
      ? 'Это твой лот'
      : lot ? `Поставить ${fmt(min)} ⭐` : 'Активного лота нет';
  }

  const manage = !!lot && !!lot.canManage;
  const finish = $('aucFinishBtn');
  const cancel = $('aucCancelBtn');
  if (finish) finish.disabled = !manage;
  if (cancel) cancel.disabled = !manage;
  refreshClock();
}

function renderTabs(items) {
  const box = $('aucLotTabs');
  if (!box) return;
  box.classList.toggle('hidden', items.length < 2);
  if (items.length < 2) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = items.map((x) => {
    const active = x.id === lot?.id;
    return `<button type="button" class="auc-lot-tab ${active ? 'auc-lot-tab--active' : ''}" data-lot-id="${escapeHtml(x.id)}">
      <span>${escapeHtml(x.emoji || '🎁')} ${escapeHtml(x.title)}</span>
      <b>${fmt(x.currentBid)} ⭐</b>
    </button>`;
  }).join('');
}

function renderStage(current) {
  const stage = $('aucStage');
  if (!stage) return;

  if (!current) {
    const canCreate = viewerId() > 0;
    stage.innerHTML = `<div class="auc-empty">
      <div><b>🎁</b>Активных лотов нет.<div class="small mt">${canCreate ? 'Выставь подарок в панели ниже.' : 'Игроки скоро выставят новые подарки.'}</div></div>
    </div>`;
    return;
  }

  const done = current.status !== 'active';
  const statusClass = current.status === 'canceled'
    ? 'auc-status--cancel'
    : done ? 'auc-status--done' : '';
  const emoji = escapeHtml(current.emoji || '🎁');
  const host = escapeHtml(current.host?.name || 'Игрок');
  stage.innerHTML = `
    <div class="auc-lot">
      <div class="auc-gift" aria-hidden="true">
        <div class="auc-gift__shadow"></div>
        <div class="auc-gift__cube">
          <div class="auc-gift__face auc-gift__face--back"></div>
          <div class="auc-gift__face auc-gift__face--left"></div>
          <div class="auc-gift__face auc-gift__face--right"></div>
          <div class="auc-gift__face auc-gift__face--top"></div>
          <div class="auc-gift__face auc-gift__face--bottom"></div>
          <div class="auc-gift__face auc-gift__face--front">
            <span class="auc-gift__ribbon auc-gift__ribbon--v"></span>
            <span class="auc-gift__ribbon auc-gift__ribbon--h"></span>
            <span class="auc-gift__emoji">${emoji}</span>
          </div>
        </div>
        <div class="auc-gift__bow"></div>
      </div>
      <div>
        <span class="auc-status ${statusClass}">${STATUS_LABEL[current.status] || current.status}</span>
        <div class="auc-lot__title">${escapeHtml(current.title)}</div>
        <div class="auc-lot__host">Организатор: <b>${host}</b></div>
        ${current.note ? `<div class="auc-lot__note">${escapeHtml(current.note)}</div>` : ''}
        <div class="auc-lot__bid"><b>${fmt(current.currentBid)}</b><span>⭐ ${done ? 'итоговая ставка' : 'текущая ставка'}</span></div>
        <div class="auc-timer" id="aucTimer" data-ends="${Number(current.endsAt) || 0}" data-status="${current.status}"><span>⏱ —</span></div>
        ${current.leader
          ? `<div class="auc-leader">${done ? 'Победитель' : 'Лидер'}: <b>${escapeHtml(current.leader.name)}</b></div>`
          : '<div class="auc-leader">Ставок пока нет</div>'}
      </div>
    </div>`;
}

function refreshClock() {
  const el = $('aucTimer');
  const span = el?.querySelector('span');
  if (!el || !span) return;
  if (el.dataset.status !== 'active') {
    span.textContent = STATUS_LABEL[el.dataset.status] || 'Завершён';
    el.classList.remove('auc-timer--danger');
    return;
  }
  const left = Math.max(0, (Number(el.dataset.ends) || 0) - Date.now());
  const seconds = Math.ceil(left / 1000);
  span.textContent = `⏱ ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  el.classList.toggle('auc-timer--danger', left > 0 && left < 30000);
  if (left <= 0 && !clockReloading) {
    clockReloading = true;
    load(false).finally(() => { clockReloading = false; });
  }
}

function renderBids(bids, burned) {
  const box = $('aucBids');
  if (box) {
    box.innerHTML = bids.length
      ? bids.map((b) => `
        <div class="auc-bid-row ${b.burned ? 'auc-bid-row--burned' : ''} ${b.mine ? 'auc-bid-row--mine' : ''}">
          <span class="auc-bid-row__name">${escapeHtml(b.name)}${b.mine ? ' · ты' : ''}</span>
          <span class="small muted">${new Date(b.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          <span class="auc-bid-row__amount">${b.burned ? '🔥 ' : '⭐ '}${fmt(b.amount)}</span>
        </div>`).join('')
      : '<div class="small muted">Пока нет ставок. Первый ставит от стартовой цены лота.</div>';
  }
  const label = $('aucBurned');
  if (label) label.textContent = `Сгорело: ${fmt(burned)} ⭐`;
}

function renderHistory(items) {
  const box = $('aucHistory');
  if (!box) return;
  box.innerHTML = items.length
    ? items.map((a) => `
      <div class="auc-history__row">
        <span class="auc-name">${escapeHtml(a.emoji || '🎁')} ${escapeHtml(a.title)}</span>
        <span class="auc-who">${a.status === 'canceled' ? 'отменён' : a.winner ? escapeHtml(a.winner.name) : 'нет ставок'}</span>
        <span class="auc-sum">${fmt(a.winner?.amount || a.currentBid || 0)} ⭐</span>
      </div>`).join('')
    : '<div class="small muted">Завершённых лотов пока нет.</div>';
}

async function placeBid() {
  if (busy || !lot) return;
  const input = $('aucAmount');
  const amount = Math.round(Number(input?.value));
  const min = minNext();
  if (!amount || amount < min) {
    toast(`Минимальная ставка: ${fmt(min)} ⭐`, 'err');
    return;
  }
  if (amount > betLimit()) {
    toast(`Лимит ставки: ${fmt(betLimit())} ⭐`, 'err');
    return;
  }

  busy = true;
  const btn = $('aucBidBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Ставка…'; }
  try {
    await api('/auction/bid', { method: 'POST', body: { lotId: lot.id, amount } });
    app.haptic?.('success');
    toast(`Ставка ${fmt(amount)} ⭐ в резерве — не сгорела`, 'ok');
    selectedId = lot.id;
    await load(false);
  } catch {
    await load(false);
  } finally {
    busy = false;
  }
}

async function createLot() {
  const title = ($('aucTitle')?.value || '').trim();
  if (!title) {
    toast('Укажи название подарка', 'err');
    return;
  }
  const body = {
    title,
    note: ($('aucNote')?.value || '').trim(),
    emoji: ($('aucEmoji')?.value || '').trim() || '🎁',
    minutes: Number($('aucMinutes')?.value) || 5,
    minBid: Number($('aucMinBid')?.value) || 100,
    step: Number($('aucStep')?.value) || 50,
  };
  const btn = $('aucCreateBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Выставляем…'; }
  try {
    const r = await api('/auction/create', { method: 'POST', body });
    app.haptic?.('success');
    toast('Подарок выставлен на аукцион', 'ok');
    selectedId = r.lot?.id || '';
    for (const id of ['aucTitle', 'aucNote']) {
      const field = $(id);
      if (field) field.value = '';
    }
    await load(true);
  } catch {} finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Выставить подарок'; }
  }
}

async function decide(action) {
  if (!lot) return;
  const path = action === 'finish' ? '/auction/finish' : '/auction/cancel';
  const lotId = lot.id;
  const btn = action === 'finish' ? $('aucFinishBtn') : $('aucCancelBtn');
  if (btn) btn.disabled = true;
  try {
    await api(path, { method: 'POST', body: { lotId } });
    app.haptic?.('success');
    toast(action === 'finish' ? 'Аукцион завершён' : 'Лот отменён', 'ok');
    selectedId = '';
    await load(true);
  } catch {
    await load(false);
  }
}
