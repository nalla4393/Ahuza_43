import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { defaultStorefrontContent, type Database, type Order } from './database.js';
import { applyCapturedQrPayment, applyRefundWebhook, isVerifiedCapture, verifyRazorpayWebhookSignature } from './payments.js';

function testOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    userId: 'customer-1',
    shippingAddress: {
      name: 'Test Customer', addressLine1: '1 Test Street', city: 'Hyderabad', state: 'Telangana',
      postalCode: '500001', country: 'India', phone: '9999999999',
    },
    items: [{ productId: 'product-1', name: 'Test item', sku: 'TEST-1', quantity: 2, unitPrice: 500 }],
    amount: 100000,
    currency: 'INR',
    status: 'pending_payment',
    paymentStatus: 'pending',
    paymentEnvironment: 'test',
    paymentReference: 'AHUZA-ORDER-1',
    razorpayQrCodeId: 'qr_1',
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function testDatabase(order = testOrder()): Database {
  return {
    products: [{
      id: 'product-1', name: 'Test item', description: '', price: 500, sku: 'TEST-1', stock: 8,
      category: 'Test', imageUrl: 'https://example.com/item.jpg', active: true,
      ghostMannequin: { tags: [] },
    }],
    customers: [],
    orders: [order],
    events: [],
    supportTickets: [],
    paymentReceiptReviews: [],
    paymentAuditEvents: [],
    processedPaymentWebhookIds: [],
    content: structuredClone(defaultStorefrontContent),
  };
}

const validCapture = { id: 'pay_1', amount: 100000, currency: 'INR', status: 'captured', method: 'upi' };

test('Razorpay webhook HMAC accepts only the exact raw body and signature', () => {
  const rawBody = Buffer.from('{"event":"qr_code.credited"}');
  const secret = 'test-webhook-secret';
  const signature = createHmac('sha256', secret).update(rawBody).digest('hex');
  assert.equal(verifyRazorpayWebhookSignature(rawBody, signature, secret), true);
  assert.equal(verifyRazorpayWebhookSignature(Buffer.from(`${rawBody.toString()} `), signature, secret), false);
  assert.equal(verifyRazorpayWebhookSignature(rawBody, 'invalid', secret), false);
});

test('only captured UPI payments with exact paise amount and currency are accepted', () => {
  assert.equal(isVerifiedCapture(validCapture, { amount: 100000, currency: 'INR' }), true);
  assert.equal(isVerifiedCapture({ ...validCapture, amount: 99999 }, { amount: 100000, currency: 'INR' }), false);
  assert.equal(isVerifiedCapture({ ...validCapture, currency: 'USD' }, { amount: 100000, currency: 'INR' }), false);
  assert.equal(isVerifiedCapture({ ...validCapture, status: 'failed' }, { amount: 100000, currency: 'INR' }), false);
  assert.equal(isVerifiedCapture({ ...validCapture, method: 'card' }, { amount: 100000, currency: 'INR' }), false);
});

test('a verified sandbox capture remains test-only and restores reserved inventory', () => {
  const database = testDatabase();
  const result = applyCapturedQrPayment(database, {
    eventId: 'evt_test_1', qrCodeId: 'qr_1', paymentReference: 'AHUZA-ORDER-1', internalOrderId: 'order-1', payment: validCapture,
  });
  assert.equal(result.outcome, 'test_paid');
  assert.equal(database.orders[0].status, 'test_paid');
  assert.equal(database.orders[0].paymentStatus, 'test_paid');
  assert.equal(database.products[0].stock, 10);
});

test('amount and internal reference mismatches never settle an order', () => {
  const wrongAmountDatabase = testDatabase();
  const amountResult = applyCapturedQrPayment(wrongAmountDatabase, {
    eventId: 'evt_wrong_amount', qrCodeId: 'qr_1', paymentReference: 'AHUZA-ORDER-1', internalOrderId: 'order-1',
    payment: { ...validCapture, amount: 99999 },
  });
  assert.equal(amountResult.outcome, 'review');
  assert.equal(wrongAmountDatabase.orders[0].status, 'pending_payment');
  assert.ok(wrongAmountDatabase.orders[0].paymentReview);

  const wrongReferenceDatabase = testDatabase();
  const referenceResult = applyCapturedQrPayment(wrongReferenceDatabase, {
    eventId: 'evt_wrong_reference', qrCodeId: 'qr_1', paymentReference: 'OTHER-ORDER', internalOrderId: 'order-1', payment: validCapture,
  });
  assert.equal(referenceResult.outcome, 'review');
  assert.equal(wrongReferenceDatabase.orders[0].status, 'pending_payment');

  const wrongOrderDatabase = testDatabase();
  const orderResult = applyCapturedQrPayment(wrongOrderDatabase, {
    eventId: 'evt_wrong_order', qrCodeId: 'qr_1', paymentReference: 'AHUZA-ORDER-1',
    internalOrderId: 'another-order', payment: validCapture,
  });
  assert.equal(orderResult.outcome, 'review');
  assert.equal(wrongOrderDatabase.orders[0].status, 'pending_payment');
});

test('pending, failed, and non-UPI payment attempts cannot settle an order', () => {
  for (const payment of [
    { ...validCapture, status: 'pending' },
    { ...validCapture, status: 'failed' },
    { ...validCapture, method: 'card' },
  ]) {
    const database = testDatabase();
    assert.equal(applyCapturedQrPayment(database, {
      eventId: `evt_${payment.status}_${payment.method}`,
      qrCodeId: 'qr_1',
      paymentReference: 'AHUZA-ORDER-1',
      internalOrderId: 'order-1',
      payment,
    }).outcome, 'review');
    assert.equal(database.orders[0].status, 'pending_payment');
    assert.equal(database.products[0].stock, 8);
  }
});

test('a live verified capture settles an order but does not re-deduct reserved inventory', () => {
  const database = testDatabase(testOrder({ paymentEnvironment: 'live' }));
  const result = applyCapturedQrPayment(database, {
    eventId: 'evt_live_1',
    qrCodeId: 'qr_1',
    paymentReference: 'AHUZA-ORDER-1',
    internalOrderId: 'order-1',
    payment: validCapture,
  });
  assert.equal(result.outcome, 'paid');
  assert.equal(database.orders[0].status, 'paid');
  assert.equal(database.orders[0].paymentStatus, 'paid');
  assert.equal(database.products[0].stock, 8);
});

test('duplicate captured-payment webhook delivery is idempotent', () => {
  const database = testDatabase();
  const input = { eventId: 'evt_duplicate', qrCodeId: 'qr_1', paymentReference: 'AHUZA-ORDER-1', internalOrderId: 'order-1', payment: validCapture };
  assert.equal(applyCapturedQrPayment(database, input).outcome, 'test_paid');
  assert.equal(applyCapturedQrPayment(database, input).outcome, 'duplicate');
  assert.equal(database.products[0].stock, 10);
  assert.equal(database.paymentAuditEvents?.length, 1);
});

test('processed full refunds mark the order refunded and duplicate events are ignored', () => {
  const order = testOrder({
    status: 'paid',
    paymentStatus: 'paid',
    paymentEnvironment: 'live',
    paymentId: 'pay_live_1',
    paymentVerifiedAt: new Date().toISOString(),
    refund: {
      idempotencyKey: 'refund-key',
      receipt: 'ahuza_order',
      providerRefundId: 'rfnd_1',
      amount: 100000,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });
  const database = testDatabase(order);
  const input = {
    eventId: 'evt_refund_1',
    eventType: 'refund.processed' as const,
    refund: { id: 'rfnd_1', paymentId: 'pay_live_1', amount: 100000, status: 'processed', currency: 'INR', receipt: 'ahuza_order' },
  };
  assert.equal(applyRefundWebhook(database, input).outcome, 'updated');
  assert.equal(database.orders[0].status, 'refunded');
  assert.equal(database.orders[0].paymentStatus, 'refunded');
  assert.equal(applyRefundWebhook(database, input).outcome, 'duplicate');
});
