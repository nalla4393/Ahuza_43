import { mutateDatabase, type Database, type Order, type PaymentEvent } from './database.js';
import { verifyPaymentNotification, type PaymentNotification, type PaymentProvider } from './payment-provider.js';

export type PaymentWebhookResult =
  | { outcome: 'processed' | 'duplicate'; orderId?: string; paymentConfirmed?: boolean }
  | { outcome: 'rejected'; reason: 'invalid_signature' | 'order_not_found' | 'amount_mismatch' | 'currency_mismatch' | 'provider_reference_reused' };

export function confirmOrderAfterVerifiedPayment(
  order: Order,
  verification: {
    method: NonNullable<Order['paymentVerificationMethod']>;
    verifiedAt: string;
    providerReference?: string;
  },
): boolean {
  if (order.paymentStatus === 'paid' || order.paymentStatus === 'refunded') return false;
  order.status = 'paid';
  order.paymentStatus = 'paid';
  order.paymentVerificationMethod = verification.method;
  order.paymentVerifiedAt = verification.verifiedAt;
  if (verification.providerReference) order.providerPaymentReference = verification.providerReference;
  delete order.reservationExpiresAt;
  return true;
}

export function applyVerifiedPaymentNotification(
  database: Pick<Database, 'orders' | 'products'> & Partial<Pick<Database, 'paymentEvents'>>,
  provider: PaymentProvider['name'],
  notification: PaymentNotification,
): Exclude<PaymentWebhookResult, { reason: 'invalid_signature' }> {
  const events = database.paymentEvents ??= [];
  if (events.some((event) => event.provider === provider && event.eventId === notification.eventId)) {
    return { outcome: 'duplicate' };
  }

  const order = database.orders.find((entry) => entry.paymentProvider === provider
    && entry.paymentReference === notification.orderReference);
  let outcome: PaymentEvent['outcome'] = 'processed';
  let reason: 'order_not_found' | 'amount_mismatch' | 'currency_mismatch' | 'provider_reference_reused' | undefined;
  if (!order) {
    outcome = 'rejected';
    reason = 'order_not_found';
  } else if (order.amount !== notification.amountPaise) {
    outcome = 'rejected';
    reason = 'amount_mismatch';
  } else if (order.currency !== notification.currency) {
    outcome = 'rejected';
    reason = 'currency_mismatch';
  } else if (database.orders.some((entry) => entry.id !== order.id
    && entry.paymentProvider === provider
    && entry.providerPaymentReference === notification.providerReference)
    || events.some((event) => event.orderId !== order?.id
      && event.provider === provider && event.providerReference === notification.providerReference)) {
    outcome = 'rejected';
    reason = 'provider_reference_reused';
  }

  const event: PaymentEvent = {
    eventId: notification.eventId,
    provider,
    ...(order ? { orderId: order.id } : {}),
    orderReference: notification.orderReference,
    providerReference: notification.providerReference,
    amountPaise: notification.amountPaise,
    currency: notification.currency,
    status: notification.status,
    outcome,
    ...(reason ? { rejectionReason: reason } : {}),
    receivedAt: new Date().toISOString(),
  };
  events.push(event);
  if (outcome === 'rejected' && reason) return { outcome, reason };

  let paymentConfirmed = false;
  if (notification.status === 'paid' && order && !['paid', 'refunded'].includes(order.paymentStatus || '')) {
    const inventoryAvailable = order.items.every((item) => {
      const product = database.products.find((entry) => entry.id === item.productId);
      return product && product.stock >= item.quantity;
    });
    if (order.status === 'cancelled' || order.paymentStatus === 'expired') {
      if (inventoryAvailable) {
        for (const item of order.items) database.products.find((entry) => entry.id === item.productId)!.stock -= item.quantity;
      } else {
        order.paymentFulfillmentIssue = 'inventory_unavailable_after_late_payment';
      }
    }
    order.paymentProvider = provider;
    paymentConfirmed = confirmOrderAfterVerifiedPayment(order, {
      method: provider === 'demo' ? 'demo_webhook' : 'verified_webhook',
      verifiedAt: event.receivedAt,
      providerReference: notification.providerReference,
    });
  } else if (notification.status === 'processing' && order && order.paymentStatus === 'pending'
    && order.status === 'pending_payment') {
    order.paymentStatus = 'processing';
  } else if (notification.status === 'failed' && order && !['paid', 'refunded'].includes(order.paymentStatus || '')
    && order.status === 'pending_payment') {
    order.paymentStatus = 'failed';
  } else if (notification.status === 'cancelled' && order && !['paid', 'refunded'].includes(order.paymentStatus || '')
    && order.status === 'pending_payment') {
    order.paymentStatus = 'cancelled';
  } else if (notification.status === 'refunded' && order && order.paymentStatus === 'paid') {
    order.paymentStatus = 'refunded';
    order.status = 'refunded';
  }
  return { outcome: 'processed', ...(order ? { orderId: order.id } : {}), paymentConfirmed };
}

export async function processPaymentWebhook(
  provider: PaymentProvider,
  rawBody: Buffer,
  signature: string | undefined,
): Promise<PaymentWebhookResult> {
  const notification = await verifyPaymentNotification(provider, rawBody, signature);
  if (!notification) return { outcome: 'rejected', reason: 'invalid_signature' };
  return mutateDatabase((database) => applyVerifiedPaymentNotification(database, provider.name, notification));
}
