export const defaultShippingCharge = 10000;
export const freeShippingThreshold = 250000;
export const maxShippingCharge = 10000000;

export function shippingForSubtotal(subtotal: number, charge: number): number {
  return subtotal < freeShippingThreshold ? charge : 0;
}
