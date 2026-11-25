import { ApiError } from './wiftgram.js';
import { miniAppUrl } from './auth.js';
import { CasinoError } from './errors.js';
import { fmtMoney, escapeHtml, sleep, shortName } from './utils.js';
import { CONFIG } from './config.js';

const APP_BUTTON = '🎰 Открыть казино';

export class Bot {
  constructor({ engine, store, api, log = console }) {
    this.engine = engine;
    this.store = store;
    this.api = api;
    this.log = log;
    this.running = false;
    this.offset = Number(store.data.meta?.updateOffset || 0);
    this.pending = new Map();
    this.me = null;
    this._lastBigWinNotify = 0;
    this.botUsername = '';
  }

  get settings() { return this.store.settings; }

  baseUrl() {
    return (this.settings.publicUrl || CONFIG.publicUrl || '').replace(/\/+$/, '');
  }

  appUrl(userId) {
    const base = this.baseUrl();
    if (!base) return '';
    const direct = miniAppUrl(base, userId, 'app');
    if (!CONFIG.pagesUrl) return direct;
    // Стабильная ссылка ведёт на GitHub Pages, который знает текущий бэкенд
    // из параметра u. При смене туннеля бот обновляет кнопку с новым адресом.
    const token = new URL(direct).searchParams.get('t') || '';
    const pages = new URL(CONFIG.pagesUrl);
    pages.searchParams.set('u', base);
    if (token) pages.searchParams.set('t', token);
    return pages.toString();
  }

  // ─── запуск ─────────────────────────────────────────────────────────────────
  async start() {
    this.me = await this.api.getMe();
    this.botUsername = this.me.username || '';
    if (this.botUsername && this.store.settings.botUsername !== this.botUsername) {
      this.store.settings = { botUsername: this.botUsername };
    }
    this.log.info?.(`[bot] Подключён: @${this.me.username} (id ${this.me.id})`);
    await this.setupCommands();
    this.running = true;
    this.engine.on('broadcast', ({ text }) => this.broadcast(text));
    this.engine.on('bigwin', (info) => this.notifyBigWin(info));
    this.engine.on('deposit:new', (dep) => this.notifyDeposit(dep));
    this.engine.on('deposit:decided', (dep) => this.notifyDepositDecided(dep));
    this.engine.on('withdraw:new', (wd) => this.notifyWithdrawal(wd));
    this.engine.on('withdraw:decided', (wd) => this.notifyWithdrawalDecided(wd));
    if (this.settings.ownerId) {
      const u = this.store.user(this.settings.ownerId);
      if (u) u.isOwner = true;
    }
    this.pollLoop().catch((e) => this.log.error?.('[bot] polling остановлен:', e));
  }

  async stop() {
    this.running = false;
  }

  async setupCommands() {
    const commands = [
      { command: 'start', description: 'Запустить казино' },
      { command: 'play', description: 'Открыть мини-приложение' },
      { command: 'balance', description: 'Мой баланс' },
      { command: 'daily', description: 'Ежедневный бонус' },
      { command: 'top', description: 'Топ игроков' },
      { command: 'promo', description: 'Активировать промокод' },
      { command: 'topup', description: 'Пополнить звёзды' },
      { command: 'withdraw', description: 'Вывести звёзды' },
      { command: 'help', description: 'Помощь' },
    ];
    try { await this.api.setMyCommands(commands); } catch (e) { this.log.warn?.('[bot] setMyCommands:', e.message); }
  }

  async pollLoop() {
    // Wiftgram-прокси рвёт длинные HTTP-соединения, из-за чего long polling
    // регулярно падал с "fetch failed". Короткий опрос каждые 1.5 с стабильнее:
    // запрос быстро завершается, а сетевые обрывы не блокируют бота на минуты.
    let failures = 0;
    while (this.running) {
      try {
        const updates = await this.api.getUpdates(this.offset, 0);
        failures = 0;
        if (Array.isArray(updates) && updates.length) {
          for (const u of updates) {
            this.offset = Math.max(this.offset, (u.update_id || 0) + 1);
            try {
              await this.handleUpdate(u);
            } catch (err) {
              this.log.error?.('[bot] update error:', err.message);
            }
          }
          this.store.data.meta.updateOffset = this.offset;
          this.store.save();
          await sleep(120);
        } else {
          await sleep(1500);
        }
      } catch (err) {
        if (err instanceof ApiError && err.code === 401) {
          this.log.error?.('[bot] Токен не принят:', err.description);
          await sleep(15000);
          continue;
        }
        failures += 1;
        // Не засоряем журнал каждой сетевой ошибкой: пишем только первую
        // в серии и затем ждём с нарастающей паузой.
        if (failures === 1) {
          const code = err instanceof ApiError ? ` (${err.code})` : '';
          this.log.warn?.(`[bot] опрос не удался${code}:`, err.message);
        }
        await sleep(Math.min(8000, 1200 * failures));
      }
    }
  }

  // ─── отправка ───────────────────────────────────────────────────────────────
  async send(chatId, text, extra = {}) {
    try {
      return await this.api.sendMessage(chatId, text, extra);
    } catch (err) {
      if (err instanceof ApiError && /parse_mode|entit/i.test(err.description || '')) {
        const { parse_mode, ...rest } = extra;
        return this.api.sendMessage(chatId, text.replace(/<[^>]+>/g, ''), rest);
      }
      throw err;
    }
  }

  async sendApp(chatId, text, rows = []) {
    const url = this.appUrl(chatId);
    if (!url) {
      const note = this.engine.isOwner(chatId)
        ? '\n\n⚠️ <b>Публичный адрес не настроен.</b>\nЗапусти <code>scripts\\tunnel.ps1</code> или впиши HTTPS-адрес в админке: /seturl https://...'
        : '\n\n⏳ Хозяин ещё настраивает казино, загляни чуть позже.';
      return this.send(chatId, text + note, { reply_markup: { inline_keyboard: rows } });
    }
    const keyboard = { inline_keyboard: [[{ text: APP_BUTTON, web_app: { url } }], ...rows] };
    try {
      return await this.api.sendMessage(chatId, text, { reply_markup: keyboard });
    } catch (err) {
      if (err instanceof ApiError && /button|keyboard|web_app|webapp|unsupported/i.test(`${err.description}`)) {
        // Синяя кнопка открывает сайт без initData. При строгой проверке
        // аккаунта это ведёт в чужую сессию — ведём игрока в меню бота.
        const note = '\n\n⚠️ Кнопка не поддерживается клиентом. Открой казино через меню бота.';
        return this.api.sendMessage(chatId, text + note);
      }
      throw err;
    }
  }

  async answerCallback(id, text = '', alert = false) {
    try {
      await this.api.answerCallbackQuery(id, { text, show_alert: alert });
    } catch {}
  }

  // ─── обновления ─────────────────────────────────────────────────────────────
  async handleUpdate(update) {
    if (update.message) return this.onMessage(update.message);
    if (update.callback_query) return this.onCallback(update.callback_query);
    if (update.inline_query) {
      return this.api.answerInlineQuery?.(update.inline_query.id, []);
    }
    if (update.pre_checkout_query) {
      return this.api.call('answerPreCheckoutQuery', { pre_checkout_query_id: update.pre_checkout_query.id, ok: false }).catch(() => {});
    }
  }

  async onMessage(msg) {
    const from = msg.from;
    if (!from || from.is_bot) return;
    let user = this.store.ensureUser(from);
    if (!user) return;
    const chatId = msg.chat?.id || from.id;
    const text = (msg.text || '').trim();

    // Хозяин по умолчанию
    if (!this.settings.ownerId) {
      this.store.settings = { ownerId: from.id };
      user.isOwner = true;
      this.store.save();
      await this.send(chatId, `👑 <b>Ты назначен хозяином казино!</b>\nID: <code>${from.id}</code>\n\nТеперь тебе доступны /admin и панель управления в мини-приложении.`);
    } else if (Number(this.settings.ownerId) === from.id && !user.isOwner) {
      user.isOwner = true;
      this.store.save();
    }

    if (msg.web_app_data) {
      return this.send(chatId, `✅ Мини-приложение ответило: <code>${escapeHtml(String(msg.web_app_data.data).slice(0, 300))}</code>`);
    }

    const pending = this.pending.get(from.id);
    if (pending) {
      this.pending.delete(from.id);
      return this.handlePending(chatId, user, pending, text);
    }

    if (!text) {
      return this.sendApp(chatId, '🎰 <b>GGDROP CASINO</b>\nЖми кнопку ниже — там все игры, бонусы и твой баланс.');
    }

    if (!text.startsWith('/')) {
      if (user.banned) return this.send(chatId, '⛔ Аккаунт заблокирован хозяином казино.');
      return this.sendApp(chatId, `💬 Привет, ${escapeHtml(shortName(user))}!\nИгры и ставки — в мини-приложении:`);
    }

    const [rawCmd, ...args] = text.split(/\s+/);
    const cmd = rawCmd.toLowerCase().replace(/@.*$/, '').slice(1);
    try {
      await this.command(cmd, args, chatId, user);
    } catch (err) {
      if (err instanceof CasinoError) return this.send(chatId, `⚠️ ${escapeHtml(err.message)}`);
      this.log.error?.('[bot] command error:', err);
      return this.send(chatId, '⚠️ Что-то пошло не так, попробуй ещё раз.');
    }
  }

  async handlePending(chatId, user, pending, text) {
    if (pending.action === 'broadcast') {
      if (!text) return this.send(chatId, 'Отменено.');
      const r = this.engine.adminBroadcast(user.id, text);
      return this.send(chatId, `📣 Рассылка запущена: ${r.recipients} получателей.`);
    }
    if (pending.action === 'seturl') {
      const url = text.replace(/\/+$/, '');
      if (!/^https?:\/\/[^\s]+$/i.test(url)) {
        return this.send(chatId, '⚠️ Нужен адрес вида <code>https://example.com</code>');
      }
      this.store.settings = { publicUrl: url };
      this.store.save();
      return this.send(chatId, `✅ Адрес мини-приложения: <code>${escapeHtml(url)}</code>\nПроверь кнопку «${APP_BUTTON}».`);
    }
  }

  async command(cmd, args, chatId, user) {
    const owner = this.engine.isOwner(user.id);
    switch (cmd) {
      case 'start':
        return this.cmdStart(chatId, user, args);
      case 'play':
      case 'casino':
      case 'app':
        return this.sendApp(chatId, '🎰 <b>GGDROP CASINO</b>\nСтавки уже ждут. Открывай приложение:');
      case 'balance':
      case 'bal':
      case 'wallet':
        return this.cmdBalance(chatId, user);
      case 'daily':
      case 'bonus':
        return this.cmdDaily(chatId, user);
      case 'top':
      case 'leaderboard':
        return this.cmdTop(chatId);
      case 'profile':
      case 'me':
      case 'stats':
        return this.cmdProfile(chatId, user);
      case 'promo':
      case 'promocode':
        return this.cmdPromo(chatId, user, args);
      case 'pay':
      case 'send':
        return this.cmdPay(chatId, user, args);
      case 'dice':
        return this.cmdDice(chatId, user, args);
      case 'topup':
      case 'deposit':
        return this.cmdTopup(chatId, user);
      case 'deposits':
        if (!owner) return this.send(chatId, '⛔ Только для хозяина.');
        return this.cmdDeposits(chatId);
      case 'withdraw':
        return this.cmdWithdraw(chatId, user, args);
      case 'withdrawals':
        if (!owner) return this.send(chatId, '⛔ Только для хозяина.');
        return this.cmdWithdrawals(chatId);
      case 'help':
        return this.cmdHelp(chatId, user);
      case 'admin':
        return this.cmdAdmin(chatId, user);
      case 'seturl':
        if (!owner) return this.send(chatId, '⛔ Только для хозяина.');
        this.pending.set(user.id, { action: 'seturl' });
        return this.send(chatId, '🔗 Пришли HTTPS-адрес мини-приложения (например, <code>https://xxx.trycloudflare.com</code>):');
      case 'setbal':
      case 'setbalance':
        if (!owner) return this.send(chatId, '⛔ Только для хозяина.');
        return this.cmdSetBal(chatId, args);
      case 'giveall':
        if (!owner) return this.send(chatId, '⛔ Только для хозяина.');
        return this.cmdGiveAll(chatId, args);
      case 'ban':
      case 'unban':
        if (!owner) return this.send(chatId, '⛔ Только для хозяина.');
        return this.cmdBan(chatId, args, cmd === 'ban');
      case 'broadcast':
        if (!owner) return this.send(chatId, '⛔ Только для хозяина.');
        this.pending.set(user.id, { action: 'broadcast' });
        return this.send(chatId, '📣 Пришли текст рассылки (или /cancel):');
      case 'maintenance':
        if (!owner) return this.send(chatId, '⛔ Только для хозяина.');
        return this.cmdMaintenance(chatId, args);
      case 'promonew':
        if (!owner) return this.send(chatId, '⛔ Только для хозяина.');
        return this.cmdPromoNew(chatId, args);
      case 'whoami':
      case 'id':
        return this.send(chatId, `🆔 Твой ID: <code>${user.id}</code>${owner ? ' 👑 (хозяин)' : ''}`);
      case 'cancel':
        this.pending.delete(user.id);
        return this.send(chatId, 'Отменено.');
      default:
        return this.sendApp(chatId, '🤔 Не знаю такой команды. Список: /help');
    }
  }

  // ─── команды ────────────────────────────────────────────────────────────────
  async cmdStart(chatId, user, args = []) {
    const s = this.settings;
    const refId = Number(args[0] || 0);
    if (refId && refId !== user.id && !user.refBy && !user.refCounted) {
      const refUser = this.store.user(refId);
      if (refUser && !refUser.banned) {
        user.refBy = refId;
        user.refCounted = true;
        refUser.refCount = (refUser.refCount || 0) + 1;
        if (s.refBonus > 0) {
          this.store.credit(refUser, s.refBonus, 'ref');
          refUser.refEarned = (refUser.refEarned || 0) + s.refBonus;
          this.send(refUser.id, `👥 По твоей ссылке пришёл ${escapeHtml(shortName(user))}. Бонус: +${fmtMoney(s.refBonus, s.currency)}`).catch(() => {});
        }
        this.store.save();
      }
    }
    if (!user.welcomed && s.welcomeBonus > 0 && user.balance === 0) {
      this.store.credit(user, s.welcomeBonus, 'welcome');
      user.welcomed = true;
      this.store.save();
    }
    const rows = [
      [
        { text: '💰 Баланс', callback_data: 'balance' },
        { text: '⭐ Пополнить', callback_data: 'topup' },
      ],
      [
        { text: '🎁 Бонус', callback_data: 'daily' },
        { text: '🏆 Топ', callback_data: 'top' },
      ],
      [
        { text: '👤 Профиль', callback_data: 'profile' },
        { text: '💸 Вывод', callback_data: 'withdraw' },
      ],
      [
        { text: '🍀 Колесо', callback_data: 'app' },
      ],
    ];
    if (this.engine.isOwner(user.id)) rows.push([{ text: '👑 Панель хозяина', callback_data: 'admin:stats' }]);
    const hello =
      `🎰 <b>GGDROP CASINO</b>\n\n` +
      `Привет, <b>${escapeHtml(shortName(user))}</b>!\n` +
      `Рулетка, краш, кости, блэкджек, колесо, плинко и монетка — всё внутри мини-приложения.\n\n` +
      `💰 Баланс: <b>${fmtMoney(user.balance, s.currency)}</b>` +
      (user.welcomed && s.welcomeBonus > 0 ? `\n🎉 Приветственный бонус +${fmtMoney(s.welcomeBonus, s.currency)} уже начислен!` : '');
    await this.sendApp(chatId, hello, rows);
    this.setupMenuButton(chatId, user.id).catch(() => {});
  }

  async setupMenuButton(chatId, userId) {
    const url = this.appUrl(userId);
    if (!url) return;
    try {
      await this.api.setChatMenuButton({ type: 'web_app', text: 'Казино', web_app: { url } }, chatId);
    } catch {}
  }

  async cmdBalance(chatId, user) {
    const s = this.settings;
    await this.send(
      chatId,
      `💰 <b>Баланс</b>\n\n` +
        `Доступно: <b>${fmtMoney(user.balance, s.currency)}</b>\n` +
        `Всего ставок: ${fmtMoney(user.totalBet, s.currency)}\n` +
        `Выиграно: ${fmtMoney(user.totalWin, s.currency)}\n` +
        `Игр: ${user.games || 0} (побед ${user.wins || 0})`,
      { reply_markup: { inline_keyboard: [[{ text: '🎰 Открыть казино', callback_data: 'app' }]] } }
    );
  }

  async cmdDaily(chatId, user) {
    try {
      const r = this.engine.daily(user.id);
      await this.send(chatId, `🎁 <b>Бонус получен!</b>\n+${fmtMoney(r.amount, this.settings.currency)}\n\n💰 Баланс: <b>${fmtMoney(r.balance, this.settings.currency)}</b>`);
    } catch (err) {
      if (err instanceof CasinoError) return this.send(chatId, `⏳ ${escapeHtml(err.message)}`);
      throw err;
    }
  }

  async cmdTop(chatId) {
    const top = this.store.leaderboard(10);
    if (!top.length) return this.send(chatId, '🏆 Пока никто не играл — стань первым!');
    const lines = top.map((u, i) => {
      const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
      const net = (u.totalWin || 0) - (u.totalBet || 0);
      return `${medal} ${escapeHtml(shortName(u))} — ${net >= 0 ? '+' : ''}${fmtMoney(net, this.settings.currency)}`;
    });
    await this.send(chatId, `🏆 <b>Топ игроков</b>\n\n${lines.join('\n')}`);
  }

  async cmdProfile(chatId, user) {
    const s = this.settings;
    const net = (user.totalWin || 0) - (user.totalBet || 0);
    const winrate = user.games ? Math.round((user.wins / user.games) * 100) : 0;
    await this.send(
      chatId,
      `👤 <b>Профиль</b>\n\n` +
        `Имя: ${escapeHtml(shortName(user))}\n` +
        `ID: <code>${user.id}</code>\n` +
        `Баланс: <b>${fmtMoney(user.balance, s.currency)}</b>\n` +
        `Игр: ${user.games || 0} · Winrate: ${winrate}%\n` +
        `Оборот: ${fmtMoney(user.totalBet, s.currency)}\n` +
        `Профит: ${net >= 0 ? '+' : ''}${fmtMoney(net, s.currency)}\n` +
        `Максимальный выигрыш: ${fmtMoney(user.biggestWin, s.currency)}\n` +
        `Приглашено друзей: ${user.refCount || 0}`
    );
  }

  async cmdPromo(chatId, user, args) {
    const code = args[0];
    if (!code) return this.send(chatId, '🎟 Использование: <code>/promo КОД</code>');
    try {
      const r = this.engine.redeemPromo(user.id, code);
      await this.send(chatId, `🎟 Промокод активирован!\n+${fmtMoney(r.amount, this.settings.currency)}\n\n💰 Баланс: <b>${fmtMoney(r.balance, this.settings.currency)}</b>`);
    } catch (err) {
      if (err instanceof CasinoError) return this.send(chatId, `⚠️ ${escapeHtml(err.message)}`);
      throw err;
    }
  }

  async cmdPay(chatId, user, args) {
    const targetRaw = args[0];
    const amount = Math.round(Number(args[1]));
    if (!targetRaw || !amount) return this.send(chatId, '💸 Использование: <code>/pay 123456789 500</code> или <code>/pay @username 500</code>');
    let target = null;
    if (/^\d+$/.test(targetRaw)) target = this.store.user(Number(targetRaw));
    else if (targetRaw.startsWith('@')) {
      const uname = targetRaw.slice(1).toLowerCase();
      target = this.store.users().find((u) => (u.username || '').toLowerCase() === uname) || null;
    }
    if (!target) return this.send(chatId, '⚠️ Получатель не найден. Он должен хотя бы раз зайти в бота.');
    try {
      const r = this.engine.transfer(user.id, target.id, amount);
      await this.send(chatId, `💸 Переведено <b>${fmtMoney(amount, this.settings.currency)}</b> игроку ${escapeHtml(shortName(target))}\n💰 Твой баланс: <b>${fmtMoney(r.balance, this.settings.currency)}</b>`);
      this.send(target.id, `💸 Тебе перевели <b>${fmtMoney(amount, this.settings.currency)}</b> от ${escapeHtml(shortName(user))}`).catch(() => {});
    } catch (err) {
      if (err instanceof CasinoError) return this.send(chatId, `⚠️ ${escapeHtml(err.message)}`);
      throw err;
    }
  }

  async cmdDice(chatId, user, args) {
    const amount = Math.round(Number(args[0]) || 0);
    if (!amount) {
      return this.send(chatId, '🎲 Быстрая игра: <code>/dice 100</code> — ставка на «больше 50».\nАзартнее — в мини-приложении: /play');
    }
    const over = args[1] !== 'under';
    try {
      const r = this.engine.rollDice(user.id, { amount, target: 50, over });
      const head = r.win ? `🎉 <b>Победа!</b> x${r.multiplier}` : `😕 <b>Проигрыш</b>`;
      await this.send(
        chatId,
        `${head}\n\n🎲 Бросок: <b>${r.roll}</b> (${over ? 'больше' : 'меньше'} 50)\n` +
          `${r.win ? `Выигрыш: +${fmtMoney(r.payout - r.totalBet, this.settings.currency)}\n` : ''}` +
          `💰 Баланс: <b>${fmtMoney(r.balance, this.settings.currency)}</b>`
      );
    } catch (err) {
      if (err instanceof CasinoError) return this.send(chatId, `⚠️ ${escapeHtml(err.message)}`);
      throw err;
    }
  }

  async cmdTopup(chatId, user) {
    const cashier = this.settings.cashierUsername || 'crypt';
    const url = this.appUrl(chatId);
    const text =
      `⭐ <b>Пополнение звёзд</b>\n\n` +
      `Баланс: <b>${fmtMoney(user.balance, this.settings.currency)}</b>\n\n` +
      `Пополнение идёт через хозяина казино:\n` +
      `1️⃣ Открой мини-приложение → «Пополнить» и создай заявку с суммой.\n` +
      `2️⃣ Напиши <b>@${escapeHtml(cashier)}</b> и отправь оффер/подарок со звёздами на эту сумму.\n` +
      `3️⃣ Хозяин подтвердит — звёзды сразу упадут на баланс.`;
    const rows = [];
    if (url) rows.push([{ text: '⭐ Открыть пополнение', web_app: { url: `${url}&view=topup` } }]);
    rows.push([{ text: `Скопировать @${cashier}`, callback_data: 'cashier' }]);
    try {
      if (url) return this.api.sendMessage(chatId, text, { reply_markup: { inline_keyboard: rows } });
    } catch {}
    return this.send(chatId, text, { reply_markup: { inline_keyboard: rows } });
  }

  async cmdDeposits(chatId) {
    const list = this.engine.pendingDeposits(20);
    if (!list.length) return this.send(chatId, '💳 Открытых заявок на пополнение нет.');
    const lines = list.map(
      (d) => `#${d.id} · ${escapeHtml(d.userName)} · <b>${fmtMoney(d.amount, this.settings.currency)}</b> · <code>${d.userId}</code>`
    );
    const keyboard = {
      inline_keyboard: list.slice(0, 8).map((d) => [
        { text: `✅ ${d.amount} · ${d.id}`, callback_data: `dep:ok:${d.id}` },
        { text: '❌', callback_data: `dep:no:${d.id}` },
      ]),
    };
    return this.send(chatId, `💳 <b>Заявки на пополнение</b>\n\n${lines.join('\n')}`, { reply_markup: keyboard });
  }

  async cmdWithdraw(chatId, user, args = []) {
    const s = this.settings;
    const min = Math.max(1, Number(s.minWithdraw) || 1000);
    const max = Math.min(Number(s.maxWithdraw) || 150000, this.store.balanceCap());
    const url = this.appUrl(user.id);
    const amount = Math.round(Number(args[0] || 0));
    if (amount > 0) {
      try {
        const wd = this.engine.createWithdrawal(user.id, { amount, contact: args.slice(1).join(' ') || '' });
        return this.send(
          chatId,
          `💸 Заявка <b>#${wd.id}</b> на ${fmtMoney(wd.amount, s.currency)} создана.\n\n` +
            `Сумма уже зарезервирована. Напиши <b>@${escapeHtml(s.cashierUsername || 'crypt')}</b> и укажи номер заявки — хозяин выплатит звёзды вручную. ` +
            `Если заявку отклонят — звёзды вернутся на баланс.`
        );
      } catch (err) {
        if (err instanceof CasinoError) return this.send(chatId, `⚠️ ${escapeHtml(err.message)}`);
        throw err;
      }
    }
    const text =
      `💸 <b>Вывод звёзд</b>\n\n` +
      `Баланс: <b>${fmtMoney(user.balance, s.currency)}</b>${user.vault ? `\nВ банке: ${fmtMoney(user.vault, s.currency)}` : ''}\n` +
      `Лимит на вывод: ${min} – ${max} ⭐\n\n` +
      `1️⃣ Открой вкладку «Вывод» в мини-приложении и создай заявку.\n` +
      `2️⃣ Сумма резервируется сразу, повторно её потратить нельзя.\n` +
      `3️⃣ Напиши <b>@${escapeHtml(s.cashierUsername || 'crypt')}</b>, укажи номер заявки — хозяин выплатит звёзды.\n` +
      `4️⃣ При отклонении звёзды возвращаются на баланс.`;
    const rows = [];
    if (url) rows.push([{ text: '💸 Открыть вывод', web_app: { url: `${url}&view=withdraw` } }]);
    return this.send(chatId, text, rows.length ? { reply_markup: { inline_keyboard: rows } } : {});
  }

  async cmdWithdrawals(chatId) {
    const list = this.engine.pendingWithdrawals(20);
    if (!list.length) return this.send(chatId, '💸 Открытых заявок на вывод нет.');
    const lines = list.map(
      (w) => `#${w.id} · ${escapeHtml(w.userName)} · <b>${fmtMoney(w.amount, this.settings.currency)}</b> · <code>${w.userId}</code>${w.contact ? `\n   ${escapeHtml(w.contact)}` : ''}`
    );
    const keyboard = {
      inline_keyboard: list.slice(0, 8).map((w) => [
        { text: `✅ Выплачено · ${w.id}`, callback_data: `wd:ok:${w.id}` },
        { text: '❌ Отклонить', callback_data: `wd:no:${w.id}` },
      ]),
    };
    return this.send(chatId, `💸 <b>Заявки на вывод</b>\n\n${lines.join('\n')}`, { reply_markup: keyboard });
  }

  async cmdHelp(chatId, user) {
    await this.send(
      chatId,
      `ℹ️ <b>Команды</b>\n\n` +
        `/play — открыть казино\n` +
        `/balance — баланс\n` +
        `/daily — бонус раз в сутки\n` +
        `/top — топ игроков\n` +
        `/profile — статистика\n` +
        `/promo КОД — промокод\n` +
        `/pay ID СУММА — перевод\n` +
        `/dice СУММА — быстрая игра\n` +
        `/topup — как пополнить звёзды\n` +
        `/withdraw СУММА — заявка на вывод\n` +
        (this.engine.isOwner(user.id) ? `\n👑 <b>Хозяин</b>\n/admin — панель\n/deposits — заявки на пополнение\n/withdrawals — заявки на вывод\n/seturl — адрес приложения\n/setbal ID СУММА\n/giveall СУММА\n/ban ID · /unban ID\n/broadcast — рассылка\n/maintenance on|off` : '')
    );
  }

  async cmdAdmin(chatId, user) {
    if (!this.engine.isOwner(user.id)) return this.send(chatId, '⛔ Только для хозяина казино.');
    const st = this.store.stats();
    const url = this.appUrl(user.id);
    const rows = [
      [{ text: '📊 Статистика', callback_data: 'admin:stats' }, { text: '👥 Игроки', callback_data: 'admin:users' }],
      [{ text: '📣 Рассылка', callback_data: 'admin:bc' }, { text: '⚙️ Настройки', callback_data: 'admin:settings' }],
    ];
    if (url) rows.push([{ text: '👑 Панель хозяина', web_app: { url: `${url}&admin=1` } }]);
    await this.sendApp(
      chatId,
      `👑 <b>Панель хозяина</b>\n\n` +
        `👥 Игроков: <b>${st.users}</b> (за сутки ${st.active})\n` +
        `🎰 Ставок: ${st.totalBets} на ${fmtMoney(st.wagered, this.settings.currency)}\n` +
        `💸 Выплачено: ${fmtMoney(st.paid, this.settings.currency)}\n` +
        `📈 GGR: <b>${fmtMoney(st.ggr, this.settings.currency)}</b>\n` +
        `💼 В банках игроков: ${fmtMoney(st.balances, this.settings.currency)}\n` +
        `🎯 Мин/макс ставка: ${this.settings.minBet} / ${this.settings.maxBet}\n` +
        `🛠 Режим: ${this.settings.maintenance ? 'техобслуживание' : 'открыто'}\n` +
        `🌐 Адрес: <code>${escapeHtml(this.baseUrl() || 'не задан')}</code>`,
      rows
    );
  }

  async cmdSetBal(chatId, args) {
    const id = Number(args[0]);
    const amount = Math.round(Number(args[1]));
    if (!id || !Number.isFinite(amount)) return this.send(chatId, 'Использование: <code>/setbal 1780243335 10000</code>');
    try {
      const r = this.engine.adminUserAction(this.settings.ownerId, id, 'set', amount);
      await this.send(chatId, `✅ Баланс ${escapeHtml(shortName(r.user))} = <b>${fmtMoney(r.user.balance, this.settings.currency)}</b>`);
      this.send(id, `👑 Хозяин установил твой баланс: <b>${fmtMoney(r.user.balance, this.settings.currency)}</b>`).catch(() => {});
    } catch (err) {
      if (err instanceof CasinoError) return this.send(chatId, `⚠️ ${escapeHtml(err.message)}`);
      throw err;
    }
  }

  async cmdGiveAll(chatId, args) {
    const amount = Math.round(Number(args[0]));
    if (!Number.isFinite(amount) || amount === 0) return this.send(chatId, 'Использование: <code>/giveall 1000</code>');
    const users = this.store.users().filter((u) => !u.banned);
    for (const u of users) this.store.credit(u, amount, 'admin-give');
    await this.send(chatId, `✅ Начислено ${fmtMoney(amount, this.settings.currency)} всем игрокам (${users.length}).`);
  }

  async cmdBan(chatId, args, ban) {
    const id = Number(args[0]);
    if (!id) return this.send(chatId, `Использование: <code>/${ban ? 'ban' : 'unban'} 1780243335</code>`);
    try {
      const r = this.engine.adminUserAction(this.settings.ownerId, id, ban ? 'ban' : 'unban');
      await this.send(chatId, `${ban ? '🚫 Заблокирован' : '✅ Разблокирован'}: ${escapeHtml(shortName(r.user))}`);
    } catch (err) {
      if (err instanceof CasinoError) return this.send(chatId, `⚠️ ${escapeHtml(err.message)}`);
      throw err;
    }
  }

  async cmdMaintenance(chatId, args) {
    const on = /^(on|1|true|вкл)$/i.test(args[0] || '');
    const off = /^(off|0|false|выкл)$/i.test(args[0] || '');
    if (!on && !off) return this.send(chatId, 'Использование: <code>/maintenance on</code> или <code>/maintenance off</code>');
    this.store.settings = { maintenance: on };
    await this.send(chatId, on ? '🛠 Режим техобслуживания включён — ставки принимает только хозяин.' : '✅ Казино снова открыто для всех.');
  }

  async cmdPromoNew(chatId, args) {
    const [code, amount, uses] = args;
    try {
      const p = this.engine.adminCreatePromo(this.settings.ownerId, { code, amount, uses });
      await this.send(chatId, `🎟 Промокод <code>${p.code}</code> создан: +${fmtMoney(p.amount, this.settings.currency)}, активаций: ${p.uses || '∞'}`);
    } catch (err) {
      if (err instanceof CasinoError) return this.send(chatId, `⚠️ ${escapeHtml(err.message)}`);
      throw err;
    }
  }

  // ─── callbacks ──────────────────────────────────────────────────────────────
  async onCallback(q) {
    const user = this.store.ensureUser(q.from);
    const chatId = q.message?.chat?.id || q.from.id;
    const data = q.data || '';
    try {
      if (data === 'app') {
        await this.answerCallback(q.id, 'Открываю казино…');
        return this.sendApp(chatId, '🎰 <b>GGDROP CASINO</b>\nВыбирай игру:');
      }
      if (data === 'topup') {
        await this.answerCallback(q.id);
        return this.cmdTopup(chatId, user);
      }
      if (data === 'cashier') {
        return this.answerCallback(q.id, `@${this.settings.cashierUsername}`, true);
      }
      if (data.startsWith('dep:')) {
        if (!this.engine.isOwner(user.id)) return this.answerCallback(q.id, 'Только хозяин казино', true);
        const [, act, id] = data.split(':');
        try {
          const dep = this.engine.decideDeposit(user.id, id, act === 'ok');
          await this.answerCallback(q.id, act === 'ok' ? `Зачислено ${dep.amount} ⭐` : 'Заявка отклонена');
          if (q.message) {
            const status = act === 'ok' ? '✅ Зачислено' : '❌ Отклонено';
            const old = (q.message.text || '').replace(/<[^>]+>/g, '').split('\nПроверь')[0];
            this.api
              .editMessageText(q.message.chat.id, q.message.message_id, `${old}\n\n${status}`)
              .catch(() => {});
          }
        } catch (err) {
          await this.answerCallback(q.id, err.message || 'Ошибка', true);
        }
        return;
      }
      if (data.startsWith('wd:')) {
        if (!this.engine.isOwner(user.id)) return this.answerCallback(q.id, 'Только хозяин казино', true);
        const [, act, id] = data.split(':');
        try {
          const wd = this.engine.decideWithdrawal(user.id, id, act === 'ok');
          await this.answerCallback(q.id, act === 'ok' ? `Выплачено ${wd.amount} ⭐` : 'Отклонено, звёзды возвращены');
          if (q.message) {
            const status = act === 'ok' ? '✅ Выплачено' : '❌ Отклонено · возврат';
            const old = (q.message.text || '').replace(/<[^>]+>/g, '').split('\nПроверь')[0];
            this.api
              .editMessageText(q.message.chat.id, q.message.message_id, `${old}\n\n${status}`)
              .catch(() => {});
          }
        } catch (err) {
          await this.answerCallback(q.id, err.message || 'Ошибка', true);
        }
        return;
      }
      if (data === 'balance') {
        await this.answerCallback(q.id);
        return this.cmdBalance(chatId, user);
      }
      if (data === 'daily') {
        await this.answerCallback(q.id);
        return this.cmdDaily(chatId, user);
      }
      if (data === 'top') {
        await this.answerCallback(q.id);
        return this.cmdTop(chatId);
      }
      if (data === 'profile') {
        await this.answerCallback(q.id);
        return this.cmdProfile(chatId, user);
      }
      if (data.startsWith('admin:')) {
        if (!this.engine.isOwner(user.id)) return this.answerCallback(q.id, 'Только для хозяина', true);
        await this.answerCallback(q.id);
        const sub = data.slice(6);
        if (sub === 'stats') {
          const st = this.store.stats();
          return this.send(
            chatId,
            `📊 <b>Статистика</b>\n\nИгроков: ${st.users} (активных ${st.active})\nЗабанено: ${st.banned}\n` +
              `Ставок: ${st.totalBets}\nОборот: ${fmtMoney(st.wagered, this.settings.currency)}\n` +
              `Выплачено: ${fmtMoney(st.paid, this.settings.currency)}\nGGR: <b>${fmtMoney(st.ggr, this.settings.currency)}</b>\n` +
              `Сегодня: ${st.todayBets} ставок, оборот ${fmtMoney(st.todayWagered, this.settings.currency)}\n\n` +
              `🎰 Рулетка: ${st.rounds.roulette || 0}\n💥 Краш: ${st.rounds.crash || 0}\n` +
              `🎲 Кости: ${st.rounds.dice || 0}\n🃏 Блэкджек: ${st.rounds.blackjack || 0}\n` +
              `🍀 Колесо: ${st.rounds.wheel || 0}\n🔻 Плинко: ${st.rounds.plinko || 0}\n◐ Монетка: ${st.rounds.coinflip || 0}`
          );
        }
        if (sub === 'users') {
          const list = this.store.users().sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0)).slice(0, 15);
          const lines = list.map((u) => `${u.banned ? '🚫' : '•'} ${escapeHtml(shortName(u))} — ${fmtMoney(u.balance, this.settings.currency)}`);
          return this.send(chatId, `👥 <b>Последние игроки</b>\n\n${lines.join('\n') || '—'}`);
        }
        if (sub === 'bc') {
          this.pending.set(user.id, { action: 'broadcast' });
          return this.send(chatId, '📣 Пришли текст рассылки:');
        }
        if (sub === 'settings') {
          const s = this.settings;
          return this.send(
            chatId,
            `⚙️ <b>Настройки</b>\n\nМин. ставка: ${s.minBet}\nМакс. ставка: ${s.maxBet}\n` +
              `Дом: рулетка ${(s.houseEdge.roulette * 100).toFixed(1)}%, краш ${(s.houseEdge.crash * 100).toFixed(1)}%, ` +
              `кости ${(s.houseEdge.dice * 100).toFixed(1)}%, колесо ${(s.houseEdge.wheel * 100).toFixed(1)}%, плинко ${(s.houseEdge.plinko * 100).toFixed(1)}%, монетка ${(s.houseEdge.coinflip * 100).toFixed(1)}%\n` +
              `Дневной бонус: ${s.dailyBonus}\nПриветственный: ${s.welcomeBonus}\n\n` +
              `Менять — в панели хозяина в приложении.`
          );
        }
        return;
      }
      if (data.startsWith('qdice:')) {
        const [, amt, dir] = data.split(':');
        const r = this.engine.rollDice(user.id, { amount: Number(amt), target: 50, over: dir !== 'under' });
        await this.answerCallback(q.id, r.win ? `Победа! ${r.payout}` : 'Проигрыш', !r.win);
        return this.send(chatId, `🎲 ${r.roll} · ${r.win ? `+${fmtMoney(r.payout - r.totalBet, this.settings.currency)}` : `−${fmtMoney(r.totalBet, this.settings.currency)}`}\n💰 ${fmtMoney(r.balance, this.settings.currency)}`);
      }
      return this.answerCallback(q.id);
    } catch (err) {
      if (err instanceof CasinoError) return this.answerCallback(q.id, err.message, true);
      this.log.error?.('[bot] callback error:', err);
    }
  }

  // ─── уведомления ────────────────────────────────────────────────────────────
  async notifyDeposit(dep) {
    const ownerId = Number(this.settings.ownerId || 0);
    if (!ownerId) return;
    const text =
      `💳 <b>Заявка на пополнение #${dep.id}</b>\n\n` +
      `Игрок: ${escapeHtml(dep.userName)}${dep.username ? ` (@${escapeHtml(dep.username)})` : ''}\n` +
      `ID: <code>${dep.userId}</code>\n` +
      `Сумма: <b>${fmtMoney(dep.amount, this.settings.currency)}</b>\n\n` +
      `Проверь перевод звёзд и подтверди:`;
    const keyboard = {
      inline_keyboard: [
        [
          { text: `✅ Зачислить ${dep.amount}`, callback_data: `dep:ok:${dep.id}` },
          { text: '❌ Отклонить', callback_data: `dep:no:${dep.id}` },
        ],
      ],
    };
    try {
      await this.send(ownerId, text, { reply_markup: keyboard });
    } catch (e) {
      this.log.warn?.('[bot] не смог отправить заявку хозяину:', e.message);
    }
    await this.send(
      dep.userId,
      `💳 Заявка <b>#${dep.id}</b> на ${fmtMoney(dep.amount, this.settings.currency)} создана.\n\n` +
        `Осталось написать <b>@${escapeHtml(this.settings.cashierUsername)}</b> и отправить оффер/подарок со звёздами на эту сумму.\n` +
        `Как только хозяин подтвердит — звёзды придут на баланс автоматически.`
    ).catch(() => {});
  }

  async notifyDepositDecided(dep) {
    const u = this.store.user(dep.userId);
    const money = fmtMoney(dep.amount, this.settings.currency);
    if (dep.status === 'approved') {
      await this.send(
        dep.userId,
        `✅ <b>Пополнение #${dep.id} подтверждено</b>\n+${money}\n\n💰 Баланс: <b>${fmtMoney(u?.balance || 0, this.settings.currency)}</b>`
      ).catch(() => {});
    } else {
      await this.send(
        dep.userId,
        `❌ Заявка #${dep.id} на ${money} отклонена хозяином.\nЕсли это ошибка — напиши @${escapeHtml(this.settings.cashierUsername)}.`
      ).catch(() => {});
    }
  }

  async notifyWithdrawal(wd) {
    const ownerId = Number(this.settings.ownerId || 0);
    if (!ownerId) return;
    const text =
      `💸 <b>Заявка на вывод #${wd.id}</b>\n\n` +
      `Игрок: ${escapeHtml(wd.userName)}${wd.username ? ` (@${escapeHtml(wd.username)})` : ''}\n` +
      `ID: <code>${wd.userId}</code>\n` +
      `Сумма: <b>${fmtMoney(wd.amount, this.settings.currency)}</b>${wd.contact ? `\nКонтакт: ${escapeHtml(wd.contact)}` : ''}\n\n` +
      `Сумма уже зарезервирована. Напиши игроку в Wiftgram и отправь звёзды, затем подтверди:`;
    const keyboard = {
      inline_keyboard: [
        [
          { text: `✅ Выплачено ${wd.amount}`, callback_data: `wd:ok:${wd.id}` },
          { text: '❌ Отклонить', callback_data: `wd:no:${wd.id}` },
        ],
      ],
    };
    try {
      await this.send(ownerId, text, { reply_markup: keyboard });
    } catch (e) {
      this.log.warn?.('[bot] не смог отправить заявку на вывод:', e.message);
    }
    await this.send(
      wd.userId,
      `💸 Заявка <b>#${wd.id}</b> на ${fmtMoney(wd.amount, this.settings.currency)} принята.\n\n` +
        `Сумма зарезервирована. Напиши <b>@${escapeHtml(this.settings.cashierUsername || 'crypt')}</b> и укажи номер заявки. ` +
        `Если хозяин отклонит заявку — звёзды вернутся автоматически.`
    ).catch(() => {});
  }

  async notifyWithdrawalDecided(wd) {
    const u = this.store.user(wd.userId);
    const money = fmtMoney(wd.amount, this.settings.currency);
    if (wd.status === 'approved') {
      await this.send(
        wd.userId,
        `✅ <b>Выплата #${wd.id} подтверждена</b>\n${money} отправлены хозяином.\n\n💰 Баланс: <b>${fmtMoney(u?.balance || 0, this.settings.currency)}</b>`
      ).catch(() => {});
    } else {
      await this.send(
        wd.userId,
        `❌ Заявка на вывод #${wd.id} отклонена. ${money} возвращены на баланс.\n\n💰 Баланс: <b>${fmtMoney(u?.balance || 0, this.settings.currency)}</b>`
      ).catch(() => {});
    }
  }

  async notifyBigWin({ user, game, bet, payout }) {
    const ownerId = Number(this.settings.ownerId || 0);
    if (!ownerId || Date.now() - this._lastBigWinNotify < 20000) return;
    this._lastBigWinNotify = Date.now();
    const names = { roulette: 'рулетка', crash: 'краш', dice: 'кости', blackjack: 'блэкджек', wheel: 'колесо', plinko: 'плинко', coinflip: 'монетка' };
    this.send(ownerId, `💥 <b>Крупный выигрыш</b>\n${escapeHtml(shortName(user))} поднял ${fmtMoney(payout, this.settings.currency)} в ${names[game] || game} (ставка ${fmtMoney(bet, this.settings.currency)}).`).catch(() => {});
  }

  async broadcast(text) {
    const users = this.store.users().filter((u) => !u.banned);
    this.log.info?.(`[bot] Рассылка на ${users.length} игроков`);
    let ok = 0;
    for (const u of users) {
      try {
        await this.send(u.id, `📣 ${text}`);
        ok++;
      } catch {}
      await sleep(45);
    }
    return ok;
  }

  // ─── вебхук ─────────────────────────────────────────────────────────────────
  async handleWebhook(update) {
    try {
      await this.handleUpdate(update);
    } catch (err) {
      this.log.error?.('[bot] webhook error:', err.message);
    }
  }
}
