import { isValidUpiId } from './customerData.js';
import type { Order } from './database.js';

export function manualUpiAdjustment(baseAmount: number, orders: Order[], now: number): number | null {
  const recentAmounts = new Set(orders.filter((order) => order.paymentMethod === 'upi'
    && (Date.parse(order.createdAt) + 60 * 60 * 1000 > now
      || (order.reservationExpiresAt && Date.parse(order.reservationExpiresAt) > now)))
    .map((order) => order.amount));
  for (let adjustment = 1; adjustment <= 99; adjustment++) {
    if (!recentAmounts.has(baseAmount + adjustment)) return adjustment;
  }
  return null;
}

export function paymentProvider(): 'manual_upi' | 'payu' | 'invalid' {
  const provider = process.env.PAYMENT_PROVIDER?.trim() || 'manual_upi';
  return provider === 'manual_upi' || provider === 'payu' ? provider : 'invalid';
}

export function manualUpiConfiguration(): { vpa: string; payee: string } | null {
  const vpa = process.env.UPI_VPA?.trim() || '';
  const payee = process.env.UPI_PAYEE_NAME?.trim() || '';
  return isValidUpiId(vpa) && payee.length > 0 && payee.length <= 100 ? { vpa, payee } : null;
}

export function manualUpiLink(configuration: { vpa: string; payee: string }, amount: number, reference: string): string {
  if (!Number.isSafeInteger(amount) || amount < 100 || !reference) throw new Error('Invalid UPI payment details');
  const params = new URLSearchParams({ pa: configuration.vpa, pn: configuration.payee, am: (amount / 100).toFixed(2), cu: 'INR', tn: reference });
  return `upi://pay?${params}`;
}
