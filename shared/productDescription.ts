import type { ProductDetails } from './productDetails.js';

const generatedSection = '\n\nProduct details:\n';

export function generateProductDescription(product: ProductDetails & { name: string; description: string }): string | null {
  const summary = product.description.split(generatedSection)[0]?.trim() || '';
  const facts = [
    ['Fabric', product.fabric],
    ['Colour', product.color],
    ['Pattern', product.pattern],
    ['Fit', product.fit],
    ['Style', product.style],
    ['Occasion / use', product.occasion],
    ['Specifications', product.components],
    ['Care instructions', product.careInstructions],
  ].filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim()))
    .map(([label, value]) => `${label}: ${value.trim()}`);
  if (!facts.length) return null;

  const prefix = summary ? `${summary}${generatedSection}` : `Product details:\n`;
  return `${prefix}${facts.join('\n')}`.slice(0, 1000);
}
