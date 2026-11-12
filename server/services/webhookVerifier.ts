import { createHmac, timingSafeEqual } from 'node:crypto';
import express, { type RequestHandler } from 'express';

export const verifyWebhookSignature: RequestHandler = (request, response, next) => {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    response.status(503).json({ error: 'Webhook secret is not configured on the server.' });
    return;
  }
  const signature = request.get('x-signature');
  if (!signature) {
    response.status(401).json({ error: 'Missing webhook signature header.' });
    return;
  }
  if (!Buffer.isBuffer(request.body)) {
    response.status(400).json({ error: 'Expected a raw JSON webhook body.' });
    return;
  }
  if (!/^[0-9a-f]{64}$/i.test(signature)) {
    response.status(403).json({ error: 'Invalid webhook signature.' });
    return;
  }
  const expected = createHmac('sha256', secret).update(request.body).digest();
  if (!timingSafeEqual(Buffer.from(signature, 'hex'), expected)) {
    response.status(403).json({ error: 'Invalid webhook signature.' });
    return;
  }
  next();
};

export const paymentWebhook = express.Router();
paymentWebhook.post('/',
  express.raw({ type: 'application/json', limit: '32kb', inflate: false }),
  verifyWebhookSignature,
  (_request, response) => {
    response.status(503).json({ error: 'Automatic payment verification is not configured. Payments require owner review.' });
  },
);
