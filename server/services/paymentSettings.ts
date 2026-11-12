import { getDatabase, mutateDatabase } from './database.js';
import { decryptServerSecret, encryptServerSecret } from './secretStorage.js';

export type PayUSettings = {
  merchantKey: string;
  merchantSalt: string;
  mode: 'test' | 'production';
  callbackUrl: string;
  webhookUrl: string;
};

export type PayUSettingsStatus = {
  configured: boolean;
  hasMerchantKey: boolean;
  hasMerchantSalt: boolean;
  mode: 'test' | 'production';
  callbackUrl: string;
  webhookUrl: string;
  managedInOwnerStudio: boolean;
};

const defaultCallbackUrl = 'https://www.ahuzawear.com/api/payments/payu/callback';
const defaultWebhookUrl = 'https://www.ahuzawear.com/api/payments/payu/webhook';

function envMode(): 'test' | 'production' | null {
  const value = process.env.PAYU_MODE?.trim();
  if (!value || value === 'test') return 'test';
  return value === 'production' ? 'production' : null;
}

export async function activePaymentProvider(): Promise<'payu'> {
  return 'payu';
}

export async function getPayUSettings(): Promise<PayUSettings | null> {
  const saved = (await getDatabase()).paymentProviderSettings;
  if (saved) {
    if (saved.provider !== 'payu' || !saved.payuMerchantKeyEnc || !saved.payuMerchantSaltEnc
      || (saved.payuMode !== undefined && saved.payuMode !== 'test' && saved.payuMode !== 'production')) return null;
    return {
      merchantKey: decryptServerSecret(saved.payuMerchantKeyEnc),
      merchantSalt: decryptServerSecret(saved.payuMerchantSaltEnc),
      mode: saved.payuMode || 'test',
      callbackUrl: saved.payuCallbackUrl || defaultCallbackUrl,
      webhookUrl: saved.payuWebhookUrl || defaultWebhookUrl,
    };
  }
  const merchantKey = process.env.PAYU_MERCHANT_KEY?.trim() || '';
  const merchantSalt = process.env.PAYU_MERCHANT_SALT?.trim() || '';
  const mode = envMode();
  if (!merchantKey || !merchantSalt || !mode) return null;
  return {
    merchantKey,
    merchantSalt,
    mode,
    callbackUrl: process.env.PAYU_CALLBACK_URL?.trim() || defaultCallbackUrl,
    webhookUrl: process.env.PAYU_WEBHOOK_URL?.trim() || defaultWebhookUrl,
  };
}

export async function getPayUSettingsStatus(): Promise<PayUSettingsStatus> {
  const saved = (await getDatabase()).paymentProviderSettings;
  const settings = await getPayUSettings();
  return {
    configured: Boolean(settings),
    hasMerchantKey: Boolean(settings?.merchantKey),
    hasMerchantSalt: Boolean(settings?.merchantSalt),
    mode: settings?.mode || saved?.payuMode || envMode() || 'test',
    callbackUrl: settings?.callbackUrl || saved?.payuCallbackUrl || process.env.PAYU_CALLBACK_URL?.trim() || defaultCallbackUrl,
    webhookUrl: settings?.webhookUrl || saved?.payuWebhookUrl || process.env.PAYU_WEBHOOK_URL?.trim() || defaultWebhookUrl,
    managedInOwnerStudio: Boolean(saved),
  };
}

export async function savePayUSettings(input: {
  merchantKey: string;
  merchantSalt: string;
  mode: 'test' | 'production';
  callbackUrl: string;
  webhookUrl: string;
}): Promise<PayUSettingsStatus> {
  const current = await getPayUSettings();
  const merchantKey = input.merchantKey.trim() || current?.merchantKey || '';
  const merchantSalt = input.merchantSalt.trim() || current?.merchantSalt || '';
  if (!merchantKey || !merchantSalt) throw new Error('Enter both PayU merchant credentials to enable PayU');

  await mutateDatabase((database) => {
    database.paymentProviderSettings = {
      provider: 'payu',
      payuMerchantKeyEnc: encryptServerSecret(merchantKey),
      payuMerchantSaltEnc: encryptServerSecret(merchantSalt),
      payuMode: input.mode,
      payuCallbackUrl: input.callbackUrl,
      payuWebhookUrl: input.webhookUrl,
    };
  });
  return getPayUSettingsStatus();
}

export async function deletePayUSettings(): Promise<void> {
  await mutateDatabase((database) => {
    database.paymentProviderSettings = { provider: 'manual_upi' };
  });
}
