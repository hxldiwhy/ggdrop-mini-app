/** Блэкджек: 6 колод, дилер стоит на 17 (в т.ч. мягких), блэкджек платит 3:2. */
import { shuffle, rngInt } from '../utils.js';

export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function newShoe(decks = 6) {
  const cards = [];
  for (let d = 0; d < decks; d++) {
    for (const s of SUITS) for (const r of RANKS) cards.push({ r, s });
  }
  return shuffle(cards);
}

export function draw(shoe) {
  if (!shoe.length) throw new Error('SHOE_EMPTY');
  return shoe.pop();
}

export function cardValue(card) {
  if (card.r === 'A') return 11;
  if (['K', 'Q', 'J', '10'].includes(card.r)) return 10;
  return Number(card.r);
}

export function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const v = cardValue(c);
    total += v;
    if (c.r === 'A') aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  const soft = aces > 0 && total <= 21;
  return { total, soft, blackjack: cards.length === 2 && total === 21 };
}

export function dealerShouldHit(cards) {
  const { total, soft } = handValue(cards);
  if (total < 17) return true;
  if (total === 17 && soft) return false; // стоит на мягких 17
  return false;
}

export function playDealer(shoe, dealerCards) {
  const cards = [...dealerCards];
  while (dealerShouldHit(cards)) cards.push(draw(shoe));
  return cards;
}

export function canDouble(cards, balance, bet) {
  return cards.length === 2 && balance >= bet;
}

export function standardDeckRng() {
  return rngInt(0, 51) / 52;
}
