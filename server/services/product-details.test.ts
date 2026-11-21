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
import { productIsPurchasable, productPricing, productStockStatus } from '../../shared/productPricing.js';
import { generateProductDescription } from '../../shared/productDescription.js';

test('generated product copy uses entered facts, preserves the intro, and is repeatable', () => {
  const product = { name: 'Linen top', description: 'A relaxed top.', fabric: 'Linen', color: 'Blue' };
  const generated = generateProductDescription(product);
  assert.equal(generated, 'A relaxed top.\n\nProduct details:\nFabric: Linen\nColour: Blue');
  assert.equal(generateProductDescription({ ...product, description: generated }), generated);
  assert.doesNotMatch(generated || '', /cotton|hand wash|occasion/i);
  assert.equal(generateProductDescription({ name: 'Linen top', description: 'A relaxed top.' }), null);
});

test('discount MRP uses the stored selling price and rounded whole-rupee math', () => {
  assert.deepEqual(productPricing(580, 20), { sellingPrice: 580, mrp: 725, discountAmount: 145, discountPercent: 20 });
  assert.deepEqual(productPricing(1000, 20), { sellingPrice: 1000, mrp: 1250, discountAmount: 250, discountPercent: 20 });
  assert.equal(productPricing(580), null);
  assert.equal(productPricing(580, 100), null);
});

test('missing stock status remains backward compatible with numeric inventory', () => {
  assert.equal(productStockStatus({ stock: 3 }), 'in_stock');
  assert.equal(productStockStatus({ stock: 0 }), 'sold_out');
  assert.equal(productStockStatus({ stock: 4, stockStatus: 'limited_stock' }), 'limited_stock');
  assert.equal(productStockStatus({ stock: 4, stockStatus: 'sold_out' }), 'sold_out');
  assert.equal(productIsPurchasable({ stock: 4, stockStatus: 'sold_out' }), false);
  assert.equal(productIsPurchasable({ stock: 4, stockStatus: 'limited_stock' }), true);
});

test('product details render provided fields and omit missing fields', () => {
  const text = (id: keyof typeof defaultStorefrontCopy) => defaultStorefrontCopy[id];
  assert.equal(renderToStaticMarkup(createElement(ProductDetails, { product: {}, text })), '');
  const html = renderToStaticMarkup(createElement(ProductDetails, {
    product: { fabric: 'Cotton & linen', color: 'Blue', fit: 'Relaxed', occasion: 'Everyday', careInstructions: 'Hand wash', components: 'Shirt and trousers', bulletPoints: ['Soft <fabric>', 'Relaxed fit'] },
    text,
  }));
  assert.match(html, /<dt>Fabric<\/dt><dd>Cotton &amp; linen<\/dd>/);
  assert.match(html, /<dt>Colour<\/dt><dd>Blue<\/dd>/);
  assert.match(html, /<dt>Fit<\/dt><dd>Relaxed<\/dd>/);
  assert.match(html, /<dt>Occasion \/ use<\/dt><dd>Everyday<\/dd>/);
  assert.match(html, /<dt>Care instructions<\/dt><dd>Hand wash<\/dd>/);
  assert.match(html, /<dt>Specifications \/ components<\/dt><dd>Shirt and trousers<\/dd>/);
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
      stockStatus: 'limited_stock', discountPercent: 20, color: ' Blue ', fit: ' Relaxed ',
      fabric: ' Cotton ', pattern: 'Solid', components: 'Shirt', bulletPoints: [' Soft ', 'Everyday fit'],
    });
    assert.equal(created.status, 201);
    const { product } = await created.json() as { product: { id: string; price: number; fabric: string; color: string; fit: string; stockStatus: string; discountPercent: number; bulletPoints: string[] } };
    assert.equal(product.fabric, 'Cotton');
    assert.equal(product.color, 'Blue');
    assert.equal(product.fit, 'Relaxed');
    assert.equal(product.stockStatus, 'limited_stock');
    assert.equal(product.discountPercent, 20);
    assert.equal(product.price, 100);
    assert.deepEqual(product.bulletPoints, ['Soft', 'Everyday fit']);
    const url = `/owner/inventory/${product.id}`;
    assert.equal((await request(url, 'PATCH', { bulletPoints: Array(11).fill('Point') })).status, 400);
    assert.equal((await request(url, 'PATCH', { fabric: 7 })).status, 400);
    assert.equal((await request(url, 'PATCH', { stockStatus: 'unavailable' })).status, 400);
    assert.equal((await request(url, 'PATCH', { discountPercent: 100 })).status, 400);
    assert.equal((await request(url, 'PATCH', { bulletPoints: ['x'.repeat(301)] })).status, 400);
    assert.equal((await request(url, 'PATCH', { pattern: 'Striped', stockStatus: 'sold_out', discountPercent: 0 })).status, 200);
    const visible = await (await fetch(`${base}/products/${product.id}`)).json() as { product: { fabric: string; color: string; fit: string; pattern: string; stockStatus: string; discountPercent?: number; price: number; bulletPoints: string[] } };
    assert.equal(visible.product.fabric, 'Cotton');
    assert.equal(visible.product.color, 'Blue');
    assert.equal(visible.product.fit, 'Relaxed');
    assert.equal(visible.product.pattern, 'Striped');
    assert.equal(visible.product.stockStatus, 'sold_out');
    assert.equal(visible.product.discountPercent, undefined);
    assert.equal(visible.product.price, 100);
    assert.deepEqual(visible.product.bulletPoints, ['Soft', 'Everyday fit']);
    assert.equal((await request(url, 'PATCH', { fabric: '', bulletPoints: [] })).status, 200);
    const saved = JSON.parse(await readFile(process.env.DATA_FILE, 'utf8')) as { products: { id: string; price: number; discountPercent?: number; stockStatus?: string; fabric?: string; pattern?: string; bulletPoints?: string[] }[] };
    const persisted = saved.products.find((entry) => entry.id === product.id);
    assert.equal(persisted?.price, 100);
    assert.equal(persisted?.discountPercent, undefined);
    assert.equal(persisted?.stockStatus, 'sold_out');
    assert.equal(persisted?.fabric, '');
    assert.equal(persisted?.pattern, 'Striped');
    assert.deepEqual(persisted?.bulletPoints, []);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
