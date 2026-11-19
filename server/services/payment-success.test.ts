import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PaymentSuccess from '../../src/PaymentSuccess.js';

const props = {
  orderId: 'order-123',
  amount: '₹2,613.45',
  reference: 'AHUZA-123',
  items: [{ name: 'Soft Form Shirt', quantity: 2, size: 'M' }],
  onContinueShopping: () => {},
  onViewOrders: () => {},
};

test('payment confirmation shows the order details and next steps', () => {
  const markup = renderToStaticMarkup(createElement(PaymentSuccess, { ...props, needsReview: false }));
  assert.match(markup, /Payment successful/);
  assert.match(markup, /order is confirmed/);
  assert.match(markup, /₹2,613\.45/);
  assert.match(markup, /order-123/);
  assert.match(markup, /AHUZA-123/);
  assert.match(markup, /Soft Form Shirt · Size M/);
  assert.match(markup, /Qty 2/);
  assert.match(markup, /View order/);
  assert.match(markup, /Continue shopping/);
});

test('payment received for an order needing review does not claim confirmation', () => {
  const markup = renderToStaticMarkup(createElement(PaymentSuccess, { ...props, needsReview: true }));
  assert.match(markup, /Payment received/);
  assert.match(markup, /order needs review/);
  assert.doesNotMatch(markup, /order is confirmed|Payment successful/);
});
