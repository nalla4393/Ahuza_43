import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('Gmail scan records unique Axis credits for review without paying orders', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ahuza-gmail-test-'));
  const keys = ['DATA_FILE', 'STOREFRONT_DATABASE_URL', 'GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'GMAIL_TRUSTED_BANK_SENDERS'] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.DATA_FILE = path.join(directory, 'db.json');
  delete process.env.STOREFRONT_DATABASE_URL;
  process.env.GMAIL_CLIENT_ID = 'test-client';
  process.env.GMAIL_CLIENT_SECRET = 'test-secret';
  process.env.GMAIL_REFRESH_TOKEN = 'test-refresh';
  process.env.GMAIL_TRUSTED_BANK_SENDERS = 'alerts@axis.bank.in';
  const originalFetch = globalThis.fetch;
  const body = 'Amount Credited: INR 1,250.00\nAccount Number: XXXX1234\nDate & Time: 11-11-26, 14:35 IST\nTransaction Info: UPI/P2A/123456789012/REF987654/UTIUPI';
  const headers = [
    { name: 'From', value: 'Axis Bank Alerts <alerts@axis.bank.in>' },
    { name: 'Subject', value: 'INR 1,250.00 was credited to your A/c.' },
    { name: 'Authentication-Results', value: 'mx.google.com; dkim=pass header.i=@axis.bank.in; dmarc=pass header.from=axis.bank.in' },
  ];
  let scenario: 'initial' | 'history' | 'failure' | 'expired' | 'changed-account' | 'new-sender' = 'initial';
  let attachmentFetches = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-access' });
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-access');
    if (url.endsWith('/profile')) return Response.json({ emailAddress: scenario === 'changed-account' ? 'other@example.test' : 'owner@example.test', historyId: scenario === 'expired' || scenario === 'new-sender' ? '140' : '100' });
    if (url.includes('/messages?')) {
      const query = new URL(url).searchParams;
      assert.equal(query.get('includeSpamTrash'), 'true');
      if (scenario === 'expired' || scenario === 'new-sender') return Response.json({ messages: [{ id: 'm1' }, { id: 'm6' }] });
      if (!query.has('pageToken')) return Response.json({ messages: [{ id: 'm1' }, { id: 'm2' }], nextPageToken: 'next' });
      return Response.json({ messages: [{ id: 'm3' }, { id: 'm4' }] });
    }
    if (url.includes('/history?')) {
      const query = new URL(url).searchParams;
      if (scenario === 'expired') return new Response(null, { status: 404 });
      if (scenario === 'failure' && query.has('pageToken')) return new Response(null, { status: 503 });
      if (scenario === 'history' || scenario === 'failure') {
        if (!query.has('pageToken')) return Response.json({ history: [{ messagesAdded: [{ message: { id: 'm5' } }, { message: { id: 'm7' } }] }], nextPageToken: 'next-history', historyId: '120' });
        return Response.json({ history: [{ messagesAdded: [{ message: { id: 'm6' } }] }], historyId: '120' });
      }
      return Response.json({ historyId: '100' });
    }
    if (url.includes('/messages/m5/attachments/text-body')) {
      attachmentFetches++;
      return Response.json({ data: Buffer.from(body.replace('123456789012', '999999999999')).toString('base64url') });
    }
    const id = url.match(/\/messages\/(m\d)\?/)?.[1];
    assert.ok(id);
    const messageBody = id === 'm3' ? body.replace('Amount Credited', 'Amount Debited') : id === 'm4' ? body.replace('1,250.00', '1,251.00') : id === 'm5' || id === 'm6' ? body.replace('123456789012', '999999999999') : body;
    const messageHeaders = id === 'm4' ? headers.map((header) => header.name === 'Subject' ? { ...header, value: header.value.replace('1,250.00', '1,251.00') } : header)
      : id === 'm7' ? headers.map((header) => header.name === 'From' ? { ...header, value: 'Other <other@example.test>' } : header) : headers;
    return Response.json({ id, internalDate: '1794408000000', payload: { mimeType: 'text/plain', headers: messageHeaders, body: id === 'm5' ? { attachmentId: 'text-body' } : { data: Buffer.from(messageBody).toString('base64url') } } });
  };
  try {
    const { getDatabase, mutateDatabase } = await import('./database.js');
    const { scanGmailPaymentAlerts } = await import('./gmailPaymentAlerts.js');
    await mutateDatabase((database) => {
      database.orders.push({
        id: 'order-1', userId: 'customer-1', shippingAddress: { name: 'Test', addressLine1: 'Test', city: 'Test', state: 'Test', postalCode: '000000', country: 'India', phone: '0000000000' },
        items: [], amount: 125000, currency: 'INR', paymentMethod: 'upi', status: 'pending_payment', paymentStatus: 'pending',
        paymentReference: 'AHUZA-123456', createdAt: '2026-11-11T08:00:00.000Z',
      });
    });
    await scanGmailPaymentAlerts();
    await scanGmailPaymentAlerts();
    let database = await getDatabase();
    assert.deepEqual(database.gmailProcessedMessageIds, ['m1', 'm2', 'm3', 'm4']);
    assert.equal(database.bankPaymentAlerts?.length, 1);
    const alert = database.bankPaymentAlerts?.[0];
    assert.equal(alert?.id, 'm1');
    assert.equal(alert?.transactionReference, '123456789012');
    assert.equal(alert?.transactionAt, '2026-11-11T09:05:00.000Z');
    assert.equal(alert?.status, 'review_required');
    assert.equal(alert?.duplicateConflict, true);
    assert.deepEqual(alert?.history?.map((event) => event.action), ['received', 'duplicate', 'duplicate_conflict']);
    assert.equal(alert?.matchedOrderId, undefined);
    assert.equal(database.orders[0]?.paymentStatus, 'pending');
    assert.equal(database.orders[0]?.status, 'pending_payment');
    assert.equal(database.gmailHistoryId, '100');
    scenario = 'failure';
    await assert.rejects(scanGmailPaymentAlerts(), /HTTP 503/);
    database = await getDatabase();
    assert.equal(database.gmailHistoryId, '100');
    assert.equal(database.bankPaymentAlerts?.length, 2);
    scenario = 'history';
    await scanGmailPaymentAlerts();
    database = await getDatabase();
    assert.equal(database.gmailHistoryId, '120');
    assert.equal(database.bankPaymentAlerts?.length, 2);
    assert.equal(database.gmailProcessedMessageIds?.includes('m6'), true);
    assert.equal(database.gmailProcessedMessageIds?.includes('m7'), false);
    assert.equal(attachmentFetches, 1);
    scenario = 'expired';
    await scanGmailPaymentAlerts();
    database = await getDatabase();
    assert.equal(database.gmailHistoryId, '140');
    assert.equal(database.bankPaymentAlerts?.length, 2);
    scenario = 'changed-account';
    await assert.rejects(scanGmailPaymentAlerts(), /Gmail account changed/);
    assert.equal((await getDatabase()).gmailHistoryId, '140');
    scenario = 'new-sender';
    process.env.GMAIL_TRUSTED_BANK_SENDERS = 'alerts@axis.bank.in,other@axis.bank.in';
    await scanGmailPaymentAlerts();
    database = await getDatabase();
    assert.equal(database.gmailHistoryId, '140');
    assert.equal(database.orders[0]?.paymentStatus, 'pending');
    const persisted: unknown = JSON.parse(await readFile(path.join(directory, 'db.json'), 'utf8'));
    assert.deepEqual(persisted, database);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await rm(directory, { recursive: true, force: true });
  }
});
