import assert from 'node:assert/strict';
import test from 'node:test';
import { createUpiIntent, isValidUpiVpa } from './upi.js';

test('validates a syntactically valid merchant UPI VPA', () => {
  assert.equal(isValidUpiVpa('ahuza.store@bank'), true);
  assert.equal(isValidUpiVpa('invalid-vpa'), false);
  assert.equal(isValidUpiVpa('user@'), false);
});

test('creates a direct UPI intent with exact merchant, amount, currency and order reference', () => {
  const intent = new URL(createUpiIntent({
    vpa: 'ahuza.store@bank',
    merchantName: 'AHUZA Apparel',
    amountPaise: 259000,
    orderReference: 'AHUZA-1234ABCD',
  }));
  assert.equal(intent.protocol, 'upi:');
  assert.equal(intent.hostname, 'pay');
  assert.equal(intent.searchParams.get('pa'), 'ahuza.store@bank');
  assert.equal(intent.searchParams.get('pn'), 'AHUZA Apparel');
  assert.equal(intent.searchParams.get('am'), '2590.00');
  assert.equal(intent.searchParams.get('cu'), 'INR');
  assert.equal(intent.searchParams.get('tr'), 'AHUZA-1234ABCD');
  assert.equal(intent.searchParams.get('tn'), 'AHUZA order AHUZA-1234ABCD');
});

test('rejects invalid amounts and malformed order references', () => {
  assert.throws(() => createUpiIntent({ vpa: 'ahuza.store@bank', merchantName: 'AHUZA', amountPaise: 0, orderReference: 'AHUZA-123' }));
  assert.throws(() => createUpiIntent({ vpa: 'ahuza.store@bank', merchantName: 'AHUZA', amountPaise: 100, orderReference: 'bad/ref' }));
});
