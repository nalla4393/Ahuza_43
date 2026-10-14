import { getDatabase, mutateDatabase, type Order, type StoreEvent, type SupportTicket } from './database.js';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { runAutomations } from './automations.js';
import { generateOrderEmailBody, type OrderEmailKind } from './ai.js';

type IntegrationEvent = { name: string; orderId?: string; amount?: number; currency?: string; page?: string; campaign?: string; consent?: boolean };

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<void> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Integration returned HTTP ${response.status}`);
}

type WebhookTestResult = { configured: boolean; accepted: boolean; status?: number };

export async function getMarketingWebhookUrls(): Promise<{ zapier?: string; googleAds?: string }> {
  const database = await getDatabase();
  return {
    zapier: (database.integrationWebhooks?.zapier ?? process.env.ZAPIER_WEBHOOK_URL) || undefined,
    googleAds: (database.integrationWebhooks?.googleAds ?? process.env.GOOGLE_ADS_WEBHOOK_URL) || undefined,
  };
}

async function testWebhook(url: string | undefined, body: unknown): Promise<WebhookTestResult> {
  if (!url) return { configured: false, accepted: false };
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    return { configured: true, accepted: response.ok, status: response.status };
  } catch {
    return { configured: true, accepted: false };
  }
}

export async function testMarketingWebhooks(): Promise<{ zapier: WebhookTestResult; googleAds: WebhookTestResult }> {
  const occurredAt = new Date().toISOString();
  const urls = await getMarketingWebhookUrls();
  const [zapier, googleAds] = await Promise.all([
    testWebhook(urls.zapier, { name: 'owner_integration_test', testMode: true, occurredAt }),
    testWebhook(urls.googleAds, { eventName: 'integration_test', testMode: true, source: 'ahuza_owner_studio', occurredAt }),
  ]);
  return { zapier, googleAds };
}

export async function triggerAutomations(event: IntegrationEvent): Promise<void> {
  const urls = await getMarketingWebhookUrls();
  if (urls.zapier) {
    try { await postJson(urls.zapier, { ...event, occurredAt: new Date().toISOString() }); }
    catch (error) { console.error('Zapier webhook failed:', error); }
  }
  if (event.name === 'purchase' && event.consent === true && urls.googleAds) {
    try { await postJson(urls.googleAds, { eventName: event.name, transactionId: event.orderId, value: event.amount, currency: event.currency }); }
    catch (error) { console.error('Google Ads conversion hook failed:', error); }
  }
}

export async function notifySupportTicket(ticket: SupportTicket): Promise<void> {
  if (!isEmailConfigured()) throw new Error('Email is not configured.');
  await sendEmail('Info@ahuzawear.com', `Customer support ticket ${ticket.id}`, `A customer support ticket needs follow-up.\n\nReference: ${ticket.id}\nCategory: ${ticket.category}\nCustomer: ${ticket.email}\nCreated: ${ticket.createdAt}\n\n${ticket.message}\n\nPlease respond within 48 working hours.`);
}

export async function recordMarketingEvent(event: Omit<StoreEvent, 'id' | 'createdAt'>): Promise<void> {
  await mutateDatabase((database) => {
    database.events.push({ id: randomUUID(), ...event, createdAt: new Date().toISOString() });
    if (database.events.length > 10000) database.events.splice(0, database.events.length - 10000);
  });
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() || (process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS));
}

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const from = process.env.EMAIL_FROM || (process.env.SMTP_USER ? `Ahuza Apparel <${process.env.SMTP_USER}>` : 'Ahuza Apparel <onboarding@resend.dev>');
  if (process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS) {
    const port = Number(process.env.SMTP_PORT) || 465;
    const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST.trim(), port, secure: port === 465, auth: { user: process.env.SMTP_USER.trim(), pass: process.env.SMTP_PASS }, connectionTimeout: 10000, socketTimeout: 15000 });
    await transport.sendMail({ from, to, subject, text });
    return;
  }
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.info(`[email not configured] ${subject} -> ${to}`);
    return;
  }
  await postJson('https://api.resend.com/emails', { from, to: [to], subject, text }, { Authorization: 'Bearer ' + apiKey });
}

const orderEmailSubjects: Record<OrderEmailKind, (id: string) => string> = {
  order_placed: (id) => `We've received your Ahuza order ${id}`,
  payment_confirmed: (id) => `Payment confirmed for your Ahuza order ${id}`,
  shipped: (id) => `Your Ahuza order ${id} is on its way`,
  follow_up: () => 'How are you enjoying your Ahuza pieces?',
};

function fallbackOrderEmail(kind: OrderEmailKind, order: Order): string {
  const total = `${order.currency} ${(order.amount / 100).toFixed(2)}`;
  if (kind === 'order_placed') return order.paymentMethod === 'cod'
    ? `Hi ${order.shippingAddress.name}, your order ${order.id} (${total}) has been placed successfully and is confirmed.\n\nAHUZA Customer Care`
    : `Hi ${order.shippingAddress.name}, we've received your order ${order.id} (${total}). Your payment is not confirmed yet; we will email you once it is verified.\n\nAHUZA Customer Care`;
  if (kind === 'payment_confirmed') return `Hi ${order.shippingAddress.name}, your payment for order ${order.id} (${total}) is verified and your order is confirmed.\n\nAHUZA Customer Care`;
  if (kind === 'shipped') return `Hi ${order.shippingAddress.name}, your order ${order.id} has shipped.${order.trackingNumber ? ` Tracking number: ${order.trackingNumber}.` : ''}\n\nAHUZA Customer Care`;
  return `Hi ${order.shippingAddress.name}, we hope your order ${order.id} feels right at home. You can request a return or replacement within 7 days of delivery.\n\nAHUZA Customer Care`;
}

export async function sendOrderEmail(kind: OrderEmailKind, order: Order, email: string): Promise<void> {
  if (!isEmailConfigured()) return;
  const details = JSON.stringify({
    customerName: order.shippingAddress.name,
    orderReference: order.id,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    status: order.status,
    items: order.items.map(({ name, quantity, size }) => ({ name, quantity, ...(size ? { size } : {}) })),
    total: `${order.currency} ${(order.amount / 100).toFixed(2)}`,
    trackingNumber: order.trackingNumber || 'Not provided',
  });
  let body: string;
  try { body = await generateOrderEmailBody(kind, details); }
  catch (error) { console.error('AI email draft failed; using template:', error instanceof Error ? error.message : error); body = fallbackOrderEmail(kind, order); }
  await sendEmail(email, orderEmailSubjects[kind](order.id), body);
}

export async function sendOrderConfirmation(order: Order, email: string): Promise<void> {
  await sendOrderEmail('payment_confirmed', order, email);
}

export async function sendShippingNotice(order: Order, email: string): Promise<void> {
  await sendOrderEmail('shipped', order, email);
}

export async function sendSevenDayFollowUps(): Promise<void> {
  if (!isEmailConfigured()) return;
  const now = Date.now();
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  const candidates = (await getDatabase()).orders.filter((order) => order.status === 'delivered' && !order.followUpSentAt && order.deliveredAt && new Date(order.deliveredAt).getTime() <= cutoff);
  for (const candidate of candidates) {
    const customer = (await getDatabase()).customers.find((entry) => entry.id === candidate.userId);
    if (!customer) continue;
    try {
      await sendOrderEmail('follow_up', candidate, customer.email);
      await mutateDatabase((database) => {
        const order = database.orders.find((entry) => entry.id === candidate.id);
        if (order && !order.followUpSentAt) order.followUpSentAt = new Date().toISOString();
      });
    } catch (error) { console.error(`Follow-up failed for order ${candidate.id}:`, error); }
  }
}

export function startFollowUpScheduler(): void {
  void sendSevenDayFollowUps().catch((error) => console.error('Follow-up scan failed:', error));
  void runAutomations().catch((error) => console.error('Automation scan failed:', error));
  setInterval(() => void runAutomations().catch((error) => console.error('Automation scan failed:', error)), 15 * 60 * 1000).unref();
  const timer = setInterval(() => void sendSevenDayFollowUps().catch((error) => console.error('Follow-up scan failed:', error)), 60 * 60 * 1000);
  timer.unref();
}

export async function expirePendingOrders(): Promise<void> {
  const now = Date.now();
  const expiredOrders = (await getDatabase()).orders.filter((order) => order.paymentMethod === 'upi' && order.status === 'pending_payment'
    && order.reservationExpiresAt && new Date(order.reservationExpiresAt).getTime() <= now);
  for (const candidate of expiredOrders) {
    await mutateDatabase((database) => {
      const order = database.orders.find((entry) => entry.id === candidate.id && entry.status === 'pending_payment'
        && entry.paymentMethod === 'upi' && entry.reservationExpiresAt && new Date(entry.reservationExpiresAt).getTime() <= now);
      if (!order) return;
      for (const item of order.items) {
        const product = database.products.find((entry) => entry.id === item.productId);
        if (product) product.stock += item.quantity;
      }
      order.status = 'cancelled';
      order.paymentStatus = 'expired';
      delete order.reservationExpiresAt;
    });
  }
}
