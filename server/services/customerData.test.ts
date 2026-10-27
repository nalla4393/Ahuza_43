import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decryptCustomerValue, encryptCustomerValue, isValidUpiId } from './customerData.js';

test('encrypts and decrypts a customer UPI ID without storing it in plain text', () => {
  process.env.CUSTOMER_DATA_KEY = 'k'.repeat(40);
  const stored = encryptCustomerValue('asha@okbank');
  assert.ok(!stored.includes('asha'));
  assert.equal(decryptCustomerValue(stored), 'asha@okbank');
  assert.notEqual(encryptCustomerValue('asha@okbank'), stored);
});

test('rejects tampered or foreign ciphertext and changed keys', () => {
  process.env.CUSTOMER_DATA_KEY = 'k'.repeat(40);
  const stored = encryptCustomerValue('asha@okbank');
  const parts = stored.split(':');
  parts[3] = Buffer.from('tampered-value').toString('base64');
  assert.equal(decryptCustomerValue(parts.join(':')), null);
  assert.equal(decryptCustomerValue(undefined), null);
  process.env.CUSTOMER_DATA_KEY = 'z'.repeat(40);
  assert.equal(decryptCustomerValue(stored), null);
});

test('validates UPI IDs', () => {
  assert.equal(isValidUpiId('asha.k@okbank'), true);
  assert.equal(isValidUpiId('invalid'), false);
  assert.equal(isValidUpiId('a@'), false);
});
