import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { createSeoRouter } from '../seo.js';
import { defaultStorefrontContent, type Database, type Product } from './database.js';

test('SEO pages and sitemap reflect the published active catalog', async () => {
  const product: Product = {
    id: 'shirt-1', name: 'Linen & Cotton', description: 'Soft </script> & easy', sku: 'SHIRT-1',
    price: 2490, stock: 2, category: 'Kurta Sets', imageUrl: '/uploads/shirt.webp',
    active: true, ghostMannequin: { tags: [] },
  };
  const database: Database = {
    products: [product, { ...product, id: 'hidden', active: false }],
    customers: [], orders: [], events: [], supportTickets: [], content: structuredClone(defaultStorefrontContent),
    sitePublished: true,
  };
  const app = express();
  app.use(createSeoRouter(path.resolve('.'), async () => database));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${base}/products/shirt-1`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /<title>Linen &amp; Cotton \| AHUZA Apparel<\/title>/);
    assert.match(html, /rel="canonical" href="https:\/\/www\.ahuzawear\.com\/products\/shirt-1"/);
    assert.match(html, /property="og:image" content="https:\/\/www\.ahuzawear\.com\/uploads\/shirt\.webp"/);
    assert.match(html, /<h1>Linen &amp; Cotton<\/h1>/);
    assert.match(html, /Soft &lt;\/script&gt; &amp; easy/);
    const schema = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]!);
    assert.equal(schema.offers.price, '2490.00');
    assert.equal(schema.offers.availability, 'https://schema.org/InStock');
    assert.equal(schema.description, product.description);
    assert.equal(schema.aggregateRating, undefined);
    assert.equal((html.match(/<title>/g) || []).length, 1);
    assert.equal((html.match(/rel="canonical"/g) || []).length, 1);

    product.stock = 0;
    const outOfStock = await (await fetch(`${base}/products/shirt-1`)).text();
    assert.match(outOfStock, /https:\/\/schema.org\/OutOfStock/);
    const collection = await fetch(`${base}/collections/Kurta%20Sets`);
    assert.equal(collection.status, 200);
    assert.match(await collection.text(), /href="\/products\/shirt-1"/);
    const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
    assert.match(sitemap, /\/products\/shirt-1/);
    assert.match(sitemap, /\/collections\/Kurta%20Sets/);
    assert.doesNotMatch(sitemap, /\/products\/hidden/);
    assert.equal((await fetch(`${base}/products/hidden`)).status, 404);
    assert.equal((await fetch(`${base}/collections/Unknown`)).status, 404);
    database.sitePublished = false;
    assert.equal((await fetch(`${base}/products/shirt-1`)).status, 503);
    assert.equal((await fetch(`${base}/sitemap.xml`)).status, 503);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
