import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ManualPaymentInstructions from '../../src/ManualPaymentInstructions.js';

test('manual payment instructions explain the pending flow before and after checkout', () => {
  for (const orderId of [undefined, 'ORDER-123']) {
    const markup = renderToStaticMarkup(createElement(ManualPaymentInstructions, { email: 'support@example.com', orderId }));
    assert.match(markup, /only after AHUZA manually verifies the bank credit/);
    assert.match(markup, /If it does not appear after you pay/);
    assert.match(markup, /Upload your payment screenshot/);
    assert.match(markup, /bank transaction reference/);
    assert.match(markup, /screenshot is for reference only, not proof of payment/);
    assert.match(markup, /order changes to Paid/);
    assert.match(markup, /Do not share your UPI PIN or OTP/);
    assert.match(markup, /mailto:support@example.com/);
    if (orderId) assert.match(markup, /ORDER-123/);
  }
});
