import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Order } from './database.js';

const API_URL = 'https://www.instamojo.com/api/1.1/payment-requests/';

export function instamojoConfigured(): boolean {
  return Boolean(process.env.INSTAMOJO_API_KEY?.trim() && process.env.INSTAMOJO_AUTH_TOKEN?.trim());
}

export function instamojoWebhookConfigured(): boolean {
  return Boolean(process.env.INSTAMOJO_SALT?.trim());
}

export function instamojoAmountInPaise(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const amount = String(value);
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  if (!match) return null;
  const paise = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(paise) ? paise : null;
}

export function verifyInstamojoWebhook(data: unknown): boolean {
  if (!instamojoWebhookConfigured() || !data || typeof data !== 'object' || Array.isArray(data)) return false;
  const values = data as Record<string, unknown>;
  if (typeof values.mac !== 'string' || !/^[a-f\d]{40}$/i.test(values.mac)) return false;
  const fields = Object.entries(values).filter(([key]) => key.toLowerCase() !== 'mac');
  if (fields.some(([, value]) => typeof value !== 'string')) return false;
  fields.sort(([left], [right]) => {
    const a = left.toLowerCase();
    const b = right.toLowerCase();
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const message = fields.map(([, value]) => value).join('|');
  const calculated = createHmac('sha1', process.env.INSTAMOJO_SALT!.trim()).update(message).digest();
  const provided = Buffer.from(values.mac, 'hex');
  return provided.length === calculated.length && timingSafeEqual(provided, calculated);
}

async function request(path: string, method: 'GET' | 'POST', body?: URLSearchParams): Promise<Record<string, unknown>> {
  if (!instamojoConfigured()) throw new Error('Instamojo is not configured');
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'X-Api-Key': process.env.INSTAMOJO_API_KEY!.trim(),
      'X-Auth-Token': process.env.INSTAMOJO_AUTH_TOKEN!.trim(),
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(body ? { body } : {}),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Instamojo returned HTTP ${response.status}`);
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('success' in data) || data.success !== true) throw new Error('Instamojo returned an invalid response');
  return data as Record<string, unknown>;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Instamojo payment request');
  return value as Record<string, unknown>;
}

export async function createInstamojoRequest(order: Order, email: string): Promise<{ requestId: string; payUrl: string }> {
  const fields: Record<string, string> = {
    amount: (order.amount / 100).toFixed(2),
    purpose: `AHUZA order ${order.id}`,
    buyer_name: order.shippingAddress.name,
    email,
    phone: order.shippingAddress.phone,
    redirect_url: process.env.INSTAMOJO_REDIRECT_URL || 'https://www.ahuzawear.com/',
    allow_repeated_payments: 'false',
    send_email: 'false',
    send_sms: 'false',
  };
  if (instamojoWebhookConfigured()) {
    fields.webhook = process.env.INSTAMOJO_WEBHOOK_URL?.trim() || 'https://www.ahuzawear.com/api/payments/instamojo/webhook';
  }
  const body = new URLSearchParams(fields);
  const payment = object((await request('', 'POST', body)).payment_request);
  if (typeof payment.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(payment.id) || typeof payment.longurl !== 'string') throw new Error('Invalid Instamojo creation response');
  const url = new URL(payment.longurl);
  if (url.protocol !== 'https:' || !['www.instamojo.com', 'instamojo.com'].includes(url.hostname) || url.username || url.password) throw new Error('Invalid Instamojo payment URL');
  return { requestId: payment.id, payUrl: url.href };
}

export function parseInstamojoStatus(data: unknown, requestId: string, amountPaise: number): { confirmed: boolean; transactionReference?: string } {
  const paymentRequest = object(object(data).payment_request);
  if (paymentRequest.id !== requestId || instamojoAmountInPaise(paymentRequest.amount) !== amountPaise) throw new Error('Instamojo request does not match order');
  if (!Array.isArray(paymentRequest.payments)) throw new Error('Instamojo payment list missing');
  const payments = paymentRequest.payments.map(object);
  const paid = payments.filter((payment) => typeof payment.status === 'string' && payment.status.toLowerCase() === 'credit');
  if (paid.length > 1) throw new Error('Multiple Instamojo payments require review');
  if (!paid.length) return { confirmed: false };
  const payment = paid[0];
  if (typeof payment.payment_id !== 'string' || !payment.payment_id
      || instamojoAmountInPaise(payment.amount) !== amountPaise
      || (payment.currency !== undefined && payment.currency !== 'INR')) throw new Error('Instamojo payment does not match order');
  return { confirmed: true, transactionReference: payment.payment_id };
}

export async function getInstamojoStatus(requestId: string, amountPaise: number) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) throw new Error('Invalid Instamojo request ID');
  return parseInstamojoStatus(await request(`${encodeURIComponent(requestId)}/`, 'GET'), requestId, amountPaise);
}
