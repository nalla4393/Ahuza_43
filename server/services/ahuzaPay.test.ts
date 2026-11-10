import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { ahuzaPayConfiguration, verifyAhuzaPayWebhook } from './ahuzaPay.js';

test('Ahuza Pay webhook checks the raw body, timestamp, and signature', () => {
  const previous = process.env.AHUZA_PAY_WEBHOOK_SECRET;
  const secret = 'test-secret-'.repeat(4);
  process.env.AHUZA_PAY_WEBHOOK_SECRET = secret;
  try {
    const body = Buffer.from('{"event":"payment.confirmed"}');
    const timestamp = '1800000000';
    const signature = `sha256=${createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex')}`;
    assert.equal(verifyAhuzaPayWebhook(body, timestamp, signature, 1800000000000), true);
    assert.equal(verifyAhuzaPayWebhook(Buffer.from('{}'), timestamp, signature, 1800000000000), false);
    assert.equal(verifyAhuzaPayWebhook(body, timestamp, signature, 1800000310000), false);
    assert.equal(verifyAhuzaPayWebhook(body, timestamp, 'sha256=invalid', 1800000000000), false);
  } finally {
    if (previous === undefined) delete process.env.AHUZA_PAY_WEBHOOK_SECRET;
    else process.env.AHUZA_PAY_WEBHOOK_SECRET = previous;
  }
});

test('Ahuza Pay checkout requires complete configuration', () => {
  const saved = [process.env.AHUZA_PAY_BASE_URL, process.env.AHUZA_PAY_API_KEY, process.env.AHUZA_PAY_WEBHOOK_SECRET];
  try {
    process.env.AHUZA_PAY_BASE_URL = 'https://pay.example';
    process.env.AHUZA_PAY_API_KEY = 'a'.repeat(32);
    process.env.AHUZA_PAY_WEBHOOK_SECRET = '';
    assert.throws(() => ahuzaPayConfiguration());
    process.env.AHUZA_PAY_WEBHOOK_SECRET = 'b'.repeat(32);
    assert.equal(ahuzaPayConfiguration()?.baseUrl, 'https://pay.example');
  } finally {
    for (const [index, key] of ['AHUZA_PAY_BASE_URL', 'AHUZA_PAY_API_KEY', 'AHUZA_PAY_WEBHOOK_SECRET'].entries()) {
      if (saved[index] === undefined) delete process.env[key];
      else process.env[key] = saved[index];
    }
  }
});
