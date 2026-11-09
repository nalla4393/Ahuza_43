import { getDatabase, mutateDatabase, type Database, type Order } from './database.js';
import { getInstamojoStatus, instamojoConfigured } from './instamojo.js';
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
): Promise<boolean> {
  const matches = (entry: { id: string; userId: string; instamojoRequestId?: string; amount: number }) =>
    entry.id === orderId && entry.instamojoRequestId === requestId && entry.amount === amount
    && (userId === undefined || entry.userId === userId);
  const result = await mutateDatabase((database): Confirmation | null => {
    const order = database.orders.find(matches);
    if (!order || order.paymentMethod !== 'upi' || order.paymentStatus === 'paid' || !OPEN_STATUSES.includes(order.status)) return null;

    if (order.status === 'cancelled') {
      const missing = outOfStockItems(database, order);
      if (missing.length) {
        order.paymentStatus = 'paid';
        order.paymentVerificationMethod = 'instamojo';
        if (transactionReference) order.manualPaymentReference = transactionReference;
        order.paymentVerifiedAt = new Date().toISOString();
        delete order.reservationExpiresAt;
        console.error(`Instamojo order ${order.id} is paid but cannot be fulfilled due to insufficient stock (${missing.join(', ')}); owner review required`);
        return { kind: 'held', items: missing };
      }
      for (const item of order.items) {
        const product = database.products.find((entry) => entry.id === item.productId);
        if (product) product.stock -= item.quantity;
      }
    }

    order.status = 'paid';
    order.paymentStatus = 'paid';
    order.paymentVerificationMethod = 'instamojo';
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

export async function confirmUpiPaymentByOwner(orderId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await mutateDatabase((database) => {
    const current = database.orders.find((entry) => entry.id === orderId);
    if (!current || current.paymentMethod !== 'upi') return 'Only UPI orders can be confirmed here' as const;
    if (current.instamojoRequestId) return 'Instamojo payments must be verified with Instamojo' as const;
    if (current.paymentStatus === 'paid') return 'This order is already paid' as const;
    if (!OPEN_STATUSES.includes(current.status)) return 'This order cannot be confirmed in its current status' as const;
    if (current.status === 'cancelled') {
      const available = current.items.every((item) => (database.products.find((entry) => entry.id === item.productId)?.stock ?? 0) >= item.quantity);
      if (!available) return 'Not enough stock to restore this cancelled order' as const;
      for (const item of current.items) database.products.find((entry) => entry.id === item.productId)!.stock -= item.quantity;
    }
    current.status = 'paid';
    current.paymentStatus = 'paid';
    current.paymentVerificationMethod = 'manual_bank_reconciliation';
    current.paymentVerifiedAt = new Date().toISOString();
    delete current.reservationExpiresAt;
    return true as const;
  });
  if (result !== true) return { ok: false, error: result ?? 'Order not found' };
  await enqueueOrderEmail(orderId, 'payment_confirmed').catch((error) => console.error('Payment confirmation email queue failed:', error));
  await enqueueOrderEmail(orderId, 'owner_new_order').catch((error) => console.error('Owner order email queue failed:', error));
  return { ok: true };
}
