import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

function storageKey(): Buffer {
  const secret = process.env.PAYMENT_CONFIG_KEY?.trim() || process.env.SESSION_SECRET?.trim() || '';
  if (secret.length < 32) throw new Error('PAYMENT_CONFIG_KEY or a 32-character SESSION_SECRET is required to store payment credentials');
  return Buffer.from(hkdfSync('sha256', secret, 'ahuza-server-secrets', 'payment-config-v1', 32));
}

export function encryptServerSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', storageKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptServerSecret(value: string): string {
  const parts = value.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Stored payment credential is invalid');
  try {
    const decipher = createDecipheriv('aes-256-gcm', storageKey(), Buffer.from(parts[1], 'base64'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8');
  } catch (error) {
    throw new Error('Stored payment credential could not be decrypted', { cause: error });
  }
}
