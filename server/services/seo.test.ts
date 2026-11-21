import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { createSeoRouter } from '../seo.js';
import { defaultStorefrontContent, type Database, type Product } from './database.js';
import { findProductBySlug, productPath } from '../../shared/productUrl.js';
import { copyProductLink, shareProduct } from '../../src/productSharing.js';

test('SEO pages and sitemap reflect the published active catalog', async () => {
  const product: Product = {
    id: 'shirt-1', name: 'Linen & Cotton', description: 'Soft </script> & easy', sku: 'SHIRT-1',
    price: 2490, stock: 2, category: 'Kurta Sets', imageUrl: '/uploads/shirt.webp',
    active: true, ghostMannequin: { tags: [] },
    fabric: 'Cotton & linen', pattern: 'Striped', components: 'Top & trousers', bulletPoints: ['Soft <fabric>'],
  };
  const database: Database = {
    products: [product, { ...product, id: 'shirt-2' }, { ...product, id: 'hidden', active: false }],
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
  const productUrl = productPath(product);

  try {
    const response = await fetch(`${base}${productUrl}`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /<title>Linen &amp; Cotton \| AHUZAH Apparel<\/title>/);
    assert.match(html, /rel="canonical" href="https:\/\/www\.ahuzawear\.com\/products\/linen-cotton--shirt-1"/);
    assert.match(html, /property="og:image" content="https:\/\/www\.ahuzawear\.com\/uploads\/shirt\.webp"/);
    assert.match(html, /<h1>Linen &amp; Cotton<\/h1>/);
    assert.match(html, /Soft &lt;\/script&gt; &amp; easy/);
    assert.match(html, /<dt>Fabric<\/dt><dd>Cotton &amp; linen<\/dd>/);
    assert.match(html, /<dt>Pattern<\/dt><dd>Striped<\/dd>/);
    assert.match(html, /<dt>Specifications \/ components<\/dt><dd>Top &amp; trousers<\/dd>/);
    assert.match(html, /<h2>About this item<\/h2><ul><li>Soft &lt;fabric&gt;<\/li><\/ul>/);
    const schema = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]!);
    assert.equal(schema.offers.price, '2490.00');
    assert.equal(schema.offers.availability, 'https://schema.org/InStock');
    assert.equal(schema.description, product.description);
    assert.equal(schema.aggregateRating, undefined);
    assert.equal((html.match(/<title>/g) || []).length, 1);
    assert.equal((html.match(/rel="canonical"/g) || []).length, 1);

    product.stock = 0;
    const outOfStock = await (await fetch(`${base}${productUrl}`)).text();
    assert.match(outOfStock, /https:\/\/schema.org\/OutOfStock/);
    const collection = await fetch(`${base}/collections/Kurta%20Sets`);
    assert.equal(collection.status, 200);
    assert.match(await collection.text(), /href="\/products\/linen-cotton--shirt-1"/);
    const home = await (await fetch(`${base}/`)).text();
    assert.match(home, /href="\/products\/linen-cotton--shirt-1"/);
    assert.doesNotMatch(home, /--hidden/);
    const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
    assert.match(sitemap, /\/products\/linen-cotton--shirt-1/);
    assert.match(sitemap, /\/products\/linen-cotton--shirt-2/);
    assert.match(sitemap, /\/collections\/Kurta%20Sets/);
    assert.doesNotMatch(sitemap, /--hidden/);
    for (const oldPath of ['/products/shirt-1', '/products/old-name--shirt-1']) {
      const redirect = await fetch(`${base}${oldPath}`, { redirect: 'manual' });
      assert.equal(redirect.status, 301);
      assert.equal(redirect.headers.get('location'), productUrl);
    }
    assert.equal((await fetch(`${base}/products/hidden`)).status, 404);
    assert.equal((await fetch(`${base}/collections/Unknown`)).status, 404);
    database.sitePublished = false;
    assert.equal((await fetch(`${base}${productUrl}`)).status, 503);
    assert.equal((await fetch(`${base}/sitemap.xml`)).status, 503);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('product URLs distinguish duplicate names and resolve old names', () => {
  const first = { id: 'one', name: 'Crème Kurta' };
  const second = { id: 'two', name: 'Crème Kurta' };
  assert.equal(productPath(first), '/products/creme-kurta--one');
  assert.notEqual(productPath(first), productPath(second));
  assert.equal(findProductBySlug([first, second], 'old-name--two'), second);
  assert.equal(productPath({ id: 'three', name: '✨' }), '/products/product--three');
});

test('copy and native share use the canonical product URL and surface unsupported devices', async () => {
  const product = { id: 'one', name: 'Green Kurta' };
  const url = 'https://www.ahuzawear.com/products/green-kurta--one';
  let copied = '';
  let shared: ShareData | undefined;
  await copyProductLink(product, 'https://www.ahuzawear.com', { clipboard: { writeText: async (value) => { copied = value; } } });
  await shareProduct(product, 'https://www.ahuzawear.com', { share: async (data) => { shared = data; } });
  assert.equal(copied, url);
  assert.deepEqual(shared, { title: product.name, url });
  await assert.rejects(copyProductLink(product, 'https://www.ahuzawear.com', {}), /Copying is unavailable/);
  await assert.rejects(shareProduct(product, 'https://www.ahuzawear.com', {}), /Use Copy Link/);
});
