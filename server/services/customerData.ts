import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

export function isValidUpiId(value: string): boolean {
  return /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/.test(value);
}

// Customer UPI IDs are encrypted at rest with a key derived from CUSTOMER_DATA_KEY (or SESSION_SECRET).
function dataKey(): Buffer | null {
  const secret = process.env.CUSTOMER_DATA_KEY?.trim() || process.env.SESSION_SECRET?.trim() || '';
  if (secret.length < 16) return null;
  return Buffer.from(hkdfSync('sha256', secret, 'ahuza-customer-data', 'customer-upi-v1', 32));
}

export function customerDataConfigured(): boolean {
  return dataKey() !== null;
}

export function encryptCustomerValue(plain: string): string {
  const key = dataKey();
  if (!key) throw new Error('CUSTOMER_DATA_KEY_MISSING');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptCustomerValue(stored: string | undefined): string | null {
  const key = dataKey();
  const parts = stored?.split(':');
  if (!key || !parts || parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
