import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

test('owner can upload, publish and reset chatbot portrait; in-use image cannot be deleted', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ahuza-chatbot-'));
  process.env.DATA_FILE = path.join(directory, 'db.json');
  process.env.UPLOAD_DIR = path.join(directory, 'uploads');
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
  const ownerHeaders = { 'X-Owner-Key': 'test-owner-key', 'Content-Type': 'application/json' };
  const patch = (value: string, authorized = true) => fetch(`${base}/owner/content`, {
    method: 'PATCH',
    headers: authorized ? ownerHeaders : { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatbotImageUrl: value }),
  });
  try {
    assert.equal((await patch('', false)).status, 403);
    assert.equal((await patch('javascript:alert(1)')).status, 400);
    const imageBytes = await readFile('public/beulah-avatar.jpg');
    const upload = await fetch(`${base}/owner/images`, { method: 'POST', headers: { 'X-Owner-Key': 'test-owner-key', 'Content-Type': 'image/jpeg' }, body: imageBytes });
    assert.equal(upload.status, 201);
    const { image } = await upload.json() as { image: { id: string; url: string } };
    assert.equal((await patch(image.url)).status, 200);
    const storefront = await (await fetch(`${base}/storefront`)).json() as { content: { chatbotImageUrl: string } };
    assert.equal(storefront.content.chatbotImageUrl, image.url);
    assert.equal((await fetch(`${base}/owner/images/${image.id}`, { method: 'DELETE', headers: ownerHeaders })).status, 409);
    assert.equal((await patch('')).status, 200);
    const reset = await (await fetch(`${base}/storefront`)).json() as { content: { chatbotImageUrl: string } };
    assert.equal(reset.content.chatbotImageUrl, '');
    assert.equal((await fetch(`${base}/owner/images/${image.id}`, { method: 'DELETE', headers: ownerHeaders })).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
