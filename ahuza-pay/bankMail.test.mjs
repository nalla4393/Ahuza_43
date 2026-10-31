import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCreditEmail } from './bankMail.mjs';

const ok = { from: 'Axis Bank <alerts@axisbank.com>', subject: 'Credit alert', text: 'Rs. 1,299.50 has been credited to your A/c XX1234. UPI Ref 412345678901.', messageId: '<m1@x>', authResults: 'mx.google.com; dkim=pass header.d=axisbank.com' };

test('parses a genuine Axis credit mail', () => {
  const r = parseCreditEmail(ok);
  assert.equal(r.amount_paise, 129950);
  assert.equal(r.reference, '412345678901');
});

test('rejects debits, forged senders and unverified mail', () => {
  assert.equal(parseCreditEmail({ ...ok, text: 'Rs. 500 has been debited from your A/c' }), null);
  assert.equal(parseCreditEmail({ ...ok, from: 'x@evil.com' }), null);
  assert.equal(parseCreditEmail({ ...ok, authResults: 'mx.google.com; dkim=fail' }), null);
  assert.equal(parseCreditEmail({ ...ok, from: 'a@axisbank.com.evil.com' }), null);
});

test('parses a Google Pay received mail and falls back to message id', () => {
  const r = parseCreditEmail({ from: 'Google Pay <noreply@google.com>', subject: 'Ananya sent you ₹680', text: 'You received ₹680.00', messageId: '<g1@google.com>', authResults: 'spf=pass' });
  assert.equal(r.amount_paise, 68000);
  assert.equal(r.reference, 'g1@google.com');
});
