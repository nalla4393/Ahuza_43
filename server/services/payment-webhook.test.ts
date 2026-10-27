import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database, Order, Product } from './database.js';
import { getPaymentProvider, signDemoPaymentNotification, type PaymentNotification } from './payment-provider.js';
import { applyVerifiedPaymentNotification } from './payment-webhook.js';

const secret = 'local-demo-webhook-secret-for-tests-32';
const orderReference = 'AHUZA-1234567890ABCDEFGHIJ';

function createOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    userId: 'customer-1',
    shippingAddress: {
      name: 'Test Customer', addressLine1: '1 Test Road', city: 'Chennai', state: 'Tamil Nadu',
      postalCode: '600001', country: 'India', phone: '9876543210',
    },
    items: [{ productId: 'product-1', name: 'Test Shirt', sku: 'AH-TEST-1', quantity: 1, unitPrice: 10 }],
    amount: 1000,
    currency: 'INR',
    paymentMethod: 'upi',
    paymentProvider: 'demo',
    paymentReference: orderReference,
    status: 'pending_payment',
    paymentStatus: 'pending',
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function createProduct(stock = 1): Product {
  return {
    id: 'product-1', name: 'Test Shirt', description: '', price: 10, sku: 'AH-TEST-1',
    stock, category: 'Tops', imageUrl: '', active: true, ghostMannequin: { tags: [] },
  };
}

function createDatabase(order = createOrder()): Pick<Database, 'orders' | 'products'> & Partial<Pick<Database, 'paymentEvents'>> {
  return { orders: [order], products: [createProduct()] };
}

function createNotification(overrides: Partial<PaymentNotification> = {}): PaymentNotification {
  return {
    eventId: 'event-1',
    orderReference,
    providerReference: 'demo-txn-1',
    amountPaise: 1000,
    currency: 'INR',
    status: 'paid',
    ...overrides,
  };
}

test('demo payment notifications require a valid HMAC and valid payload', async () => {
  const previousSecret = process.env.DEMO_PAYMENT_WEBHOOK_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.DEMO_PAYMENT_WEBHOOK_SECRET = secret;
  process.env.NODE_ENV = 'test';
  try {
    const provider = getPaymentProvider('demo');
    const body = Buffer.from(JSON.stringify(createNotification()));
    const signature = signDemoPaymentNotification(body, secret);
    assert.deepEqual(await provider.verifyPaymentNotification(body, signature), createNotification());
    assert.equal(await provider.verifyPaymentNotification(body, '0'.repeat(64)), null);
    assert.equal(await provider.verifyPaymentNotification(Buffer.from('{"status":"paid"}'), signature), null);
    process.env.NODE_ENV = 'production';
    assert.equal(await provider.verifyPaymentNotification(body, signature), null);
    assert.throws(() => getPaymentProvider('demo'), /DEMO_PAYMENT_PROVIDER_NOT_ALLOWED_IN_PRODUCTION/);
  } finally {
    if (previousSecret === undefined) delete process.env.DEMO_PAYMENT_WEBHOOK_SECRET;
    else process.env.DEMO_PAYMENT_WEBHOOK_SECRET = previousSecret;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('a matching verified paid notification confirms the order once and records its event', () => {
  const database = createDatabase();
  const notification = createNotification();

  assert.deepEqual(applyVerifiedPaymentNotification(database, 'demo', notification), {
    outcome: 'processed', orderId: 'order-1', paymentConfirmed: true,
  });
  assert.equal(database.orders[0].paymentStatus, 'paid');
  assert.equal(database.orders[0].status, 'paid');
  assert.equal(database.orders[0].paymentVerificationMethod, 'demo_webhook');
  assert.equal(database.orders[0].providerPaymentReference, 'demo-txn-1');
  assert.equal(database.paymentEvents?.length, 1);
  assert.deepEqual(applyVerifiedPaymentNotification(database, 'demo', notification), { outcome: 'duplicate' });
  assert.equal(database.paymentEvents?.length, 1);
});

test('mismatched amount and order references are rejected without marking an order paid', () => {
  const database = createDatabase();
  const amountMismatch = applyVerifiedPaymentNotification(database, 'demo', createNotification({ amountPaise: 1001 }));
  assert.deepEqual(amountMismatch, { outcome: 'rejected', reason: 'amount_mismatch' });
  const wrongReference = applyVerifiedPaymentNotification(database, 'demo', createNotification({
    eventId: 'event-2',
    orderReference: 'AHUZA-ABCDEFGHIJ1234567890',
  }));
  assert.deepEqual(wrongReference, { outcome: 'rejected', reason: 'order_not_found' });
  assert.equal(database.orders[0].paymentStatus, 'pending');
  assert.equal(database.paymentEvents?.every((event) => event.outcome === 'rejected'), true);
});

test('stale failure notifications cannot downgrade a paid order', () => {
  const database = createDatabase();
  applyVerifiedPaymentNotification(database, 'demo', createNotification());
  const result = applyVerifiedPaymentNotification(database, 'demo', createNotification({
    eventId: 'event-2',
    providerReference: 'demo-txn-2',
    status: 'failed',
  }));

  assert.deepEqual(result, { outcome: 'processed', orderId: 'order-1', paymentConfirmed: false });
  assert.equal(database.orders[0].paymentStatus, 'paid');
  assert.equal(database.orders[0].status, 'paid');
});

test('pending and failed notifications never confirm an order', () => {
  const database = createDatabase();
  const pending = applyVerifiedPaymentNotification(database, 'demo', createNotification({ status: 'processing' }));
  assert.equal(pending.outcome, 'processed');
  assert.equal(database.orders[0].paymentStatus, 'processing');
  const failed = applyVerifiedPaymentNotification(database, 'demo', createNotification({
    eventId: 'event-2',
    status: 'failed',
  }));

  assert.equal(failed.outcome, 'processed');
  assert.equal(database.orders[0].paymentStatus, 'failed');
  assert.equal(database.orders[0].status, 'pending_payment');
});

test('a verified refund marks the order refunded and a stale paid event cannot restore it', () => {
  const database = createDatabase();
  applyVerifiedPaymentNotification(database, 'demo', createNotification());
  applyVerifiedPaymentNotification(database, 'demo', createNotification({
    eventId: 'event-2',
    providerReference: 'demo-refund-1',
    status: 'refunded',
  }));
  const latePaid = applyVerifiedPaymentNotification(database, 'demo', createNotification({
    eventId: 'event-3',
    providerReference: 'demo-txn-late',
  }));

  assert.equal(latePaid.outcome, 'processed');
  assert.equal(database.orders[0].paymentStatus, 'refunded');
  assert.equal(database.orders[0].status, 'refunded');
});

test('late verified payments are recorded even when cancelled-order inventory is unavailable', () => {
  const database = createDatabase(createOrder({ status: 'cancelled', paymentStatus: 'expired' }));
  database.products[0].stock = 0;

  applyVerifiedPaymentNotification(database, 'demo', createNotification());

  assert.equal(database.orders[0].paymentStatus, 'paid');
  assert.equal(database.orders[0].status, 'paid');
  assert.equal(database.orders[0].paymentFulfillmentIssue, 'inventory_unavailable_after_late_payment');
});
