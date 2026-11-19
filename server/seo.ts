import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Database, Product } from './services/database.js';
import { mergeStorefrontCopy, type StorefrontCopy } from '../shared/storefrontCopy.js';
import { findProductBySlug, productPath } from '../shared/productUrl.js';

const origin = 'https://www.ahuzawear.com';
const defaultImage = `${origin}/ahuza-brand-social.jpg`;
const categoryPath = (category: string) => `/collections/${encodeURIComponent(category)}`;
const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

function imageUrl(product: Product): string {
  const image = product.images?.find((entry) => entry.id === product.mainImageId) || product.images?.[0];
  const candidate = image?.url || product.ghostMannequin?.imageUrl || product.imageUrl;
  if (!candidate) return defaultImage;
  try {
    const url = new URL(candidate, origin);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch {
    // Older catalog entries may contain invalid image URLs.
  }
  return defaultImage;
}

function meta(title: string, description: string, url: string, image: string, type: 'website' | 'product', schema: object): string {
  const json = JSON.stringify(schema).replace(/</g, '\\u003c');
  return `<title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${escape(url)}">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="AHUZA Wear">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(description)}">
<meta property="og:url" content="${escape(url)}">
<meta property="og:image" content="${escape(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escape(title)}">
<meta name="twitter:description" content="${escape(description)}">
<meta name="twitter:image" content="${escape(image)}">
<script type="application/ld+json">${json}</script>`;
}

function productPage(product: Product, copy: StorefrontCopy): { head: string; body: string } {
  const url = origin + productPath(product);
  const image = imageUrl(product);
  const title = `${product.name} | AHUZA Apparel`;
  const description = product.description || `Shop ${product.name} at AHUZA Apparel.`;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description,
    image: [image],
    sku: product.sku,
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'INR',
      price: product.price.toFixed(2),
      availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    },
  };
  const price = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(product.price);
  const attributes = [
    { label: copy.detailFabric, value: product.fabric },
    { label: copy.detailPattern, value: product.pattern },
    { label: copy.detailComponents, value: product.components },
  ].filter((entry): entry is { label: string; value: string } => Boolean(entry.value));
  const details = attributes.length ? `<dl>${attributes.map(({ label, value }) => `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`).join('')}</dl>` : '';
  const highlights = product.bulletPoints?.length ? `<h2>${escape(copy.detailBulletPoints)}</h2><ul>${product.bulletPoints.map((point) => `<li>${escape(point)}</li>`).join('')}</ul>` : '';
  const body = `<main><a href="/">AHUZA Apparel</a><h1>${escape(product.name)}</h1><p>${escape(description)}</p><img src="${escape(image)}" alt="${escape(product.name)}" width="400"><p>${escape(price)}</p><p>${product.stock > 0 ? 'In stock' : 'Out of stock'}</p><p>SKU: ${escape(product.sku)}</p>${details}${highlights}<a href="/">Shop the collection</a></main>`;
  return { head: meta(title, description, url, image, 'product', schema), body };
}

function collectionPage(category: string, products: Product[]): { head: string; body: string } {
  const url = origin + categoryPath(category);
  const title = `${category} | AHUZA Apparel`;
  const description = `Explore ${category} at AHUZA Apparel. Shop our collection online.`;
  const schema = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, description, url };
  const items = products.map((product) => `<li><a href="${escape(productPath(product))}">${escape(product.name)}</a></li>`).join('');
  return { head: meta(title, description, url, imageUrl(products[0]!), 'website', schema), body: `<main><a href="/">AHUZA Apparel</a><h1>${escape(category)}</h1><p>${escape(description)}</p><ul>${items}</ul></main>` };
}

export function createSeoRouter(frontendPath: string, loadDatabase: () => Promise<Database>): Router {
  const router = Router();

  router.get('/sitemap.xml', async (_request, response) => {
    const database = await loadDatabase();
    response.set('Cache-Control', 'no-store');
    if (database.sitePublished === false) {
      response.status(503).type('text').send('Storefront temporarily unavailable');
      return;
    }
    const products = database.products.filter((product) => product.active);
    const categories = [...new Set(products.map((product) => product.category).filter(Boolean))];
    const urls = ['/', '/terms.html', ...products.map(productPath), ...categories.map(categoryPath)];
    response.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${escape(origin + url)}</loc></url>`).join('')}</urlset>`);
  });

  router.get('/', async (_request, response) => {
    const database = await loadDatabase();
    response.set('Cache-Control', 'no-store');
    const template = await readFile(path.join(frontendPath, 'index.html'), 'utf8');
    if (database.sitePublished === false) {
      response.set('X-Robots-Tag', 'noindex');
      response.type('html').send(template);
      return;
    }
    const links = database.products.filter((product) => product.active)
      .map((product) => `<li><a href="${escape(productPath(product))}">${escape(product.name)}</a></li>`).join('');
    if (!template.includes('<div id="root"></div>')) throw new Error('Storefront root is missing');
    response.type('html').send(template.replace('<div id="root"></div>', () => `<div id="root"><main><h1>AHUZA Wear</h1><ul>${links}</ul></main></div>`));
  });

  router.get(['/products/:slug', '/collections/:category'], async (request, response) => {
    const database = await loadDatabase();
    response.set('Cache-Control', 'no-store');
    if (database.sitePublished === false) {
      response.set('X-Robots-Tag', 'noindex');
      response.status(503).type('text').send('Storefront temporarily unavailable');
      return;
    }
    const products = database.products.filter((product) => product.active);
    const product = typeof request.params.slug === 'string' ? findProductBySlug(products, request.params.slug) : undefined;
    const category = typeof request.params.category === 'string' ? request.params.category : '';
    const matches = category ? products.filter((entry) => entry.category === category) : [];
    if (!product && !matches.length) {
      response.set('X-Robots-Tag', 'noindex');
      response.status(404).type('text').send('Page not found');
      return;
    }
    if (product && request.path !== productPath(product)) {
      response.redirect(301, productPath(product));
      return;
    }
    const page = product ? productPage(product, mergeStorefrontCopy(database.content.copy)) : collectionPage(category, matches);
    const template = await readFile(path.join(frontendPath, 'index.html'), 'utf8');
    if (!template.includes('<!-- SEO_START -->') || !template.includes('<!-- SEO_END -->') || !template.includes('<div id="root"></div>')) {
      throw new Error('Storefront SEO template markers are missing');
    }
    const html = template.replace(/<!-- SEO_START -->[\s\S]*?<!-- SEO_END -->/, () => `<!-- SEO_START -->${page.head}<!-- SEO_END -->`)
      .replace('<div id="root"></div>', () => `<div id="root">${page.body}</div>`);
    response.type('html').send(html);
  });

  return router;
}
