import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { paymentWebhook } from './webhookVerifier.js';

test('payment webhook verifies the exact body and never acknowledges an unimplemented payment', async () => {
  const previous = process.env.WEBHOOK_SECRET;
  const app = express();
  app.use('/api/webhooks/payment', paymentWebhook);
  app.use(express.json());
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/webhooks/payment`;
  const body = '{ "status": "SUCCESS", "orderId": "order-1" }';
  const signature = createHmac('sha256', 'test-secret').update(body).digest('hex');
  const send = (payload: string, sig?: string, contentType = 'application/json') => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': contentType, ...(sig ? { 'x-signature': sig } : {}) },
    body: payload,
  });
  try {
    delete process.env.WEBHOOK_SECRET;
    assert.equal((await send(body, signature)).status, 503);
    process.env.WEBHOOK_SECRET = 'test-secret';
    assert.equal((await send(body)).status, 401);
    assert.equal((await send(body, 'bad')).status, 403);
    assert.equal((await send(body, '0'.repeat(64))).status, 403);
    assert.equal((await send(JSON.stringify(JSON.parse(body)), signature)).status, 403);
    assert.equal((await send(body, signature, 'text/plain')).status, 400);
    const acceptedSignature = await send(body, signature);
    assert.equal(acceptedSignature.status, 503);
    assert.match((await acceptedSignature.json() as { error: string }).error, /requires? owner review/i);
  } finally {
    if (previous === undefined) delete process.env.WEBHOOK_SECRET; else process.env.WEBHOOK_SECRET = previous;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
