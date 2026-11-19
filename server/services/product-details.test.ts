import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ProductDetails from '../../src/ProductDetails.js';
import { defaultStorefrontCopy } from '../../shared/storefrontCopy.js';

test('product details render provided fields and omit missing fields', () => {
  const text = (id: keyof typeof defaultStorefrontCopy) => defaultStorefrontCopy[id];
  assert.equal(renderToStaticMarkup(createElement(ProductDetails, { product: {}, text })), '');
  const html = renderToStaticMarkup(createElement(ProductDetails, {
    product: { fabric: 'Cotton & linen', components: 'Shirt and trousers', bulletPoints: ['Soft <fabric>', 'Relaxed fit'] },
    text,
  }));
  assert.match(html, /<dt>Fabric<\/dt><dd>Cotton &amp; linen<\/dd>/);
  assert.match(html, /<dt>Components<\/dt><dd>Shirt and trousers<\/dd>/);
  assert.doesNotMatch(html, /<dt>Pattern<\/dt>/);
  assert.match(html, /<h3>About this item<\/h3>/);
  assert.match(html, /<li>Soft &lt;fabric&gt;<\/li><li>Relaxed fit<\/li>/);
});

test('owner can save, update and clear validated product details', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ahuza-product-details-'));
  process.env.DATA_FILE = path.join(directory, 'db.json');
  process.env.OWNER_API_KEY = 'test-owner-key';
  const { api } = await import('../routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api', api);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api`;
  const headers = { 'X-Owner-Key': 'test-owner-key', 'Content-Type': 'application/json' };
  const request = (url: string, method: string, body: object) => fetch(`${base}${url}`, { method, headers, body: JSON.stringify(body) });

  try {
    const created = await request('/owner/inventory', 'POST', {
      name: 'Test shirt', description: 'A shirt', price: 100, sku: 'TEST-DETAILS',
      stock: 1, category: 'Shirts', imageUrl: 'https://example.com/shirt.jpg',
      fabric: ' Cotton ', pattern: 'Solid', components: 'Shirt', bulletPoints: [' Soft ', 'Everyday fit'],
    });
    assert.equal(created.status, 201);
    const { product } = await created.json() as { product: { id: string; fabric: string; bulletPoints: string[] } };
    assert.equal(product.fabric, 'Cotton');
    assert.deepEqual(product.bulletPoints, ['Soft', 'Everyday fit']);
    const url = `/owner/inventory/${product.id}`;
    assert.equal((await request(url, 'PATCH', { bulletPoints: Array(11).fill('Point') })).status, 400);
    assert.equal((await request(url, 'PATCH', { fabric: 7 })).status, 400);
    assert.equal((await request(url, 'PATCH', { bulletPoints: ['x'.repeat(301)] })).status, 400);
    assert.equal((await request(url, 'PATCH', { pattern: 'Striped' })).status, 200);
    const visible = await (await fetch(`${base}/products/${product.id}`)).json() as { product: { fabric: string; pattern: string; bulletPoints: string[] } };
    assert.equal(visible.product.fabric, 'Cotton');
    assert.equal(visible.product.pattern, 'Striped');
    assert.deepEqual(visible.product.bulletPoints, ['Soft', 'Everyday fit']);
    assert.equal((await request(url, 'PATCH', { fabric: '', bulletPoints: [] })).status, 200);
    const saved = JSON.parse(await readFile(process.env.DATA_FILE, 'utf8')) as { products: { id: string; fabric?: string; pattern?: string; bulletPoints?: string[] }[] };
    const persisted = saved.products.find((entry) => entry.id === product.id);
    assert.equal(persisted?.fabric, '');
    assert.equal(persisted?.pattern, 'Striped');
    assert.deepEqual(persisted?.bulletPoints, []);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
