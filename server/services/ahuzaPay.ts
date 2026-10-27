import type { Order, ShippingAddress } from './database.js';

export type AhuzaPayStatus = { confirmed: boolean; closed: boolean; transactionReference?: string };

export function getAhuzaPayConfiguration(): { configured: boolean; baseUrl: string; apiKey: string } {
  const baseUrl = (process.env.AHUZA_PAY_URL?.trim() || '').replace(/\/+$/, '');
  const apiKey = process.env.AHUZA_PAY_API_KEY?.trim() || '';
  return { configured: /^https:\/\//.test(baseUrl) && apiKey.length >= 32, baseUrl, apiKey };
}

async function callAhuzaPay(path: string, init: { method: string; body?: unknown }): Promise<Record<string, any>> {
  const { configured, baseUrl, apiKey } = getAhuzaPayConfiguration();
  if (!configured) throw new Error('AHUZA_PAY_NOT_CONFIGURED');
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) throw new Error(`AHUZA_PAY_${response.status}${typeof body.error === 'string' ? `: ${body.error}` : ''}`);
  return body;
}

export function buildAhuzaPayOrder(
  order: Pick<Order, 'id' | 'items' | 'shippingAmount' | 'amount'>,
  customer: { name: string; email: string },
  address: ShippingAddress,
) {
  return {
    external_order_id: order.id,
    items: order.items.map((item) => ({
      name: item.name,
      size: item.size || '',
      quantity: item.quantity,
      unit_price_paise: Math.round(item.unitPrice * 100),
    })),
    delivery_fee_paise: order.shippingAmount || 0,
    total_amount_paise: order.amount,
    customer_name: address.name || customer.name,
    customer_email: customer.email,
    customer_phone: address.phone,
    delivery_address: [address.addressLine1, address.addressLine2, address.city, address.state, address.postalCode]
      .filter(Boolean).join(', '),
  };
}

export async function createAhuzaPayOrder(payload: ReturnType<typeof buildAhuzaPayOrder>): Promise<{ payUrl: string }> {
  const body = await callAhuzaPay('/api/merchant/orders', { method: 'POST', body: payload });
  const payUrl = typeof body.pay_url === 'string' ? body.pay_url : '';
  if (!payUrl.startsWith(`${getAhuzaPayConfiguration().baseUrl}/pay/`)) throw new Error('AHUZA_PAY_BAD_RESPONSE');
  return { payUrl };
}

export async function getAhuzaPayStatus(orderId: string): Promise<AhuzaPayStatus> {
  const body = await callAhuzaPay(`/api/merchant/orders/${encodeURIComponent(orderId)}`, { method: 'GET' });
  return {
    confirmed: body.order_confirmed === true && body.payment_status === 'PAID',
    closed: ['CANCELLED', 'EXPIRED', 'FAILED'].includes(body.payment_status),
    ...(typeof body.transaction_reference === 'string' ? { transactionReference: body.transaction_reference } : {}),
  };
}
