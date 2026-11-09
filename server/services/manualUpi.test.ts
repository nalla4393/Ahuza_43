import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import session from 'express-session';
import { manualUpiConfiguration, manualUpiLink, paymentProvider } from './manualUpi.js';

test('manual UPI configuration fails closed and link contains the server amount and reference', () => {
  const previous = { ...process.env };
  try {
    process.env.PAYMENT_PROVIDER = 'manual_upi';
    process.env.UPI_VPA = 'invalid';
    process.env.UPI_PAYEE_NAME = 'Ahuza & Co';
    assert.equal(manualUpiConfiguration(), null);
    process.env.UPI_VPA = 'store@example';
    const config = manualUpiConfiguration();
    assert.ok(config);
    const link = new URL(manualUpiLink(config, 250099, 'AHUZA-123'));
    assert.equal(link.protocol, 'upi:');
    assert.equal(link.host, 'pay');
    assert.equal(link.searchParams.get('pa'), 'store@example');
    assert.equal(link.searchParams.get('pn'), 'Ahuza & Co');
    assert.equal(link.searchParams.get('am'), '2500.99');
    assert.equal(link.searchParams.get('tn'), 'AHUZA-123');
    assert.throws(() => manualUpiLink(config, NaN, 'ref'));
    process.env.PAYMENT_PROVIDER = 'unknown';
    assert.equal(paymentProvider(), 'invalid');
    delete process.env.PAYMENT_PROVIDER;
    assert.equal(paymentProvider(), 'instamojo');
  } finally {
    for (const key of ['PAYMENT_PROVIDER', 'UPI_VPA', 'UPI_PAYEE_NAME']) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});

test('manual checkout stays pending until an owner records a unique bank reference', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ahuza-manual-upi-'));
  process.env.DATA_FILE = path.join(directory, 'db.json');
  process.env.PAYMENT_PROVIDER = 'manual_upi';
  process.env.UPI_VPA = 'store@example';
  process.env.UPI_PAYEE_NAME = 'Test Store';
  process.env.OWNER_API_KEY = 'test-owner-key';
  const { api } = await import('../routes.js');
  const { getDatabase, mutateDatabase } = await import('./database.js');
  await mutateDatabase((database) => {
    database.customers.push({ id: 'test-customer', email: 'customer@example.test', passwordHash: 'unused', createdAt: new Date().toISOString() });
  });
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-session-secret-at-least-32-characters', resave: false, saveUninitialized: false }));
  app.post('/test-login', (request, response) => { request.session.userId = 'test-customer'; response.sendStatus(204); });
  app.use('/api', api);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
  const config = await (await fetch(`${base}/api/payments/config`)).json() as { configured: boolean; automaticVerification: boolean; provider: string };
  assert.deepEqual(config, { configured: true, automaticVerification: false, provider: 'manual_upi' });
    const login = await fetch(`${base}/test-login`, { method: 'POST' });
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    const headers = { 'Content-Type': 'application/json', Cookie: cookie };
    const shippingAddress = { name: 'Test Customer', addressLine1: 'Test Street', city: 'Chennai', state: 'Tamil Nadu', postalCode: '600001', country: 'India', phone: '9876543210' };
    const create = () => fetch(`${base}/api/payments/orders`, { method: 'POST', headers, body: JSON.stringify({ paymentMethod: 'upi', items: [{ productId: 'soft-form-shirt', quantity: 1 }], shippingAddress }) });
    const created = await create();
    assert.equal(created.status, 201);
    const order = await created.json() as { orderId: string; payUrl: string; paymentReference: string; amount: number; provider: string };
    assert.equal(order.provider, 'manual_upi');
    const link = new URL(order.payUrl);
    assert.equal(link.searchParams.get('am'), (order.amount / 100).toFixed(2));
    assert.equal(link.searchParams.get('tn'), order.paymentReference);
    const status = await fetch(`${base}/api/payments/orders/${order.orderId}/status`, { headers });
    assert.equal((await status.json() as { status: string }).status, 'pending');
    const confirmUrl = `${base}/api/owner/orders/${order.orderId}/confirm-upi-payment`;
    const ownerHeaders = { ...headers, 'X-Owner-Key': 'test-owner-key' };
    assert.equal((await fetch(confirmUrl, { method: 'PATCH', headers, body: JSON.stringify({ transactionReference: 'BANK123456' }) })).status, 403);
    assert.equal((await fetch(confirmUrl, { method: 'PATCH', headers: ownerHeaders, body: '{}' })).status, 400);
    assert.equal((await fetch(confirmUrl, { method: 'PATCH', headers: ownerHeaders, body: JSON.stringify({ transactionReference: 'BANK123456' }) })).status, 200);
    assert.equal((await fetch(confirmUrl, { method: 'PATCH', headers: ownerHeaders, body: JSON.stringify({ transactionReference: 'BANK123456' }) })).status, 409);
    const confirmed = (await getDatabase()).orders.find((entry) => entry.id === order.orderId);
    assert.equal(confirmed?.paymentStatus, 'paid');
    assert.equal(confirmed?.paymentVerificationMethod, 'manual_bank_reconciliation');
    assert.equal(confirmed?.manualPaymentReference, 'BANK123456');
    const second = await (await create()).json() as { orderId: string };
    assert.equal((await fetch(`${base}/api/owner/orders/${second.orderId}/confirm-upi-payment`, { method: 'PATCH', headers: ownerHeaders, body: JSON.stringify({ transactionReference: 'bank123456' }) })).status, 409);
    await mutateDatabase((database) => {
      const current = database.orders.find((entry) => entry.id === second.orderId)!;
      current.reservationExpiresAt = new Date(Date.now() - 1000).toISOString();
    });
    const expired = await fetch(`${base}/api/payments/orders/${second.orderId}/status`, { headers });
    assert.equal((await expired.json() as { status: string }).status, 'expired');
    await mutateDatabase((database) => {
      database.products.find((entry) => entry.id === 'soft-form-shirt')!.stock = 0;
    });
    assert.equal((await fetch(`${base}/api/owner/orders/${second.orderId}/confirm-upi-payment`, { method: 'PATCH', headers: ownerHeaders, body: JSON.stringify({ transactionReference: 'BANK987654' }) })).status, 409);
    await mutateDatabase((database) => {
      database.products.find((entry) => entry.id === 'soft-form-shirt')!.stock = 1;
    });
    assert.equal((await fetch(`${base}/api/owner/orders/${second.orderId}/confirm-upi-payment`, { method: 'PATCH', headers: ownerHeaders, body: JSON.stringify({ transactionReference: 'BANK987654' }) })).status, 200);
    assert.equal((await getDatabase()).products.find((entry) => entry.id === 'soft-form-shirt')?.stock, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
