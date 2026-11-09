import { Minus, Plus } from 'lucide-react';

type CheckoutItem = {
  id: string;
  name: string;
  imageUrl: string;
  size?: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  canIncrease: boolean;
};

export default function CheckoutItems({ items, busy, onChangeQuantity, onRemove, onContinueShopping }: {
  items: CheckoutItem[];
  busy: boolean;
  onChangeQuantity: (id: string, size: string | undefined, change: number) => void;
  onRemove: (id: string, size: string | undefined) => void;
  onContinueShopping: () => void;
}) {
  return <section className="checkout-items" aria-labelledby="checkout-items-title">
    <div className="checkout-items-heading"><h3 id="checkout-items-title">Your order</h3><button type="button" onClick={onContinueShopping} disabled={busy}>Add products</button></div>
    <div className="bag-lines">{items.map((item) => <div className="bag-line" key={`${item.id}-${item.size || 'standard'}`}>
      <img src={item.imageUrl} alt={item.name} />
      <div className="bag-line-copy">
        <h3>{item.name}</h3>
        <p>{item.unitPrice}{item.size ? ` · Size ${item.size}` : ''}</p>
        <div className="quantity-control">
          <button type="button" aria-label={`Remove one ${item.name}${item.size ? ` size ${item.size}` : ''}`} onClick={() => onChangeQuantity(item.id, item.size, -1)} disabled={busy}><Minus size={13} /></button>
          <span aria-label={`Quantity ${item.quantity}`}>{item.quantity}</span>
          <button type="button" aria-label={`Add one ${item.name}${item.size ? ` size ${item.size}` : ''}`} onClick={() => onChangeQuantity(item.id, item.size, 1)} disabled={busy || !item.canIncrease}><Plus size={13} /></button>
        </div>
        <button className="checkout-remove-item" type="button" onClick={() => onRemove(item.id, item.size)} disabled={busy} aria-label={`Remove ${item.name}${item.size ? ` size ${item.size}` : ''} from order`}>Remove</button>
      </div>
      <span className="line-total">{item.lineTotal}</span>
    </div>)}</div>
  </section>;
}
