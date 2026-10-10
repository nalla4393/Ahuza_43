import { createHmac, timingSafeEqual } from 'node:crypto';
import Razorpay from 'razorpay';
import type { Database, Order, PaymentAuditEvent } from './database.js';

export type PaymentEnvironment = 'test' | 'live';
export type PaymentStatus = 'pending' | 'failed' | 'captured' | 'expired' | 'cancelled';
export type VerifiedPayment = { id: string; amount: number; currency: string; status: string; method: string };
export type QrPaymentStatus = {
  status: PaymentStatus;
  payment?: VerifiedPayment;
  capturedPayments: VerifiedPayment[];
  qrStatus: 'active' | 'closed';
  expiresAt: string | null;
  reference: string | null;
  orderId: string | null;
};
export type PaymentConfiguration = {
  provider: string | null;
  environment: PaymentEnvironment | null;
  configured: boolean;
  upiQrSupported: boolean;
  upiIntentSupported: boolean;
};

export interface PaymentProvider {
  readonly environment: PaymentEnvironment;
  readonly accountId: string;
  verifyWebhook(rawBody: Buffer, signature: string): boolean;
  createUpiQr(input: { amount: number; orderId: string; paymentReference: string; expiresAt: number }): Promise<{ qrCodeId: string; imageUrl: string; expiresAt: string }>;
  fetchQrStatus(qrCodeId: string): Promise<QrPaymentStatus>;
  closeQrCode(qrCodeId: string): Promise<void>;
  fetchPayment(paymentId: string): Promise<VerifiedPayment & { order_id: string | null; amount_refunded: number; captured: boolean }>;
  createFullRefund(paymentId: string, amount: number, orderId: string, idempotencyKey: string, receipt: string): Promise<{ id: string; status: 'pending' | 'processed' | 'failed'; amount: number; paymentId: string; currency: string }>;
  fetchRefund(refundId: string, paymentId: string): Promise<{ id: string; status: 'pending' | 'processed' | 'failed'; amount: number; paymentId: string; currency: string; receipt?: string }>;
}

export function getPaymentConfiguration(): PaymentConfiguration {
  const provider = process.env.PAYMENT_PROVIDER?.trim().toLowerCase() || null;
  const environment = process.env.PAYMENT_ENVIRONMENT === 'test' || process.env.PAYMENT_ENVIRONMENT === 'live'
    ? process.env.PAYMENT_ENVIRONMENT
    : null;
  const keyId = process.env.RAZORPAY_KEY_ID?.trim() || '';
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim() || '';
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || '';
  const accountId = process.env.RAZORPAY_ACCOUNT_ID?.trim() || '';
  const environmentKeyMatches = environment === 'test'
    ? keyId.startsWith('rzp_test_')
    : environment === 'live' ? keyId.startsWith('rzp_live_') : false;
  return {
    provider,
    environment,
    configured: provider === 'razorpay' && Boolean(keyId && keySecret && webhookSecret && accountId && environmentKeyMatches),
    upiQrSupported: provider === 'razorpay',
    upiIntentSupported: false,
  };
}

export function verifyRazorpayWebhookSignature(rawBody: Buffer, signature: string, secret: string): boolean {
  if (!/^[a-f\d]{64}$/i.test(signature) || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const supplied = Buffer.from(signature, 'hex');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function isVerifiedCapture(payment: VerifiedPayment, expected: { amount: number; currency: string }): boolean {
  return payment.status === 'captured'
    && payment.method === 'upi'
    && Number.isSafeInteger(payment.amount)
    && payment.amount === expected.amount
    && payment.currency === expected.currency;
}

function addAuditEvent(database: Database, event: PaymentAuditEvent): void {
  database.paymentAuditEvents ||= [];
  database.paymentAuditEvents.push(event);
  if (database.paymentAuditEvents.length > 5000) database.paymentAuditEvents.splice(0, database.paymentAuditEvents.length - 5000);
}

export function applyCapturedQrPayment(
  database: Database,
  input: { eventId: string; qrCodeId: string; paymentReference: string | null; internalOrderId: string | null; payment: VerifiedPayment },
): { outcome: 'duplicate' | 'unmatched' | 'review' | 'already_paid' | 'paid' | 'test_paid'; order?: Order; orderId?: string } {
  database.processedPaymentWebhookIds ||= [];
  if (database.processedPaymentWebhookIds.includes(input.eventId)) return { outcome: 'duplicate' };
  database.processedPaymentWebhookIds.push(input.eventId);
  if (database.processedPaymentWebhookIds.length > 5000) database.processedPaymentWebhookIds.splice(0, database.processedPaymentWebhookIds.length - 5000);
  const order = database.orders.find((entry) => entry.razorpayQrCodeId === input.qrCodeId);
  if (!order) {
    addAuditEvent(database, { eventId: input.eventId, type: 'qr_code.credited', orderId: null, paymentId: input.payment.id, outcome: 'unmatched', createdAt: new Date().toISOString() });
    return { outcome: 'unmatched' };
  }
  const audit = (outcome: string) => addAuditEvent(database, { eventId: input.eventId, type: 'qr_code.credited', orderId: order.id, paymentId: input.payment.id, outcome, createdAt: new Date().toISOString() });
  if (order.paymentId === input.payment.id && (order.paymentStatus === 'paid' || order.paymentStatus === 'test_paid' || order.paymentStatus === 'refunded')) {
    audit('already_paid');
    return { outcome: 'already_paid', orderId: order.id };
  }
  if (order.paymentId && order.paymentId !== input.payment.id) {
    order.paymentReview = { reason: 'A second or conflicting captured payment was received for this order.', paymentId: input.payment.id, createdAt: new Date().toISOString() };
    audit('review');
    return { outcome: 'review', orderId: order.id };
  }
  if (input.paymentReference !== order.paymentReference) {
    order.paymentReview = { reason: 'The payment provider QR reference does not match this local order.', paymentId: input.payment.id, createdAt: new Date().toISOString() };
    audit('review');
    return { outcome: 'review', orderId: order.id };
  }
  if (input.internalOrderId !== order.id) {
    order.paymentReview = { reason: 'The payment provider QR order reference does not match the local order.', paymentId: input.payment.id, createdAt: new Date().toISOString() };
    audit('review');
    return { outcome: 'review', orderId: order.id };
  }
  if (!isVerifiedCapture(input.payment, { amount: order.amount, currency: order.currency })) {
    order.paymentReview = { reason: 'Captured payment method, amount, or currency does not match the local order.', paymentId: input.payment.id, createdAt: new Date().toISOString() };
    audit('review');
    return { outcome: 'review', orderId: order.id };
  }
  if (order.status !== 'pending_payment' || order.refund) {
    order.paymentReview = { reason: `Captured payment arrived while local order was ${order.status}.`, paymentId: input.payment.id, createdAt: new Date().toISOString() };
    audit('review');
    return { outcome: 'review', orderId: order.id };
  }

  order.paymentId = input.payment.id;
  order.paymentVerifiedAt = new Date().toISOString();
  delete order.reservationExpiresAt;
  if (order.paymentEnvironment === 'test') {
    order.paymentStatus = 'test_paid';
    order.status = 'test_paid';
    for (const item of order.items) {
      const product = database.products.find((entry) => entry.id === item.productId);
      if (product) product.stock += item.quantity;
    }
    audit('test_paid');
    return { outcome: 'test_paid', order: structuredClone(order) };
  }
  order.paymentStatus = 'paid';
  order.status = 'paid';
  audit('paid');
  return { outcome: 'paid', order: structuredClone(order) };
}

export function applyRefundWebhook(
  database: Database,
  input: { eventId: string; eventType: 'refund.created' | 'refund.processed' | 'refund.failed'; refund: { id: string; paymentId: string; amount: number; status: string; receipt?: string; currency?: string } },
): { outcome: 'duplicate' | 'unmatched' | 'review' | 'updated'; orderId?: string } {
  database.processedPaymentWebhookIds ||= [];
  if (database.processedPaymentWebhookIds.includes(input.eventId)) return { outcome: 'duplicate' };
  database.processedPaymentWebhookIds.push(input.eventId);
  if (database.processedPaymentWebhookIds.length > 5000) database.processedPaymentWebhookIds.splice(0, database.processedPaymentWebhookIds.length - 5000);
  const order = database.orders.find((entry) => entry.paymentId === input.refund.paymentId);
  if (!order) {
    addAuditEvent(database, { eventId: input.eventId, type: input.eventType, orderId: null, paymentId: input.refund.paymentId, outcome: 'unmatched', createdAt: new Date().toISOString() });
    return { outcome: 'unmatched' };
  }
  const audit = (outcome: string) => addAuditEvent(database, { eventId: input.eventId, type: input.eventType, orderId: order.id, paymentId: input.refund.paymentId, outcome, createdAt: new Date().toISOString() });
  const currentRefund = order.refund;
  if (!currentRefund || (currentRefund.providerRefundId !== input.refund.id && currentRefund.receipt !== input.refund.receipt)) {
    order.paymentReview = { reason: 'A provider refund event does not match the local refund request.', paymentId: input.refund.paymentId, createdAt: new Date().toISOString() };
    audit('review');
    return { outcome: 'review', orderId: order.id };
  }
  if (input.refund.amount !== currentRefund.amount || (input.refund.currency && input.refund.currency !== order.currency)) {
    order.paymentReview = { reason: 'Refund amount or currency does not match the local refund request.', paymentId: input.refund.paymentId, createdAt: new Date().toISOString() };
    audit('review');
    return { outcome: 'review', orderId: order.id };
  }
  currentRefund.providerRefundId = input.refund.id;
  currentRefund.status = input.refund.status === 'processed' ? 'processed' : input.refund.status === 'failed' ? 'failed' : 'pending';
  currentRefund.updatedAt = new Date().toISOString();
  if (currentRefund.status === 'processed') {
    order.paymentStatus = 'refunded';
    order.status = 'refunded';
  }
  audit('updated');
  return { outcome: 'updated', orderId: order.id };
}

export class RazorpayPaymentProvider implements PaymentProvider {
  readonly environment: PaymentEnvironment;
  readonly accountId: string;
  private readonly keyId: string;
  private readonly keySecret: string;
  private readonly webhookSecret: string;
  private readonly razorpay: Razorpay;

  constructor() {
    const configuration = getPaymentConfiguration();
    if (!configuration.configured || !configuration.environment) throw new Error('PAYMENT_NOT_CONFIGURED');
    this.environment = configuration.environment;
    this.keyId = process.env.RAZORPAY_KEY_ID!.trim();
    this.keySecret = process.env.RAZORPAY_KEY_SECRET!.trim();
    this.webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET!.trim();
    this.accountId = process.env.RAZORPAY_ACCOUNT_ID!.trim();
    this.razorpay = new Razorpay({ key_id: this.keyId, key_secret: this.keySecret });
  }

  verifyWebhook(rawBody: Buffer, signature: string): boolean {
    return verifyRazorpayWebhookSignature(rawBody, signature, this.webhookSecret);
  }

  async createUpiQr(input: { amount: number; orderId: string; paymentReference: string; expiresAt: number }): Promise<{ qrCodeId: string; imageUrl: string; expiresAt: string }> {
    const qrCode = await this.razorpay.qrCode.create({
      type: 'upi_qr',
      usage: 'single_use',
      fixed_amount: true,
      payment_amount: input.amount,
      name: 'AHUZA Apparel',
      description: `AHUZA order ${input.paymentReference}`,
      close_by: input.expiresAt,
      notes: { ahuza_order_id: input.orderId, payment_reference: input.paymentReference },
    });
    let image: URL;
    try { image = new URL(qrCode.image_url); }
    catch {
      await this.razorpay.qrCode.close(qrCode.id);
      throw new Error('PAYMENT_PROVIDER_INVALID_QR_URL');
    }
    if (image.protocol !== 'https:') {
      await this.razorpay.qrCode.close(qrCode.id);
      throw new Error('PAYMENT_PROVIDER_INVALID_QR_URL');
    }
    const closeBy = Number(qrCode.close_by) || input.expiresAt;
    return { qrCodeId: qrCode.id, imageUrl: image.toString(), expiresAt: new Date(closeBy * 1000).toISOString() };
  }

  async fetchQrStatus(qrCodeId: string): Promise<QrPaymentStatus> {
    const [qrCode, payments] = await Promise.all([
      this.razorpay.qrCode.fetch(qrCodeId),
      this.razorpay.qrCode.fetchAllPayments(qrCodeId, { count: 100 }),
    ]);
    const capturedPayments = payments.items.filter((payment) => payment.status === 'captured').map((payment) => ({
      id: payment.id,
      amount: Number(payment.amount),
      currency: payment.currency,
      status: payment.status,
      method: payment.method,
    }));
    const payment = capturedPayments[0];
    const failedAttempt = payments.items.some((item) => item.status === 'failed');
    const closeBy = Number(qrCode.close_by);
    const expiresAt = Number.isFinite(closeBy) && closeBy > 0 ? new Date(closeBy * 1000).toISOString() : null;
    const expired = qrCode.status === 'closed' || Boolean(expiresAt && Date.now() >= Date.parse(expiresAt));
    return {
      status: payment ? 'captured' : expired ? (qrCode.close_reason === 'on_demand' ? 'cancelled' : 'expired') : failedAttempt ? 'failed' : 'pending',
      ...(payment ? { payment } : {}),
      capturedPayments,
      qrStatus: qrCode.status,
      expiresAt,
      reference: typeof qrCode.notes?.payment_reference === 'string' ? qrCode.notes.payment_reference : null,
      orderId: typeof qrCode.notes?.ahuza_order_id === 'string' ? qrCode.notes.ahuza_order_id : null,
    };
  }

  async closeQrCode(qrCodeId: string): Promise<void> {
    await this.razorpay.qrCode.close(qrCodeId);
  }

  async fetchPayment(paymentId: string): Promise<VerifiedPayment & { order_id: string | null; amount_refunded: number; captured: boolean }> {
    const payment = await this.razorpay.payments.fetch(paymentId);
    return {
      id: payment.id,
      amount: Number(payment.amount),
      currency: payment.currency,
      status: payment.status,
      method: payment.method,
      order_id: payment.order_id,
      amount_refunded: Number(payment.amount_refunded || 0),
      captured: payment.captured,
    };
  }

  async createFullRefund(paymentId: string, amount: number, orderId: string, idempotencyKey: string, receipt: string): Promise<{ id: string; status: 'pending' | 'processed' | 'failed'; amount: number; paymentId: string; currency: string }> {
    const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'X-Refund-Idempotency': idempotencyKey,
      },
      body: JSON.stringify({ amount, receipt, notes: { ahuza_order_id: orderId } }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    let refund: unknown;
    try { refund = JSON.parse(text); } catch { throw new Error('PAYMENT_REFUND_RESPONSE_INVALID'); }
    if (!response.ok || !refund || typeof refund !== 'object' || Array.isArray(refund)) throw new Error('PAYMENT_REFUND_REQUEST_FAILED');
    const result = refund as Record<string, unknown>;
    if (typeof result.id !== 'string' || typeof result.payment_id !== 'string' || result.amount !== amount
      || typeof result.currency !== 'string' || !['pending', 'processed', 'failed'].includes(String(result.status))) throw new Error('PAYMENT_REFUND_RESPONSE_INVALID');
    return { id: result.id, status: result.status as 'pending' | 'processed' | 'failed', amount, paymentId: result.payment_id, currency: result.currency };
  }

  async fetchRefund(refundId: string, paymentId: string): Promise<{ id: string; status: 'pending' | 'processed' | 'failed'; amount: number; paymentId: string; currency: string; receipt?: string }> {
    const refund = await this.razorpay.refunds.fetch(refundId, { payment_id: paymentId });
    return { id: refund.id, status: refund.status, amount: Number(refund.amount), paymentId: refund.payment_id, currency: refund.currency, receipt: refund.receipt || undefined };
  }
}

export function createPaymentProvider(): PaymentProvider {
  if (process.env.PAYMENT_PROVIDER?.trim().toLowerCase() !== 'razorpay') throw new Error('PAYMENT_PROVIDER_UNSUPPORTED');
  return new RazorpayPaymentProvider();
}
