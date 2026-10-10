import { getDatabase, mutateDatabase, type Order, type StoreEvent, type SupportTicket } from './database.js';
import { randomUUID } from 'node:crypto';
import { applyCapturedQrPayment, createPaymentProvider, getPaymentConfiguration } from './payments.js';

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
  if (!process.env.RESEND_API_KEY?.trim()) throw new Error('RESEND_API_KEY is not configured.');
  await sendEmail('Info@ahuzawear.com', `Customer support ticket ${ticket.id}`, `A customer support ticket needs follow-up.\n\nReference: ${ticket.id}\nCategory: ${ticket.category}\nCustomer: ${ticket.email}\nCreated: ${ticket.createdAt}\n\n${ticket.message}\n\nPlease respond within 48 working hours.`);
}

export async function recordMarketingEvent(event: Omit<StoreEvent, 'id' | 'createdAt'>): Promise<void> {
  await mutateDatabase((database) => {
    database.events.push({ id: randomUUID(), ...event, createdAt: new Date().toISOString() });
    if (database.events.length > 10000) database.events.splice(0, database.events.length - 10000);
  });
}

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.info(`[email not configured] ${subject} -> ${to}`);
    return;
  }
  const authorization = 'Bearer ' + apiKey;
  await postJson('https://api.resend.com/emails', {
    from: process.env.EMAIL_FROM || 'Ahuza Apparel <onboarding@resend.dev>',
    to: [to],
    subject,
    text,
  }, { Authorization: authorization });
}

export async function sendOrderConfirmation(order: Order, email: string): Promise<void> {
  await sendEmail(email, `Your Ahuza order ${order.id} is confirmed`, `Thank you for your order. Total: ${order.currency} ${(order.amount / 100).toFixed(2)}. Track your order at /api/orders/${order.id}.`);
}

export async function sendShippingNotice(order: Order, email: string): Promise<void> {
  await sendEmail(email, `Your Ahuza order ${order.id} is on its way`, `Your order has shipped. Track its status at /api/orders/${order.id}.`);
}

export async function sendSevenDayFollowUps(): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  const now = Date.now();
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  const candidates = (await getDatabase()).orders.filter((order) => order.status === 'delivered' && !order.followUpSentAt && order.deliveredAt && new Date(order.deliveredAt).getTime() <= cutoff);
  for (const candidate of candidates) {
    const customer = (await getDatabase()).customers.find((entry) => entry.id === candidate.userId);
    if (!customer) continue;
    try {
      await sendEmail(customer.email, 'How are you enjoying your Ahuza pieces?', `We hope your order ${candidate.id} feels right at home. If you need a return or replacement, you can request one within 7 days of delivery.`);
      await mutateDatabase((database) => {
        const order = database.orders.find((entry) => entry.id === candidate.id);
        if (order && !order.followUpSentAt) order.followUpSentAt = new Date().toISOString();
      });
    } catch (error) { console.error(`Follow-up failed for order ${candidate.id}:`, error); }
  }
}

export function startFollowUpScheduler(): void {
  void sendSevenDayFollowUps().catch((error) => console.error('Follow-up scan failed:', error));
  const timer = setInterval(() => void sendSevenDayFollowUps().catch((error) => console.error('Follow-up scan failed:', error)), 60 * 60 * 1000);
  timer.unref();
}

export async function expirePendingOrders(): Promise<void> {
  const now = Date.now();
  const expiredOrders = (await getDatabase()).orders.filter((order) => order.status === 'pending_payment'
    && order.reservationExpiresAt && new Date(order.reservationExpiresAt).getTime() <= now);
  if (!expiredOrders.length) return;
  const configured = getPaymentConfiguration().configured;
  const provider = configured ? createPaymentProvider() : null;
  for (const candidate of expiredOrders) {
    if (candidate.razorpayQrCodeId && !provider) {
      console.error(`Keeping expired reservation for ${candidate.id}: Razorpay is not configured to confirm or close its QR.`);
      continue;
    }
    if (candidate.razorpayQrCodeId && provider) {
      try {
        let status = await provider.fetchQrStatus(candidate.razorpayQrCodeId);
        if (status.status === 'captured') {
          if (status.capturedPayments.length > 1) {
            for (const [index, payment] of status.capturedPayments.entries()) {
              await mutateDatabase((database) => applyCapturedQrPayment(database, {
                eventId: `expiry_multiple_${candidate.razorpayQrCodeId}_${payment.id}_${index}`,
                qrCodeId: candidate.razorpayQrCodeId!,
                paymentReference: null,
                internalOrderId: null,
                payment,
              }));
            }
            continue;
          }
          for (const [index, payment] of status.capturedPayments.entries()) {
            const result = await mutateDatabase((database) => applyCapturedQrPayment(database, {
              eventId: `expiry_${candidate.razorpayQrCodeId}_${payment.id}_${index}`,
              qrCodeId: candidate.razorpayQrCodeId!,
              paymentReference: status.reference,
              internalOrderId: status.orderId,
              payment,
            }));
            if (result.outcome === 'paid' && result.order) {
              const email = (await getDatabase()).customers.find((customer) => customer.id === result.order!.userId)?.email;
              if (email) void sendOrderConfirmation(result.order, email).catch((error) => console.error('Confirmation email failed:', error));
              void triggerAutomations({ name: 'purchase', orderId: result.order.id, amount: result.order.amount / 100, currency: result.order.currency, consent: result.order.marketingConsent });
            }
          }
          continue;
        }
        if (status.qrStatus === 'active') {
          await provider.closeQrCode(candidate.razorpayQrCodeId);
          status = await provider.fetchQrStatus(candidate.razorpayQrCodeId);
        }
        if (status.status === 'captured' || status.qrStatus === 'active') continue;
      } catch (error) {
        console.error(`Could not safely close or verify expired Razorpay QR for ${candidate.id}; reservation retained:`, error);
        continue;
      }
    }
    await mutateDatabase((database) => {
      const order = database.orders.find((entry) => entry.id === candidate.id && entry.status === 'pending_payment'
        && entry.reservationExpiresAt && new Date(entry.reservationExpiresAt).getTime() <= now);
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