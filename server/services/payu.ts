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
    zipcode: order.shippingAddress.postalCode,
    udf1: order.id,
    udf2: '',
    udf3: '',
    udf4: '',
    udf5: order.id,
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

export async function createPayUIntent(
  order: Order,
  email: string,
  clientIp: string,
  userAgent: string,
): Promise<{ value: string; expiresAt: string }> {
  if (!clientIp?.trim() || !userAgent?.trim() || !order.reservationExpiresAt) {
    throw new Error('PayU UPI intent request is missing device or reservation information');
  }
  const checkout = await createPayUCheckout(order, email);
  const response = await fetch(checkout.action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      ...checkout.fields,
      pg: 'UPI',
      bankcode: 'INTENT',
      txn_s2s_flow: '4',
      s2s_client_ip: clientIp.trim(),
      s2s_device_info: userAgent.trim(),
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`PayU UPI intent API returned HTTP ${response.status}`);
  const data = object(await readPayUJson(response, 'UPI intent'));
  const metadata = object(data?.metaData);
  const result = object(data?.result);
  console.debug(`PayU intent response validation: txnId=${metadata?.txnId}, amount=${result?.amount}, expected=${(order.amount/100).toFixed(2)}, merchantVpa=${result?.merchantVpa}`);
  if (!metadata || metadata.txnId !== order.payuTxnId || typeof metadata.txnStatus !== 'string'
    || (metadata.txnStatus as string).toLowerCase() !== 'pending' || !result
    || payuAmountInPaise(result.amount) !== order.amount || typeof result.merchantVpa !== 'string'
    || typeof result.intentURIData !== 'string' || result.intentURIData.length > 4096) {
    const receivedAmount = payuAmountInPaise(result?.amount);
    console.error(`PayU intent validation failed: txnMismatch=${metadata?.txnId !== order.payuTxnId}, statusMismatch=${(metadata?.txnStatus as string | undefined)?.toLowerCase() !== 'pending'}, amountMismatch=${receivedAmount} vs ${order.amount}, missingResult=${!result}, missingIntentData=${!result?.intentURIData}, missingVpa=${!result?.merchantVpa}`);
    throw new Error('PayU returned an invalid UPI intent response');
  }
  const intent = new URL(`upi://pay?${result.intentURIData}`);
  if (intent.protocol !== 'upi:' || intent.hostname !== 'pay' || intent.username || intent.password
    || intent.pathname || intent.hash
    || intent.searchParams.getAll('pa').length !== 1 || intent.searchParams.get('pa') !== result.merchantVpa
    || intent.searchParams.getAll('am').length !== 1 || payuAmountInPaise(intent.searchParams.get('am')) !== order.amount
    || intent.searchParams.getAll('cu').length !== 1 || intent.searchParams.get('cu') !== 'INR'
    || intent.searchParams.getAll('tr').length !== 1 || !intent.searchParams.get('tr')) {
    throw new Error('PayU returned a UPI intent that does not match the order');
  }
  return { value: intent.href, expiresAt: order.reservationExpiresAt };
}

export async function createPayUQr(order: Order, email: string, clientIp: string, userAgent: string): Promise<{ value: string; expiresAt: string }> {
  if (!clientIp?.trim() || !userAgent?.trim() || !order.reservationExpiresAt) throw new Error('PayU QR request is missing device or reservation information');
  const checkout = await createPayUCheckout(order, email);
  const remaining = Math.floor((Date.parse(order.reservationExpiresAt) - Date.now()) / 1000);
  const expirySeconds = Math.min(1800, remaining);
  if (!Number.isFinite(expirySeconds) || expirySeconds < 60) throw new Error('Not enough reservation time remains for a PayU QR');
  const expiresAt = new Date(Date.now() + expirySeconds * 1000).toISOString();
  const response = await fetch(checkout.action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      ...checkout.fields, pg: 'DBQR', bankcode: 'UPIDBQR', txn_s2s_flow: '4',
      expiry_time: String(expirySeconds), s2s_client_ip: clientIp.trim(), s2s_device_info: userAgent.trim(),
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`PayU QR API returned HTTP ${response.status}`);
  const data = object(await readPayUJson(response, 'QR'));
  const metadata = object(data?.metaData);
  const result = object(data?.result);
  console.debug(`PayU QR response validation: txnId=${metadata?.txnId}, amount=${result?.amount}, expected=${(order.amount/100).toFixed(2)}, merchantVpa=${result?.merchantVpa}`);
  if (!metadata || metadata.txnId !== order.payuTxnId || typeof metadata.txnStatus !== 'string'
    || (metadata.txnStatus as string).toLowerCase() !== 'pending' || !result
    || payuAmountInPaise(result.amount) !== order.amount || typeof result.qrString !== 'string'
    || typeof result.merchantVpa !== 'string' || result.qrString.length > 4096) {
    const receivedAmount = payuAmountInPaise(result?.amount);
    console.error(`PayU QR validation failed: txnMismatch=${metadata?.txnId !== order.payuTxnId}, statusMismatch=${(metadata?.txnStatus as string | undefined)?.toLowerCase() !== 'pending'}, amountMismatch=${receivedAmount} vs ${order.amount}, missingResult=${!result}, missingQrString=${!result?.qrString}, missingVpa=${!result?.merchantVpa}`);
    throw new Error('PayU returned an invalid QR response');
  }
  const qr = new URL(result.qrString);
  if (qr.protocol !== 'upi:' || qr.hostname !== 'pay' || qr.username || qr.password || qr.hash
    || qr.searchParams.getAll('pa').length !== 1 || qr.searchParams.get('pa') !== result.merchantVpa
    || qr.searchParams.getAll('am').length !== 1 || payuAmountInPaise(qr.searchParams.get('am')) !== order.amount
    || qr.searchParams.getAll('cu').length !== 1 || qr.searchParams.get('cu') !== 'INR') {
    throw new Error('PayU returned a QR that does not match the order');
  }
  return { value: result.qrString, expiresAt };
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

async function readPayUJson(response: Response, label: string): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`PayU ${label} API returned a non-JSON response (likely a PayU outage page): ${text.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
}

type PayUStatus = { confirmed: boolean; failed?: boolean; transactionReference?: string };

export function parsePayUStatus(data: unknown, txnid: string, amountPaise: number): PayUStatus {
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
  if (typeof transaction.status !== 'string') throw new Error('PayU transaction status is missing');
  const status = transaction.status.toLowerCase();
  if (status === 'failure' || status === 'failed') return { confirmed: false, failed: true };
  if (status !== 'success') return { confirmed: false };
  if (typeof transaction.mihpayid !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(transaction.mihpayid)) {
    throw new Error('PayU transaction reference is missing');
  }
  return { confirmed: true, transactionReference: transaction.mihpayid };
}

export async function getPayUStatus(txnid: string, amountPaise: number): Promise<PayUStatus> {
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
  return parsePayUStatus(await readPayUJson(response, 'verify-payment'), txnid, amountPaise);
}
