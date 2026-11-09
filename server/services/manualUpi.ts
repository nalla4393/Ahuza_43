import { isValidUpiId } from './customerData.js';

export function paymentProvider(): 'instamojo' | 'manual_upi' | 'invalid' {
  const provider = process.env.PAYMENT_PROVIDER?.trim() || 'instamojo';
  return provider === 'instamojo' || provider === 'manual_upi' ? provider : 'invalid';
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
