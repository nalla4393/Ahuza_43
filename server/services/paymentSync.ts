import { getDatabase, mutateDatabase } from './database.js';
import { getAhuzaPayConfiguration, getAhuzaPayStatus } from './ahuzaPay.js';
import { enqueueOrderEmail } from './integrations.js';

// Marks a pending UPI order paid only when Ahuza Pay itself reports a bank-verified payment,
// then queues the payment confirmation email (which carries the invoice PDF).
export async function syncAhuzaPayPayment(orderId: string, userId?: string): Promise<boolean> {
  const matches = (entry: { id: string; userId: string }) => entry.id === orderId && (userId === undefined || entry.userId === userId);
  const order = (await getDatabase()).orders.find(matches);
  if (!order || order.paymentMethod !== 'upi' || order.paymentStatus === 'paid' || !getAhuzaPayConfiguration().configured) return false;
  if (!['pending_payment', 'cancelled'].includes(order.status)) return false;
  const remote = await getAhuzaPayStatus(order.id);
  if (!remote.confirmed) return false;
  const paid = await mutateDatabase((database) => {
    const current = database.orders.find(matches);
    if (!current || current.paymentStatus === 'paid' || !['pending_payment', 'cancelled'].includes(current.status)) return null;
    if (current.status === 'cancelled') {
      const available = current.items.every((item) => database.products.find((entry) => entry.id === item.productId)!.stock >= item.quantity);
      if (!available) return null;
      for (const item of current.items) database.products.find((entry) => entry.id === item.productId)!.stock -= item.quantity;
    }
    current.status = 'paid';
    current.paymentStatus = 'paid';
    current.paymentVerificationMethod = 'ahuza_pay';
    if (remote.transactionReference) current.manualPaymentReference = remote.transactionReference;
    current.paymentVerifiedAt = new Date().toISOString();
    delete current.reservationExpiresAt;
    return true;
  });
  if (!paid) return false;
  await enqueueOrderEmail(orderId, 'payment_confirmed').catch((error) => console.error('Payment confirmation email queue failed:', error));
  return true;
}

// Background reconciliation so orders are confirmed without the customer keeping the page open.
export async function reconcileAhuzaPayOrders(): Promise<void> {
  if (!getAhuzaPayConfiguration().configured) return;
  const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const candidates = (await getDatabase()).orders.filter((order) => order.paymentMethod === 'upi' && order.paymentStatus !== 'paid'
    && (order.status === 'pending_payment' || (order.status === 'cancelled' && Date.parse(order.createdAt) >= recentCutoff)));
  for (const candidate of candidates) {
    await syncAhuzaPayPayment(candidate.id).catch((error) => console.error(`Ahuza Pay reconcile failed for order ${candidate.id}:`, error instanceof Error ? error.message : error));
  }
}
