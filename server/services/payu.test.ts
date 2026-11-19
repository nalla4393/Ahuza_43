import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import test, { after } from 'node:test';
import express from 'express';
import session from 'express-session';
import type { Order } from './database.js';

const testDirectory = await mkdtemp(path.join(os.tmpdir(), 'ahuza-payu-suite-'));
const previousDataFile = process.env.DATA_FILE;
process.env.DATA_FILE = path.join(testDirectory, 'db.json');
const { createPayUCheckout, parsePayUStatus, payuAmountInPaise, payuConfigured, verifyPayUResponseHash } = await import('./payu.js');

after(async () => {
  if (previousDataFile === undefined) delete process.env.DATA_FILE; else process.env.DATA_FILE = previousDataFile;
  await rm(testDirectory, { recursive: true, force: true });
});
const order = {
  id: 'order-123',
  payuTxnId: 'AH12345678901234567890',
  amount: 68000,
  shippingAddress: { name: 'Test Customer', phone: '9876543210' },
} as Order;

async function withPayUEnvironment(callback: () => void | Promise<void>): Promise<void> {
  const previous = {
    key: process.env.PAYU_MERCHANT_KEY,
    salt: process.env.PAYU_MERCHANT_SALT,
    mode: process.env.PAYU_MODE,
    callbackUrl: process.env.PAYU_CALLBACK_URL,
  };
  process.env.PAYU_MERCHANT_KEY = 'test-key';
  process.env.PAYU_MERCHANT_SALT = 'test-salt';
  process.env.PAYU_MODE = 'test';
  process.env.PAYU_CALLBACK_URL = 'https://store.example/api/payments/payu/callback';
  try {
    await callback();
  } finally {
    if (previous.key === undefined) delete process.env.PAYU_MERCHANT_KEY; else process.env.PAYU_MERCHANT_KEY = previous.key;
    if (previous.salt === undefined) delete process.env.PAYU_MERCHANT_SALT; else process.env.PAYU_MERCHANT_SALT = previous.salt;
    if (previous.mode === undefined) delete process.env.PAYU_MODE; else process.env.PAYU_MODE = previous.mode;
    if (previous.callbackUrl === undefined) delete process.env.PAYU_CALLBACK_URL; else process.env.PAYU_CALLBACK_URL = previous.callbackUrl;
  }
}

test('PayU checkout payload has a server-generated hash and trusted callback URLs', async () => {
  await withPayUEnvironment(async () => {
    assert.equal(await payuConfigured(), true);
    const checkout = await createPayUCheckout(order, 'customer@example.test');
    assert.equal(checkout.action, 'https://test.payu.in/_payment');
    assert.equal(checkout.fields.txnid, order.payuTxnId);
    assert.equal(checkout.fields.amount, '680.00');
    assert.equal(checkout.fields.udf1, order.id);
    assert.equal(checkout.fields.surl, 'https://store.example/api/payments/payu/callback');
    assert.equal(checkout.fields.furl, checkout.fields.surl);
    const { hash, ...fields } = checkout.fields;
    const expected = createHash('sha512').update([
      fields.key, fields.txnid, fields.amount, fields.productinfo, fields.firstname, fields.email,
      fields.udf1, fields.udf2, fields.udf3, fields.udf4, fields.udf5,
      '', '', '', '', '', 'test-salt',
    ].join('|')).digest('hex');
    assert.equal(hash, expected);
  });
});

test('PayU response hash validates exact signed fields and rejects tampering', async () => {
  await withPayUEnvironment(async () => {
    const fields: Record<string, string> = {
      key: 'test-key',
      status: 'success',
      txnid: order.payuTxnId!,
      amount: '680.00',
      productinfo: `AHUZA order ${order.id}`,
      firstname: order.shippingAddress.name,
      email: 'customer@example.test',
      udf1: order.id,
      udf2: '',
      udf3: '',
      udf4: '',
      udf5: '',
    };
    fields.hash = createHash('sha512').update([
      'test-salt', fields.status, '', '', '', '', '',
      fields.udf5, fields.udf4, fields.udf3, fields.udf2, fields.udf1,
      fields.email, fields.firstname, fields.productinfo, fields.amount, fields.txnid, fields.key,
    ].join('|')).digest('hex');
    assert.equal(await verifyPayUResponseHash(fields), true);
    assert.equal(await verifyPayUResponseHash({ ...fields, amount: '1.00' }), false);
    assert.equal(await verifyPayUResponseHash({ ...fields, key: 'other-key' }), false);
    const withCharges: Record<string, string> = { ...fields, additionalCharges: '1.00' };
    withCharges.hash = createHash('sha512').update([
      withCharges.additionalCharges, 'test-salt', fields.status, '', '', '', '', '',
      fields.udf5, fields.udf4, fields.udf3, fields.udf2, fields.udf1,
      fields.email, fields.firstname, fields.productinfo, fields.amount, fields.txnid, fields.key,
    ].join('|')).digest('hex');
    assert.equal(await verifyPayUResponseHash(withCharges), true);
    assert.equal(await verifyPayUResponseHash({ ...withCharges, additionalCharges: '2.00' }), false);
  });
});

test('PayU verification accepts only matching successful transactions', () => {
  const transaction = { txnid: order.payuTxnId, amount: '680.00', status: 'success', mihpayid: '987654321' };
  assert.deepEqual(parsePayUStatus({ status: 1, transaction_details: { [order.payuTxnId!]: transaction } }, order.payuTxnId!, order.amount), {
    confirmed: true, transactionReference: '987654321',
  });
  assert.deepEqual(parsePayUStatus({ status: 0 }, order.payuTxnId!, order.amount), { confirmed: false });
  assert.deepEqual(parsePayUStatus({ status: 1, transaction_details: { [order.payuTxnId!]: { ...transaction, status: 'failure' } } }, order.payuTxnId!, order.amount), { confirmed: false });
  assert.throws(() => parsePayUStatus({ status: 1, transaction_details: { [order.payuTxnId!]: { ...transaction, amount: '1.00' } } }, order.payuTxnId!, order.amount));
  const documented = { txnid: order.payuTxnId, transaction_amount: '680.00', amt: '680.00', status: 'success', mihpayid: '987654321' };
  assert.equal(parsePayUStatus({ status: 1, transaction_details: { [order.payuTxnId!]: documented } }, order.payuTxnId!, order.amount).confirmed, true);
  assert.throws(() => parsePayUStatus({ status: 1, transaction_details: { [order.payuTxnId!]: { ...documented, transaction_amount: '1.00' } } }, order.payuTxnId!, order.amount));
  assert.throws(() => parsePayUStatus({ status: 1, transaction_details: { [order.payuTxnId!]: { ...documented, amount: '1.00' } } }, order.payuTxnId!, order.amount));
  assert.equal(payuAmountInPaise('680.009'), null);
});

test('PayU verify-payment API uses signed merchant credentials and confirms a matching transaction', async () => {
  await withPayUEnvironment(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), 'https://test.payu.in/merchant/postservice?form=2');
      assert.equal(init?.method, 'POST');
      const body = init?.body as URLSearchParams;
      assert.equal(body.get('key'), 'test-key');
      assert.equal(body.get('command'), 'verify_payment');
      assert.equal(body.get('var1'), order.payuTxnId);
      assert.equal(body.get('hash'), createHash('sha512').update(`test-key|verify_payment|${order.payuTxnId}|test-salt`).digest('hex'));
      return Response.json({
        status: 1,
        transaction_details: {
          [order.payuTxnId!]: { txnid: order.payuTxnId, amount: '680.00', status: 'success', mihpayid: '987654321' },
        },
      });
    };
    try {
      const { getPayUStatus } = await import('./payu.js');
      assert.deepEqual(await getPayUStatus(order.payuTxnId!, order.amount), { confirmed: true, transactionReference: '987654321' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('PayU webhook confirms the matching order only after server-side verification', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ahuza-payu-'));
  const originalFetch = globalThis.fetch;
  const previous = {
    dataFile: process.env.DATA_FILE,
    provider: process.env.PAYMENT_PROVIDER,
    key: process.env.PAYU_MERCHANT_KEY,
    salt: process.env.PAYU_MERCHANT_SALT,
    mode: process.env.PAYU_MODE,
    callbackUrl: process.env.PAYU_CALLBACK_URL,
  };
  process.env.DATA_FILE = path.join(directory, 'db.json');
  process.env.PAYMENT_PROVIDER = 'manual_upi';
  process.env.PAYU_MERCHANT_KEY = 'test-key';
  process.env.PAYU_MERCHANT_SALT = 'test-salt';
  process.env.PAYU_MODE = 'test';
  process.env.PAYU_CALLBACK_URL = 'https://store.example/api/payments/payu/callback';
  let server: ReturnType<express.Application['listen']> | undefined;
  try {
    const [{ api }, { getDatabase, mutateDatabase }] = await Promise.all([
      import('../routes.js'),
      import('./database.js'),
    ]);
    await mutateDatabase((database) => {
      database.customers.push({ id: 'payu-customer', email: 'customer@example.test', passwordHash: 'unused', createdAt: new Date().toISOString() });
      database.shippingChargeAmount = 12345;
    });
    const app = express();
    app.use(express.json());
    app.use(session({ secret: 'payu-test-session-secret-with-more-than-32-characters', resave: false, saveUninitialized: false }));
    app.post('/test-login', (request, response) => { request.session.userId = 'payu-customer'; response.sendStatus(204); });
    app.use('/api', api);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    assert.deepEqual(await (await originalFetch(`${base}/api/payments/config`)).json(), { configured: true, automaticVerification: true, provider: 'payu' });
    const login = await originalFetch(`${base}/test-login`, { method: 'POST' });
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    const create = await originalFetch(`${base}/api/payments/orders`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentMethod: 'upi',
        expectedShippingAmount: 12345,
        items: [{ productId: 'soft-form-shirt', quantity: 1 }],
        shippingAddress: { name: 'Test Customer', addressLine1: 'Test Street', city: 'Chennai', state: 'Tamil Nadu', postalCode: '600001', country: 'India', phone: '9876543210' },
      }),
    });
    assert.equal(create.status, 201);
    const payment = await create.json() as { orderId: string; paymentForm: { action: string; fields: Record<string, string> }; amount: number };
    assert.equal(payment.paymentForm.action, 'https://test.payu.in/_payment');
    assert.equal(payment.amount, 261345);
    assert.equal(payment.paymentForm.fields.amount, '2613.45');
    assert.equal('PAYU_MERCHANT_SALT' in payment.paymentForm.fields, false);
    const statusUrl = `${base}/api/payments/orders/${payment.orderId}/status`;
    assert.equal((await originalFetch(statusUrl)).status, 401);
    assert.equal((await (await originalFetch(statusUrl, { headers: { Cookie: cookie } })).json() as { status: string }).status, 'pending');

    const fields = payment.paymentForm.fields;
    const callback: Record<string, string> = {
      key: fields.key,
      status: 'success',
      txnid: fields.txnid,
      amount: fields.amount,
      productinfo: fields.productinfo,
      firstname: fields.firstname,
      email: fields.email,
      udf1: fields.udf1,
      udf2: fields.udf2,
      udf3: fields.udf3,
      udf4: fields.udf4,
      udf5: fields.udf5,
    };
    callback.hash = createHash('sha512').update([
      'test-salt', callback.status, '', '', '', '', '',
      callback.udf5, callback.udf4, callback.udf3, callback.udf2, callback.udf1,
      callback.email, callback.firstname, callback.productinfo, callback.amount, callback.txnid, callback.key,
    ].join('|')).digest('hex');
    let remoteStatus = 'pending';
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), 'https://test.payu.in/merchant/postservice?form=2');
      const request = init?.body as URLSearchParams;
      assert.equal(request.get('var1'), fields.txnid);
      return Response.json({
        status: 1,
        transaction_details: {
          [fields.txnid]: { txnid: fields.txnid, transaction_amount: fields.amount, status: remoteStatus, mihpayid: '987654321' },
        },
      });
    };
    const webhook = (payload: Record<string, string>) => originalFetch(`${base}/api/payments/payu/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(payload),
    });
    assert.equal((await webhook({ ...callback, amount: '1.00' })).status, 400);
    const mismatched: Record<string, string> = { ...callback, amount: '1.00' };
    mismatched.hash = createHash('sha512').update([
      'test-salt', mismatched.status, '', '', '', '', '',
      mismatched.udf5, mismatched.udf4, mismatched.udf3, mismatched.udf2, mismatched.udf1,
      mismatched.email, mismatched.firstname, mismatched.productinfo, mismatched.amount, mismatched.txnid, mismatched.key,
    ].join('|')).digest('hex');
    assert.equal((await webhook(mismatched)).status, 400);
    assert.equal((await webhook(callback)).status, 200);
    assert.equal((await getDatabase()).orders.find((entry) => entry.id === payment.orderId)?.paymentStatus, 'pending');
    remoteStatus = 'success';
    assert.equal((await webhook(callback)).status, 200);
    assert.equal((await webhook(callback)).status, 200);
    const returned = await originalFetch(`${base}/api/payments/payu/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(callback),
      redirect: 'manual',
    });
    assert.equal(returned.status, 303);
    assert.equal(returned.headers.get('location'), '/order-success');
    const stored = (await getDatabase()).orders.find((entry) => entry.id === payment.orderId);
    assert.equal(stored?.paymentStatus, 'paid');
    assert.equal((await (await originalFetch(statusUrl, { headers: { Cookie: cookie } })).json() as { status: string }).status, 'paid');
    assert.equal(stored?.paymentVerificationMethod, 'payu');
    assert.equal(stored?.manualPaymentReference, '987654321');
    assert.equal((await getDatabase()).orderEmailNotifications?.filter((entry) => entry.orderId === payment.orderId && entry.kind === 'payment_confirmed').length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (server) {
      server.close();
      await once(server, 'close');
    }
    if (previous.dataFile === undefined) delete process.env.DATA_FILE; else process.env.DATA_FILE = previous.dataFile;
    if (previous.provider === undefined) delete process.env.PAYMENT_PROVIDER; else process.env.PAYMENT_PROVIDER = previous.provider;
    if (previous.key === undefined) delete process.env.PAYU_MERCHANT_KEY; else process.env.PAYU_MERCHANT_KEY = previous.key;
    if (previous.salt === undefined) delete process.env.PAYU_MERCHANT_SALT; else process.env.PAYU_MERCHANT_SALT = previous.salt;
    if (previous.mode === undefined) delete process.env.PAYU_MODE; else process.env.PAYU_MODE = previous.mode;
    if (previous.callbackUrl === undefined) delete process.env.PAYU_CALLBACK_URL; else process.env.PAYU_CALLBACK_URL = previous.callbackUrl;
    await rm(directory, { recursive: true, force: true });
  }
});
