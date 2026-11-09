import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createInstamojoRequest, instamojoAmountInPaise, parseInstamojoStatus, verifyInstamojoWebhook } from './instamojo.js';
import type { Order } from './database.js';

const requestId = 'request123';
const payment = { payment_id: 'payment123', status: 'Credit', amount: '680.00', currency: 'INR' };
const result = (payments: unknown[]) => ({ payment_request: { id: requestId, amount: '680.00', payments } });

test('only a matching Instamojo credit verifies an order', () => {
  assert.deepEqual(parseInstamojoStatus(result([]), requestId, 68000), { confirmed: false });
  assert.deepEqual(parseInstamojoStatus(result([{ ...payment, status: 'Failed' }]), requestId, 68000), { confirmed: false });
  assert.deepEqual(parseInstamojoStatus(result([payment]), requestId, 68000), { confirmed: true, transactionReference: 'payment123' });
  assert.throws(() => parseInstamojoStatus(result([payment]), 'different', 68000));
  assert.throws(() => parseInstamojoStatus(result([payment]), requestId, 67900));
  assert.throws(() => parseInstamojoStatus(result([{ ...payment, amount: '1.00' }]), requestId, 68000));
  assert.throws(() => parseInstamojoStatus(result([{ ...payment, currency: 'USD' }]), requestId, 68000));
  assert.throws(() => parseInstamojoStatus(result([payment, payment]), requestId, 68000));
  assert.deepEqual(parseInstamojoStatus({ payment_request: { id: requestId, amount: 680, payments: [{ ...payment, amount: 680 }] } }, requestId, 68000), {
    confirmed: true, transactionReference: 'payment123',
  });
  assert.equal(instamojoAmountInPaise('680.001'), null);
});

test('verifies signed Instamojo webhook payloads', () => {
  const previousSalt = process.env.INSTAMOJO_SALT;
  process.env.INSTAMOJO_SALT = 'test-salt';
  const payload = { amount: '680.00', currency: 'INR', payment_id: 'payment123', payment_request_id: requestId, purpose: 'AHUZA order order123', status: 'Credit' };
  const message = Object.entries(payload).sort(([a], [b]) => {
    const left = a.toLowerCase();
    const right = b.toLowerCase();
    return left < right ? -1 : left > right ? 1 : 0;
  }).map(([, value]) => value).join('|');
  const signed = { ...payload, mac: createHmac('sha1', 'test-salt').update(message).digest('hex') };
  try {
    assert.equal(verifyInstamojoWebhook(signed), true);
    assert.equal(verifyInstamojoWebhook({ ...signed, amount: '1.00' }), false);
    assert.equal(verifyInstamojoWebhook({ ...signed, extra: ['invalid'] }), false);
  } finally {
    if (previousSalt === undefined) delete process.env.INSTAMOJO_SALT; else process.env.INSTAMOJO_SALT = previousSalt;
  }
});

test('creates a form-encoded request and returns Instamojo longurl', async () => {
  const originalFetch = globalThis.fetch;
  const oldKey = process.env.INSTAMOJO_API_KEY;
  const oldToken = process.env.INSTAMOJO_AUTH_TOKEN;
  const oldSalt = process.env.INSTAMOJO_SALT;
  const oldWebhookUrl = process.env.INSTAMOJO_WEBHOOK_URL;
  process.env.INSTAMOJO_API_KEY = 'test-key';
  process.env.INSTAMOJO_AUTH_TOKEN = 'test-token';
  process.env.INSTAMOJO_SALT = 'test-salt';
  delete process.env.INSTAMOJO_WEBHOOK_URL;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://www.instamojo.com/api/1.1/payment-requests/');
    assert.equal(init?.method, 'POST');
    assert.equal((init?.body as URLSearchParams).get('amount'), '680.00');
    assert.equal((init?.body as URLSearchParams).get('allow_repeated_payments'), 'false');
    assert.equal((init?.body as URLSearchParams).get('webhook'), 'https://www.ahuzawear.com/api/payments/instamojo/webhook');
    return Response.json({ success: true, payment_request: { id: requestId, longurl: 'https://www.instamojo.com/@shop/request123/' } });
  };
  try {
    const order = { id: 'order123', amount: 68000, shippingAddress: { name: 'Customer', phone: '9999999999' } } as Order;
    assert.deepEqual(await createInstamojoRequest(order, 'customer@example.com'), { requestId, payUrl: 'https://www.instamojo.com/@shop/request123/' });
  } finally {
    globalThis.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.INSTAMOJO_API_KEY; else process.env.INSTAMOJO_API_KEY = oldKey;
    if (oldToken === undefined) delete process.env.INSTAMOJO_AUTH_TOKEN; else process.env.INSTAMOJO_AUTH_TOKEN = oldToken;
    if (oldSalt === undefined) delete process.env.INSTAMOJO_SALT; else process.env.INSTAMOJO_SALT = oldSalt;
    if (oldWebhookUrl === undefined) delete process.env.INSTAMOJO_WEBHOOK_URL; else process.env.INSTAMOJO_WEBHOOK_URL = oldWebhookUrl;
  }
});
