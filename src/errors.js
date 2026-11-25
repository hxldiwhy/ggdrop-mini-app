export class CasinoError extends Error {
  constructor(code, message, http = 400) {
    super(message || code);
    this.name = 'CasinoError';
    this.code = code;
    this.http = http;
  }
}

export const ERRORS = {
  USER_NOT_FOUND: 'Пользователь не найден',
  BANNED: 'Аккаунт заблокирован хозяином казино',
  MAINTENANCE: 'Казино на техобслуживании, ставки временно недоступны',
  BET_INVALID: 'Некорректная ставка',
  BET_TOO_LOW: 'Ставка меньше минимальной',
  BET_TOO_HIGH: 'Ставка больше лимита',
  BALANCE_LOW: 'Недостаточно средств',
  GAME_NOT_FOUND: 'Игра не найдена или уже завершена',
  NOT_YOUR_GAME: 'Это не ваша игра',
  TOO_LATE: 'Поздно — раунд уже закончился',
  ALREADY_BET: 'Ставка в этом раунде уже сделана',
  DAILY_WAIT: 'Бонус ещё не готов',
  PROMO_INVALID: 'Промокод не найден',
  PROMO_USED: 'Ты уже активировал этот промокод',
  PROMO_EXHAUSTED: 'Промокод закончился',
  INVALID_ACTION: 'Недопустимое действие',
  NOT_OWNER: 'Доступ только для хозяина казино',
};
