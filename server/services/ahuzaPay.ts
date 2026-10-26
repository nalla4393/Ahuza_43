import type { Order, ShippingAddress } from './database.js';

type AhuzaPayResult = { payUrl: string; status: string; confirmed: boolean; transactionReference: string | null };

export function getAhuzaPayConfiguration(): { configured: boolean; baseUrl: string; apiKey: string } {
  const baseUrl = (process.env.AHUZA_PAY_BASE_URL || '').trim().replace(/\/+$/, '');
  const apiKey = (process.env.AHUZA_PAY_API_KEY || '').trim();
  const secure = /^https:\/\//.test(baseUrl) || /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseUrl);
  return { configured: secure && apiKey.length >= 32, baseUrl, apiKey };
}

async function call(path: string, init: { method: string; body?: unknown }): Promise<any> {
  const { baseUrl, apiKey } = getAhuzaPayConfiguration();
  const response = await fetch(`${baseUrl}/api/merchant${path}`, {
    method: init.method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Ahuza Pay responded ${response.status}`);
  return data;
}

function toResult(data: any): AhuzaPayResult {
  const { baseUrl } = getAhuzaPayConfiguration();
  // Always build the URL from our configured base so a response can never redirect elsewhere.
  const payUrl = typeof data.pay_path === 'string' && /^\/pay\/[A-Za-z0-9_-]+$/.test(data.pay_path) ? `${baseUrl}${data.pay_path}` : '';
  if (!payUrl) throw new Error('Ahuza Pay returned an invalid payment link');
  return { payUrl, status: String(data.payment_status), confirmed: data.order_confirmed === true, transactionReference: typeof data.transaction_reference === 'string' ? data.transaction_reference : null };
}

export async function createAhuzaPayOrder(order: Order, email: string, address: ShippingAddress): Promise<AhuzaPayResult> {
  const lines = [address.addressLine1, address.addressLine2, address.city, address.state, address.postalCode].filter(Boolean).join(', ');
  return toResult(await call('/orders', {
    method: 'POST',
    body: {
      external_order_id: order.id,
      items: order.items.map((item) => ({ name: item.name, size: item.size || '', quantity: item.quantity, unit_price_paise: Math.round(item.unitPrice * 100) })),
      delivery_fee_paise: order.shippingAmount || 0,
      total_amount_paise: order.amount,
      customer_name: address.name,
      customer_email: email,
      customer_phone: address.phone,
      delivery_address: lines,
    },
  }));
}

export async function getAhuzaPayStatus(orderId: string): Promise<AhuzaPayResult> {
  return toResult(await call(`/orders/${encodeURIComponent(orderId)}`, { method: 'GET' }));
}
