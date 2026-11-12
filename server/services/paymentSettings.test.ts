import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import test, { after } from 'node:test';
import express from 'express';

const directory = await mkdtemp(path.join(os.tmpdir(), 'ahuza-payment-settings-'));
const previous = {
  dataFile: process.env.DATA_FILE,
  ownerKey: process.env.OWNER_API_KEY,
  sessionSecret: process.env.SESSION_SECRET,
  provider: process.env.PAYMENT_PROVIDER,
  merchantKey: process.env.PAYU_MERCHANT_KEY,
  merchantSalt: process.env.PAYU_MERCHANT_SALT,
  payuMode: process.env.PAYU_MODE,
};
process.env.DATA_FILE = path.join(directory, 'db.json');
process.env.OWNER_API_KEY = 'test-owner-key';
process.env.SESSION_SECRET = 'payment-settings-test-session-secret-with-more-than-32';
process.env.PAYMENT_PROVIDER = 'manual_upi';
delete process.env.PAYU_MERCHANT_KEY;
delete process.env.PAYU_MERCHANT_SALT;
const [{ api }, { getDatabase }] = await Promise.all([import('../routes.js'), import('./database.js')]);

after(async () => {
  if (previous.dataFile === undefined) delete process.env.DATA_FILE; else process.env.DATA_FILE = previous.dataFile;
  if (previous.ownerKey === undefined) delete process.env.OWNER_API_KEY; else process.env.OWNER_API_KEY = previous.ownerKey;
  if (previous.sessionSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previous.sessionSecret;
  if (previous.provider === undefined) delete process.env.PAYMENT_PROVIDER; else process.env.PAYMENT_PROVIDER = previous.provider;
  if (previous.merchantKey === undefined) delete process.env.PAYU_MERCHANT_KEY; else process.env.PAYU_MERCHANT_KEY = previous.merchantKey;
  if (previous.merchantSalt === undefined) delete process.env.PAYU_MERCHANT_SALT; else process.env.PAYU_MERCHANT_SALT = previous.merchantSalt;
  if (previous.payuMode === undefined) delete process.env.PAYU_MODE; else process.env.PAYU_MODE = previous.payuMode;
  await rm(directory, { recursive: true, force: true });
});

test('Owner Studio can create, edit, and delete encrypted PayU settings', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', api);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/owner/payment-provider/payu`;
  const headers = { 'Content-Type': 'application/json', 'X-Owner-Key': 'test-owner-key' };

  try {
    const initial = await fetch(base, { headers });
    assert.equal(initial.status, 200);
    assert.deepEqual(await initial.json(), {
      settings: {
        configured: false,
        hasMerchantKey: false,
        hasMerchantSalt: false,
        mode: 'test',
        callbackUrl: 'https://www.ahuzawear.com/api/payments/payu/callback',
        webhookUrl: 'https://www.ahuzawear.com/api/payments/payu/webhook',
        managedInOwnerStudio: false,
      },
      activeProvider: 'payu',
    });

    const payload = {
      merchantKey: 'merchant-key-secret',
      merchantSalt: 'merchant-salt-secret',
      mode: 'test',
      callbackUrl: 'https://store.example/api/payments/payu/callback',
      webhookUrl: 'https://store.example/api/payments/payu/webhook',
    };
    const saved = await fetch(base, { method: 'PUT', headers, body: JSON.stringify(payload) });
    assert.equal(saved.status, 200);
    const savedBody = await saved.json() as { settings: { configured: boolean; hasMerchantKey: boolean; hasMerchantSalt: boolean }; activeProvider: string };
    assert.deepEqual(savedBody, {
      settings: {
        configured: true,
        hasMerchantKey: true,
        hasMerchantSalt: true,
        mode: 'test',
        callbackUrl: payload.callbackUrl,
        webhookUrl: payload.webhookUrl,
        managedInOwnerStudio: true,
      },
      activeProvider: 'payu',
    });
    assert.equal(JSON.stringify(savedBody).includes('merchant-key-secret'), false);
    assert.equal(JSON.stringify(savedBody).includes('merchant-salt-secret'), false);

    const stored = (await getDatabase()).paymentProviderSettings;
    assert.equal(stored?.provider, 'payu');
    assert.notEqual(stored?.payuMerchantKeyEnc, payload.merchantKey);
    assert.notEqual(stored?.payuMerchantSaltEnc, payload.merchantSalt);

    const edited = await fetch(base, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ ...payload, merchantKey: '', merchantSalt: '', mode: 'production' }),
    });
    assert.equal(edited.status, 200);
    assert.equal((await edited.json() as { settings: { mode: string } }).settings.mode, 'production');

    const removed = await fetch(base, { method: 'DELETE', headers });
    assert.equal(removed.status, 200);
    assert.deepEqual(await removed.json(), { deleted: true, activeProvider: 'payu' });
    const afterDelete = (await getDatabase()).paymentProviderSettings;
    assert.deepEqual(afterDelete, { provider: 'manual_upi' });
    const config = await fetch(`${base.replace('/owner/payment-provider/payu', '/payments/config')}`);
    assert.deepEqual(await config.json(), { configured: false, automaticVerification: false, provider: 'payu' });

    await (await import('./database.js')).mutateDatabase((database) => {
      database.orders.push({
        id: 'proof-order',
        userId: 'payu-customer',
        shippingAddress: { name: 'Customer', addressLine1: 'Address', city: 'City', state: 'State', postalCode: '123456', country: 'India', phone: '9876543210' },
        items: [],
        amount: 125000,
        currency: 'INR',
        status: 'pending_payment',
        paymentMethod: 'upi',
        paymentStatus: 'pending',
        manualPaymentProof: { id: '12345678-1234-4234-8234-123456789012', mimeType: 'image/png', uploadedAt: new Date().toISOString() },
        createdAt: new Date().toISOString(),
      });
    });
    const reviewQueue = await fetch(`${base.replace('/payment-provider/payu', '/payment-review-queue')}`, { headers });
    assert.equal(reviewQueue.status, 200);
    const queueData = await reviewQueue.json() as { proofOrders: { id: string; note: string }[]; verificationRequired: boolean };
    assert.equal(queueData.verificationRequired, true);
    assert.equal(queueData.proofOrders[0]?.id, 'proof-order');
    assert.match(queueData.proofOrders[0]!.note, /does not verify bank settlement/);
    assert.equal((await getDatabase()).orders.find((order) => order.id === 'proof-order')?.paymentStatus, 'pending');
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('Owner Studio concurrent requests do not consume the failed-access limit', async () => {
  const app = express();
  app.use('/api', api);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/owner`;
  try {
    const paths = ['analytics', 'inventory', 'orders', 'payment-alerts', 'payment-review-queue', 'support-tickets', 'content', 'integrations', 'site-status', 'image-settings', 'payment-provider/payu'];
    const responses = await Promise.all(paths.map((path) => fetch(`${base}/${path}`, { headers: { 'X-Owner-Key': 'test-owner-key' } })));
    assert.deepEqual(responses.map((response) => response.status), Array(paths.length).fill(200));
    for (let attempt = 0; attempt < 10; attempt++) {
      assert.equal((await fetch(`${base}/analytics`, { headers: { 'X-Owner-Key': 'wrong-key' } })).status, 403);
    }
    assert.equal((await fetch(`${base}/analytics`, { headers: { 'X-Owner-Key': 'wrong-key' } })).status, 429);
    assert.equal((await fetch(`${base}/analytics`, { headers: { 'X-Owner-Key': 'test-owner-key' } })).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
