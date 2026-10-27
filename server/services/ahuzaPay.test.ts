import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAhuzaPayOrder, getAhuzaPayConfiguration } from './ahuzaPay.js';

test('builds a merchant order with integer paise values', () => {
  const payload = buildAhuzaPayOrder(
    { id: 'o-1', amount: 260000, shippingAmount: 10000, items: [{ productId: 'p', name: 'Saree', sku: 's', quantity: 2, unitPrice: 1250, size: 'M' }] },
    { name: 'Account', email: 'a@example.com' },
    { name: 'Asha', addressLine1: '1 Main Rd', city: 'Pune', state: 'MH', postalCode: '411001', country: 'India', phone: '9876543210' },
  );
  assert.deepEqual(payload.items, [{ name: 'Saree', size: 'M', quantity: 2, unit_price_paise: 125000 }]);
  assert.equal(payload.total_amount_paise, 260000);
  assert.equal(payload.delivery_fee_paise, 10000);
  assert.equal(payload.customer_name, 'Asha');
  assert.equal(payload.delivery_address, '1 Main Rd, Pune, MH, 411001');
});

test('gateway needs an https URL and a 32+ character key', () => {
  const saved = { ...process.env };
  process.env.AHUZA_PAY_URL = 'http://example.com';
  process.env.AHUZA_PAY_API_KEY = 'x'.repeat(40);
  assert.equal(getAhuzaPayConfiguration().configured, false);
  process.env.AHUZA_PAY_URL = 'https://pay.example.com/';
  assert.equal(getAhuzaPayConfiguration().configured, true);
  process.env.AHUZA_PAY_API_KEY = 'short';
  assert.equal(getAhuzaPayConfiguration().configured, false);
  process.env = saved;
});
