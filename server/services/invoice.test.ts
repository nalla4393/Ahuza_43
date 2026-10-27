import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Order } from './database.js';
import { buildInvoicePdf } from './invoice.js';

const paidOrder: Order = {
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
  paymentVerificationMethod: 'ahuza_pay',
  paymentStatus: 'paid',
  paymentVerifiedAt: '2026-10-14T12:00:00.000Z',
  status: 'paid',
  createdAt: '2026-10-14T00:00:00.000Z',
};

test('invoice generator returns a PDF for the confirmed order', async () => {
  const pdf = await buildInvoicePdf(paidOrder, 'customer@example.com');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 500);
  assert.match(pdf.toString('latin1'), /%%EOF/);
});
