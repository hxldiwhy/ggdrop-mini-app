/* Панель хозяина казино (доступна только владельцу). */
import { state, api, toast, fmt, money, modal, onScreen } from './core.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let data = null;
let players = [];
let activeTab = 'overview';
let searchTimer = null;

export function initAdmin() {
  onScreen('admin', { enter: () => loadAll() });
  window.addEventListener('admin-tab', (e) => {
    activeTab = e.detail;
    if (e.detail === 'players') loadPlayers();
    if (e.detail === 'promos' && data) renderPromos();
    if (e.detail === 'settings' && data) renderSettings();
    if (e.detail === 'broadcast') renderBroadcast();
    if (e.detail === 'deposits') loadDepositsAdmin();
    if (e.detail === 'withdrawals') loadWithdrawalsAdmin();
  });
  window.addEventListener('admin-refresh', () => loadAll());
}

async function loadAll() {
  if (!state.user?.isOwner) return;
  try {
    const res = await api('/admin/overview', { silent: true });
    data = res.data;
    renderOverview();
    if (activeTab === 'settings') renderSettings();
    if (activeTab === 'promos') renderPromos();
    if (activeTab === 'players') loadPlayers();
  } catch (e) {
    if (e.status === 403) toast('Доступ только у хозяина', 'err');
  }
}

function renderOverview() {
  const d = data;
  if (!d) return;
  const box = $('adminOverview');
  const games = Object.entries(d.byGame || {})
    .map(([k, v]) => `<div class="kv"><span class="kv__k">${esc(k)}</span><span class="kv__v">${fmt(v.bet)} → ${fmt(v.payout)}</span></div>`)
    .join('') || '<div class="small muted">Пока нет ставок</div>';

  box.innerHTML = `
    <div class="stat-grid mb">
      <div class="stat"><div class="stat__label">Игроков</div><div class="stat__value">${fmt(d.users)}</div></div>
      <div class="stat"><div class="stat__label">GGR</div><div class="stat__value ${d.ggr >= 0 ? 'pos' : 'neg'}">${fmt(d.ggr)}</div></div>
      <div class="stat"><div class="stat__label">Оборот</div><div class="stat__value">${fmt(d.wagered)}</div></div>
      <div class="stat"><div class="stat__label">Выплачено</div><div class="stat__value">${fmt(d.paid)}</div></div>
      <div class="stat"><div class="stat__label">Ставок</div><div class="stat__value">${fmt(d.totalBets)}</div></div>
      <div class="stat"><div class="stat__label">В банках</div><div class="stat__value gold">${fmt(d.balances)}</div></div>
      <div class="stat"><div class="stat__label">В хранилище</div><div class="stat__value">${fmt(d.vaultTotal || 0)}</div></div>
      <div class="stat"><div class="stat__label">Комиссий</div><div class="stat__value">${fmt(d.feesTotal || 0)}</div></div>
    </div>

    <div class="panel">
      <div class="row row--between mb">
        <div class="panel__title" style="font-size:13px">Сегодня</div>
        <span class="badge ${d.maintenance ? 'off' : 'on'}">${d.maintenance ? 'ТЕХРЕЖИМ' : 'ОТКРЫТО'}</span>
      </div>
      <div class="kv"><span class="kv__k">Ставок</span><span class="kv__v">${fmt(d.todayBets)}</span></div>
      <div class="kv"><span class="kv__k">Оборот</span><span class="kv__v">${fmt(d.todayWagered)}</span></div>
      <div class="kv"><span class="kv__k">Выплаты</span><span class="kv__v">${fmt(d.todayPaid)}</span></div>
      <div class="kv"><span class="kv__k">Заявок на вывод</span><span class="kv__v">${(d.withdrawals || []).length}</span></div>
      <div class="kv"><span class="kv__k">Валюта</span><span class="kv__v">${esc(d.currency)}</span></div>
      <div class="kv"><span class="kv__k">Ставки</span><span class="kv__v">${d.minBet} – ${d.maxBet}</span></div>
      <div class="kv"><span class="kv__k">Публичный адрес</span><span class="kv__v" style="max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.publicUrl || 'не задан')}</span></div>
    </div>

    <div class="panel">
      <div class="panel__title" style="font-size:13px">По играм</div>
      ${games}
      <div class="small muted mt">Краш: раунд #${d.crash?.roundId || 0}, текущая точка x${d.crash?.crashPoint || 0}</div>
    </div>
  `;
}

/* ─── игроки ─────────────────────────────────────────────────────────────── */
async function loadPlayers(q = '') {
  try {
    const res = await api(`/admin/users?q=${encodeURIComponent(q)}`, { silent: true });
    players = res.users || [];
    renderPlayers();
  } catch {
    $('adminPlayers').innerHTML = '<div class="panel small muted">Не удалось загрузить игроков</div>';
  }
}

function renderPlayers() {
  const box = $('adminPlayers');
  box.innerHTML = `
    <div class="panel">
      <input type="text" id="adminSearch" placeholder="Поиск: id, @username, имя" value="" />
      <div class="small muted mt">Найди игрока, чтобы выдать фишки, изменить баланс или забанить.</div>
    </div>
    <div id="adminPlayersList"></div>
  `;
  const search = $('adminSearch');
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadPlayers(search.value), 350);
  });
  const list = $('adminPlayersList');
  if (!players.length) {
    list.innerHTML = '<div class="panel small muted">Никого не найдено</div>';
    return;
  }
  list.innerHTML = players
    .map(
      (u) => `<div class="user-row">
        <div class="info">
          <div class="name">${esc(u.username ? '@' + u.username : u.firstName || 'id' + u.id)} ${u.isOwner ? '👑' : ''} ${u.banned ? '🚫' : ''}</div>
          <div class="sub">id ${u.id} · игр ${u.games || 0} · ставок ${fmt(u.totalBet)}${u.vault ? ` · банк ${fmt(u.vault)}` : ''}</div>
        </div>
        <div class="bal">${fmt(u.balance)}</div>
        <button class="chip-btn" data-user="${u.id}">⚙️</button>
      </div>`
    )
    .join('');
  list.querySelectorAll('[data-user]').forEach((btn) => {
    btn.onclick = () => openUser(Number(btn.dataset.user));
  });
}

function openUser(id) {
  const u = players.find((p) => p.id === id);
  if (!u) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="kv"><span class="kv__k">Баланс</span><span class="kv__v gold">${fmt(u.balance)}</span></div>
    <div class="kv"><span class="kv__k">Банк (излишек)</span><span class="kv__v">${fmt(u.vault || 0)}</span></div>
    <div class="kv"><span class="kv__k">Оборот</span><span class="kv__v">${fmt(u.totalBet)}</span></div>
    <div class="kv"><span class="kv__k">Выигрыши</span><span class="kv__v">${fmt(u.totalWin)}</span></div>
    <label class="field mt">Сумма</label>
    <input type="number" id="admAmount" value="1000" inputmode="numeric" />
    <div class="row mt" style="gap:6px">
      <button class="btn btn--sm btn--green" style="flex:1" id="admCredit">+ Выдать</button>
      <button class="btn btn--sm btn--red" style="flex:1" id="admDebit">− Списать</button>
      <button class="btn btn--sm btn--ghost" style="flex:1" id="admSet">= Баланс</button>
    </div>
    ${u.vault ? '<button class="btn btn--sm btn--ghost btn--block mt" id="admVault">Перевести из банка на баланс</button>' : ''}
    <button class="btn btn--sm btn--block mt ${u.banned ? 'btn--green' : 'btn--red'}" id="admBan">${u.banned ? 'Разблокировать' : 'Заблокировать'}</button>
    <div class="small muted mt">Профиль: ${esc(u.firstName || '')} ${u.username ? '@' + u.username : ''}<br/>id ${u.id}</div>
  `;
  const close = modal({ title: '👤 Игрок', content: wrap });
  const amount = () => Math.round(Number(wrap.querySelector('#admAmount').value) || 0);
  const act = async (action) => {
    try {
      const r = await api('/admin/user', { method: 'POST', body: { id: u.id, action, amount: amount() } });
      toast(`Баланс игрока: ${fmt(r.user.balance)}`, 'ok');
      await loadPlayers($('adminSearch')?.value || '');
      await loadAll();
      close();
    } catch {}
  };
  wrap.querySelector('#admCredit').onclick = () => act('credit');
  wrap.querySelector('#admDebit').onclick = () => act('debit');
  wrap.querySelector('#admSet').onclick = () => act('set');
  wrap.querySelector('#admVault')?.addEventListener('click', () => act('vault'));
  wrap.querySelector('#admBan').onclick = () => act(u.banned ? 'unban' : 'ban');
}

/* ─── заявки на вывод ───────────────────────────────────────────────────── */
async function loadWithdrawalsAdmin() {
  const box = $('adminWithdrawals');
  if (!box) return;
  box.innerHTML = '<div class="skeleton" style="height:140px"></div>';
  try {
    const r = await api('/admin/withdrawals', { silent: true });
    renderWithdrawalsAdmin(r.withdrawals || [], r.history || []);
  } catch {
    box.innerHTML = '<div class="panel small muted">Не удалось загрузить заявки</div>';
  }
}

function renderWithdrawalsAdmin(list, history) {
  const box = $('adminWithdrawals');
  const cashier = data?.cashierUsername || 'crypt';
  const when = (ts) => new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const pending = list.length
    ? list
        .map(
          (w) => `<div class="wd-admin-row">
            <div class="wd-admin-row__main">
              <div class="name">#${esc(w.id)} · ${esc(w.userName)}</div>
              <div class="sub">id ${w.userId} · ${when(w.createdAt)}${w.contact ? ` · ${esc(w.contact)}` : ''}</div>
            </div>
            <div class="bal gold">${fmt(w.net ?? w.amount)} ⭐${w.fee ? `<div class="small muted">комиссия ${fmt(w.fee)}</div>` : ''}</div>
            <button class="chip-btn" data-wd-ok="${esc(w.id)}" title="Выплачено">✅</button>
            <button class="chip-btn" data-wd-no="${esc(w.id)}" title="Отклонить с возвратом">✕</button>
          </div>`
        )
        .join('')
    : '<div class="small muted">Новых заявок нет</div>';
  const hist = history.length
    ? history
        .map(
          (w) => `<div class="user-row">
            <div class="info"><div class="name">#${esc(w.id)} · ${esc(w.userName)}</div><div class="sub">${when(w.decidedAt)}</div></div>
            <div class="bal">${fmt(w.net ?? w.amount)} ⭐${w.fee ? `<div class="small muted">комиссия ${fmt(w.fee)}</div>` : ''}</div>
            <span class="st ${w.status === 'approved' ? 'approved' : 'rejected'}">${w.status === 'approved' ? 'выплачено' : 'возврат'}</span>
          </div>`
        )
        .join('')
    : '<div class="small muted">Пусто</div>';
  box.innerHTML = `
    <div class="panel">
      <div class="panel__title" style="font-size:13px">💸 Ожидают выплаты (${list.length})</div>
      <div class="small muted">Переведи звёзды игроку и подтверди. При отклонении сумма вернётся на баланс автоматически. Кассир: <b>@${esc(cashier)}</b>.</div>
      <div class="mt">${pending}</div>
    </div>
    <div class="panel">
      <div class="panel__title" style="font-size:13px">История выводов</div>
      <div class="mt">${hist}</div>
    </div>
  `;
  box.querySelectorAll('[data-wd-ok]').forEach((btn) => { btn.onclick = () => decideWithdrawalAdmin(btn.dataset.wdOk, true); });
  box.querySelectorAll('[data-wd-no]').forEach((btn) => { btn.onclick = () => decideWithdrawalAdmin(btn.dataset.wdNo, false); });
}

async function decideWithdrawalAdmin(id, approve) {
  try {
    const r = await api('/admin/withdraw', { method: 'POST', body: { id, approve } });
    toast(approve ? `Отмечено выплаченным: #${r.withdrawal.id}` : 'Отклонено, звёзды возвращены', approve ? 'ok' : '');
    await loadWithdrawalsAdmin();
    await loadAll();
  } catch {}
}

/* ─── заявки на пополнение ───────────────────────────────────────────────── */
async function loadDepositsAdmin() {
  const box = $('adminDeposits');
  if (!box) return;
  box.innerHTML = '<div class="skeleton" style="height:140px"></div>';
  try {
    const r = await api('/admin/deposits', { silent: true });
    renderDepositsAdmin(r.deposits || [], r.history || []);
  } catch {
    box.innerHTML = '<div class="panel small muted">Не удалось загрузить заявки</div>';
  }
}

function renderDepositsAdmin(list, history) {
  const box = $('adminDeposits');
  const cashier = data?.cashierUsername || 'crypt';
  const when = (ts) =>
    new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  const pending = list.length
    ? list
        .map(
          (d) => `<div class="user-row">
            <div class="info">
              <div class="name">#${esc(d.id)} · ${esc(d.userName)}</div>
              <div class="sub">id ${d.userId} · ${when(d.createdAt)}</div>
            </div>
            <div class="bal">${fmt(d.amount)} ⭐</div>
            <button class="chip-btn" data-dep-ok="${esc(d.id)}" title="Зачислить">✅</button>
            <button class="chip-btn" data-dep-no="${esc(d.id)}" title="Отклонить">✕</button>
          </div>`
        )
        .join('')
    : '<div class="small muted">Новых заявок нет</div>';

  const hist = history.length
    ? history
        .map(
          (d) => `<div class="user-row">
            <div class="info"><div class="name">#${esc(d.id)} · ${esc(d.userName)}</div><div class="sub">${when(d.decidedAt)}</div></div>
            <div class="bal">${fmt(d.amount)} ⭐</div>
            <span class="st ${d.status}">${d.status === 'approved' ? 'зачислено' : 'отклонено'}</span>
          </div>`
        )
        .join('')
    : '<div class="small muted">Пусто</div>';

  box.innerHTML = `
    <div class="panel">
      <div class="panel__title" style="font-size:13px">💳 Ожидают подтверждения (${list.length})</div>
      <div class="small muted">Игрок переводит звёзды на <b>@${esc(cashier)}</b> и создаёт заявку. Проверь перевод — и подтверди.</div>
      <div class="mt">${pending}</div>
    </div>
    <div class="panel">
      <div class="panel__title" style="font-size:13px">История заявок</div>
      <div class="mt">${hist}</div>
    </div>
  `;

  box.querySelectorAll('[data-dep-ok]').forEach((btn) => {
    btn.onclick = () => decideDeposit(btn.dataset.depOk, true);
  });
  box.querySelectorAll('[data-dep-no]').forEach((btn) => {
    btn.onclick = () => decideDeposit(btn.dataset.depNo, false);
  });
}

async function decideDeposit(id, approve) {
  try {
    const r = await api('/admin/deposit', { method: 'POST', body: { id, approve } });
    toast(approve ? `Зачислено ${fmt(r.deposit.amount)} ⭐` : 'Заявка отклонена', approve ? 'ok' : '');
    await loadDepositsAdmin();
    await loadAll();
  } catch {}
}

/* ─── настройки ──────────────────────────────────────────────────────────── */
function renderSettings() {
  const d = data;
  const box = $('adminSettings');
  if (!d) return;
  box.innerHTML = `
    <div class="panel">
      <div class="panel__title" style="font-size:13px">Лимиты ставок</div>
      <div class="row mt" style="gap:8px">
        <div style="flex:1"><label class="field">Мин</label><input type="number" id="setMinBet" value="${d.minBet}" /></div>
        <div style="flex:1"><label class="field">Макс</label><input type="number" id="setMaxBet" value="${d.maxBet}" /></div>
      </div>
      <label class="field mt">Валюта</label>
      <input type="text" id="setCurrency" value="${esc(d.currency)}" maxlength="8" />
    </div>

    <div class="panel">
      <div class="panel__title" style="font-size:13px">Бонусы</div>
      <div class="row mt" style="gap:8px">
        <div style="flex:1"><label class="field">Дневной</label><input type="number" id="setDailyBonus" value="${d.dailyBonus}" /></div>
        <div style="flex:1"><label class="field">Новичку</label><input type="number" id="setWelcomeBonus" value="${d.welcomeBonus}" /></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel__title" style="font-size:13px">🏦 Кошелёк и вывод</div>
      <div class="small muted">Потолок баланса снят. При выплате заявки удерживается комиссия 13% — игрок видит её в истории.</div>
      <div class="row mt" style="gap:8px">
        <div style="flex:1"><label class="field">Мин. вывод ⭐</label><input type="number" id="setMinWithdraw" value="${d.minWithdraw || 1000}" /></div>
        <div style="flex:1"><label class="field">Макс. вывод ⭐</label><input type="number" id="setMaxWithdraw" value="${d.maxWithdraw || 1000000}" /></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel__title" style="font-size:13px">⭐ Пополнение звёзд</div>
      <div class="small muted">Игрок пишет кассиру и отправляет оффер, после этого подтверждаешь заявку.</div>
      <label class="field mt">Ник кассира (без @)</label>
      <input type="text" id="setCashier" value="${esc(d.cashierUsername || 'crypt')}" />
      <div class="row mt" style="gap:8px">
        <div style="flex:1"><label class="field">Мин. сумма</label><input type="number" id="setMinDeposit" value="${d.minDeposit || 100}" /></div>
        <div style="flex:1"><label class="field">Макс. сумма</label><input type="number" id="setMaxDeposit" value="${d.maxDeposit || 1000000}" /></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel__title" style="font-size:13px">Преимущество казино</div>
      <div class="small muted">Сколько процентов остаётся казино в среднем. 0.03 = 3%.</div>
      ${['roulette', 'crash', 'blackjack', 'wheel', 'plinko', 'coinflip']
        .map(
          (k) => `<div class="row mt" style="gap:8px;align-items:center">
            <div style="flex:1" class="small">${k}</div>
            <input type="number" step="0.005" min="0" max="0.25" id="setEdge_${k}" value="${d.houseEdge[k]}" style="width:100px" />
          </div>`
        )
        .join('')}
    </div>

    <div class="panel">
      <div class="panel__title" style="font-size:13px">Тайминги краша</div>
      <div class="row mt" style="gap:8px">
        <div style="flex:1"><label class="field">Приём ставок, с</label><input type="number" id="setBettingMs" value="${Math.round((d.crashTimings?.bettingMs || 8000) / 1000)}" /></div>
        <div style="flex:1"><label class="field">Пауза, с</label><input type="number" id="setCooldownMs" value="${Math.round((d.crashTimings?.cooldownMs || 5000) / 1000)}" /></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel__title" style="font-size:13px">Публичный адрес приложения</div>
      <div class="small muted">HTTPS-адрес, по которому открывается мини-приложение (туннель или твой домен).</div>
      <input type="text" id="setPublicUrl" class="mt" placeholder="https://example.com" value="${esc(d.publicUrl || '')}" />
    </div>

    <div class="panel">
      <div class="row row--between">
        <div>
          <div class="panel__title" style="font-size:13px">Режим техобслуживания</div>
          <div class="small muted">Ставки принимает только хозяин.</div>
        </div>
        <button class="btn btn--sm ${d.maintenance ? 'btn--red' : 'btn--ghost'}" id="setMaintenance">${d.maintenance ? 'Выключить' : 'Включить'}</button>
      </div>
    </div>

    <button class="btn btn--block btn--lg" id="setSave">Сохранить настройки</button>
  `;

  const maintBtn = $('setMaintenance');
  let maintenance = d.maintenance;
  maintBtn.onclick = () => {
    maintenance = !maintenance;
    maintBtn.textContent = maintenance ? 'Выключить' : 'Включить';
    maintBtn.className = `btn btn--sm ${maintenance ? 'btn--red' : 'btn--ghost'}`;
  };

  $('setSave').onclick = async () => {
    const body = {
      minBet: Number($('setMinBet').value),
      maxBet: Number($('setMaxBet').value),
      currency: $('setCurrency').value.trim() || '⭐',
      dailyBonus: Number($('setDailyBonus').value),
      welcomeBonus: Number($('setWelcomeBonus').value),
      cashierUsername: ($('setCashier')?.value || '').trim().replace(/^@/, ''),
      minDeposit: Number($('setMinDeposit')?.value || 100),
      maxDeposit: Number($('setMaxDeposit')?.value || 1000000),
      maxBalance: 0,
      minWithdraw: Number($('setMinWithdraw')?.value || 1000),
      maxWithdraw: Number($('setMaxWithdraw')?.value || 1000000),
      storageFee: { enabled: false, threshold: 100000, percentPerDay: 0 },
      maintenance,
      publicUrl: $('setPublicUrl').value.trim(),
      bettingMs: Math.max(3, Number($('setBettingMs').value) || 8) * 1000,
      cooldownMs: Math.max(1, Number($('setCooldownMs').value) || 5) * 1000,
      houseEdge: {},
    };
    for (const k of ['roulette', 'crash', 'blackjack', 'wheel', 'plinko', 'coinflip']) {
      body.houseEdge[k] = Number($(`setEdge_${k}`).value);
    }
    try {
      const r = await api('/admin/settings', { method: 'POST', body });
      state.settings = { ...state.settings, ...r.settings };
      toast('Настройки сохранены', 'ok');
      await loadAll();
    } catch {}
  };
}

/* ─── промокоды ──────────────────────────────────────────────────────────── */
function renderPromos() {
  const d = data;
  const box = $('adminPromos');
  const promos = d?.promos || [];
  box.innerHTML = `
    <div class="panel">
      <div class="panel__title" style="font-size:13px">Новый промокод</div>
      <div class="row mt" style="gap:8px">
        <div style="flex:1.2"><label class="field">Код</label><input type="text" id="promoCode" placeholder="WELCOME" style="text-transform:uppercase" /></div>
        <div style="flex:1"><label class="field">Сумма</label><input type="number" id="promoAmount" value="1000" /></div>
        <div style="flex:1"><label class="field">Активаций</label><input type="number" id="promoUses" value="10" /></div>
      </div>
      <button class="btn btn--block mt" id="promoCreate">Создать</button>
    </div>
    <div class="panel">
      <div class="panel__title" style="font-size:13px">Активные</div>
      ${promos.length
        ? promos
            .map(
              (p) => `<div class="user-row">
                <div class="info"><div class="name">${esc(p.code)}</div><div class="sub">+${fmt(p.amount)} · использован ${(p.usedBy || []).length}/${p.uses || '∞'}</div></div>
                <button class="chip-btn" data-delpromo="${esc(p.code)}">✕</button>
              </div>`
            )
            .join('')
        : '<div class="small muted">Пока нет</div>'}
    </div>
  `;
  $('promoCreate').onclick = async () => {
    try {
      await api('/admin/promo', {
        method: 'POST',
        body: {
          code: $('promoCode').value.trim().toLowerCase(),
          amount: Number($('promoAmount').value),
          uses: Number($('promoUses').value),
        },
      });
      toast('Промокод создан', 'ok');
      await loadAll();
    } catch {}
  };
  box.querySelectorAll('[data-delpromo]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        await api('/admin/promo', { method: 'POST', body: { code: btn.dataset.delpromo, delete: true } });
        toast('Удалён', 'ok');
        await loadAll();
      } catch {}
    };
  });
}

/* ─── рассылка ───────────────────────────────────────────────────────────── */
function renderBroadcast() {
  const box = $('adminBroadcast');
  box.innerHTML = `
    <div class="panel">
      <div class="panel__title" style="font-size:13px">📣 Рассылка всем игрокам</div>
      <div class="small muted">Отправится в чат каждому, кто не забанен.</div>
      <textarea id="bcText" rows="4" placeholder="Текст сообщения…" style="width:100%;margin-top:10px;background:rgba(0,0,0,.3);border:1px solid var(--line);border-radius:12px;padding:12px;color:var(--text);font-family:inherit;font-size:14px;resize:vertical"></textarea>
      <button class="btn btn--block mt" id="bcSend">Отправить</button>
    </div>
  `;
  $('bcSend').onclick = async () => {
    const text = $('bcText').value.trim();
    if (!text) return toast('Введи текст', 'err');
    try {
      const r = await api('/admin/broadcast', { method: 'POST', body: { text } });
      toast(`Отправлено: ${r.recipients}`, 'ok');
      $('bcText').value = '';
    } catch {}
  };
}
