type ProductIdentity = { id: string; name: string };

export function productSlug(product: ProductIdentity): string {
  const name = product.name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100).replace(/-+$/g, '');
  return `${name || 'product'}--${product.id}`;
}

export function productPath(product: ProductIdentity): string {
  return `/products/${encodeURIComponent(productSlug(product))}`;
}

export function findProductBySlug<T extends ProductIdentity>(products: T[], slug: string): T | undefined {
  return products.find((product) => productSlug(product) === slug)
    || products.find((product) => product.id === slug)
    || products.filter((product) => slug.endsWith(`--${product.id}`))
      .sort((a, b) => b.id.length - a.id.length)[0];
}
