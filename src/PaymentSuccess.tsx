import { useEffect, useRef } from 'react';
import { ArrowRight, Check } from 'lucide-react';

type Props = {
  orderId: string;
  amount: string;
  reference?: string;
  items?: { name: string; quantity: number; size?: string }[];
  needsReview: boolean;
  onContinueShopping: () => void;
  onViewOrders: () => void;
};

export default function PaymentSuccess({ orderId, amount, reference, items, needsReview, onContinueShopping, onViewOrders }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);

  return <section className="payment-success-page" aria-labelledby="payment-success-title">
    <div className="payment-success-card">
      <div className="payment-success-brand"><span>AHUZA</span><small>APPAREL</small></div>
      <div className="payment-success-body">
        <div className="payment-success-mark"><Check size={32} strokeWidth={2} aria-hidden="true" /></div>
        <p className="payment-success-eyebrow">PAYMENT VERIFIED</p>
        <h1 id="payment-success-title" ref={heading} tabIndex={-1}>{needsReview ? 'Payment received' : 'Payment successful'}</h1>
        <p className="payment-success-lead">{needsReview
          ? 'Your payment was verified, but your order needs review. Please contact AHUZA for the next steps.'
          : 'Thank you for shopping with us. Your order is confirmed and we’re getting it ready.'}</p>
        <dl className="payment-success-details">
          <div><dt>Amount paid</dt><dd>{amount}</dd></div>
          <div><dt>Order ID</dt><dd>{orderId}</dd></div>
          {reference && <div><dt>Payment reference</dt><dd>{reference}</dd></div>}
        </dl>
        {items && items.length > 0 && <div className="payment-success-items" aria-label="Order summary">
          <h2>Order summary</h2>
          {items.map((item, index) => <p key={`${item.name}-${index}`}><span>{item.name}{item.size ? ` · Size ${item.size}` : ''}</span><span>Qty {item.quantity}</span></p>)}
        </div>}
        {!needsReview && <p className="payment-success-note">You can find your order and receipt in your account. We’ll email you tracking details when your order is on its way.</p>}
        <div className="payment-success-actions">
          <button className="dark-button" type="button" onClick={onViewOrders}>View order <ArrowRight size={16} aria-hidden="true" /></button>
          <button className="payment-success-secondary" type="button" onClick={onContinueShopping}>Continue shopping</button>
        </div>
      </div>
    </div>
  </section>;
}
