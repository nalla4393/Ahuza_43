export function isValidUpiVpa(value: string): boolean {
  return /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/.test(value);
}

export function getUpiConfiguration(): { configured: boolean; vpa: string | null; merchantName: string } {
  const vpa = process.env.UPI_VPA?.trim() || '';
  return {
    configured: isValidUpiVpa(vpa),
    vpa: isValidUpiVpa(vpa) ? vpa : null,
    merchantName: (process.env.UPI_MERCHANT_NAME?.trim() || 'AHUZA Apparel').slice(0, 50),
  };
}

export function createUpiIntent(input: {
  vpa: string;
  merchantName: string;
  amountPaise: number;
  orderReference: string;
}): string {
  if (!isValidUpiVpa(input.vpa) || !Number.isSafeInteger(input.amountPaise) || input.amountPaise < 1
    || !/^[A-Z0-9-]{1,50}$/.test(input.orderReference)) {
    throw new Error('INVALID_UPI_INTENT');
  }
  const params = new URLSearchParams({
    pa: input.vpa,
    pn: input.merchantName.slice(0, 50),
    tr: input.orderReference,
    tn: `AHUZA order ${input.orderReference}`,
    am: (input.amountPaise / 100).toFixed(2),
    cu: 'INR',
  });
  return `upi://pay?${params.toString()}`;
}
