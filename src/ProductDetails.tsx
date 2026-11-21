import type { ProductDetails as Details } from '../shared/productDetails';
import type { StorefrontCopyId } from '../shared/storefrontCopy';

type Props = {
  product: Details;
  text: (id: StorefrontCopyId) => string;
};

export default function ProductDetails({ product, text }: Props) {
  const attributes = [
    { id: 'detailFabric', label: text('detailFabric'), value: product.fabric },
    { id: 'detailColor', label: 'Colour', value: product.color },
    { id: 'detailPattern', label: text('detailPattern'), value: product.pattern },
    { id: 'detailFit', label: 'Fit', value: product.fit },
    { id: 'detailStyle', label: 'Style', value: product.style },
    { id: 'detailOccasion', label: 'Occasion / use', value: product.occasion },
    { id: 'detailComponents', label: 'Specifications / components', value: product.components },
    { id: 'detailCare', label: 'Care instructions', value: product.careInstructions },
  ].filter(({ value }) => value);

  if (!attributes.length && !product.bulletPoints?.length) return null;

  return <section className="pd-details" aria-label="Product details">
    {attributes.length > 0 && <><h3>Product specifications</h3><dl className="pd-attributes">
      {attributes.map(({ id, label, value }) => <div key={id}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl></>}
    {product.bulletPoints && product.bulletPoints.length > 0 && <div className="pd-highlights">
      <h3>{text('detailBulletPoints')}</h3>
      <ul>{product.bulletPoints.map((point, index) => <li key={`${index}-${point}`}>{point}</li>)}</ul>
    </div>}
  </section>;
}
