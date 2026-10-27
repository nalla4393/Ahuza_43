import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Order } from './database.js';
import { appendOrderEmailDetails } from './integrations.js';

const order: Order = {
  id: 'order-reference-123',
  userId: 'customer-1',
  shippingAddress: {
    name: 'Test Customer',
    addressLine1: '1 Main Street',
    city: 'Hyderabad',
    state: 'Telangana',
    postalCode: '500001',
    country: 'India',
    phone: '9550582277',
  },
  items: [{ productId: 'shirt-1', name: 'Cotton Shirt', sku: 'SKU-1', quantity: 1, unitPrice: 1000 }],
  amount: 100000,
  currency: 'INR',
  paymentMethod: 'upi',
  paymentReference: 'AHUZA-UNIQUE-123',
  status: 'pending_payment',
  createdAt: '2026-10-14T00:00:00.000Z',
};

test('order received email always includes the order and payment reference, not a premature carrier number', () => {
  const body = appendOrderEmailDetails('order_placed', order, 'Order received.');
  assert.match(body, /Order reference: order-reference-123/);
  assert.match(body, /Payment reference: AHUZA-UNIQUE-123/);
  assert.match(body, /Account > Order history/);
  assert.doesNotMatch(body, /Tracking number:/);
});

test('shipping updates include the carrier tracking number and HTTPS link', () => {
  const shipped: Order = { ...order, status: 'shipped', trackingNumber: 'CARRIER-123', trackingUrl: 'https://carrier.example/track/CARRIER-123' };
  const body = appendOrderEmailDetails('shipped', shipped, 'Your order has shipped.');
  assert.match(body, /Tracking number: CARRIER-123/);
  assert.match(body, /https:\/\/carrier\.example\/track\/CARRIER-123/);
});

test('delivery notification invites the customer to rate and review the order', () => {
  const delivered: Order = { ...order, status: 'delivered' };
  const body = appendOrderEmailDetails('delivered', delivered, 'Your order was delivered.');
  assert.match(body, /rate and review your order/i);
  assert.match(body, /order-reference-123/);
});

test('payment confirmation email tells the customer where to get the invoice and receipt', () => {
  const paid: Order = { ...order, status: 'paid', paymentStatus: 'paid', paymentVerifiedAt: '2026-10-14T12:00:00.000Z' };
  const body = appendOrderEmailDetails('payment_confirmed', paid, 'Your payment is confirmed.');
  assert.match(body, /invoice and payment receipt are attached as a PDF/i);
  assert.match(body, /Account > Order history/);
});

test('unverified payment email never claims an invoice receipt is attached', () => {
  const body = appendOrderEmailDetails('payment_confirmed', order, 'Your payment update.');
  assert.doesNotMatch(body, /invoice and payment receipt are attached/i);
});
