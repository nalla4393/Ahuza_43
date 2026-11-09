import assert from 'node:assert/strict';
import test from 'node:test';
import { gmailPaymentAlertsConfigured, parseAxisBankCreditEmail } from './gmailPaymentAlerts.js';

const validEmail = {
  from: 'Axis Bank <alerts@axisbank.com>',
  authenticationResults: ['mx.google.com; dkim=pass header.i=@axisbank.com; dmarc=pass (p=NONE) header.from=axisbank.com;'],
  subject: 'Your account has been credited',
  body: 'Dear Customer, Your A/c No. XXXXXXXXXX1234 has been credited by Rs. 1,234.50 on 09-Nov-2026 by UPI/P2P/123456789012/Customer Name. UPI Ref Number UTR123456789012. Available Balance: Rs. 5,000.00',
  internalDate: '1794238651000',
};

test('parses only authenticated Axis Bank credits with a UPI reference', () => {
  assert.deepEqual(parseAxisBankCreditEmail(validEmail), {
    amount: 123450,
    transactionReference: 'UTR123456789012',
    receivedAt: new Date(Number(validEmail.internalDate)).toISOString(),
  });
});

test('rejects unauthenticated, foreign, debit, and incomplete bank emails', () => {
  assert.equal(parseAxisBankCreditEmail({ ...validEmail, from: 'Axis Bank <alerts@attacker.example>' }), null);
  assert.equal(parseAxisBankCreditEmail({ ...validEmail, authenticationResults: ['mx.google.com; dmarc=fail header.from=axisbank.com;'] }), null);
  assert.equal(parseAxisBankCreditEmail({ ...validEmail, body: 'Your account was debited by Rs. 1,234.50. UPI Ref Number UTR123456789012' }), null);
  assert.equal(parseAxisBankCreditEmail({ ...validEmail, body: 'Your account was credited by Rs. 1,234.50' }), null);
  assert.equal(parseAxisBankCreditEmail({ ...validEmail, internalDate: 'invalid' }), null);
});

test('requires all Gmail OAuth credentials without exposing their values', () => {
  assert.equal(gmailPaymentAlertsConfigured({ GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret' } as NodeJS.ProcessEnv), false);
  assert.equal(gmailPaymentAlertsConfigured({ GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'token' } as NodeJS.ProcessEnv), true);
});
