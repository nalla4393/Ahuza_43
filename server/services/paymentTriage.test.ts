import assert from 'node:assert/strict';
import test from 'node:test';
import { assessPaymentCandidate, rankPaymentCandidates } from './paymentTriage.js';
import type { BankPaymentAlert, Order } from './database.js';

const alert: BankPaymentAlert = {
  id: 'alert-1',
  amount: 125000,
  transactionReference: 'UTR12345678',
  receivedAt: '2026-01-02T10:15:00.000Z',
  transactionAt: '2026-01-02T10:10:00.000Z',
  status: 'review_required',
};
const order = (id: string, createdAt: string, reservationExpiresAt: string): Order => ({
  id,
  userId: 'customer-1',
  shippingAddress: { name: 'Customer', addressLine1: 'Address', city: 'City', state: 'State', postalCode: '123456', country: 'India', phone: '9876543210' },
  items: [],
  amount: 125000,
  currency: 'INR',
  status: 'pending_payment',
  paymentMethod: 'upi',
  paymentStatus: 'pending',
  createdAt,
  reservationExpiresAt,
});

test('payment triage reports matching amount and reservation timing without claiming verification', () => {
  const timely = order('timely', '2026-01-02T09:30:00.000Z', '2026-01-02T10:30:00.000Z');
  const late = order('late', '2026-01-02T09:00:00.000Z', '2026-01-02T09:59:00.000Z');
  const timelyAssessment = assessPaymentCandidate(alert, timely);
  assert.equal(timelyAssessment.matchLevel, 'amount_and_time');
  assert.ok(timelyAssessment.reasons.includes('Exact INR amount match'));
  assert.equal(assessPaymentCandidate(alert, late).matchLevel, 'timing_mismatch');
  assert.deepEqual(rankPaymentCandidates(alert, [late, timely]).map(({ order: item }) => item.id), ['timely', 'late']);
});

test('payment triage never infers a match from a timestamp that predates the order', () => {
  const createdAfterPayment = order('later', '2026-01-02T10:11:00.000Z', '2026-01-02T11:11:00.000Z');
  const assessment = assessPaymentCandidate(alert, createdAfterPayment);
  assert.equal(assessment.matchLevel, 'timing_mismatch');
  assert.ok(assessment.reasons.some((reason) => reason.includes('predates')));
});

test('payment triage treats email receipt time as a lower-quality fallback', () => {
  const noPreciseTime: BankPaymentAlert = { ...alert, transactionAt: undefined };
  const assessment = assessPaymentCandidate(noPreciseTime, order('fallback', '2026-01-02T10:00:00.000Z', '2026-01-02T11:00:00.000Z'));
  assert.equal(assessment.matchLevel, 'amount_only');
  assert.ok(assessment.reasons.some((reason) => reason.includes('no precise transaction timestamp')));
});

test('adjusted amounts remain review hints rather than payment verification', () => {
  const adjusted = { ...order('adjusted', '2026-01-02T10:00:00.000Z', '2026-01-02T11:00:00.000Z'), paymentAdjustmentAmount: 43 };
  const assessment = assessPaymentCandidate(alert, adjusted);
  assert.ok(assessment.reasons.some((reason) => reason.includes('review hint, not proof')));
});
