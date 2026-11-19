import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';
import jsQR from 'jsqr';
import sharp from 'sharp';
import PaymentQr from '../../src/PaymentQr.js';

test('checkout displays the supplied static QR and its code is scannable', async () => {
  const markup = renderToStaticMarkup(createElement(PaymentQr, { reference: 'AHUZA-123456' }));
  assert.match(markup, /src="\/ahuza-upi-qr\.png"/);
  assert.match(markup, /AHUZA-123456/);
  const qr = await readFile('public/ahuza-upi-qr.png');
  const { data, info } = await sharp(qr).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  assert.ok(decoded?.data.startsWith('upi://pay?'));
});
