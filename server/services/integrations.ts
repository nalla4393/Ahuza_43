import { getDatabase, mutateDatabase, type Order, type OrderEmailKind, type StoreEvent, type SupportTicket } from './database.js';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { runAutomations } from './automations.js';
import { generateOrderEmailBody } from './ai.js';
import { buildInvoicePdf } from './invoice.js';

type EmailAttachment = { filename: string; content: Buffer; contentType: 'application/pdf' };

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<void> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Integration returned HTTP ${response.status}`);
}

export async function notifySupportTicket(ticket: SupportTicket): Promise<void> {
  if (!isEmailConfigured()) throw new Error('Email is not configured.');
  await sendEmail(supportEmail(), `Customer support ticket ${ticket.id}`, `A customer support ticket needs follow-up.\n\nReference: ${ticket.id}\nCategory: ${ticket.category}\nCustomer: ${ticket.email}\nCreated: ${ticket.createdAt}\n\n${ticket.message}\n\nPlease respond within 48 working hours.`);
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

export const supportEmail = (): string => process.env.SUPPORT_EMAIL?.trim() || 'info@ahuzawear.com';

// Order and marketing mail is sent from EMAIL_FROM (orders@); replies are routed to the support inbox.
export async function sendEmail(to: string, subject: string, text: string, attachments: EmailAttachment[] = []): Promise<void> {
  const replyTo = supportEmail();
  const from = process.env.EMAIL_FROM || (process.env.SMTP_USER ? `Ahuza Apparel <${process.env.SMTP_USER}>` : 'Ahuza Apparel <onboarding@resend.dev>');
  if (process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS) {
    const port = Number(process.env.SMTP_PORT) || 465;
    const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST.trim(), port, secure: port === 465, auth: { user: process.env.SMTP_USER.trim(), pass: process.env.SMTP_PASS }, connectionTimeout: 10000, socketTimeout: 15000 });
    await transport.sendMail({
      from, to, replyTo, subject, text,
      attachments: attachments.map(({ filename, content, contentType }) => ({ filename, content, contentType })),
    });
    return;
  }
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.info(`[email not configured] ${subject} -> ${to}`);
    return;
  }
  await postJson('https://api.resend.com/emails', {
    from, to: [to], reply_to: replyTo, subject, text,
    ...(attachments.length ? {
      attachments: attachments.map(({ filename, content, contentType }) => ({
        filename, content: content.toString('base64'), content_type: contentType,
      })),
    } : {}),
  }, { Authorization: 'Bearer ' + apiKey });
}

const orderEmailSubjects: Record<OrderEmailKind, (id: string) => string> = {
  owner_new_order: (id) => `New AHUZA order received ${id}`,
  order_placed: (id) => `We've received your Ahuza order ${id}`,
  payment_confirmed: (id) => `Thank you! Your Ahuza order ${id} is confirmed`,
  shipped: (id) => `Your Ahuza order ${id} is on its way`,
  out_for_delivery: (id) => `Your Ahuza order ${id} is out for delivery`,
  delivered: (id) => `Your Ahuza order ${id} has been delivered`,
  follow_up: (id) => `How are you enjoying your Ahuza order ${id}?`,
};

function ownerOrderEmail(order: Order, customerEmail: string): string {
  const lines = order.items.map((item) => `- ${item.name}${item.size ? ` (${item.size})` : ''} x ${item.quantity}`).join('\n');
  const address = [order.shippingAddress.addressLine1, order.shippingAddress.addressLine2, order.shippingAddress.city, order.shippingAddress.state, order.shippingAddress.postalCode].filter(Boolean).join(', ');
  return `You have received a new order.\n\nOrder: ${order.id}\nPayment: ${order.paymentMethod === 'cod' ? 'Cash on delivery' : `UPI (${order.paymentStatus})`}\nTotal: ${order.currency} ${(order.amount / 100).toFixed(2)}\n\nItems:\n${lines}\n\nCustomer: ${order.shippingAddress.name}\nEmail: ${customerEmail}\nPhone: ${order.shippingAddress.phone}\nShip to: ${address}\n\nManage it in the owner dashboard.`;
}

function firstName(order: Order): string {
  return order.shippingAddress.name.trim().split(/\s+/)[0] || 'there';
}

// Fixed, reviewed wording for the combined payment-and-order confirmation, so it never varies or mentions anything pending.
function paymentConfirmedEmail(order: Order): string {
  const items = order.items.map((item) => `- ${item.name}${item.size ? ` (${item.size})` : ''} × ${item.quantity}`).join('\n');
  return `Hi ${firstName(order)},

Thank you so much for choosing AHUZA. We're delighted to let you know that your payment of ${order.currency} ${(order.amount / 100).toFixed(2)} has reached us and your order ${order.id} is confirmed.

Your order
${items}

What happens next
Our team is now preparing your order with care. Once it's handed to our delivery partner, we'll send you a short note with tracking details, so you'll always know where it is.

Your invoice and payment receipt are attached as a PDF. You can also find them anytime under Account > Order history at www.ahuzawear.com.

If you have any questions, or would like to change something, just reply to this email. We're always happy to help.

Thank you for being part of the AHUZA family. We hope you love what's on its way to you.

Warm regards,
Team AHUZA
AHUZA Apparel · www.ahuzawear.com`;
}

function fallbackOrderEmail(kind: OrderEmailKind, order: Order): string {
  const total = `${order.currency} ${(order.amount / 100).toFixed(2)}`;
  if (kind === 'order_placed') return order.paymentMethod === 'cod'
    ? `Hi ${order.shippingAddress.name}, your order ${order.id} (${total}) has been placed successfully and is confirmed. Order reference: ${order.id}. Track progress after signing into your AHUZA account and opening Order history.\n\nAHUZA Customer Care`
    : `Hi ${order.shippingAddress.name}, we've received your order ${order.id} (${total}). Reference: ${order.paymentReference || order.id}. Your payment is not confirmed yet; we will email you once it is verified. Track progress in your AHUZA account under Order history.\n\nAHUZA Customer Care`;
  if (kind === 'payment_confirmed') return `Hi ${order.shippingAddress.name}, your payment for order ${order.id} (${total}) has been received and your order is confirmed. We are now getting it ready and it will be picked up for delivery soon.\n\nAHUZA Customer Care`;
  if (kind === 'shipped') return `Hi ${order.shippingAddress.name}, your order ${order.id} has shipped.${order.trackingNumber ? ` Tracking number: ${order.trackingNumber}.` : ''}${order.trackingUrl ? ` Track your delivery: ${order.trackingUrl}` : ''}\n\nAHUZA Customer Care`;
  if (kind === 'out_for_delivery') return `Hi ${order.shippingAddress.name}, your order ${order.id} is out for delivery.${order.trackingNumber ? ` Tracking number: ${order.trackingNumber}.` : ''}${order.trackingUrl ? ` Track your delivery: ${order.trackingUrl}` : ''}\n\nAHUZA Customer Care`;
  if (kind === 'delivered') return `Hi ${order.shippingAddress.name}, your order ${order.id} has been marked delivered. We hope you love it. Please sign in to your AHUZA account and open Account > Order history to rate and review your purchase.\n\nAHUZA Customer Care`;
  return `Hi ${order.shippingAddress.name}, we hope your order ${order.id} feels right at home. You can request a return or replacement within 7 days of delivery.\n\nAHUZA Customer Care`;
}

export async function sendOrderEmail(kind: OrderEmailKind | 'follow_up', order: Order, email: string): Promise<void> {
  if (!isEmailConfigured()) return;
  if (kind === 'owner_new_order') {
    await sendEmail(process.env.OWNER_EMAIL?.trim() || supportEmail(), orderEmailSubjects[kind](order.id), ownerOrderEmail(order, email));
    return;
  }
  if (kind === 'payment_confirmed' && (order.paymentStatus !== 'paid' || !order.paymentVerifiedAt)) return;
  const details = JSON.stringify({
    customerName: order.shippingAddress.name,
    orderReference: order.id,
    paymentReference: order.paymentReference || order.id,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    status: order.status,
    items: order.items.map(({ name, quantity, size }) => ({ name, quantity, ...(size ? { size } : {}) })),
    total: `${order.currency} ${(order.amount / 100).toFixed(2)}`,
    trackingNumber: order.trackingNumber || 'Not provided',
    trackingUrl: order.trackingUrl || 'Not provided',
  });
  if (kind === 'payment_confirmed') {
    const invoice = { filename: `ahuza-invoice-${order.id}.pdf`, content: await buildInvoicePdf(order, email), contentType: 'application/pdf' as const };
    await sendEmail(email, orderEmailSubjects[kind](order.id), paymentConfirmedEmail(order), [invoice]);
    return;
  }
  let body: string;
  try { body = await generateOrderEmailBody(kind, details); }
  catch (error) { console.error('AI email draft failed; using template:', error instanceof Error ? error.message : error); body = fallbackOrderEmail(kind, order); }
  body = appendOrderEmailDetails(kind, order, body);
  await sendEmail(email, orderEmailSubjects[kind](order.id), body);
}

export function appendOrderEmailDetails(kind: OrderEmailKind, order: Order, body: string): string {
  const tracking = [
    order.trackingNumber ? `Tracking number: ${order.trackingNumber}` : '',
    order.trackingUrl ? `Track shipment: ${order.trackingUrl}` : '',
  ].filter(Boolean).join('\n');
  const details = kind === 'order_placed'
    ? `Order reference: ${order.id}\nPayment reference: ${order.paymentReference || order.id}\nTrack progress by signing in at www.ahuzawear.com and opening Account > Order history.`
    : kind === 'payment_confirmed' && order.paymentStatus === 'paid' && order.paymentVerifiedAt
      ? `Order reference: ${order.id}\nYour invoice and payment receipt are attached as a PDF. We will email you again when your order ships. You can also download them from Account > Order history after signing in at www.ahuzawear.com.`
      : kind === 'payment_confirmed'
        ? `Order reference: ${order.id}`
    : `Order reference: ${order.id}${tracking ? `\n${tracking}` : ''}${kind === 'delivered' ? '\nPlease sign in at www.ahuzawear.com and open Account > Order history to rate and review your order.' : ''}`;
  return `${body.trim()}\n\n${details}`;
}

export async function enqueueOrderEmail(orderId: string, kind: OrderEmailKind): Promise<void> {
  await mutateDatabase((database) => {
    database.orderEmailNotifications ||= [];
    const existing = database.orderEmailNotifications.find((notification) => notification.orderId === orderId && notification.kind === kind);
    if (!existing) {
      const now = new Date().toISOString();
      database.orderEmailNotifications.push({
        id: randomUUID(), orderId, kind, status: 'pending', attempts: 0, dueAt: now, nextAttemptAt: now,
      });
    }
  });
  void processOrderEmailQueue().catch((error) => console.error('Order email queue failed:', error));
}

export async function processOrderEmailQueue(): Promise<void> {
  if (!isEmailConfigured()) return;
  const now = Date.now();
  const due = (await getDatabase()).orderEmailNotifications
    ?.filter((entry) => entry.status === 'pending' && Date.parse(entry.nextAttemptAt) <= now && entry.attempts < 10)
    .slice(0, 20) || [];
  for (const candidate of due) {
    const claimed = await mutateDatabase((database) => {
      const notification = database.orderEmailNotifications?.find((entry) => entry.id === candidate.id && entry.status === 'pending' && Date.parse(entry.nextAttemptAt) <= Date.now());
      if (!notification) return null;
      notification.attempts += 1;
      notification.nextAttemptAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const order = database.orders.find((entry) => entry.id === notification.orderId);
      const customer = order && database.customers.find((entry) => entry.id === order.userId);
      return order && customer ? { notificationId: notification.id, kind: notification.kind, order: structuredClone(order), email: customer.email } : null;
    });
    if (!claimed) continue;
    try {
      await sendOrderEmail(claimed.kind, claimed.order, claimed.email);
      await mutateDatabase((database) => {
        const notification = database.orderEmailNotifications?.find((entry) => entry.id === claimed.notificationId);
        if (notification) { notification.status = 'sent'; notification.sentAt = new Date().toISOString(); delete notification.lastError; }
      });
    } catch (error) {
      await mutateDatabase((database) => {
        const notification = database.orderEmailNotifications?.find((entry) => entry.id === claimed.notificationId);
        if (notification) {
          notification.lastError = error instanceof Error ? error.message.slice(0, 300) : 'Email send failed.';
          if (notification.attempts >= 10) notification.status = 'failed';
        }
      });
      console.error(`Order ${claimed.kind} email failed for ${claimed.order.id}; will retry:`, error);
    }
  }
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
  void processOrderEmailQueue().catch((error) => console.error('Order email queue failed:', error));
  void sendSevenDayFollowUps().catch((error) => console.error('Follow-up scan failed:', error));
  void runAutomations().catch((error) => console.error('Automation scan failed:', error));
  setInterval(() => void runAutomations().catch((error) => console.error('Automation scan failed:', error)), 15 * 60 * 1000).unref();
  const timer = setInterval(() => void sendSevenDayFollowUps().catch((error) => console.error('Follow-up scan failed:', error)), 60 * 60 * 1000);
  timer.unref();
  const orderEmailTimer = setInterval(() => void processOrderEmailQueue().catch((error) => console.error('Order email queue failed:', error)), 60 * 1000);
  orderEmailTimer.unref();
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
