import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { detectImageType, maxUploadBytes } from './images.js';

export type PaymentProofMimeType = 'image/jpeg' | 'image/png';
export type PaymentProof = { id: string; mimeType: PaymentProofMimeType; uploadedAt: string };

const paymentProofRoot = path.resolve(process.env.PAYMENT_PROOF_DIR
  || path.join(path.dirname(process.env.DATA_FILE || '.data/ahuza-db.json'), 'payment-proofs'));
const extensions: Record<PaymentProofMimeType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };

function isPaymentProofMimeType(value: string): value is PaymentProofMimeType {
  return Object.hasOwn(extensions, value);
}

export async function savePaymentProof(buffer: Buffer, mimeType: string): Promise<PaymentProof> {
  const detected = detectImageType(buffer);
  if (!buffer.length || buffer.length > maxUploadBytes || !isPaymentProofMimeType(mimeType) || detected !== mimeType) {
    throw new Error('INVALID_PAYMENT_PROOF');
  }
  const metadata = await sharp(buffer, { limitInputPixels: 40_000_000 }).metadata().catch(() => {
    throw new Error('INVALID_PAYMENT_PROOF');
  });
  if (!metadata.width || !metadata.height || metadata.width > 10000 || metadata.height > 10000) {
    throw new Error('INVALID_PAYMENT_PROOF');
  }

  const proof: PaymentProof = { id: randomUUID(), mimeType, uploadedAt: new Date().toISOString() };
  await mkdir(paymentProofRoot, { recursive: true, mode: 0o700 });
  try {
    await writeFile(path.join(paymentProofRoot, `${proof.id}.${extensions[proof.mimeType]}`), buffer, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    await rm(path.join(paymentProofRoot, `${proof.id}.${extensions[proof.mimeType]}`), { force: true });
    throw error;
  }
  return proof;
}

export async function readPaymentProof(proof: PaymentProof): Promise<Buffer> {
  if (!/^[0-9a-f-]{36}$/.test(proof.id) || !isPaymentProofMimeType(proof.mimeType)) throw new Error('INVALID_PAYMENT_PROOF');
  return readFile(path.join(paymentProofRoot, `${proof.id}.${extensions[proof.mimeType]}`));
}

export async function deletePaymentProof(proof: PaymentProof): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(proof.id) || !isPaymentProofMimeType(proof.mimeType)) return;
  await rm(path.join(paymentProofRoot, `${proof.id}.${extensions[proof.mimeType]}`), { force: true });
}
