import { getDatabase, mutateDatabase } from './database.js';
import { getAhuzaPayConfiguration } from './ahuzaPay.js';
import { recordAgentEvent, verifyPaymentAndConfirm, type PaymentAgentTrigger } from './paymentAgent.js';
import { enqueueOrderEmail } from './integrations.js';

// Delegates to the payment verification agent, which confirms a pending UPI order only when Ahuza Pay
// reports a bank-verified payment and Owner Studio stock covers it.
export async function syncAhuzaPayPayment(orderId: string, userId?: string, trigger: PaymentAgentTrigger = 'poll'): Promise<boolean> {
  return verifyPaymentAndConfirm(orderId, trigger, userId);
}

// Background reconciliation so orders are confirmed without the customer keeping the page open.
export async function reconcileAhuzaPayOrders(): Promise<void> {
  if (!getAhuzaPayConfiguration().configured) return;
  const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const candidates = (await getDatabase()).orders.filter((order) => order.paymentMethod === 'upi' && order.paymentStatus !== 'paid'
    && (order.status === 'pending_payment' || (order.status === 'cancelled' && Date.parse(order.createdAt) >= recentCutoff)));
  for (const candidate of candidates) {
    await syncAhuzaPayPayment(candidate.id).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      // Ahuza Pay never received this order (for example the payment link could not be created), so there is nothing to confirm.
      if (message.startsWith('AHUZA_PAY_404')) return;
      console.error(`Ahuza Pay reconcile failed for order ${candidate.id}:`, message);
    });
  }
}

// Owner-approved confirmation for a UPI order whose bank credit was checked by hand (UTR matched in the bank app).
export async function confirmUpiPaymentByOwner(orderId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await mutateDatabase((database) => {
    const current = database.orders.find((entry) => entry.id === orderId);
    if (!current || current.paymentMethod !== 'upi') return 'Only UPI orders can be confirmed here' as const;
    if (current.paymentStatus === 'paid') return 'This order is already paid' as const;
    if (!['pending_payment', 'cancelled'].includes(current.status)) return 'This order cannot be confirmed in its current status' as const;
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
    recordAgentEvent(database, { orderId: current.id, trigger: 'owner_manual', decision: 'confirmed', detail: 'Owner confirmed the bank credit by hand' });
    return true as const;
  });
  if (result !== true) return { ok: false, error: result ?? 'Order not found' };
  await enqueueOrderEmail(orderId, 'payment_confirmed').catch((error) => console.error('Payment confirmation email queue failed:', error));
  await enqueueOrderEmail(orderId, 'owner_new_order').catch((error) => console.error('Owner order email queue failed:', error));
  return { ok: true };
}
