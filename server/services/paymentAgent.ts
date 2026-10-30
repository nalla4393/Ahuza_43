import { randomUUID } from 'node:crypto';
import { getDatabase, mutateDatabase, type Database, type Order, type PaymentAgentEntry } from './database.js';
import { getAhuzaPayConfiguration, getAhuzaPayStatus } from './ahuzaPay.js';
import { enqueueOrderEmail } from './integrations.js';

const MAX_LOG_ENTRIES = 200;
const OPEN_STATUSES = ['pending_payment', 'cancelled'];

export type PaymentAgentTrigger = PaymentAgentEntry['trigger'];

export function recordAgentEvent(database: Database, entry: Omit<PaymentAgentEntry, 'id' | 'at'>): void {
  if (!database.paymentAgentLog) database.paymentAgentLog = [];
  database.paymentAgentLog.unshift({ id: randomUUID(), at: new Date().toISOString(), ...entry });
  if (database.paymentAgentLog.length > MAX_LOG_ENTRIES) database.paymentAgentLog.length = MAX_LOG_ENTRIES;
}

// Names of products whose Owner Studio stock cannot cover this order (sizes of one product are added together).
export function outOfStockItems(database: Database, order: Pick<Order, 'items'>): string[] {
  const needed = new Map<string, { name: string; quantity: number }>();
  for (const item of order.items) {
    const line = needed.get(item.productId) || { name: item.name, quantity: 0 };
    line.quantity += item.quantity;
    needed.set(item.productId, line);
  }
  return [...needed].filter(([productId, line]) => (database.products.find((entry) => entry.id === productId)?.stock ?? 0) < line.quantity).map(([, line]) => line.name);
}

type Outcome = { kind: 'confirmed' } | { kind: 'held'; items: string[] };

// Payment verification agent: confirms a UPI order on its own once Ahuza Pay reports a bank-verified payment.
// Steps: verify the payment with Ahuza Pay, check Owner Studio inventory, confirm the order, email the customer
// and the owner, and write every decision to the agent log. An order is never confirmed without stock.
export async function verifyPaymentAndConfirm(orderId: string, trigger: PaymentAgentTrigger, userId?: string): Promise<boolean> {
  const matches = (entry: { id: string; userId: string }) => entry.id === orderId && (userId === undefined || entry.userId === userId);
  const order = (await getDatabase()).orders.find(matches);
  if (!order || order.paymentMethod !== 'upi' || order.paymentStatus === 'paid' || !getAhuzaPayConfiguration().configured) return false;
  if (!OPEN_STATUSES.includes(order.status)) return false;

  const remote = await getAhuzaPayStatus(order.id);
  if (!remote.confirmed) {
    if (!remote.closed) console.info(`Ahuza Pay order ${order.id} not confirmed yet: payment_status=${remote.paymentStatus || 'none'} order_confirmed=${remote.orderConfirmed}`);
    return false;
  }

  const outcome = await mutateDatabase((database): Outcome | null => {
    const current = database.orders.find(matches);
    if (!current || current.paymentStatus === 'paid' || !OPEN_STATUSES.includes(current.status)) return null;
    // A pending order still holds the stock reserved at checkout; a cancelled one released it and must reserve again.
    if (current.status === 'cancelled') {
      const missing = outOfStockItems(database, current);
      if (missing.length) {
        const alreadyHeld = database.paymentAgentLog?.find((entry) => entry.orderId === current.id)?.decision === 'held_out_of_stock';
        if (!alreadyHeld) recordAgentEvent(database, { orderId: current.id, trigger, decision: 'held_out_of_stock', detail: `Payment received but no stock left for: ${missing.join(', ')}` });
        return { kind: 'held', items: missing };
      }
      for (const item of current.items) {
        const product = database.products.find((entry) => entry.id === item.productId);
        if (product) product.stock -= item.quantity;
      }
    }
    current.status = 'paid';
    current.paymentStatus = 'paid';
    current.paymentVerificationMethod = 'ahuza_pay';
    if (remote.transactionReference) current.manualPaymentReference = remote.transactionReference;
    current.paymentVerifiedAt = new Date().toISOString();
    delete current.reservationExpiresAt;
    recordAgentEvent(database, { orderId: current.id, trigger, decision: 'confirmed', detail: `Bank-verified payment${remote.transactionReference ? ` (ref ${remote.transactionReference})` : ''}; stock checked and held` });
    return { kind: 'confirmed' };
  });

  if (outcome?.kind === 'held') console.error(`Payment agent: order ${orderId} is paid but out of stock (${outcome.items.join(', ')}); needs the owner`);
  if (outcome?.kind !== 'confirmed') return false;
  await enqueueOrderEmail(orderId, 'payment_confirmed').catch((error) => console.error('Payment confirmation email queue failed:', error));
  await enqueueOrderEmail(orderId, 'owner_new_order').catch((error) => console.error('Owner order email queue failed:', error));
  return true;
}
