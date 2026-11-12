import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import session from 'express-session';
import sharp from 'sharp';
import { manualUpiAdjustment, manualUpiConfiguration, manualUpiLink, paymentProvider } from './manualUpi.js';
import type { Order } from './database.js';

test('manual UPI adjustments avoid recent amounts, report exhaustion and can be reused later', () => {
  const now = Date.parse('2026-01-02T10:00:00Z');
  const template: Order = {
    id: 'order', userId: 'customer', shippingAddress: { name: 'Customer', addressLine1: 'Street', city: 'City', state: 'State', postalCode: '123456', country: 'India', phone: '9876543210' },
    items: [], amount: 50001, currency: 'INR', paymentMethod: 'upi', status: 'cancelled', paymentStatus: 'expired', createdAt: new Date(now - 1000).toISOString(),
  };
  assert.equal(manualUpiAdjustment(50000, [template], now), 2);
  assert.equal(manualUpiAdjustment(50000, [{ ...template, createdAt: new Date(now - 3600001).toISOString() }], now), 1);
  assert.equal(manualUpiAdjustment(50000, Array.from({ length: 99 }, (_, index) => ({ ...template, amount: 50001 + index })), now), null);
});

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
    process.env.PAYMENT_PROVIDER = 'payu';
    assert.equal(paymentProvider(), 'payu');
    process.env.PAYMENT_PROVIDER = 'unknown';
    assert.equal(paymentProvider(), 'invalid');
    process.env.PAYMENT_PROVIDER = 'instamojo';
    assert.equal(paymentProvider(), 'invalid');
    delete process.env.PAYMENT_PROVIDER;
    assert.equal(paymentProvider(), 'manual_upi');
  } finally {
    for (const key of ['PAYMENT_PROVIDER', 'UPI_VPA', 'UPI_PAYEE_NAME']) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});

test('new manual checkout is disabled while legacy UPI orders remain reviewable', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ahuza-manual-upi-'));
  process.env.DATA_FILE = path.join(directory, 'db.json');
  process.env.PAYMENT_PROVIDER = 'manual_upi';
  process.env.UPI_VPA = 'store@example';
  process.env.UPI_PAYEE_NAME = 'Test Store';
  process.env.OWNER_API_KEY = 'test-owner-key';
  delete process.env.PAYU_MERCHANT_KEY;
  delete process.env.PAYU_MERCHANT_SALT;
  const { api } = await import('../routes.js');
  const { getDatabase, mutateDatabase } = await import('./database.js');
  await mutateDatabase((database) => {
    database.customers.push({ id: 'test-customer', email: 'customer@example.test', passwordHash: 'unused', createdAt: new Date().toISOString() });
  });
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-session-secret-at-least-32-characters', resave: false, saveUninitialized: false }));
  app.post('/test-login', (request, response) => { request.session.userId = 'test-customer'; response.sendStatus(204); });
  app.post('/test-other-login', (request, response) => { request.session.userId = 'other-customer'; response.sendStatus(204); });
  app.use('/api', api);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const config = await (await fetch(`${base}/api/payments/config`)).json() as { configured: boolean; automaticVerification: boolean; provider: string };
    assert.deepEqual(config, { configured: false, automaticVerification: false, provider: 'payu' });
    const login = await fetch(`${base}/test-login`, { method: 'POST' });
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    const headers = { 'Content-Type': 'application/json', Cookie: cookie };
    const shippingAddress = { name: 'Test Customer', addressLine1: 'Test Street', city: 'Chennai', state: 'Tamil Nadu', postalCode: '600001', country: 'India', phone: '9876543210' };
    const create = () => fetch(`${base}/api/payments/orders`, { method: 'POST', headers, body: JSON.stringify({ paymentMethod: 'upi', items: [{ productId: 'soft-form-shirt', quantity: 1 }], shippingAddress }) });
    assert.equal((await create()).status, 503);
    let nextLegacyOrder = 0;
    const createLegacy = async () => mutateDatabase((database) => {
      const index = ++nextLegacyOrder;
      const product = database.products.find((entry) => entry.id === 'soft-form-shirt')!;
      product.stock--;
      const order: Order = {
        id: `legacy-${index}`, userId: 'test-customer', shippingAddress,
        items: [{ productId: product.id, name: product.name, sku: product.sku, quantity: 1, unitPrice: product.price }],
        amount: 259000 + index, paymentAdjustmentAmount: index, currency: 'INR', paymentMethod: 'upi',
        status: 'pending_payment', paymentStatus: 'pending', createdAt: new Date().toISOString(),
        reservationExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
      database.orders.push(order);
      return { orderId: order.id, amount: order.amount };
    });
    const order = await createLegacy();
    const second = await createLegacy();
    const status = await fetch(`${base}/api/payments/orders/${order.orderId}/status`, { headers });
    assert.equal((await status.json() as { status: string }).status, 'pending');
    const anonymousStatus = await fetch(`${base}/api/payments/orders/${order.orderId}/status`);
    assert.equal(anonymousStatus.status, 401);
    assert.deepEqual(await anonymousStatus.json(), { error: 'Sign in is required' });
    const otherLogin = await fetch(`${base}/test-other-login`, { method: 'POST' });
    const otherCookie = otherLogin.headers.get('set-cookie')?.split(';')[0];
    assert.ok(otherCookie);
    assert.equal((await fetch(`${base}/api/payments/orders/${order.orderId}/status`, { headers: { Cookie: otherCookie } })).status, 404);
    const signedInAgain = await fetch(`${base}/test-login`, { method: 'POST' });
    const newCookie = signedInAgain.headers.get('set-cookie')?.split(';')[0];
    assert.ok(newCookie);
    const recoveredStatus = await fetch(`${base}/api/payments/orders/${order.orderId}/status`, { headers: { Cookie: newCookie } });
    assert.equal(recoveredStatus.status, 200);
    assert.equal((await recoveredStatus.json() as { status: string }).status, 'pending');
    const screenshot = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const proofUrl = `${base}/api/payments/orders/${order.orderId}/proof`;
    const proofResponse = await fetch(proofUrl, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'image/png' }, body: screenshot });
    assert.equal(proofResponse.status, 201);
    assert.equal((await proofResponse.json() as { submitted: boolean; paymentStatus: string }).paymentStatus, 'pending');
    const pendingProof = (await getDatabase()).orders.find((entry) => entry.id === order.orderId);
    assert.equal(pendingProof?.paymentStatus, 'pending');
    assert.equal(pendingProof?.manualPaymentProof?.mimeType, 'image/png');
    assert.equal((await fetch(proofUrl, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'image/png' }, body: Buffer.from('not an image') })).status, 415);
    assert.equal((await fetch(`${base}/api/owner/orders/${order.orderId}/payment-proof`)).status, 403);
    const ownerProof = await fetch(`${base}/api/owner/orders/${order.orderId}/payment-proof`, { headers: { 'X-Owner-Key': 'test-owner-key' } });
    assert.equal(ownerProof.status, 200);
    assert.equal(ownerProof.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await ownerProof.arrayBuffer()), screenshot);
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

    await mutateDatabase((database) => { database.products.find((entry) => entry.id === 'soft-form-shirt')!.stock = 1; });
    const alertOrder = await createLegacy();
    const alertId = 'gmail-message-test-1';
    await mutateDatabase((database) => {
      database.bankPaymentAlerts!.push({
        id: alertId,
        amount: alertOrder.amount,
        transactionReference: 'UTR123456789012',
        receivedAt: new Date(Date.now() + 1000).toISOString(),
        status: 'review_required',
      });
    });
    const alertsResponse = await fetch(`${base}/api/owner/payment-alerts`, { headers: ownerHeaders });
    const alerts = await alertsResponse.json() as { alerts: { id: string; candidates: { id: string }[] }[] };
    assert.equal(alerts.alerts[0]?.id, alertId);
    assert.equal(alerts.alerts[0]?.candidates.length, 1);
    assert.equal(alerts.alerts[0]?.candidates[0]?.id, alertOrder.orderId);
    const alertConfirm = await fetch(`${base}/api/owner/payment-alerts/${alertId}/orders/${alertOrder.orderId}/confirm`, {
      method: 'PATCH',
      headers: ownerHeaders,
    });
    assert.equal(alertConfirm.status, 200, await alertConfirm.text());
    const reviewed = await getDatabase();
    assert.equal(reviewed.orders.find((entry) => entry.id === alertOrder.orderId)?.paymentStatus, 'paid');
    assert.equal(reviewed.bankPaymentAlerts?.find((entry) => entry.id === alertId)?.matchedOrderId, alertOrder.orderId);
    assert.equal(reviewed.bankPaymentAlerts?.find((entry) => entry.id === alertId)?.history?.[0]?.action, 'owner_confirmed');
    const historyResponse = await fetch(`${base}/api/owner/payment-alerts`, { headers: ownerHeaders });
    const historyPayload = await historyResponse.json() as { alerts: { id: string }[]; history: { id: string; status: string; history: { action: string }[] }[] };
    assert.equal(historyPayload.alerts.some((entry) => entry.id === alertId), false);
    assert.equal(historyPayload.history.find((entry) => entry.id === alertId)?.status, 'confirmed');
    assert.equal(historyPayload.history.find((entry) => entry.id === alertId)?.history[0]?.action, 'owner_confirmed');
    await mutateDatabase((database) => {
      database.products.find((entry) => entry.id === 'soft-form-shirt')!.stock = 1;
    });
    assert.equal((await getDatabase()).products.find((entry) => entry.id === 'soft-form-shirt')?.stock, 1);
    const cod = await fetch(`${base}/api/payments/orders`, { method: 'POST', headers, body: JSON.stringify({ paymentMethod: 'cod', items: [{ productId: 'soft-form-shirt', quantity: 1 }], shippingAddress }) });
    assert.equal(cod.status, 201);
    assert.equal((await cod.json() as { amount: number }).amount, 259000);
    await getDatabase();
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
