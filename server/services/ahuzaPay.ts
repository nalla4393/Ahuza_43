import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Order } from './database.js';

export function ahuzaPayConfiguration(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = (process.env.AHUZA_PAY_BASE_URL || '').trim().replace(/\/+$/, '');
  const apiKey = (process.env.AHUZA_PAY_API_KEY || '').trim();
  const webhookSecret = (process.env.AHUZA_PAY_WEBHOOK_SECRET || '').trim();
  if (!baseUrl && !apiKey) return null;
  const url = new URL(baseUrl);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
      || url.username || url.password || url.search || url.hash || apiKey.length < 32 || webhookSecret.length < 32) {
    throw new Error('Invalid Ahuza Pay configuration');
  }
  return { baseUrl, apiKey };
}

export async function createAhuzaPayOrder(order: Order, email: string): Promise<string> {
  const config = ahuzaPayConfiguration();
  if (!config) throw new Error('Ahuza Pay is not configured');
  const address = order.shippingAddress;
  const response = await fetch(`${config.baseUrl}/api/merchant/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      external_order_id: order.id,
      items: order.items.map((item) => ({
        name: item.name, size: item.size || '', quantity: item.quantity,
        unit_price_paise: Math.round(item.unitPrice * 100),
      })),
      delivery_fee_paise: order.shippingAmount || 0,
      total_amount_paise: order.amount,
      customer_name: address.name, customer_email: email, customer_phone: address.phone,
      delivery_address: [address.addressLine1, address.addressLine2, address.city, address.state, address.postalCode].filter(Boolean).join(', '),
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Ahuza Pay returned HTTP ${response.status}`);
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('pay_path' in data)
      || typeof data.pay_path !== 'string' || !/^\/pay\/[A-Za-z0-9_-]+$/.test(data.pay_path)) {
    throw new Error('Ahuza Pay returned an invalid payment path');
  }
  return config.baseUrl + data.pay_path;
}

export function verifyAhuzaPayWebhook(body: Buffer, timestamp: string, signature: string, now = Date.now()): boolean {
  const secret = process.env.AHUZA_PAY_WEBHOOK_SECRET || '';
  if (secret.length < 32 || !/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300
      || !/^sha256=[0-9a-f]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}
