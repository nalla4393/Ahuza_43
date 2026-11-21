export type ProductPricing = {
  sellingPrice: number;
  mrp: number;
  discountAmount: number;
  discountPercent: number;
};

export function productPricing(price: number, discountPercent?: number): ProductPricing | null {
  if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(discountPercent)
    || !discountPercent || discountPercent < 1 || discountPercent > 99) return null;
  const mrp = Math.round(price / (1 - discountPercent / 100));
  if (!Number.isSafeInteger(mrp) || mrp <= price) return null;
  return { sellingPrice: price, mrp, discountAmount: mrp - price, discountPercent };
}

export function productStockStatus(product: { stock: number; stockStatus?: string }): 'in_stock' | 'sold_out' | 'limited_stock' {
  if (product.stock < 1 || product.stockStatus === 'sold_out') return 'sold_out';
  if (product.stockStatus === 'limited_stock') return 'limited_stock';
  return 'in_stock';
}

export function productIsPurchasable(product: { stock: number; stockStatus?: string }): boolean {
  return productStockStatus(product) !== 'sold_out';
}