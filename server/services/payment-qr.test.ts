import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import jsQR from 'jsqr';
import sharp from 'sharp';
import PaymentQr from '../../src/PaymentQr.js';
import { manualUpiLink } from './manualUpi.js';

test('checkout QR is scannable and contains the exact UPI payment details', async () => {
  const payUrl = manualUpiLink({ vpa: 'store@example', payee: 'Test Store' }, 250099, 'AHUZA-123456');
  const markup = renderToStaticMarkup(createElement(PaymentQr, { payUrl }));
  const svg = markup.match(/<svg[\s\S]*?<\/svg>/)?.[0];
  assert.ok(svg, 'payment QR must render an SVG');
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  assert.equal(decoded?.data, payUrl);
});
