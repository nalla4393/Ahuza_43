import { createHmac, timingSafeEqual } from 'node:crypto';
import { createUpiIntent, getUpiConfiguration } from './upi.js';

export type PaymentStatus = 'pending' | 'processing' | 'paid' | 'failed' | 'cancelled' | 'refunded';

export type PaymentNotification = {
  eventId: string;
  orderReference: string;
  providerReference: string;
  amountPaise: number;
  currency: 'INR';
  status: PaymentStatus;
};

export type PaymentRequest = {
  provider: 'demo' | 'upi-intent';
  mode: 'demo' | 'manual-verification';
  providerReference: string;
  upiIntent?: string;
  merchantVpa?: string;
  merchantName?: string;
};

export type PaymentRequestInput = {
  orderReference: string;
  amountPaise: number;
};

export interface PaymentProvider {
  readonly name: PaymentRequest['provider'];
  createPaymentRequest(input: PaymentRequestInput): Promise<PaymentRequest>;
  getPaymentStatus(providerReference: string): Promise<PaymentStatus | 'unknown'>;
  verifyPaymentNotification(rawBody: Buffer, signature: string | undefined): Promise<PaymentNotification | null>;
}

class DemoPaymentProvider implements PaymentProvider {
  readonly name = 'demo' as const;

  async createPaymentRequest(input: PaymentRequestInput): Promise<PaymentRequest> {
    return {
      provider: this.name,
      mode: 'demo',
      providerReference: input.orderReference,
    };
  }

  async getPaymentStatus(): Promise<PaymentStatus> {
    return 'pending';
  }

  async verifyPaymentNotification(rawBody: Buffer, signature: string | undefined): Promise<PaymentNotification | null> {
    if (process.env.NODE_ENV === 'production') return null;
    const secret = process.env.DEMO_PAYMENT_WEBHOOK_SECRET || '';
    if (!secret || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return null;
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    const supplied = Buffer.from(signature, 'hex');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

    let value: unknown;
    try {
      value = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return null;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const event = value as Record<string, unknown>;
    if (typeof event.eventId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(event.eventId)
      || typeof event.orderReference !== 'string' || !/^AHUZA-[A-Z0-9]{20}$/.test(event.orderReference)
      || typeof event.providerReference !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(event.providerReference)
      || !Number.isSafeInteger(event.amountPaise) || (event.amountPaise as number) < 1
      || event.currency !== 'INR'
      || !['pending', 'processing', 'paid', 'failed', 'cancelled', 'refunded'].includes(String(event.status))) return null;
    return event as PaymentNotification;
  }
}

class UpiIntentProvider implements PaymentProvider {
  readonly name = 'upi-intent' as const;

  async createPaymentRequest(input: PaymentRequestInput): Promise<PaymentRequest> {
    const config = getUpiConfiguration();
    if (!config.configured || !config.vpa) throw new Error('UPI_PROVIDER_NOT_CONFIGURED');
    return {
      provider: this.name,
      mode: 'manual-verification',
      providerReference: input.orderReference,
      upiIntent: createUpiIntent({
        vpa: config.vpa,
        merchantName: config.merchantName,
        amountPaise: input.amountPaise,
        orderReference: input.orderReference,
      }),
      merchantVpa: config.vpa,
      merchantName: config.merchantName,
    };
  }

  async getPaymentStatus(): Promise<'unknown'> {
    return 'unknown';
  }

  async verifyPaymentNotification(): Promise<null> {
    return null;
  }
}

export function getPaymentProvider(name = process.env.PAYMENT_PROVIDER || 'upi-intent'): PaymentProvider {
  if (name === 'demo') {
    if (process.env.NODE_ENV === 'production') throw new Error('DEMO_PAYMENT_PROVIDER_NOT_ALLOWED_IN_PRODUCTION');
    return new DemoPaymentProvider();
  }
  if (name === 'upi-intent') return new UpiIntentProvider();
  throw new Error('PAYMENT_PROVIDER_NOT_SUPPORTED');
}

export async function createPaymentRequest(input: PaymentRequestInput): Promise<PaymentRequest> {
  return getPaymentProvider().createPaymentRequest(input);
}

export async function getPaymentStatus(provider: string, providerReference: string): Promise<PaymentStatus | 'unknown'> {
  return getPaymentProvider(provider).getPaymentStatus(providerReference);
}

export async function verifyPaymentNotification(
  provider: PaymentProvider,
  rawBody: Buffer,
  signature: string | undefined,
): Promise<PaymentNotification | null> {
  return provider.verifyPaymentNotification(rawBody, signature);
}

export function signDemoPaymentNotification(rawBody: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}
