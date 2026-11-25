import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signToken, verifyToken, validateInitData, miniAppUrl, safeCompare } from '../src/auth.js';

test('токен: подпись и проверка', () => {
  const t = signToken(1780243335);
  const data = verifyToken(t);
  assert.equal(data.userId, 1780243335);
});

test('токен: подделка невозможна', () => {
  const t = signToken(1);
  const [payload] = t.split('.');
  const forged = `${payload}.${crypto.randomBytes(20).toString('base64url')}`;
  assert.equal(verifyToken(forged), null);
  assert.equal(verifyToken('garbage'), null);
  assert.equal(verifyToken(''), null);
});

test('токен: истекает', async () => {
  const t = signToken(5, -1000);
  assert.equal(verifyToken(t), null);
});

test('initData: валидная подпись принимается, битая — нет', () => {
  const botToken = '123456:TESTTOKEN_abcdefghijklmnop';
  const user = JSON.stringify({ id: 42, first_name: 'Test' });
  const params = new URLSearchParams({ user, auth_date: '1700000000' });
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  params.set('hash', hash);
  const ok = validateInitData(params.toString(), botToken);
  assert.equal(ok.id, 42);
  assert.equal(validateInitData(params.toString().replace(hash, 'deadbeef'), botToken), null);
  assert.equal(validateInitData('user=%7B%7D&hash=abc', botToken), null);
});

test('ссылка мини-приложения содержит токен', () => {
  const url = miniAppUrl('https://casino.example.com', 777);
  assert.ok(url.startsWith('https://casino.example.com/app?t='));
  const t = decodeURIComponent(url.split('t=')[1]);
  assert.equal(verifyToken(t).userId, 777);
  assert.equal(miniAppUrl('', 1), '');
});

test('safeCompare', () => {
  assert.equal(safeCompare('abc', 'abc'), true);
  assert.equal(safeCompare('abc', 'abd'), false);
  assert.equal(safeCompare('abc', 'abcd'), false);
});
