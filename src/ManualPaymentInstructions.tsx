export default function ManualPaymentInstructions({ email, orderId }: { email: string; orderId?: string }) {
  const subject = orderId ? `UPI payment for order ${orderId}` : 'UPI payment screenshot';
  return <section className="manual-payment-instructions" aria-label="Manual payment confirmation instructions">
    <strong>How UPI payment is confirmed</strong>
    <p>The payment-successful page appears only after AHUZA manually verifies the bank credit and confirms your order. This can take time.</p>
    <p>If it does not appear after you pay:</p>
    <ol>
      <li>Return here and check your payment status. Do not pay again if money was debited.</li>
      <li>Upload your payment screenshot using the secure form below, or email it with your order number{orderId ? ` (${orderId})` : ''} and bank transaction reference to <a href={`mailto:${email}?subject=${encodeURIComponent(subject)}`}>{email}</a>. Do not share your UPI PIN or OTP.</li>
      <li>Wait for the owner to check the bank statement and confirm the payment in Owner Studio. A screenshot is for reference only, not proof of payment. Once confirmed, your order changes to Paid; refresh the order status to check.</li>
    </ol>
  </section>;
}
