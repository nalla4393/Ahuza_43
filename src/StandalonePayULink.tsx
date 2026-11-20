import { ArrowRight } from 'lucide-react';

export default function StandalonePayULink({ contactEmail }: { contactEmail: string }) {
  return <>
    <p className="payment-config-warning">
      This PayU link does not receive your cart, total, or delivery details. No storefront order is created,
      stock is not reserved, and payment is not automatically matched or confirmed.
      Before paying, contact AHUZA at <a href={`mailto:${contactEmail}`}>{contactEmail}</a> with your items,
      sizes, delivery address, and total to arrange your order and confirm the amount.
    </p>
    <a className="dark-button checkout-button" href="https://u.payu.in/PAYUMN/YrNhcvnJ3Ya5">
      Continue to PayU payment link <ArrowRight size={16} />
    </a>
  </>;
}
