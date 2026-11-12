import { createHash, timingSafeEqual } from 'node:crypto';
import type { Order } from './database.js';
import { getPayUSettings } from './paymentSettings.js';

type PayUFields = Record<string, string>;

export async function payuConfigured(): Promise<boolean> {
  const settings = await getPayUSettings();
  return Boolean(settings?.merchantKey && settings.merchantSalt && callbackUrl(settings.callbackUrl));
}

function callbackUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || url.pathname !== '/api/payments/payu/callback') return null;
    return url;
  } catch {
    return null;
  }
}

function apiBaseUrl(mode: 'test' | 'production'): string {
  return mode === 'production'
    ? 'https://info.payu.in/merchant/postservice.php?form=2'
    : 'https://test.payu.in/merchant/postservice?form=2';
}

export function payuCheckoutEndpoint(mode: 'test' | 'production'): string {
  return mode === 'production' ? 'https://secure.payu.in/_payment' : 'https://test.payu.in/_payment';
}

function sha512(value: string): string {
  return createHash('sha512').update(value, 'utf8').digest('hex');
}

export function payuAmountInPaise(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) return null;
  const amount = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(amount) ? amount : null;
}

export async function createPayUCheckout(order: Order, email: string): Promise<{ action: string; fields: PayUFields }> {
  const settings = await getPayUSettings();
  const callback = settings && callbackUrl(settings.callbackUrl);
  if (!settings || !callback || !order.payuTxnId) throw new Error('PayU is not configured');
  const key = settings.merchantKey;
  const salt = settings.merchantSalt;
  const fields: PayUFields = {
    key,
    txnid: order.payuTxnId,
    amount: (order.amount / 100).toFixed(2),
    productinfo: `AHUZA order ${order.id}`,
    firstname: order.shippingAddress.name,
    email,
    phone: order.shippingAddress.phone,
    udf1: order.id,
    udf2: '',
    udf3: '',
    udf4: '',
    udf5: '',
    surl: callback.href,
    furl: callback.href,
  };
  fields.hash = sha512([
    fields.key, fields.txnid, fields.amount, fields.productinfo, fields.firstname, fields.email,
    fields.udf1, fields.udf2, fields.udf3, fields.udf4, fields.udf5,
    '', '', '', '', '', salt,
  ].join('|'));
  return { action: payuCheckoutEndpoint(settings.mode), fields };
}

export async function verifyPayUResponseHash(data: unknown): Promise<boolean> {
  const settings = await getPayUSettings();
  if (!settings || !callbackUrl(settings.callbackUrl) || !data || typeof data !== 'object' || Array.isArray(data)) return false;
  const fields = data as Record<string, unknown>;
  if (typeof fields.hash !== 'string' || !/^[a-f\d]{128}$/i.test(fields.hash)) return false;
  const stringField = (name: string): string | null => fields[name] === undefined || fields[name] === null
    ? ''
    : typeof fields[name] === 'string' ? fields[name] as string : null;
  const status = stringField('status');
  const txnid = stringField('txnid');
  const amount = stringField('amount');
  const productinfo = stringField('productinfo');
  const firstname = stringField('firstname');
  const email = stringField('email');
  const key = stringField('key');
  const udf1 = stringField('udf1');
  const udf2 = stringField('udf2');
  const udf3 = stringField('udf3');
  const udf4 = stringField('udf4');
  const udf5 = stringField('udf5');
  const additionalCharges = fields.additional_charges !== undefined
    ? stringField('additional_charges') : stringField('additionalCharges');
  if ([status, txnid, amount, productinfo, firstname, email, key, udf1, udf2, udf3, udf4, udf5, additionalCharges].includes(null)
    || key !== settings.merchantKey) return false;
  const reverse = [
    ...(additionalCharges ? [additionalCharges] : []),
    settings.merchantSalt, status!,
    '', '', '', '', '',
    udf5!, udf4!, udf3!, udf2!, udf1!, email!, firstname!, productinfo!, amount!, txnid!, key!,
  ].join('|');
  const calculated = Buffer.from(sha512(reverse), 'hex');
  const received = Buffer.from(fields.hash, 'hex');
  return calculated.length === received.length && timingSafeEqual(calculated, received);
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function parsePayUStatus(data: unknown, txnid: string, amountPaise: number): { confirmed: boolean; transactionReference?: string } {
  const response = object(data);
  if (!response || Number(response.status) !== 1) return { confirmed: false };
  const transactions = object(response.transaction_details);
  const transaction = transactions && object(transactions[txnid]);
  if (!transaction) throw new Error('PayU verification response has no matching transaction');
  const amount = transaction.transaction_amount ?? transaction.amount;
  if (transaction.txnid !== txnid || payuAmountInPaise(amount) !== amountPaise
    || (transaction.transaction_amount !== undefined && transaction.amount !== undefined
      && payuAmountInPaise(transaction.amount) !== amountPaise)) {
    throw new Error('PayU transaction does not match order');
  }
  if (typeof transaction.status !== 'string' || transaction.status.toLowerCase() !== 'success') return { confirmed: false };
  if (typeof transaction.mihpayid !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(transaction.mihpayid)) {
    throw new Error('PayU transaction reference is missing');
  }
  return { confirmed: true, transactionReference: transaction.mihpayid };
}

export async function getPayUStatus(txnid: string, amountPaise: number): Promise<{ confirmed: boolean; transactionReference?: string }> {
  const settings = await getPayUSettings();
  if (!settings || !callbackUrl(settings.callbackUrl) || !/^[a-zA-Z0-9_-]{1,64}$/.test(txnid)) throw new Error('PayU is not configured or transaction ID is invalid');
  const key = settings.merchantKey;
  const salt = settings.merchantSalt;
  const body = new URLSearchParams({
    key,
    command: 'verify_payment',
    var1: txnid,
    hash: sha512(`${key}|verify_payment|${txnid}|${salt}`),
  });
  const response = await fetch(apiBaseUrl(settings.mode), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`PayU verify-payment API returned HTTP ${response.status}`);
  return parsePayUStatus(await response.json(), txnid, amountPaise);
}
