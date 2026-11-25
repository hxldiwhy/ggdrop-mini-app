/* Мост к Wiftgram / Telegram WebApp: если клиент передал объект — используем его,
   иначе работаем как обычная веб-страница. */
(function () {
  // Разные сборки Wiftgram передают объект по-разному: Telegram.WebApp,
  // Wiftgram.WebApp или wiftgram.WebApp. Поддерживаем все варианты.
  const tg =
    (window.Telegram && window.Telegram.WebApp) ||
    (window.Wiftgram && window.Wiftgram.WebApp) ||
    (window.wiftgram && window.wiftgram.WebApp) ||
    null;

  // Некоторые клиенты кладут initData в query-строку вместо объекта.
  const qs = new URLSearchParams(window.location.search || '');
  const initDataFallback = qs.get('initData') || qs.get('init_data') || '';

  const shim = {
    available: !!tg,
    initData: (tg && tg.initData) || initDataFallback,
    initDataUnsafe: (tg && tg.initDataUnsafe) || {},
    colorScheme: (tg && tg.colorScheme) || 'dark',
    themeParams: (tg && tg.themeParams) || {},
    ready() { try { tg && tg.ready && tg.ready(); } catch (e) {} },
    expand() { try { tg && tg.expand && tg.expand(); } catch (e) {} },
    close() { try { tg && tg.close && tg.close(); } catch (e) {} },
    openLink(url) {
      try { if (tg && tg.openLink) return tg.openLink(url, { try_in_view_controller: true }); } catch (e) {}
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    openTelegramLink(url) {
      try { if (tg && tg.openTelegramLink) return tg.openTelegramLink(url); } catch (e) {}
      try { if (tg && tg.openLink) return tg.openLink(url); } catch (e) {}
      window.location.href = url;
    },
    haptic(kind) {
      try {
        const h = tg && tg.HapticFeedback;
        if (!h) return;
        if (kind === 'success') h.notificationOccurred('success');
        else if (kind === 'error') h.notificationOccurred('error');
        else h.impactOccurred(kind || 'light');
      } catch (e) {}
    },
    mainButton: (tg && tg.MainButton) || null,
    showAlert(msg) {
      try { if (tg && tg.showAlert) { tg.showAlert(msg); return true; } } catch (e) {}
      return false;
    },
  };

  window.WiftgramApp = shim;
})();
