import { CONFIG } from './config.js';

export class ApiError extends Error {
  constructor(method, code, description, payload) {
    super(`${method}: ${code} ${description || ''}`.trim());
    this.name = 'ApiError';
    this.method = method;
    this.code = code;
    this.description = description || '';
    this.payload = payload;
  }
}

export class WiftgramApi {
  constructor({ token = CONFIG.token, base = CONFIG.apiBase, timeoutMs = CONFIG.apiTimeoutMs } = {}) {
    this.token = token;
    this.base = base.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  url(method) {
    return `${this.base}/bot${this.token}/${method}`;
  }

  async call(method, payload = {}, { retries = 1, timeoutMs } = {}) {
    const body = JSON.stringify(payload ?? {});
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs ?? this.timeoutMs);
      try {
        const res = await fetch(this.url(method), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: ac.signal,
        });
        const text = await res.text();
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          throw new ApiError(method, res.status, `BAD_JSON: ${text.slice(0, 200)}`);
        }
        if (!json.ok) {
          const err = new ApiError(method, json.error_code || res.status, json.description || 'UNKNOWN', json);
          // 429 — ждём и повторяем
          if (err.code === 429 && attempt < retries) {
            const wait = (json.parameters?.retry_after || 1) * 1000;
            await new Promise((r) => setTimeout(r, Math.min(wait, 5000)));
            lastErr = err;
            continue;
          }
          if (err.code >= 500 && attempt < retries) {
            lastErr = err;
            await new Promise((r) => setTimeout(r, 700));
            continue;
          }
          throw err;
        }
        return json.result;
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.code >= 500 && attempt < retries) { lastErr = err; continue; }
          throw err;
        }
        lastErr = err;
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 700));
          continue;
        }
        throw new ApiError(method, 0, err?.message || 'NETWORK_ERROR');
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  }

  getMe() { return this.call('getMe'); }

  getUpdates(offset, timeout = 30) {
    return this.call('getUpdates', { offset, timeout, limit: 100 }, { timeoutMs: (timeout + 20) * 1000, retries: 0 });
  }

  sendMessage(chatId, text, extra = {}) {
    return this.call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
  }

  editMessageText(chatId, messageId, text, extra = {}) {
    return this.call('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', ...extra });
  }

  deleteMessage(chatId, messageId) {
    return this.call('deleteMessage', { chat_id: chatId, message_id: messageId });
  }

  answerCallbackQuery(id, extra = {}) {
    return this.call('answerCallbackQuery', { callback_query_id: id, ...extra }, { retries: 0 });
  }

  setMyCommands(commands) {
    return this.call('setMyCommands', { commands });
  }

  getMyCommands() { return this.call('getMyCommands'); }

  setChatMenuButton(menuButton, chatId) {
    return this.call('setChatMenuButton', { menu_button: menuButton, ...(chatId ? { chat_id: chatId } : {}) });
  }

  answerInlineQuery(id, results, extra = {}) {
    return this.call('answerInlineQuery', { inline_query_id: id, results, ...extra }, { retries: 0 });
  }

  getChatMenuButton() { return this.call('getChatMenuButton'); }

  sendChatAction(chatId, action = 'typing') {
    return this.call('sendChatAction', { chat_id: chatId, action }, { retries: 0 });
  }

  getFile(fileId) { return this.call('getFile', { file_id: fileId }); }

  setWebhook(url, secretToken) {
    return this.call('setWebhook', { url, ...(secretToken ? { secret_token: secretToken } : {}) });
  }

  deleteWebhook() { return this.call('deleteWebhook'); }

  getWebhookInfo() { return this.call('getWebhookInfo'); }
}
