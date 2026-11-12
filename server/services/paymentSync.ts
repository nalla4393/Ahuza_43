import { getDatabase, isUnreviewedBankPaymentAlert, mutateDatabase, type Database, type Order } from './database.js';
import { getInstamojoStatus, instamojoConfigured } from './instamojo.js';
import { getPayUStatus, payuConfigured } from './payu.js';
import { enqueueOrderEmail } from './integrations.js';

const OPEN_STATUSES = ['pending_payment', 'cancelled'];
type Confirmation = { kind: 'confirmed' } | { kind: 'held'; items: string[] };

export function outOfStockItems(database: Database, order: Pick<Order, 'items'>): string[] {
  const needed = new Map<string, { name: string; quantity: number }>();
  for (const item of order.items) {
    const line = needed.get(item.productId) || { name: item.name, quantity: 0 };
    line.quantity += item.quantity;
    needed.set(item.productId, line);
  }
  return [...needed].filter(([productId, line]) => (database.products.find((entry) => entry.id === productId)?.stock ?? 0) < line.quantity).map(([, line]) => line.name);
}

async function finalizeVerifiedPayment(
  orderId: string,
  requestId: string,
  amount: number,
  transactionReference: string | undefined,
  userId?: string,
  provider: 'instamojo' | 'payu' = 'instamojo',
): Promise<boolean> {
  const matches = (entry: Order) =>
    entry.id === orderId && (provider === 'payu' ? entry.payuTxnId : entry.instamojoRequestId) === requestId && entry.amount === amount
    && (userId === undefined || entry.userId === userId);
  const result = await mutateDatabase((database): Confirmation | null => {
    const order = database.orders.find(matches);
    if (!order || order.paymentMethod !== 'upi' || order.paymentStatus === 'paid' || !OPEN_STATUSES.includes(order.status)) return null;

    if (order.status === 'cancelled') {
      const missing = outOfStockItems(database, order);
      if (missing.length) {
        order.paymentStatus = 'paid';
        order.paymentVerificationMethod = provider;
        if (transactionReference) order.manualPaymentReference = transactionReference;
        order.paymentVerifiedAt = new Date().toISOString();
        delete order.reservationExpiresAt;
        console.error(`${provider} order ${order.id} is paid but cannot be fulfilled due to insufficient stock (${missing.join(', ')}); owner review required`);
        return { kind: 'held', items: missing };
      }
      for (const item of order.items) {
        const product = database.products.find((entry) => entry.id === item.productId);
        if (product) product.stock -= item.quantity;
      }
    }

    order.status = 'paid';
    order.paymentStatus = 'paid';
    order.paymentVerificationMethod = provider;
    if (transactionReference) order.manualPaymentReference = transactionReference;
    order.paymentVerifiedAt = new Date().toISOString();
    delete order.reservationExpiresAt;
    return { kind: 'confirmed' };
  });

  if (!result) return false;
  const emailKind = result.kind === 'confirmed' ? 'payment_confirmed' : 'owner_new_order';
  await enqueueOrderEmail(orderId, emailKind).catch((error) => console.error(`${emailKind} email queue failed:`, error));
  if (result.kind === 'confirmed') {
    await enqueueOrderEmail(orderId, 'owner_new_order').catch((error) => console.error('owner_new_order email queue failed:', error));
  }
  return result.kind === 'confirmed';
}

export async function confirmInstamojoWebhookPayment(requestId: string, amount: number, transactionReference: string): Promise<boolean> {
  const order = (await getDatabase()).orders.find((entry) => entry.instamojoRequestId === requestId);
  if (!order || order.paymentMethod !== 'upi' || order.amount !== amount || !OPEN_STATUSES.includes(order.status)) return false;
  return finalizeVerifiedPayment(order.id, requestId, amount, transactionReference);
}

export async function syncInstamojoPayment(orderId: string, userId?: string): Promise<boolean> {
  if (!instamojoConfigured()) return false;
  const order = (await getDatabase()).orders.find((entry) => entry.id === orderId && (userId === undefined || entry.userId === userId));
  if (!order || order.paymentMethod !== 'upi' || order.paymentStatus === 'paid' || !order.instamojoRequestId || !OPEN_STATUSES.includes(order.status)) return false;

  const remote = await getInstamojoStatus(order.instamojoRequestId, order.amount);
  if (!remote.confirmed) return false;
  return finalizeVerifiedPayment(order.id, order.instamojoRequestId, order.amount, remote.transactionReference, userId);
}

export async function confirmPayUWebhookPayment(txnid: string): Promise<boolean> {
  const order = (await getDatabase()).orders.find((entry) => entry.payuTxnId === txnid);
  if (!order || order.paymentMethod !== 'upi' || !OPEN_STATUSES.includes(order.status)) return false;
  return syncPayUPayment(order.id);
}

export async function syncPayUPayment(orderId: string, userId?: string): Promise<boolean> {
  if (!await payuConfigured()) return false;
  const order = (await getDatabase()).orders.find((entry) => entry.id === orderId && (userId === undefined || entry.userId === userId));
  if (!order || order.paymentMethod !== 'upi' || order.paymentStatus === 'paid' || !order.payuTxnId || !OPEN_STATUSES.includes(order.status)) return false;

  const remote = await getPayUStatus(order.payuTxnId, order.amount);
  if (!remote.confirmed) return false;
  return finalizeVerifiedPayment(order.id, order.payuTxnId, order.amount, remote.transactionReference, userId, 'payu');
}

export async function reconcileInstamojoOrders(): Promise<void> {
  if (!instamojoConfigured()) return;
  const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const candidates = (await getDatabase()).orders.filter((order) => order.instamojoRequestId && order.paymentMethod === 'upi' && order.paymentStatus !== 'paid'
    && (order.status === 'pending_payment' || (order.status === 'cancelled' && Date.parse(order.createdAt) >= recentCutoff)));
  for (const candidate of candidates) {
    await syncInstamojoPayment(candidate.id).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Instamojo reconcile failed for order ${candidate.id}:`, message);
    });
  }
}

export async function reconcilePayUPayments(): Promise<void> {
  if (!await payuConfigured()) return;
  const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const candidates = (await getDatabase()).orders.filter((order) => order.payuTxnId && order.paymentMethod === 'upi' && order.paymentStatus !== 'paid'
    && (order.status === 'pending_payment' || (order.status === 'cancelled' && Date.parse(order.createdAt) >= recentCutoff)));
  for (const candidate of candidates) {
    await syncPayUPayment(candidate.id).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`PayU reconcile failed for order ${candidate.id}:`, message);
    });
  }
}

export async function confirmUpiPaymentByOwner(orderId: string, transactionReference: string, bankAlertId?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await mutateDatabase((database) => {
    const current = database.orders.find((entry) => entry.id === orderId);
    if (!current || current.paymentMethod !== 'upi') return 'Only UPI orders can be confirmed here' as const;
    if (current.instamojoRequestId || current.payuTxnId) return 'Online provider payments must be verified with their provider' as const;
    if (current.paymentStatus === 'paid') return 'This order is already paid' as const;
    if (!OPEN_STATUSES.includes(current.status)) return 'This order cannot be confirmed in its current status' as const;
    if (!/^[a-zA-Z0-9-]{6,100}$/.test(transactionReference)) return 'Enter a valid bank transaction reference' as const;
    if (database.orders.some((entry) => entry.id !== orderId && entry.manualPaymentReference?.toLowerCase() === transactionReference.toLowerCase())) return 'This bank transaction reference is already used by another order' as const;
    const bankAlert = bankAlertId
      ? database.bankPaymentAlerts?.find((entry) => entry.id === bankAlertId && isUnreviewedBankPaymentAlert(entry))
      : database.bankPaymentAlerts?.find((entry) => entry.transactionReference.toLowerCase() === transactionReference.toLowerCase()
        && entry.amount === current.amount && isUnreviewedBankPaymentAlert(entry));
    if (bankAlertId && (!bankAlert || bankAlert.amount !== current.amount
      || bankAlert.transactionReference.toLowerCase() !== transactionReference.toLowerCase()
      || Date.parse(current.createdAt) > Date.parse(bankAlert.receivedAt))) {
      return 'This Gmail alert no longer matches the order; refresh payment alerts and review the bank statement' as const;
    }
    if (current.status === 'cancelled') {
      if (outOfStockItems(database, current).length) return 'Not enough stock to restore this cancelled order' as const;
      for (const item of current.items) database.products.find((entry) => entry.id === item.productId)!.stock -= item.quantity;
    }
    current.status = 'paid';
    current.paymentStatus = 'paid';
    current.paymentVerificationMethod = 'manual_bank_reconciliation';
    current.manualPaymentReference = transactionReference;
    current.paymentVerifiedAt = new Date().toISOString();
    delete current.reservationExpiresAt;
    if (bankAlert) {
      bankAlert.status = 'confirmed';
      bankAlert.matchedOrderId = orderId;
      bankAlert.reviewedAt = current.paymentVerifiedAt;
      (bankAlert.history ||= []).push({ at: current.paymentVerifiedAt, action: 'owner_confirmed', orderId });
    }
    return true as const;
  });
  if (result !== true) return { ok: false, error: result ?? 'Order not found' };
  await enqueueOrderEmail(orderId, 'payment_confirmed').catch((error) => console.error('Payment confirmation email queue failed:', error));
  await enqueueOrderEmail(orderId, 'owner_new_order').catch((error) => console.error('Owner order email queue failed:', error));
  return { ok: true };
}
