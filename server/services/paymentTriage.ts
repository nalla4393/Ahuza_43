import type { BankPaymentAlert, Order } from './database.js';

export type PaymentCandidateAssessment = {
  matchLevel: 'amount_and_time' | 'amount_only' | 'timing_mismatch';
  reasons: string[];
};

function transactionTime(alert: BankPaymentAlert): number {
  return Date.parse(alert.transactionAt || alert.receivedAt);
}

export function assessPaymentCandidate(alert: BankPaymentAlert, order: Order): PaymentCandidateAssessment {
  const reasons = ['Exact INR amount match'];
  if (order.paymentAdjustmentAmount) reasons.push('Amount includes a paise adjustment; this is a review hint, not proof of payment');
  const time = transactionTime(alert);
  const created = Date.parse(order.createdAt);
  const expires = order.reservationExpiresAt ? Date.parse(order.reservationExpiresAt) : Number.NaN;
  const hasTransactionTime = Boolean(alert.transactionAt);
  const withinReservation = Number.isFinite(time) && Number.isFinite(created) && time >= created
    && (!Number.isFinite(expires) || time <= expires);

  if (withinReservation) {
    reasons.push('Transaction time falls within the order reservation window');
    if (!hasTransactionTime) reasons.push('Bank alert has no precise transaction timestamp; received time is only a fallback');
    return { matchLevel: hasTransactionTime ? 'amount_and_time' : 'amount_only', reasons };
  }
  if (Number.isFinite(time) && Number.isFinite(created) && time < created) {
    reasons.push('Bank transaction predates the order');
    return { matchLevel: 'timing_mismatch', reasons };
  }
  if (Number.isFinite(time) && Number.isFinite(expires) && time > expires) {
    reasons.push('Payment appears later than the inventory reservation; check for a late payment');
    return { matchLevel: 'timing_mismatch', reasons };
  }
  reasons.push('Bank alert has no precise transaction timestamp; received time is only a fallback');
  return { matchLevel: 'amount_only', reasons };
}

export function rankPaymentCandidates(
  alert: BankPaymentAlert,
  orders: Order[],
): Array<{
  order: Order;
  assessment: PaymentCandidateAssessment;
}> {
  return orders.map((order) => ({ order, assessment: assessPaymentCandidate(alert, order) }))
    .sort((left, right) => {
      const priority = { amount_and_time: 0, amount_only: 1, timing_mismatch: 2 };
      return priority[left.assessment.matchLevel] - priority[right.assessment.matchLevel]
        || right.order.createdAt.localeCompare(left.order.createdAt);
    });
}
