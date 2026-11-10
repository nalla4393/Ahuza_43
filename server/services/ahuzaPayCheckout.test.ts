import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import session from 'express-session';

test('remote checkout requires a signed matching bank-confirmed webhook and is idempotent', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ahuza-pay-test-'));
  const remote = express();
  remote.use(express.json());
  let remoteOrder: Record<string, unknown> | undefined;
  remote.post('/api/merchant/orders', (request, response) => {
    remoteOrder = request.body;
    response.status(201).json({ pay_path: '/pay/test_reference' });
  });
  const remoteServer = remote.listen(0, '127.0.0.1');
  await once(remoteServer, 'listening');
  const remoteAddress = remoteServer.address();
  assert.ok(remoteAddress && typeof remoteAddress !== 'string');
  process.env.DATA_FILE = path.join(directory, 'db.json');
  process.env.AHUZA_PAY_BASE_URL = `http://127.0.0.1:${remoteAddress.port}`;
  process.env.AHUZA_PAY_API_KEY = 'a'.repeat(40);
  process.env.AHUZA_PAY_WEBHOOK_SECRET = 'b'.repeat(40);
  const { api } = await import('../routes.js');
  const { getDatabase, mutateDatabase } = await import('./database.js');
  await mutateDatabase((database) => {
    database.customers.push({ id: 'customer', email: 'customer@example.test', passwordHash: 'unused', createdAt: new Date().toISOString() });
  });
  const app = express();
  app.use('/api/payments/ahuza-pay/webhook', express.raw({ type: 'application/json' }));
  app.use(express.json());
  app.use(session({ secret: 'test-session-secret-at-least-32-characters', resave: false, saveUninitialized: false }));
  app.post('/login', (request, response) => { request.session.userId = 'customer'; response.sendStatus(204); });
  app.use('/api', api);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const cookie = (await fetch(`${base}/login`, { method: 'POST' })).headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    const shippingAddress = { name: 'Test Customer', addressLine1: 'Test Street', city: 'Chennai', state: 'Tamil Nadu', postalCode: '600001', country: 'India', phone: '9876543210' };
    const created = await fetch(`${base}/api/payments/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ paymentMethod: 'upi', items: [{ productId: 'soft-form-shirt', quantity: 1 }], shippingAddress }),
    });
    assert.equal(created.status, 201);
    const order = await created.json() as { orderId: string; amount: number; provider: string };
    assert.equal(order.provider, 'ahuza_pay');
    assert.equal(remoteOrder?.external_order_id, order.orderId);
    assert.equal(remoteOrder?.total_amount_paise, order.amount);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const webhook = (verification_method: string, amount: number, valid = true) => {
      const body = JSON.stringify({ event: 'payment.confirmed', external_order_id: order.orderId, amount_paise: amount, amount_paid_paise: amount, currency: 'INR', transaction_reference: '123456789012', verification_method });
      const signature = createHmac('sha256', process.env.AHUZA_PAY_WEBHOOK_SECRET!).update(`${timestamp}.${body}`).digest('hex');
      return fetch(`${base}/api/payments/ahuza-pay/webhook`, { method: 'POST', headers: {
        'Content-Type': 'application/json', 'X-Ahuza-Timestamp': timestamp,
        'X-Ahuza-Signature': `sha256=${valid ? signature : '0'.repeat(64)}`,
      }, body });
    };
    assert.equal((await webhook('BANK_ALERT', order.amount, false)).status, 401);
    assert.equal((await webhook('AI_VERIFY', order.amount)).status, 400);
    assert.equal((await webhook('BANK_ALERT', order.amount + 1)).status, 409);
    assert.notEqual((await getDatabase()).orders.find((entry) => entry.id === order.orderId)?.paymentStatus, 'paid');
    assert.equal((await webhook('BANK_ALERT', order.amount)).status, 200);
    assert.equal((await webhook('BANK_ALERT', order.amount)).status, 200);
    assert.equal((await getDatabase()).orders.find((entry) => entry.id === order.orderId)?.paymentStatus, 'paid');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => remoteServer.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
