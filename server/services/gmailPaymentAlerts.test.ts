import assert from 'node:assert/strict';
import test from 'node:test';
import { gmailPaymentAlertsConfigured, parseAxisBankCreditEmail, parsedCredit } from './gmailPaymentAlerts.js';

const validEmail = {
  from: 'Axis Bank <alerts@axisbank.com>',
  authenticationResults: ['mx.google.com; dkim=pass header.i=@axisbank.com; dmarc=pass (p=NONE) header.from=axisbank.com;'],
  subject: 'Your account has been credited',
  body: 'Dear Customer, Your A/c No. XXXXXXXXXX1234 has been credited by Rs. 1,234.50 on 09-Nov-2026 by UPI/P2P/123456789012/Customer Name. UPI Ref Number UTR123456789012. Available Balance: Rs. 5,000.00',
  internalDate: '1794238651000',
};
const trustedSenders = ['alerts@axisbank.com'];

test('parses only authenticated Axis Bank credits with a UPI reference', () => {
  assert.deepEqual(parseAxisBankCreditEmail(validEmail, trustedSenders), {
    amount: 123450,
    transactionReference: 'UTR123456789012',
    receivedAt: new Date(Number(validEmail.internalDate)).toISOString(),
  });
});

test('rejects unauthenticated, foreign, debit, and incomplete bank emails', () => {
  assert.equal(parseAxisBankCreditEmail(validEmail, []), null);
  assert.equal(parseAxisBankCreditEmail({ ...validEmail, from: 'Axis Bank <other@axisbank.com>' }, trustedSenders), null);
  assert.equal(parseAxisBankCreditEmail({ ...validEmail, from: 'Axis Bank <alerts@attacker.example>' }, trustedSenders), null);
  assert.equal(parseAxisBankCreditEmail({ ...validEmail, from: 'Axis Bank <alerts@axisbank.com> extra' }, trustedSenders), null);
  assert.equal(parseAxisBankCreditEmail({ ...validEmail, authenticationResults: ['mx.google.com; dmarc=fail header.from=axisbank.com;'] }, trustedSenders), null);
  assert.equal(parseAxisBankCreditEmail({ ...validEmail, authenticationResults: ['mx.google.com; dmarc=pass header.from=axisbank.com.attacker.example;'] }, trustedSenders), null);
  assert.equal(parseAxisBankCreditEmail({ ...validEmail, authenticationResults: [...validEmail.authenticationResults, ...validEmail.authenticationResults] }, trustedSenders), null);
  assert.equal(parseAxisBankCreditEmail({ ...validEmail, body: 'Your account was debited by Rs. 1,234.50. UPI Ref Number UTR123456789012' }, trustedSenders), null);
  assert.equal(parseAxisBankCreditEmail({ ...validEmail, body: `${validEmail.body} Transaction failed` }, trustedSenders), null);
  assert.equal(parseAxisBankCreditEmail({ ...validEmail, body: 'Your account will be credited by Rs. 1,234.50. UPI Ref Number UTR123456789012' }, trustedSenders), null);
  assert.equal(parseAxisBankCreditEmail({ ...validEmail, body: 'Your account was credited by Rs. 1,234.50' }, trustedSenders), null);
  assert.equal(parseAxisBankCreditEmail({ ...validEmail, internalDate: 'invalid' }, trustedSenders), null);
  assert.equal(parseAxisBankCreditEmail({ ...validEmail, internalDate: '9007199254740991' }, trustedSenders), null);
});

test('requires all Gmail OAuth credentials without exposing their values', () => {
  assert.equal(gmailPaymentAlertsConfigured({ GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret' } as NodeJS.ProcessEnv), false);
  const credentials = { GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'token' };
  assert.equal(gmailPaymentAlertsConfigured(credentials), false);
  assert.equal(gmailPaymentAlertsConfigured({ ...credentials, GMAIL_TRUSTED_BANK_SENDERS: 'alerts@axisbank.com' }), true);
  assert.throws(() => gmailPaymentAlertsConfigured({ ...credentials, GMAIL_TRUSTED_BANK_SENDERS: '@axisbank.com' }));
});

const observedEmail = {
  from: 'Axis Bank Alerts <alerts@axis.bank.in>',
  authenticationResults: ['mx.google.com; spf=pass smtp.mailfrom=axis.bank.in; dkim=pass header.i=@axis.bank.in; dmarc=pass header.from=axis.bank.in'],
  subject: 'INR 1,250.00 was credited to your A/c.',
  body: 'Amount Credited: INR 1,250.00\nAccount Number: XXXX1234\nDate & Time: 11-11-26, 14:35 IST\nTransaction Info: UPI/P2A/123456789012/REF987654/UTIUPI',
  internalDate: '1794408000000',
};
const observedSenders = ['alerts@axis.bank.in'];

test('parses the supplied Axis format without interpreting its references as an order ID', () => {
  assert.deepEqual(parseAxisBankCreditEmail(observedEmail, observedSenders), {
    amount: 125000,
    transactionReference: '123456789012',
    additionalReference: 'REF987654',
    transactionAt: '2026-11-11T09:05:00.000Z',
    transactionTimezone: 'IST',
    transactionType: 'UPI/P2A',
    accountSuffix: '1234',
    sender: 'alerts@axis.bank.in',
    receivedAt: new Date(Number(observedEmail.internalDate)).toISOString(),
  });
});

test('parses Gmail plain-text and HTML messages, preferring plain text', () => {
  const headers = [
    { name: 'From', value: observedEmail.from },
    { name: 'Subject', value: observedEmail.subject },
    { name: 'Authentication-Results', value: observedEmail.authenticationResults[0] },
  ];
  const html = '<table><tr><td>Amount Credited:</td><td>INR 1,250.00</td></tr><tr><td>Account Number:</td><td>XXXX1234</td></tr><tr><td>Date &amp; Time:</td><td>11-11-26, 14:35 IST</td></tr><tr><td>Transaction Info:</td><td>UPI/P2A/123456789012/REF987654/UTIUPI</td></tr></table>';
  const part = (mimeType: string, body: string) => ({ mimeType, body: { data: Buffer.from(body).toString('base64url') } });
  const message = (parts: (ReturnType<typeof part> & { filename?: string })[]) => ({ id: 'gmail-1', internalDate: observedEmail.internalDate, payload: { headers, parts } });
  const expected = parseAxisBankCreditEmail(observedEmail, observedSenders);
  assert.deepEqual(parsedCredit(message([part('text/plain', observedEmail.body)]), observedSenders), expected);
  assert.deepEqual(parsedCredit(message([part('text/html', html)]), observedSenders), expected);
  assert.equal(parsedCredit(message([part('text/plain', 'Debit alert'), part('text/html', html)]), observedSenders), null);
  assert.equal(parsedCredit(message([{ ...part('text/plain', observedEmail.body), mimeType: 'message/rfc822' }]), observedSenders), null);
  assert.equal(parsedCredit(message([{ ...part('text/plain', observedEmail.body), filename: 'forwarded.txt' }]), observedSenders), null);
});

test('rejects forwarded, unauthenticated, malformed, debit and inconsistent Axis alerts', () => {
  const reject = (changes: Partial<typeof observedEmail>) => assert.equal(parseAxisBankCreditEmail({ ...observedEmail, ...changes }, observedSenders), null);
  reject({ from: 'Forwarder <attacker@example.com>' });
  reject({ from: 'Axis Bank Alerts <alerts@axis.bank.in> <attacker@example.com>' });
  reject({ subject: `Fwd: ${observedEmail.subject}` });
  reject({ authenticationResults: ['mx.google.com; dmarc=fail header.from=axis.bank.in'] });
  reject({ authenticationResults: ['mx.google.com; dmarc=pass header.from=axis.bank.in.attacker.example'] });
  reject({ authenticationResults: ['mx.google.com; dkim=fail header.i=@axis.bank.in; dmarc=pass header.from=axis.bank.in'] });
  reject({ authenticationResults: ['mx.google.com; spf=fail smtp.mailfrom=axis.bank.in; dmarc=pass header.from=axis.bank.in'] });
  reject({ authenticationResults: [observedEmail.authenticationResults[0]!, observedEmail.authenticationResults[0]!] });
  reject({ body: observedEmail.body.replace('Amount Credited', 'Amount Debited') });
  reject({ body: `${observedEmail.body}\nTransaction failed` });
  reject({ body: observedEmail.body.replace('INR 1,250.00', 'INR 1,251.00') });
  reject({ body: observedEmail.body.replace('INR 1,250.00', 'INR 1,250.00X') });
  reject({ body: observedEmail.body.replace('11-11-26', '31-02-26') });
  reject({ body: observedEmail.body.replace('14:35 IST', '25:35 IST') });
  reject({ body: observedEmail.body.replace('14:35 IST', '14:35 UTC') });
  reject({ body: observedEmail.body.replace('UPI/P2A', 'UPI/P2P') });
  reject({ body: observedEmail.body.replace('/REF987654', '') });
  reject({ body: observedEmail.body.replace('/UTIUPI', '/UTIUPI/extra') });
  reject({ body: observedEmail.body.replace('XXXX1234', '123456781234') });
  reject({ body: `${observedEmail.body}\nAmount Credited: INR 2,500.00` });
  assert.equal(parseAxisBankCreditEmail(observedEmail, []), null);
});
