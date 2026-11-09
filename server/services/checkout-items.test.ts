import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CheckoutItems from '../../src/CheckoutItems.js';

test('checkout shows item details and quantity and removal controls', () => {
  const markup = renderToStaticMarkup(createElement(CheckoutItems, {
    items: [{ id: 'one', name: 'Jacket', imageUrl: '/jacket.jpg', size: 'M', quantity: 2, unitPrice: '₹100', lineTotal: '₹200', canIncrease: true }],
    busy: false,
    onChangeQuantity: () => {},
    onRemove: () => {},
    onContinueShopping: () => {},
  }));
  assert.match(markup, /src="\/jacket.jpg"/);
  assert.match(markup, /Size M/);
  assert.match(markup, /Quantity 2/);
  assert.match(markup, /₹200/);
  assert.match(markup, /Add one Jacket size M/);
  assert.match(markup, /Remove one Jacket size M/);
  assert.match(markup, /Remove Jacket size M from order/);
  assert.match(markup, /Add products/);
});

test('checkout disables edits while placing an order', () => {
  const markup = renderToStaticMarkup(createElement(CheckoutItems, {
    items: [{ id: 'one', name: 'Jacket', imageUrl: '/jacket.jpg', quantity: 1, unitPrice: '₹100', lineTotal: '₹100', canIncrease: true }],
    busy: true,
    onChangeQuantity: () => {},
    onRemove: () => {},
    onContinueShopping: () => {},
  }));
  assert.equal((markup.match(/disabled=""/g) || []).length, 4);
});
