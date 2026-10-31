import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { hashPassword, verifyPassword } from './services/auth.js';
import { generateAdCopy, generateAdImage, generateCustomerEmailBody, generateCustomerSupportReply, generateOwnerAgentPlan, generateSocialPost, isTextAiConfigured, type CustomerEmailKind, type OwnerAgentIntent } from './services/ai.js';
import { bannerImageKeys, circleImageKeys, getDatabase, mergeImageSettings, mutateDatabase, type Database, type Order, type Product, type ShippingAddress, type StorefrontContent, type SupportTicket } from './services/database.js';
import { sendRestockAlerts } from './services/stock-alerts.js';
import { deleteProductImageFiles, detectImageType, maxUploadBytes, sanitizeImageSettings, saveProductImage, uploadRoot } from './services/images.js';
import { publishSocialPost, runSchedule, socialStatus, validateSchedule } from './services/social.js';
import { createRule, listAutomations, runAutomations, validateRule } from './services/automations.js';
import { generateMarketingEmail } from './services/ai.js';
import { enqueueOrderEmail, expirePendingOrders, notifySupportTicket, recordMarketingEvent, isEmailConfigured, sendEmail } from './services/integrations.js';
import { buildAhuzaPayOrder, createAhuzaPayOrder, getAhuzaPayConfiguration, getAhuzaPayPayee, resetAhuzaPayPayee, updateAhuzaPayPayee } from './services/ahuzaPay.js';
import { customerDataConfigured, decryptCustomerValue, encryptCustomerValue, isValidUpiId } from './services/customerData.js';
import { confirmUpiPaymentByOwner, syncAhuzaPayPayment } from './services/paymentSync.js';
import { buildInvoicePdf } from './services/invoice.js';
import { storefrontCopyFields } from '../shared/storefrontCopy.js';

export const api = Router();
api.use('/owner', (request, response, next) => ownerFailLimit(request, response, next));
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
const ownerLimit = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
const ownerFailLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many failed attempts' } });
const adLimit = rateLimit({ windowMs: 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false });
const uploadLimit = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false });
const analyticsLimit = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false });
const supportLimit = rateLimit({ windowMs: 60 * 1000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false });
const newsletterLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false });
const paymentLimit = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });

function requireCustomer(request: Request, response: Response, next: NextFunction): void {
  if (!request.session.userId) { response.status(401).json({ error: 'Sign in is required' }); return; }
  next();
}

function requireOwner(request: Request, response: Response, next: NextFunction): void {
  const expected = process.env.OWNER_API_KEY || '';
  const supplied = request.get('x-owner-key') || '';
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const valid = expected.length > 0 && timingSafeEqual(digest(supplied), digest(expected));
  if (!valid) { response.status(403).json({ error: 'Owner access required' }); return; }
  next();
}

function asyncError(response: Response, error: unknown): void {
  if (error instanceof Error && error.message === 'AI_NOT_CONFIGURED') { response.status(503).json({ error: 'AI integration is not configured Set OPENAI_API_KEY (or GEMINI_API_KEY) in the server environment' }); return; }
  console.error(error);
  response.status(502).json({ error: 'The requested integration is temporarily unavailable' });
}

function stringValue(value: unknown, maxLength = 500): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function httpsUrl(value: unknown): value is string {
  if (!stringValue(value, 2000)) return false;
  if (/^\/uploads\/[0-9a-f-]{36}\/[\w.-]+$/i.test(value)) return true;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function validGhostMannequin(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const metadata = value as Record<string, unknown>;
  return Object.keys(metadata).every((key) => ['imageUrl', 'tags', 'background'].includes(key))
    && (metadata.imageUrl === undefined || httpsUrl(metadata.imageUrl))
    && (metadata.tags === undefined || (Array.isArray(metadata.tags) && metadata.tags.length <= 30 && metadata.tags.every((tag) => typeof tag === 'string' && tag.trim().length > 0 && tag.length <= 60)))
    && (metadata.background === undefined || (typeof metadata.background === 'string' && metadata.background.length <= 40));
}

api.get('/health', (_request, response) => response.json({ status: 'ok' }));

api.get('/site-status', async (_request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.json({ published: (await getDatabase()).sitePublished !== false });
});

api.use(async (request, response, next) => {
  if ((await getDatabase()).sitePublished !== false) { next(); return; }
  const method = request.method;
  const path = request.path;
  const ownerApi = path.startsWith('/owner/');
  const healthOrStatus = method === 'GET' && (path === '/health' || path === '/site-status');
  const paymentReadOnly = (method === 'GET' && path === '/payments/config')
    || (method === 'GET' && /^\/payments\/orders\/[^/]+\/status$/.test(path))
    || (method === 'POST' && /^\/payments\/orders\/[^/]+\/cancel$/.test(path));
  const customerAccount = (method === 'GET' && path === '/auth/me')
    || (method === 'POST' && (path === '/auth/login' || path === '/auth/logout'));
  const existingOrders = (method === 'GET' && (path === '/orders' || /^\/orders\/[^/]+(?:\/invoice)?$/.test(path)))
    || ((method === 'POST' || method === 'PATCH') && /^\/orders\/[^/]+(?:\/returns)?$/.test(path));
  if (ownerApi || healthOrStatus || paymentReadOnly || customerAccount || existingOrders) { next(); return; }
  response.status(503).json({ error: 'The AHUZA storefront is temporarily unavailable Please check back soon' });
});

api.get('/storefront', async (_request, response) => {
  const database = await getDatabase();
  response.json({ content: database.content, imageSettings: mergeImageSettings(database.imageSettings) });
});

api.get('/products', async (_request, response) => {
  const database = await getDatabase();
  response.json({ products: database.products.filter((product) => product.active) });
});

api.get('/products/:id', async (request, response) => {
  const product = (await getDatabase()).products.find((entry) => entry.id === request.params.id && entry.active);
  if (!product) { response.status(404).json({ error: 'Product not found' }); return; }
  response.json({ product });
});

api.post('/products/:id/stock-alert', requireCustomer, async (request, response) => {
  const result = await mutateDatabase<{ error: string; status: number } | { subscribed: true; alreadySubscribed: boolean }>((database) => {
    const product = database.products.find((entry) => entry.id === request.params.id && entry.active);
    if (!product) return { error: 'Product not found', status: 404 };
    if (product.stock > 0) return { error: 'This item is available now', status: 409 };
    const customer = database.customers.find((entry) => entry.id === request.session.userId);
    if (!customer) return { error: 'Sign in to receive a restock alert', status: 401 };
    database.stockAlerts ||= [];
    const existing = database.stockAlerts.find((alert) => alert.productId === product.id && alert.customerId === customer.id && !alert.notifiedAt);
    if (existing) return { subscribed: true, alreadySubscribed: true };
    database.stockAlerts.push({ id: randomUUID(), productId: product.id, customerId: customer.id, createdAt: new Date().toISOString() });
    return { subscribed: true, alreadySubscribed: false };
  });
  if ('error' in result) { response.status(result.status).json({ error: result.error }); return; }
  response.status(result.alreadySubscribed ? 200 : 201).json({ ...result, emailConfigured: isEmailConfigured() });
});

api.post('/newsletter/subscribe', newsletterLimit, async (request, response) => {
  const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || request.body?.consent !== true) {
    response.status(400).json({ error: 'Enter a valid email and agree to receive AHUZA newsletter updates' }); return;
  }
  const result = await mutateDatabase((database) => {
    database.newsletterSubscribers ||= [];
    const existing = database.newsletterSubscribers.find((subscriber) => subscriber.email === email);
    if (existing) return { subscribed: true as const, alreadySubscribed: true };
    database.newsletterSubscribers.push({
      id: randomUUID(),
      email,
      consentedAt: new Date().toISOString(),
      consentText: 'I agree to receive AHUZA news, new collection updates and offers by email',
      source: 'storefront',
    });
    return { subscribed: true as const, alreadySubscribed: false };
  });
  if (!result.alreadySubscribed) {
    void recordMarketingEvent({ name: 'newsletter_signup', page: 'newsletter' }).catch((error) => console.error('Newsletter event recording failed:', error));
  }
  response.status(result.alreadySubscribed ? 200 : 201).json(result);
});

api.post('/customer-support/chat', supportLimit, async (request, response) => {
  const message = request.body?.message;
  if (!stringValue(message, 1000)) { response.status(400).json({ error: 'A message is required (up to 1,000 characters)' }); return; }
  const complaint = /\b(?:delivery|shipping|shipment|order|parcel|package)\b.{0,50}\b(?:issue|problem|late|delay|delayed|delaying|missing|lost|stuck|not received|not delivered|not arrived|yet to)\b|\b(?:late delivery|delayed|delaying|missing parcel|lost parcel|not received|never arrived|wrong item|wrong size|wrong colou?r|damaged|defective|torn|stained|complaint|complain|refund|replacement|return request|cheated|fraud|scam|poor quality|bad quality)\b|\b(?:size|measurement|fit|fitting)\b.{0,40}\b(?:issue|problem|wrong|mismatch|small|tight|loose|too big|too small|not right|does ?n[o']?t fit)\b|\b(?:does ?n[o']?t|did ?n[o']?t|not)\s+fit\b/i.test(message);
  const asksAboutDelayCauses = /\b(?:why|reason|cause|causes|what (?:makes|causes))\b.{0,60}\b(?:delay|delayed|late|take so long)\b|\b(?:delay|delayed|late)\b.{0,40}\b(?:reason|cause|causes|why)\b/i.test(message);
  if (complaint && !asksAboutDelayCauses) {
    response.json({ reply: 'I’m really sorry about this Our support team will look into it personally Please create a support ticket with your order details and they will respond within 48 working hours Support hours are 10:00 AM–9:00 PM IST', requiresHumanSupport: true });
    return;
  }
  try {
    const database = await getDatabase();
    const storeContext = JSON.stringify({
      contact: 'Info@ahuzawear.com, +91 95505 82277, Telangana, India',
      returns: 'Returns and replacements may be requested within 7 days after delivery',
      products: database.products.filter((product) => product.active).map(({ name, description, price, stock, category, sizes }) => ({ name, description, price, stock, category, sizes: sizes || [] })),
    });
    const history = Array.isArray(request.body?.history)
      ? request.body.history.slice(-8).filter((turn: unknown): turn is { role: 'assistant' | 'customer'; text: string } => {
        const entry = turn as { role?: unknown; text?: unknown };
        return (entry?.role === 'assistant' || entry?.role === 'customer') && typeof entry.text === 'string';
      })
      : [];
    const raw = await generateCustomerSupportReply(message, storeContext, history);
    const escalate = /\[ESCALATE\]/i.test(raw) || asksAboutDelayCauses && complaint;
    response.json({ reply: raw.replace(/\s*\[ESCALATE\]\s*/gi, ' ').trim(), requiresHumanSupport: escalate });
  } catch (error) {
    if (error instanceof Error && error.message === 'AI_NOT_CONFIGURED') {
      response.json({ reply: 'I’m sorry, I can’t answer that just now Customer support is available from 10:00 AM to 9:00 PM IST You can create a support ticket or email Info@ahuzawear.com for help', requiresHumanSupport: false });
      return;
    }
    asyncError(response, error);
  }
});

api.post('/customer-support/tickets', supportLimit, async (request, response) => {
  const message = request.body?.message;
  const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : request.session.email || '';
  if (!stringValue(message, 2000) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    response.status(400).json({ error: 'Provide your support message and a valid email address' }); return;
  }
  const deliveryIssue = /\b(?:delivery|shipping|shipment)\b.{0,40}\b(?:issue|problem|late|delay|delayed|missing|lost|not received)\b|\b(?:late delivery|delayed|missing parcel|lost parcel|not received|never arrived|wrong item|damaged)\b/i.test(message);
  const complaint = /\b(?:complaint|complain|unhappy|dissatisfied|refund|replacement)\b/i.test(message);
  const ticket: SupportTicket = {
    id: `AHU-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 6).toUpperCase()}`,
    email,
    message: message.trim(),
    category: deliveryIssue ? 'delivery' : complaint ? 'complaint' : 'general',
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  await mutateDatabase((database) => { database.supportTickets.unshift(ticket); });
  let notificationSent = true;
  try {
    await notifySupportTicket(ticket);
  } catch (error) {
    notificationSent = false;
    console.error(`Support ticket ${ticket.id} was saved, but its email notification failed:`, error);
  }
  const notificationMessage = notificationSent
    ? `We’re sorry for the inconvenience Your reference ID is ${ticket.id} Our support team will reach out within 48 working hours Support hours are 10:00 AM–9:00 PM IST`
    : `Your support ticket ${ticket.id} was saved, but we could not notify our support team by email Please contact Info@ahuzawear.com or +91 95505 82277 and include this reference`;
  response.status(201).json({ ticket: { id: ticket.id, status: ticket.status }, notificationSent, message: notificationMessage });
});

api.post('/auth/signup', authLimit, async (request, response) => {
  const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
  const password = request.body?.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length < 12 || password.length > 200) {
    response.status(400).json({ error: 'Enter a valid email and a password of at least 12 characters' }); return;
  }
  const customer = await mutateDatabase(async (database) => {
    if (database.customers.some((entry) => entry.email === email)) return null;
    const created = { id: randomUUID(), email, passwordHash: await hashPassword(password), createdAt: new Date().toISOString() };
    database.customers.push(created);
    return { id: created.id, email: created.email };
  });
  if (!customer) { response.status(409).json({ error: 'An account already exists for this email' }); return; }
  await new Promise<void>((resolve, reject) => request.session.regenerate((error) => error ? reject(error) : resolve()));
  request.session.userId = customer.id;
  request.session.email = customer.email;
  response.status(201).json({ customer });
});

api.post('/auth/login', authLimit, async (request, response) => {
  const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
  const password = request.body?.password;
  if (!stringValue(email, 254) || typeof password !== 'string' || password.length > 200) { response.status(400).json({ error: 'Enter your email and password' }); return; }
  const customer = (await getDatabase()).customers.find((entry) => entry.email === email);
  if (!customer || !await verifyPassword(password, customer.passwordHash)) { response.status(401).json({ error: 'Email or password is incorrect' }); return; }
  await new Promise<void>((resolve, reject) => request.session.regenerate((error) => error ? reject(error) : resolve()));
  request.session.userId = customer.id;
  request.session.email = customer.email;
  response.json({ customer: { id: customer.id, email: customer.email } });
});

api.post('/auth/logout', (request, response, next) => {
  request.session.destroy((error) => {
    if (error) { next(error); return; }
    response.clearCookie('ahuza.sid');
    response.status(204).end();
  });
});

api.get('/auth/me', requireCustomer, (request, response) => response.json({ customer: { id: request.session.userId, email: request.session.email } }));

api.get('/account/upi', requireCustomer, paymentLimit, async (request, response) => {
  const customer = (await getDatabase()).customers.find((entry) => entry.id === request.session.userId);
  response.json({ upiId: decryptCustomerValue(customer?.savedUpiIdEnc), available: customerDataConfigured() });
});

api.put('/account/upi', requireCustomer, paymentLimit, async (request, response) => {
  const upiId = typeof request.body?.upiId === 'string' ? request.body.upiId.trim() : '';
  if (request.body?.consent !== true) { response.status(400).json({ error: 'Please confirm that you want us to save your UPI ID' }); return; }
  if (!isValidUpiId(upiId)) { response.status(400).json({ error: 'Enter a valid UPI ID such as name@bank' }); return; }
  if (!customerDataConfigured()) { response.status(503).json({ error: 'Saving a UPI ID is unavailable right now' }); return; }
  const saved = await mutateDatabase((database) => {
    const customer = database.customers.find((entry) => entry.id === request.session.userId);
    if (!customer) return false;
    customer.savedUpiIdEnc = encryptCustomerValue(upiId);
    return true;
  });
  if (!saved) { response.status(404).json({ error: 'Account not found' }); return; }
  response.json({ upiId });
});

api.delete('/account/upi', requireCustomer, paymentLimit, async (request, response) => {
  await mutateDatabase((database) => {
    const customer = database.customers.find((entry) => entry.id === request.session.userId);
    if (customer) delete customer.savedUpiIdEnc;
  });
  response.json({ upiId: null });
});

api.get('/wishlist', requireCustomer, async (request, response) => {
  const database = await getDatabase();
  const saved = database.customers.find((entry) => entry.id === request.session.userId)?.wishlist || [];
  response.json({ productIds: saved.filter((id) => database.products.some((product) => product.id === id && product.active)) });
});

api.put('/wishlist/:productId', requireCustomer, async (request, response) => {
  const productId = String(request.params.productId);
  const result = await mutateDatabase((database) => {
    const customer = database.customers.find((entry) => entry.id === request.session.userId);
    if (!customer || !database.products.some((product) => product.id === productId && product.active)) return null;
    const list = customer.wishlist || [];
    if (!list.includes(productId)) list.push(productId);
    customer.wishlist = list.slice(-200);
    return customer.wishlist;
  });
  if (!result) { response.status(404).json({ error: 'Product not found' }); return; }
  response.json({ productIds: result });
});

api.delete('/wishlist/:productId', requireCustomer, async (request, response) => {
  const productId = String(request.params.productId);
  const result = await mutateDatabase((database) => {
    const customer = database.customers.find((entry) => entry.id === request.session.userId);
    if (!customer) return null;
    customer.wishlist = (customer.wishlist || []).filter((id) => id !== productId);
    return customer.wishlist;
  });
  if (!result) { response.status(404).json({ error: 'Account not found' }); return; }
  response.json({ productIds: result });
});

async function createPaymentOrder(request: Request, response: Response): Promise<void> {
  const paymentMethod = request.body?.paymentMethod;
  if (paymentMethod !== 'upi' && paymentMethod !== 'cod') { response.status(400).json({ error: 'Choose UPI or cash on delivery' }); return; }
  if (paymentMethod === 'upi' && !getAhuzaPayConfiguration().configured) { response.status(503).json({ error: 'Online payment is unavailable Configure AHUZA_PAY_URL and AHUZA_PAY_API_KEY on the server' }); return; }
  const rawPayerUpi = request.body?.payerUpiId;
  const payerUpiId = typeof rawPayerUpi === 'string' ? rawPayerUpi.trim() : '';
  if (paymentMethod === 'upi' && payerUpiId && !isValidUpiId(payerUpiId)) { response.status(400).json({ error: 'Enter a valid UPI ID such as name@bank, or leave it blank' }); return; }
  const saveUpiId = paymentMethod === 'upi' && Boolean(payerUpiId) && request.body?.saveUpiId === true;
  if (saveUpiId && !customerDataConfigured()) { response.status(503).json({ error: 'Saving a UPI ID is unavailable right now You can still pay without saving it' }); return; }
  const items = request.body?.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > 20) { response.status(400).json({ error: 'Provide one or more cart items' }); return; }
  const parseAddress = (address: any): ShippingAddress | null => {
    const parsed: ShippingAddress = {
      name: typeof address?.name === 'string' ? address.name.trim() : '',
      addressLine1: typeof address?.addressLine1 === 'string' ? address.addressLine1.trim() : '',
      ...(typeof address?.addressLine2 === 'string' && address.addressLine2.trim() ? { addressLine2: address.addressLine2.trim() } : {}),
      city: typeof address?.city === 'string' ? address.city.trim() : '',
      state: typeof address?.state === 'string' ? address.state.trim() : '',
      postalCode: typeof address?.postalCode === 'string' ? address.postalCode.trim() : '',
      country: 'India',
      phone: typeof address?.phone === 'string' ? address.phone.trim() : '',
    };
    const valid = stringValue(parsed.name, 100) && stringValue(parsed.addressLine1, 180) && !(parsed.addressLine2 && parsed.addressLine2.length > 180) && stringValue(parsed.city, 80) && stringValue(parsed.state, 80) && /^[1-9][0-9]{5}$/.test(parsed.postalCode) && /^\+?[0-9][0-9\s-]{8,16}$/.test(parsed.phone);
    return valid ? parsed : null;
  };
  const shippingAddress = parseAddress(request.body?.shippingAddress);
  const billingAddress = request.body?.billingAddress === undefined ? shippingAddress : parseAddress(request.body.billingAddress);
  if (!shippingAddress || !billingAddress) {
    response.status(400).json({ error: 'Enter a valid name, Indian billing and delivery address, six-digit PIN code, and phone number' }); return;
  }
  const requested = new Map<string, { productId: string; size?: string; quantity: number }>();
  for (const item of items) {
    if (!stringValue(item?.productId, 100) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10
      || (item.size !== undefined && !stringValue(item.size, 20))) { response.status(400).json({ error: 'Each item needs a product ID, valid size (when required), and quantity from 1 to 10' }); return; }
    const key = `${item.productId}:${typeof item.size === 'string' ? item.size.trim().toLowerCase() : ''}`;
    const existing = requested.get(key);
    const quantity = (existing?.quantity || 0) + item.quantity;
    if (quantity > 10) { response.status(400).json({ error: 'Each product is limited to 10 items per order' }); return; }
    requested.set(key, { productId: item.productId, ...(typeof item.size === 'string' ? { size: item.size.trim() } : {}), quantity });
  }
  const products = (await getDatabase()).products;
  const orderItems: Order['items'] = [];
  for (const { productId, size, quantity } of requested.values()) {
    const product = products.find((entry) => entry.id === productId && entry.active);
    if (!product || product.stock < quantity) { response.status(409).json({ error: `Product ${productId} is unavailable in the requested quantity` }); return; }
    if (product.sizes?.length && (!size || !product.sizes.some((available) => available.toLowerCase() === size.toLowerCase()))) {
      response.status(400).json({ error: `Choose an available size for ${product.name}` }); return;
    }
    if (size && !product.sizes?.some((available) => available.toLowerCase() === size.toLowerCase())) {
      response.status(400).json({ error: `Size ${size} is not available for ${product.name}` }); return;
    }
    orderItems.push({ productId, name: product.name, sku: product.sku, quantity, unitPrice: product.price, ...(size ? { size: product.sizes!.find((available) => available.toLowerCase() === size.toLowerCase()) } : {}) });
  }
  const subtotalAmount = orderItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0) * 100;
  const shippingAmount = subtotalAmount < 250000 ? 10000 : 0;
  const amount = subtotalAmount + shippingAmount;
  if (!Number.isSafeInteger(amount) || amount < 100) { response.status(400).json({ error: 'Order total is invalid' }); return; }
  const localOrderId = randomUUID();
  const paymentReference = `AHUZA-${randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase()}`;
  const expiresAt = paymentMethod === 'upi' ? new Date(Date.now() + 60 * 60 * 1000) : null;
  const persisted = await mutateDatabase((database) => {
    const available = orderItems.every((item) => {
      const product = database.products.find((entry) => entry.id === item.productId && entry.active);
      return product && product.stock >= item.quantity && product.price === item.unitPrice;
    });
    if (!available) return false;
    for (const item of orderItems) database.products.find((entry) => entry.id === item.productId)!.stock -= item.quantity;
    database.orders.push({
      id: localOrderId, userId: request.session.userId!, shippingAddress, billingAddress, items: orderItems,
      amount, subtotalAmount, shippingAmount, discountAmount: 0, taxAmount: 0,
      currency: 'INR', status: paymentMethod === 'cod' ? 'confirmed' : 'pending_payment', paymentStatus: 'pending', paymentMethod,
      ...(paymentMethod === 'upi' ? { paymentReference, reservationExpiresAt: expiresAt!.toISOString() } : {}),
      ...(paymentMethod === 'upi' && payerUpiId && customerDataConfigured() ? { payerUpiIdEnc: encryptCustomerValue(payerUpiId) } : {}),
      marketingConsent: request.body?.marketingConsent === true,
      createdAt: new Date().toISOString(),
    });
    return true;
  });
  if (!persisted) { response.status(409).json({ error: 'Inventory changed while placing your order Please refresh your bag' }); return; }
  if (saveUpiId) {
    await mutateDatabase((database) => {
      const customer = database.customers.find((entry) => entry.id === request.session.userId);
      if (customer) customer.savedUpiIdEnc = encryptCustomerValue(payerUpiId);
    }).catch((error) => console.error('Saving the UPI ID failed:', error));
  }
  const placed = (await getDatabase()).orders.find((entry) => entry.id === localOrderId);
  const customerEmail = (await getDatabase()).customers.find((entry) => entry.id === request.session.userId)?.email;
  if (paymentMethod === 'cod') {
    if (placed && customerEmail) void enqueueOrderEmail(localOrderId, 'order_placed').catch((error) => console.error('Order received email queue failed:', error));
    void enqueueOrderEmail(localOrderId, 'owner_new_order').catch((error) => console.error('Owner order email queue failed:', error));
    response.status(201).json({ orderId: localOrderId, paymentMethod, status: 'confirmed', amount, currency: 'INR' });
    return;
  }
  let payUrl: string;
  try {
    ({ payUrl } = await createAhuzaPayOrder(buildAhuzaPayOrder(placed!, { name: shippingAddress.name, email: customerEmail || '' }, shippingAddress)));
  } catch (error) {
    console.error('Ahuza Pay order creation failed:', error);
    await mutateDatabase((database) => {
      const order = database.orders.find((entry) => entry.id === localOrderId && entry.status === 'pending_payment');
      if (!order) return;
      for (const item of order.items) {
        const product = database.products.find((entry) => entry.id === item.productId);
        if (product) product.stock += item.quantity;
      }
      order.status = 'cancelled';
      order.paymentStatus = 'cancelled';
      delete order.reservationExpiresAt;
    });
    response.status(502).json({ error: 'Could not start the payment Please try again shortly' });
    return;
  }
  // UPI customers get a single combined confirmation email, sent once the bank credit is matched.
  response.status(201).json({ orderId: localOrderId, paymentMethod, paymentReference, payUrl, amount, currency: 'INR', expiresAt: expiresAt!.toISOString(), status: 'pending' });
}

api.get('/payments/config', (_request, response) => {
  response.json({ configured: getAhuzaPayConfiguration().configured, automaticVerification: true });
});

api.post('/payments/orders', requireCustomer, paymentLimit, async (request, response) => {
  await createPaymentOrder(request, response);
});

// Ahuza Pay calls this the moment a bank credit is matched. It only triggers a re-check: the order is
// marked paid solely when Ahuza Pay itself reports PAID, so a forged call cannot confirm anything.
api.post('/payments/ahuza-pay/notify', paymentLimit, async (request, response) => {
  const expected = Buffer.from(getAhuzaPayConfiguration().apiKey);
  const header = request.get('authorization') || '';
  const supplied = Buffer.from(header.startsWith('Bearer ') ? header.slice(7).trim() : '');
  if (expected.length === 0 || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { response.status(401).json({ error: 'Authentication required' }); return; }
  const orderId = request.body?.external_order_id;
  if (typeof orderId !== 'string' || !orderId || orderId.length > 64) { response.status(400).json({ error: 'external_order_id is required' }); return; }
  const confirmed = await syncAhuzaPayPayment(orderId, undefined, 'ahuza_pay_notify').catch((error) => { console.error('Ahuza Pay notify sync failed:', error); return false; });
  response.json({ confirmed });
});

api.get('/payments/orders/:id/status', requireCustomer, paymentLimit, async (request, response) => {
  await syncAhuzaPayPayment(String(request.params.id), request.session.userId!, 'customer_check').catch((error) => console.error('Ahuza Pay status sync failed:', error));
  const order = (await getDatabase()).orders.find((entry) => entry.id === request.params.id && entry.userId === request.session.userId);
  if (!order) { response.status(404).json({ error: 'Order not found' }); return; }
  response.json({ orderId: order.id, status: order.paymentStatus || 'pending', orderStatus: order.status, paymentReference: order.paymentReference, expiresAt: order.reservationExpiresAt, verification: order.paymentVerificationMethod || 'awaiting_ahuza_pay' });
});

api.post('/payments/orders/:id/failure', requireCustomer, paymentLimit, async (request, response) => {
  if (!request.body || request.body.failed !== true || Object.keys(request.body).length !== 1) {
    response.status(400).json({ error: 'Report only that the UPI app did not complete the attempt' }); return;
  }
  const updated = await mutateDatabase((database) => {
    const order = database.orders.find((entry) => entry.id === request.params.id && entry.userId === request.session.userId);
    if (!order || order.paymentMethod !== 'upi' || order.status !== 'pending_payment' || !['pending', 'failed'].includes(order.paymentStatus || 'pending')) return false;
    order.paymentStatus = 'failed';
    return true;
  });
  if (!updated) { response.status(409).json({ error: 'This UPI order is no longer pending' }); return; }
  response.json({ status: 'failed', note: 'Customer-reported attempt only; AHUZA bank verification is still required' });
});

api.post('/payments/orders/:id/cancel', requireCustomer, paymentLimit, async (request, response) => {
  const result = await mutateDatabase((database) => {
    const order = database.orders.find((entry) => entry.id === request.params.id && entry.userId === request.session.userId);
    if (!order) return 'missing';
    if (order.paymentMethod !== 'upi' || order.status !== 'pending_payment' || !['pending', 'failed', 'cancelled'].includes(order.paymentStatus || 'pending')) return 'conflict';
    order.paymentStatus = 'cancelled';
    return 'cancelled';
  });
  if (result === 'missing') { response.status(404).json({ error: 'Order not found' }); return; }
  if (result === 'conflict') { response.status(409).json({ error: 'This order cannot be cancelled' }); return; }
  response.json({ status: result });
});

api.get('/orders/:id', requireCustomer, async (request, response) => {
  const order = (await getDatabase()).orders.find((entry) => entry.id === request.params.id && entry.userId === request.session.userId);
  if (!order) { response.status(404).json({ error: 'Order not found' }); return; }
  response.json({ order });
});

api.get('/orders', requireCustomer, async (request, response) => {
  const pending = (await getDatabase()).orders.filter((order) => order.userId === request.session.userId && order.paymentMethod === 'upi' && order.paymentStatus !== 'paid' && ['pending_payment', 'cancelled'].includes(order.status));
  await Promise.all(pending.map((order) => syncAhuzaPayPayment(order.id, request.session.userId!, 'customer_check').catch((error) => console.error('Ahuza Pay order list sync failed:', error))));
  const database = await getDatabase();
  const orders = database.orders
    .filter((order) => order.userId === request.session.userId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map(({ id, amount, currency, status, paymentMethod, paymentStatus, paymentVerifiedAt, createdAt, items, trackingNumber, trackingUrl, review }) => ({
      id, amount, currency, status, paymentMethod, paymentStatus, paymentVerifiedAt, createdAt, items, trackingNumber, trackingUrl, review,
    }));
  response.json({ orders });
});

api.post('/orders/:id/review', requireCustomer, async (request, response) => {
  const rating: unknown = request.body?.rating;
  const comment: unknown = request.body?.comment;
  if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5
    || (comment !== undefined && (typeof comment !== 'string' || comment.length > 1000))) {
    response.status(400).json({ error: 'Choose a rating from 1 to 5 stars and an optional comment up to 1,000 characters' }); return;
  }
  const result = await mutateDatabase<{ error: string; status: number } | { review: NonNullable<Order['review']> }>((database) => {
    const order = database.orders.find((entry) => entry.id === request.params.id && entry.userId === request.session.userId);
    if (!order) return { error: 'Order not found', status: 404 };
    if (order.status !== 'delivered') return { error: 'You can review an order after it is marked delivered', status: 409 };
    if (order.review) return { error: 'You have already reviewed this order', status: 409 };
    order.review = { rating, ...(typeof comment === 'string' && comment.trim() ? { comment: comment.trim() } : {}), createdAt: new Date().toISOString() };
    return { review: order.review };
  });
  if ('error' in result) { response.status(result.status).json({ error: result.error }); return; }
  response.status(201).json(result);
});

api.get('/orders/:id/invoice', requireCustomer, async (request, response) => {
  const database = await getDatabase();
  const order = database.orders.find((entry) => entry.id === request.params.id && entry.userId === request.session.userId);
  if (!order) { response.status(404).json({ error: 'Order not found' }); return; }
  if (!['paid', 'shipped', 'out_for_delivery', 'delivered'].includes(order.status) || order.paymentStatus !== 'paid'
    || (order.paymentMethod === 'upi' && !order.paymentVerifiedAt)) {
    response.status(409).json({ error: 'An invoice is available only after payment is confirmed' }); return;
  }
  const customerEmail = database.customers.find((customer) => customer.id === order.userId)?.email || 'Not available';
  const invoice = await buildInvoicePdf(order, customerEmail);
  response.setHeader('Content-Type', 'application/pdf');
  response.setHeader('Content-Disposition', `attachment; filename="ahuza-invoice-${order.id}.pdf"`);
  response.setHeader('Content-Length', invoice.length);
  response.send(invoice);
});

api.post('/orders/:id/returns', requireCustomer, async (request, response) => {
  const action = request.body?.action;
  const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim().slice(0, 500) : '';
  if (!['return', 'replacement'].includes(action) || !reason) { response.status(400).json({ error: 'Choose return or replacement and provide a reason' }); return; }
  const result = await mutateDatabase<{ order: Order } | { error: string; status: number }>((database) => {
    const order = database.orders.find((entry) => entry.id === request.params.id && entry.userId === request.session.userId);
    if (!order) return { error: 'Order not found', status: 404 };
    if (order.status !== 'delivered' || !order.deliveredAt || Date.now() > new Date(order.deliveredAt).getTime() + 7 * 24 * 60 * 60 * 1000) return { error: 'Returns and replacements are available within 7 days of delivery', status: 400 };
    if (order.returnRequest) return { error: 'A request has already been submitted for this order', status: 409 };
    order.returnRequest = { action, reason, status: 'requested', createdAt: new Date().toISOString() };
    return { order };
  });
  if ('error' in result) { response.status(result.status).json({ error: result.error }); return; }
  response.status(201).json({ order: result.order });
});

api.post('/marketing/events', analyticsLimit, async (request, response) => {
  const { name, page, campaign } = request.body || {};
  if (!stringValue(name, 64) || !/^[a-z0-9_]+$/i.test(name)) { response.status(400).json({ error: 'A valid event name is required' }); return; }
  const event = { name, ...(stringValue(page, 200) ? { page } : {}), ...(stringValue(campaign, 100) ? { campaign } : {}) };
  await recordMarketingEvent(event);
  response.status(202).json({ accepted: true });
});

api.get('/owner/analytics', requireOwner, ownerLimit, async (_request, response) => {
  const database = await getDatabase();
  const counts = database.events.reduce<Record<string, number>>((result, event) => { result[event.name] = (result[event.name] || 0) + 1; return result; }, {});
  const revenue = database.orders.filter((order) => ['paid', 'shipped', 'delivered'].includes(order.status)
    && order.paymentStatus !== 'refunded' && (order.paymentMethod !== 'cod' || order.paymentStatus === 'paid')).reduce((total, order) => total + order.amount, 0);
  response.json({ eventCounts: counts, orderCount: database.orders.length, paidRevenue: revenue / 100, currency: 'INR', lowStock: database.products.filter((product) => product.stock < 5).map(({ id, name, sku, stock }) => ({ id, name, sku, stock })) });
});

api.get('/owner/site-status', requireOwner, ownerLimit, async (_request, response) => {
  response.json({ published: (await getDatabase()).sitePublished !== false });
});

api.get('/owner/content', requireOwner, ownerLimit, async (_request, response) => response.json({ content: (await getDatabase()).content }));

api.patch('/owner/site-status', requireOwner, ownerLimit, async (request, response) => {
  if (!request.body || typeof request.body.published !== 'boolean' || Object.keys(request.body).length !== 1) {
    response.status(400).json({ error: 'Provide only a boolean published value' }); return;
  }
  const published = await mutateDatabase((database) => {
    database.sitePublished = request.body.published;
    return database.sitePublished;
  });
  console.info(`Storefront ${published ? 'published' : 'unpublished'} by owner`);
  response.json({ published });
});

api.get('/owner/inventory', requireOwner, ownerLimit, async (_request, response) => response.json({ products: (await getDatabase()).products }));

api.post('/owner/inventory', requireOwner, ownerLimit, async (request, response) => {
  const { name, description, price, sku, stock, category, imageUrl, ghostMannequin, images, mainImageId, active, sizes } = request.body || {};
  const hasImages = Array.isArray(images) && images.length > 0;
  if (!stringValue(name, 120) || !stringValue(description, 1000) || !Number.isFinite(price) || price <= 0 || price > 10000000 || !stringValue(sku, 80) || !Number.isInteger(stock) || stock < 0 || stock > 100000 || !stringValue(category, 80) || (!hasImages && !httpsUrl(imageUrl))) {
    response.status(400).json({ error: 'Provide a title, description, positive price, SKU, stock, category, and at least one uploaded image' }); return;
  }
  if (images !== undefined && !validImageIds(images, mainImageId)) { response.status(400).json({ error: 'Image list is invalid' }); return; }
  if (sizes !== undefined && !validProductSizes(sizes)) { response.status(400).json({ error: 'Sizes must be a list of up to 20 unique labels, each 1 to 20 characters' }); return; }
  if (active !== undefined && typeof active !== 'boolean') { response.status(400).json({ error: 'Status must be Published or Unpublished' }); return; }
  if (ghostMannequin !== undefined && !validGhostMannequin(ghostMannequin)) { response.status(400).json({ error: 'Ghost mannequin metadata is invalid' }); return; }
  const product = await mutateDatabase((database) => {
    if (database.products.some((entry) => entry.sku.toLowerCase() === sku.trim().toLowerCase())) return null;
    const created: Product = { id: randomUUID(), name: name.trim(), description: description.trim(), price, sku: sku.trim(), stock, category: category.trim(), imageUrl: imageUrl || '', active: active ?? true, ghostMannequin: { tags: [], ...(ghostMannequin as Product['ghostMannequin'] | undefined) }, ...(sizes?.length ? { sizes } : {}) };
    if (images !== undefined && !applyImages(database, created, images, mainImageId)) return 'bad-images' as const;
    database.products.push(created);
    return created;
  });
  if (product === 'bad-images') { response.status(400).json({ error: 'One or more images were not uploaded successfully' }); return; }
  if (!product) { response.status(409).json({ error: 'SKU is already assigned to another product' }); return; }
  response.status(201).json({ product });
});

api.patch('/owner/inventory/:id', requireOwner, ownerLimit, async (request, response) => {
  const { name, description, price, category, imageUrl, stock, sku, active, ghostMannequin, images, mainImageId, sizes } = request.body || {};
  if (images !== undefined && !validImageIds(images, mainImageId)) { response.status(400).json({ error: 'Image list is invalid' }); return; }
  if (sizes !== undefined && !validProductSizes(sizes)) { response.status(400).json({ error: 'Sizes must be a list of up to 20 unique labels, each 1 to 20 characters' }); return; }
  if (name !== undefined && !stringValue(name, 120)) { response.status(400).json({ error: 'Title must be 1 to 120 characters' }); return; }
  if (description !== undefined && !stringValue(description, 1000)) { response.status(400).json({ error: 'Description must be 1 to 1,000 characters' }); return; }
  if (price !== undefined && (!Number.isFinite(price) || price <= 0 || price > 10000000)) { response.status(400).json({ error: 'Price must be greater than zero' }); return; }
  if (category !== undefined && !stringValue(category, 80)) { response.status(400).json({ error: 'Category must be 1 to 80 characters' }); return; }
  if (imageUrl !== undefined && !httpsUrl(imageUrl)) { response.status(400).json({ error: 'Image URL must use HTTPS' }); return; }
  if (stock !== undefined && (!Number.isInteger(stock) || stock < 0 || stock > 100000)) { response.status(400).json({ error: 'Stock must be a non-negative whole number' }); return; }
  if (sku !== undefined && !stringValue(sku, 80)) { response.status(400).json({ error: 'SKU must be 1 to 80 characters' }); return; }
  if (active !== undefined && typeof active !== 'boolean') { response.status(400).json({ error: 'Active must be a boolean' }); return; }
  if (ghostMannequin !== undefined && !validGhostMannequin(ghostMannequin)) { response.status(400).json({ error: 'Ghost mannequin metadata is invalid' }); return; }
  const removedImageIds: string[] = [];
  const result = await mutateDatabase<{ product: Product } | { error: string; status: number }>((database) => {
    const product = database.products.find((entry) => entry.id === request.params.id);
    if (!product) return { error: 'Product not found', status: 404 };
    const previousIds = (product.images || []).map((image) => image.id);
    if (sku && database.products.some((entry) => entry.id !== product.id && entry.sku.toLowerCase() === sku.toLowerCase())) return { error: 'SKU is already assigned to another product', status: 409 };
    if (name !== undefined) product.name = name.trim();
    if (description !== undefined) product.description = description.trim();
    if (price !== undefined) product.price = price;
    if (category !== undefined) product.category = category.trim();
    if (imageUrl !== undefined) product.imageUrl = imageUrl;
    if (stock !== undefined) product.stock = stock;
    if (sku !== undefined) product.sku = sku.trim();
    if (active !== undefined) product.active = active;
    if (sizes !== undefined) product.sizes = sizes;
    if (ghostMannequin !== undefined) product.ghostMannequin = { ...product.ghostMannequin, ...ghostMannequin } as Product['ghostMannequin'];
    if (images !== undefined) {
      if (!applyImages(database, product, images, mainImageId)) return { error: 'One or more images were not uploaded successfully', status: 400 };
      for (const id of previousIds) if (!database.products.some((entry) => entry.images?.some((image) => image.id === id))) removedImageIds.push(id);
      database.imageLibrary = (database.imageLibrary || []).filter((image) => !removedImageIds.includes(image.id));
    }
    return { product };
  });
  if ('error' in result) { response.status(result.status).json({ error: result.error }); return; }
  await Promise.all(removedImageIds.map((id) => deleteProductImageFiles(id).catch((error) => console.error('Image cleanup failed:', error))));
  if (result.product.stock > 0) void sendRestockAlerts().catch((error) => console.error('Restock alert scan failed:', error));
  response.json(result);
});

function validProductSizes(sizes: unknown): sizes is string[] {
  return Array.isArray(sizes) && sizes.length <= 20
    && sizes.every((size) => typeof size === 'string' && size.trim().length > 0 && size.trim().length <= 20)
    && new Set(sizes.map((size) => size.trim().toLowerCase())).size === sizes.length;
}

function validImageIds(images: unknown, mainImageId: unknown): images is string[] {
  return Array.isArray(images) && images.length <= 12 && images.every((id) => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id))
    && new Set(images).size === images.length && (mainImageId === undefined || (typeof mainImageId === 'string' && images.includes(mainImageId)));
}

// Resolves ids against server-created uploads only; the main image is stored first and mirrored to imageUrl.
function applyImages(database: Database, product: Product, ids: string[], mainImageId: unknown): boolean {
  const library = database.imageLibrary || [];
  const resolved = ids.map((id) => library.find((image) => image.id === id) || database.products.flatMap((entry) => entry.images || []).find((image) => image.id === id));
  if (resolved.some((image) => !image)) return false;
  const list = resolved as NonNullable<(typeof resolved)[number]>[];
  const mainIndex = typeof mainImageId === 'string' ? list.findIndex((image) => image.id === mainImageId) : 0;
  const ordered = mainIndex > 0 ? [list[mainIndex]!, ...list.filter((_, index) => index !== mainIndex)] : list;
  product.images = ordered;
  product.mainImageId = ordered[0]?.id;
  if (ordered[0]) product.imageUrl = ordered[0].url;
  return true;
}

api.post('/owner/images', requireOwner, uploadLimit, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: maxUploadBytes }), async (request, response) => {
  if (!Buffer.isBuffer(request.body) || request.body.length === 0) { response.status(415).json({ error: 'Upload a JPG, PNG, or WebP image' }); return; }
  const detected = detectImageType(request.body);
  if (!detected || detected !== request.get('content-type')?.split(';')[0]?.trim().toLowerCase()) { response.status(415).json({ error: 'The file is not a valid JPG, PNG, or WebP image' }); return; }
  const name = decodeURIComponent(request.get('x-file-name') || 'image').replace(/[^\w .()-]/g, '_');
  try {
    const database = await getDatabase();
    const image = await saveProductImage(request.body, detected, name, mergeImageSettings(database.imageSettings));
    await mutateDatabase((db) => { (db.imageLibrary ||= []).push(image); });
    response.status(201).json({ image });
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_IMAGE') { response.status(415).json({ error: 'The image could not be read' }); return; }
    console.error('Image upload failed:', error);
    response.status(500).json({ error: 'The image could not be saved Please retry' });
  }
});

api.delete('/owner/images/:id', requireOwner, ownerLimit, async (request, response) => {
  const id = String(request.params.id);
  const removed = await mutateDatabase((database) => {
    if (database.products.some((product) => product.images?.some((image) => image.id === id))) return false;
    database.imageLibrary = (database.imageLibrary || []).filter((image) => image.id !== id);
    return true;
  });
  if (!removed) { response.status(409).json({ error: 'Image is used by a product Remove it from the product first' }); return; }
  await deleteProductImageFiles(id);
  response.json({ ok: true });
});

api.get('/owner/image-settings', requireOwner, ownerLimit, async (_request, response) => response.json({ imageSettings: mergeImageSettings((await getDatabase()).imageSettings), maxUploadMb: Math.round(maxUploadBytes / 1024 / 1024) }));

api.put('/owner/image-settings', requireOwner, ownerLimit, async (request, response) => {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) { response.status(400).json({ error: 'Provide image settings' }); return; }
  const imageSettings = sanitizeImageSettings(request.body);
  await mutateDatabase((database) => { database.imageSettings = imageSettings; });
  response.json({ imageSettings });
});

api.patch('/owner/content', requireOwner, ownerLimit, async (request, response) => {
  const patch = request.body;
  const allowed: (keyof StorefrontContent)[] = ['announcement', 'heroEyebrow', 'heroTitle', 'heroDescription', 'heroImageUrl', 'storyHeading', 'storyBody', 'storyImageUrl', 'circleImages', 'bannerImages'];
  const copyFields = new Set<string>(storefrontCopyFields.map(({ id }) => id));
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).length === 0) { response.status(400).json({ error: 'Provide at least one storefront field' }); return; }
  const imageMaps: Record<string, string[]> = { circleImages: circleImageKeys, bannerImages: bannerImageKeys };
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'copy') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) { response.status(400).json({ error: 'Invalid storefront copy' }); return; }
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0 || entries.some(([name, text]) => !copyFields.has(name) || !stringValue(text, 500))) {
        response.status(400).json({ error: 'Invalid storefront copy field' }); return;
      }
      cleaned.copy = Object.fromEntries(entries);
      continue;
    }
    if (key === 'circleLabels') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) { response.status(400).json({ error: 'Invalid category names' }); return; }
      const entries = Object.entries(value as Record<string, unknown>);
      // An empty string clears an override so the original name is shown.
      if (entries.some(([name, text]) => !circleImageKeys.includes(name) || typeof text !== 'string' || text.trim().length > 40)) { response.status(400).json({ error: 'Category names can be up to 40 characters' }); return; }
      cleaned.circleLabels = Object.fromEntries(entries.map(([name, text]) => [name, (text as string).trim()]).filter(([, text]) => text !== ''));
      continue;
    }
    if (key in imageMaps) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) { response.status(400).json({ error: `Invalid value for ${key}` }); return; }
      const entries = Object.entries(value as Record<string, unknown>);
      // An empty string clears an override so the storefront falls back to its default image.
      if (entries.some(([name, url]) => !imageMaps[key].includes(name) || (url !== '' && !httpsUrl(url)))) { response.status(400).json({ error: `Invalid image in ${key}` }); return; }
      cleaned[key] = Object.fromEntries(entries.filter(([, url]) => url !== ''));
      continue;
    }
    if (!allowed.includes(key as keyof StorefrontContent)) { response.status(400).json({ error: `Unknown storefront field: ${key}` }); return; }
    if (key.endsWith('ImageUrl') ? !httpsUrl(value) : !stringValue(value, key === 'heroTitle' ? 120 : 500)) { response.status(400).json({ error: `Invalid value for ${key}` }); return; }
    cleaned[key] = value;
  }
  const content = await mutateDatabase((database) => {
    const { copy, ...fields } = cleaned;
    database.content = { ...database.content, ...fields };
    if (copy) database.content.copy = { ...database.content.copy, ...(copy as StorefrontContent['copy']) };
    return database.content;
  });
  response.json({ content });
});

api.get('/owner/orders', requireOwner, ownerLimit, async (_request, response) => response.json({
  orders: (await getDatabase()).orders.map(({ payerUpiIdEnc, ...order }) => ({ ...order, ...(payerUpiIdEnc ? { payerUpiId: decryptCustomerValue(payerUpiIdEnc) || undefined } : {}) })),
}));

function payeeError(response: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : '';
  if (message === 'AHUZA_PAY_NOT_CONFIGURED') { response.status(503).json({ error: 'Ahuza Pay is not connected Set AHUZA_PAY_URL and AHUZA_PAY_API_KEY on the server' }); return; }
  const upstream = /^AHUZA_PAY_(\d{3}): (.+)$/.exec(message);
  if (upstream && Number(upstream[1]) === 401) { response.status(502).json({ error: 'Ahuza Pay rejected the API key Check AHUZA_PAY_API_KEY matches MERCHANT_API_KEY on Ahuza Pay' }); return; }
  if (upstream && Number(upstream[1]) >= 400 && Number(upstream[1]) < 500) { response.status(400).json({ error: upstream[2] }); return; }
  console.error('Ahuza Pay payee request failed:', error);
  response.status(502).json({ error: 'Could not reach Ahuza Pay Please try again shortly' });
}

api.get('/owner/payee', requireOwner, ownerLimit, async (_request, response) => {
  try { response.json({ payee: await getAhuzaPayPayee() }); } catch (error) { payeeError(response, error); }
});

api.put('/owner/payee', requireOwner, ownerLimit, async (request, response) => {
  const vpa = request.body?.vpa;
  const payeeName = request.body?.payeeName;
  if (vpa !== undefined && (typeof vpa !== 'string' || !isValidUpiId(vpa.trim()))) { response.status(400).json({ error: 'Enter a valid UPI ID such as name@bank' }); return; }
  if (payeeName !== undefined && (typeof payeeName !== 'string' || payeeName.trim().length < 1 || payeeName.trim().length > 60)) { response.status(400).json({ error: 'Payee name must be 1 to 60 characters' }); return; }
  if (vpa === undefined && payeeName === undefined) { response.status(400).json({ error: 'Provide a UPI ID or payee name' }); return; }
  try {
    response.json({ payee: await updateAhuzaPayPayee({ ...(vpa === undefined ? {} : { vpa: vpa.trim() }), ...(payeeName === undefined ? {} : { payeeName: payeeName.trim() }) }) });
  } catch (error) { payeeError(response, error); }
});

api.delete('/owner/payee', requireOwner, ownerLimit, async (_request, response) => {
  try { response.json({ payee: await resetAhuzaPayPayee() }); } catch (error) { payeeError(response, error); }
});

api.get('/owner/integrations', requireOwner, ownerLimit, async (_request, response) => {
  response.json({ integrations: {
    email: isEmailConfigured(),
    followUps: isEmailConfigured(),
    ai: isTextAiConfigured(),
  } });
});

api.get('/owner/support-tickets', requireOwner, ownerLimit, async (_request, response) => {
  response.json({ tickets: (await getDatabase()).supportTickets });
});

api.patch('/owner/support-tickets/:id', requireOwner, ownerLimit, async (request, response) => {
  if (request.body?.status !== 'resolved') { response.status(400).json({ error: 'Ticket status must be resolved' }); return; }
  const ticket = await mutateDatabase((database) => {
    const current = database.supportTickets.find((entry) => entry.id === request.params.id);
    if (!current) return null;
    current.status = 'resolved';
    return current;
  });
  if (!ticket) { response.status(404).json({ error: 'Support ticket not found' }); return; }
  response.json({ ticket });
});

function validTrackingUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch { return false; }
}

api.delete('/owner/orders/:id', requireOwner, ownerLimit, async (request, response) => {
  const removed = await mutateDatabase((database) => {
    const index = database.orders.findIndex((entry) => entry.id === request.params.id);
    if (index < 0) return false;
    const order = database.orders[index]!;
    // Stock is still held for orders that were never shipped or cancelled; give it back.
    if (['pending_payment', 'paid', 'confirmed'].includes(order.status)) {
      for (const item of order.items) {
        const product = database.products.find((entry) => entry.id === item.productId);
        if (product) product.stock += item.quantity;
      }
    }
    database.orders.splice(index, 1);
    database.orderEmailNotifications = (database.orderEmailNotifications || []).filter((entry) => entry.orderId !== order.id);
    return true;
  });
  if (!removed) { response.status(404).json({ error: 'Order not found' }); return; }
  response.status(204).end();
});

api.patch('/owner/orders/:id/status', requireOwner, ownerLimit, async (request, response) => {
  const status = request.body?.status;
  const trackingNumber = request.body?.trackingNumber;
  const trackingUrl = request.body?.trackingUrl;
  if (!['shipped', 'out_for_delivery', 'delivered'].includes(status)) { response.status(400).json({ error: 'Status must be shipped, out for delivery, or delivered' }); return; }
  if (trackingNumber !== undefined && (typeof trackingNumber !== 'string' || trackingNumber.length > 100)) { response.status(400).json({ error: 'Tracking reference must be at most 100 characters' }); return; }
  if (trackingUrl !== undefined && trackingUrl !== '' && !validTrackingUrl(trackingUrl)) { response.status(400).json({ error: 'Tracking link must be a valid HTTPS URL' }); return; }
  const result = await mutateDatabase((database) => {
    const order = database.orders.find((entry) => entry.id === request.params.id);
    if (!order) return null;
    const validTransitions: Record<string, string[]> = {
      confirmed: ['shipped'],
      paid: ['shipped'],
      shipped: ['out_for_delivery'],
      out_for_delivery: ['delivered'],
      delivered: [],
    };
    if (!(validTransitions[order.status] || []).includes(status) && order.status !== status) return null;
    const changed = order.status !== status;
    order.status = status;
    if (typeof trackingNumber === 'string' && trackingNumber.trim()) order.trackingNumber = trackingNumber.trim();
    if (typeof trackingUrl === 'string') {
      if (trackingUrl.trim()) order.trackingUrl = trackingUrl.trim();
      else delete order.trackingUrl;
    }
    if (status === 'delivered' && !order.deliveredAt) order.deliveredAt = new Date().toISOString();
    return { order, changed };
  });

  if (!result) { response.status(404).json({ error: 'Paid order not found or status transition is invalid' }); return; }
  const email = (await getDatabase()).customers.find((entry) => entry.id === result.order.userId)?.email;
  const notificationKind = status === 'shipped' || status === 'out_for_delivery' || status === 'delivered' ? status : null;
  if (result.changed && email && notificationKind) void enqueueOrderEmail(result.order.id, notificationKind).catch((error) => console.error(`${status} email queue failed:`, error));
  response.json({ order: result.order });
});

api.patch('/owner/orders/:id/confirm-upi-payment', requireOwner, ownerLimit, async (request, response) => {
  const result = await confirmUpiPaymentByOwner(String(request.params.id));
  if (!result.ok) { response.status(409).json({ error: result.error }); return; }
  response.json({ order: (await getDatabase()).orders.find((entry) => entry.id === request.params.id) });
});

api.get('/owner/payment-agent', requireOwner, ownerLimit, async (_request, response) => {
  const database = await getDatabase();
  const log = (database.paymentAgentLog || []).slice(0, 50);
  const heldIds = new Set(log.filter((entry) => entry.decision === 'held_out_of_stock').map((entry) => entry.orderId));
  const held = database.orders.filter((order) => heldIds.has(order.id) && order.paymentStatus !== 'paid')
    .map((order) => ({ id: order.id, amount: order.amount, items: order.items.map((item) => ({ name: item.name, quantity: item.quantity })) }));
  response.json({ log, held });
});

api.patch('/owner/orders/:id/cod-payment', requireOwner, ownerLimit, async (request, response) => {
  if (request.body?.status !== 'paid' || Object.keys(request.body || {}).some((key) => key !== 'status')) {
    response.status(400).json({ error: 'Cash-on-delivery payment status must be set to paid' }); return;
  }
  const result = await mutateDatabase((database) => {
    const order = database.orders.find((entry) => entry.id === request.params.id);
    if (!order || order.paymentMethod !== 'cod' || order.status !== 'delivered' || order.paymentStatus !== 'pending') return null;
    order.paymentStatus = 'paid';
      order.paymentVerifiedAt = new Date().toISOString();
      return { order, changed: true };
  });
  if (!result) { response.status(409).json({ error: 'Only a delivered, unpaid cash-on-delivery order can be marked paid' }); return; }
  const email = (await getDatabase()).customers.find((entry) => entry.id === result.order.userId)?.email;
  if (email) void enqueueOrderEmail(result.order.id, 'payment_confirmed').catch((error) => console.error('COD payment confirmation email queue failed:', error));
  response.json({ order: result.order });
});

api.patch('/owner/orders/:id/return', requireOwner, ownerLimit, async (request, response) => {
  const status = request.body?.status;
  if (!['approved', 'rejected'].includes(status)) { response.status(400).json({ error: 'Status must be approved or rejected' }); return; }
  const order = await mutateDatabase((database) => {
    const current = database.orders.find((entry) => entry.id === request.params.id);
    if (!current?.returnRequest) return null;
    current.returnRequest.status = status;
    return current;
  });
  if (!order) { response.status(404).json({ error: 'Return request not found' }); return; }
  response.json({ order });
});

type OwnerAgentAction =
  | { type: 'update_stock'; productId: string; productName: string; sku: string; previousStock: number; stock: number }
  | { type: 'update_order_status'; orderId: string; previousStatus: string; status: 'shipped' | 'delivered' }
  | { type: 'draft_email'; orderId: string; kind: CustomerEmailKind };

function validateOwnerAgentIntent(intent: OwnerAgentIntent, database: Awaited<ReturnType<typeof getDatabase>>): OwnerAgentAction | null {
  if (intent.type === 'update_stock') {
    if (!Number.isSafeInteger(intent.stock) || intent.stock < 0 || intent.stock > 100000) return null;
    const product = database.products.find((entry) => entry.id.toLowerCase() === intent.productIdOrSku.toLowerCase() || entry.sku.toLowerCase() === intent.productIdOrSku.toLowerCase());
    return product ? { type: 'update_stock', productId: product.id, productName: product.name, sku: product.sku, previousStock: product.stock, stock: intent.stock } : null;
  }
  if (intent.type === 'update_order_status') {
    const order = database.orders.find((entry) => entry.id === intent.orderId);
    if (!order || !['paid', 'shipped', 'delivered'].includes(order.status) || order.status === intent.status || (order.status === 'delivered' && intent.status === 'shipped')) return null;
    return { type: 'update_order_status', orderId: order.id, previousStatus: order.status, status: intent.status };
  }
  const order = database.orders.find((entry) => entry.id === intent.orderId);
  const customer = order && database.customers.find((entry) => entry.id === order.userId);
  if (!order || !customer || !['paid', 'shipped', 'delivered'].includes(order.status) || (intent.kind === 'follow_up' && order.status !== 'delivered')) return null;
  return { type: 'draft_email', orderId: order.id, kind: intent.kind };
}

api.post('/owner/chat', requireOwner, ownerLimit, async (request, response) => {
  const message = request.body?.message;
  if (!stringValue(message, 4000)) { response.status(400).json({ error: 'Message is required (up to 4,000 characters)' }); return; }
  try {
    const database = await getDatabase();
    const stockCommand = message.trim().match(/^(?:set|update)\s+(?:stock|inventory)\s+(?:for\s+)?([a-z0-9_-]+)\s+(?:to|=)\s*(\d+)$/i);
    if (stockCommand) {
      const intent: OwnerAgentIntent = { type: 'update_stock', productIdOrSku: stockCommand[1], stock: Number(stockCommand[2]) };
      const action = validateOwnerAgentIntent(intent, database);
      if (!action || action.type !== 'update_stock') { response.status(400).json({ error: 'Check the product ID or SKU and choose stock from 0 to 100,000' }); return; }
      response.json({ reply: `I can change ${action.productName} (${action.sku}) from ${action.previousStock} to ${action.stock} units`, action });
      return;
    }
    const summary = JSON.stringify({
      analytics: {
        orderCount: database.orders.length,
        paidRevenue: database.orders.filter((order) => ['paid', 'shipped', 'delivered'].includes(order.status)
          && order.paymentStatus !== 'refunded' && (order.paymentMethod !== 'cod' || order.paymentStatus === 'paid')).reduce((total, order) => total + order.amount, 0) / 100,
        eventCounts: database.events.reduce<Record<string, number>>((counts, event) => { counts[event.name] = (counts[event.name] || 0) + 1; return counts; }, {}),
      },
      products: database.products.slice(0, 100).map(({ id, name, sku, stock, price, active }) => ({ id, name, sku, stock, price, active })),
      recentOrders: database.orders.slice(-20).reverse().map(({ id, status, amount, currency, trackingNumber, items }) => ({ id, status, total: `${currency} ${(amount / 100).toFixed(2)}`, trackingNumber, items: items.map(({ name, quantity }) => ({ name, quantity })) })),
    });
    const plan = await generateOwnerAgentPlan(message, summary);
    if (!plan.action) { response.json(plan); return; }
    const action = validateOwnerAgentIntent(plan.action, database);
    if (!action) { response.json({ reply: 'I could not verify that product or order action against the current store data Refresh the dashboard and try again' }); return; }
    response.json({ ...plan, action });
  } catch (error) { asyncError(response, error); }
});

api.post('/owner/agent/execute', requireOwner, ownerLimit, async (request, response) => {
  const action = request.body?.action;
  if (action?.type === 'update_stock') {
    if (!stringValue(action.productId, 100) || !Number.isInteger(action.previousStock) || !Number.isInteger(action.stock) || action.stock < 0 || action.stock > 100000) {
      response.status(400).json({ error: 'The inventory action is invalid' }); return;
    }
    const product = await mutateDatabase((database) => {
      const current = database.products.find((entry) => entry.id === action.productId);
      if (!current || current.stock !== action.previousStock) return null;
      current.stock = action.stock;
      return { id: current.id, name: current.name, sku: current.sku, stock: current.stock };
    });
    if (!product) { response.status(409).json({ error: 'Inventory changed since this proposal Refresh and ask the agent again' }); return; }
    if (product.stock > 0) void sendRestockAlerts().catch((error) => console.error('Restock alert scan failed:', error));
    response.json({ completed: true, message: `Updated ${product.name} (${product.sku}) stock to ${product.stock}` });
    return;
  }
  if (action?.type === 'update_order_status') {
    if (!stringValue(action.orderId, 100) || !['paid', 'shipped', 'delivered'].includes(action.previousStatus) || !['shipped', 'delivered'].includes(action.status)) {
      response.status(400).json({ error: 'The order action is invalid' }); return;
    }
    const result = await mutateDatabase((database) => {
      const order = database.orders.find((entry) => entry.id === action.orderId);
      if (!order || order.status !== action.previousStatus
        || (action.status === 'shipped' && !['paid', 'confirmed'].includes(order.status))
        || (action.status === 'delivered' && order.status !== 'out_for_delivery')) return null;
      const changed = order.status !== action.status;
      order.status = action.status;
      if (action.status === 'delivered' && !order.deliveredAt) order.deliveredAt = new Date().toISOString();
      return { order, changed };
    });
    if (!result) { response.status(409).json({ error: 'Order status changed or this transition is not allowed Refresh and ask the agent again' }); return; }
    if (result.changed) void enqueueOrderEmail(result.order.id, action.status === 'shipped' ? 'shipped' : 'delivered').catch((error) => console.error(`${action.status} email queue failed:`, error));
    response.json({ completed: true, message: `Marked order ${result.order.id} ${action.status}` });
    return;
  }
  response.status(400).json({ error: 'The agent action is unsupported' });
});

const customerEmailKinds: CustomerEmailKind[] = ['alert', 'thank_you', 'follow_up'];

function customerEmailSubject(kind: CustomerEmailKind, orderId: string): string {
  if (kind === 'thank_you') return `Thank you for your AHUZA order ${orderId}`;
  if (kind === 'follow_up') return `Checking in on your AHUZA order ${orderId}`;
  return `An update on your AHUZA order ${orderId}`;
}

async function getEmailOrder(orderId: unknown, kind: unknown, response: Response): Promise<{ order: Order; email: string; kind: CustomerEmailKind } | null> {
  if (!stringValue(orderId, 100) || typeof kind !== 'string' || !customerEmailKinds.includes(kind as CustomerEmailKind)) {
    response.status(400).json({ error: 'Choose an order and a valid email type' });
    return null;
  }
  const database = await getDatabase();
  const order = database.orders.find((entry) => entry.id === orderId);
  if (!order) { response.status(404).json({ error: 'Order not found' }); return null; }
  if (!['paid', 'shipped', 'delivered'].includes(order.status)) {
    response.status(400).json({ error: 'Emails can be sent only for paid orders' }); return null;
  }
  if (kind === 'follow_up' && order.status !== 'delivered') {
    response.status(400).json({ error: 'Follow-up messages are available after delivery' }); return null;
  }
  const customer = database.customers.find((entry) => entry.id === order.userId);
  if (!customer) { response.status(404).json({ error: 'Customer email is unavailable for this order' }); return null; }
  return { order, email: customer.email, kind: kind as CustomerEmailKind };
}

api.post('/owner/email-agent/draft', requireOwner, ownerLimit, async (request, response) => {
  const selected = await getEmailOrder(request.body?.orderId, request.body?.kind, response);
  if (!selected) return;
  const { order, email, kind } = selected;
  const orderDetails = JSON.stringify({
    orderReference: order.id,
    status: order.status,
    items: order.items.map(({ name, quantity, size }) => ({ name, quantity, ...(size ? { size } : {}) })),
    total: `${order.currency} ${(order.amount / 100).toFixed(2)}`,
    trackingNumber: order.trackingNumber || 'Not provided',
    deliveredAt: order.deliveredAt || 'Not recorded',
  });
  try {
    const body = await generateCustomerEmailBody(kind, orderDetails);
    response.json({ to: email, subject: customerEmailSubject(kind, order.id), body });
  } catch (error) { asyncError(response, error); }
});

api.post('/owner/email-agent/send', requireOwner, ownerLimit, async (request, response) => {
  const selected = await getEmailOrder(request.body?.orderId, request.body?.kind, response);
  if (!selected) return;
  if (!stringValue(request.body?.subject, 180) || !stringValue(request.body?.body, 5000)) {
    response.status(400).json({ error: 'Review and provide an email subject and message' }); return;
  }
  if (!isEmailConfigured()) { response.status(503).json({ error: 'Email sending is not configured Set SMTP_HOST, SMTP_USER and SMTP_PASS (or RESEND_API_KEY)' }); return; }
  try {
    await sendEmail(selected.email, request.body.subject.trim(), request.body.body.trim());
    response.status(202).json({ sent: true, to: selected.email });
  } catch (error) { asyncError(response, error); }
});

const adPlatforms = ['Instagram', 'Facebook', 'Google Search', 'WhatsApp'];
const adGoals = ['Drive sales', 'Promote a new arrival', 'Festive offer', 'Build brand awareness'];
const adTones = ['Warm and elegant', 'Playful', 'Premium', 'Festive'];
const adImageStyles = ['Studio product shot', 'Lifestyle outdoor', 'Festive celebration', 'Minimal colour backdrop'];

function adProductFromRequest(body: unknown, database: Database): Product | null {
  const productId = (body as { productId?: unknown } | undefined)?.productId;
  return database.products.find((entry) => entry.id === productId && entry.active) ?? null;
}

api.post('/owner/ads/copy', requireOwner, adLimit, async (request, response) => {
  const { platform, goal, tone, audience } = request.body || {};
  const product = adProductFromRequest(request.body, await getDatabase());
  if (!product) { response.status(404).json({ error: 'Active product not found' }); return; }
  if (!adPlatforms.includes(platform) || !adGoals.includes(goal) || !adTones.includes(tone) || (audience !== undefined && !stringValue(audience, 120) && audience !== '')) { response.status(400).json({ error: 'Choose a valid platform, goal and tone' }); return; }
  try {
    const copy = await generateAdCopy({ productName: product.name, details: `${product.description} Category: ${product.category} Price: INR ${product.price}`, platform, goal, tone, audience: typeof audience === 'string' ? audience : '' });
    if (!copy.primaryText) { response.status(502).json({ error: 'The ad copy came back empty Please try again' }); return; }
    response.json({ copy });
  } catch (error) { asyncError(response, error); }
});

async function loadAdReference(imageUrl: string): Promise<{ data: Buffer; mimeType: string } | undefined> {
  try {
    let buffer: Buffer;
    if (/^\/uploads\/[0-9a-f-]{36}\/[\w.-]+$/i.test(imageUrl)) {
      const file = path.resolve(uploadRoot, imageUrl.replace(/^\/uploads\//, ''));
      if (!file.startsWith(uploadRoot + path.sep)) return undefined;
      buffer = await readFile(file);
    } else if (httpsUrl(imageUrl)) {
      const result = await fetch(imageUrl, { signal: AbortSignal.timeout(8000) });
      const length = Number(result.headers.get('content-length') || 0);
      if (!result.ok || length > 8 * 1024 * 1024) return undefined;
      buffer = Buffer.from(await result.arrayBuffer());
      if (buffer.length > 8 * 1024 * 1024) return undefined;
    } else return undefined;
    const mimeType = detectImageType(buffer);
    return mimeType ? { data: buffer, mimeType } : undefined;
  } catch { return undefined; }
}

api.post('/owner/ads/image', requireOwner, adLimit, async (request, response) => {
  const { style, format, notes } = request.body || {};
  const product = adProductFromRequest(request.body, await getDatabase());
  if (!product) { response.status(404).json({ error: 'Active product not found' }); return; }
  if (!adImageStyles.includes(style) || !['Square', 'Portrait', 'Landscape'].includes(format) || (notes !== undefined && notes !== '' && !stringValue(notes, 300))) { response.status(400).json({ error: 'Choose a valid style and format' }); return; }
  const reference = await loadAdReference(product.images?.find((image) => image.id === product.mainImageId)?.url || product.imageUrl);
  const prompt = `Create a ${format.toLowerCase()} advertising photograph for an Indian fashion brand called Ahuza Apparel. Style: ${style}. Product: ${product.name} (${product.category})${reference ? ' Keep the garment from the attached photo exactly as it is: same colours, pattern and shape' : ''}. ${typeof notes === 'string' ? notes : ''} Show a model wearing the garment, with clean natural lighting. Do not add any text, logos, watermarks or prices to the image.`;
  try { response.json({ image: await generateAdImage(prompt, format, reference) }); }
  catch (error) {
    if (error instanceof Error && error.message === 'AD_IMAGE_UNAVAILABLE') { response.status(503).json({ error: 'Image generation is not available on your AI plan yet Enable billing for your Gemini or OpenAI key, then try again' }); return; }
    asyncError(response, error);
  }
});

api.get('/owner/social/schedules', requireOwner, ownerLimit, async (_request, response) => {
  const database = await getDatabase();
  response.json({ schedules: database.socialSchedules || [], posts: [...(database.socialPosts || [])].reverse().slice(0, 40), connected: socialStatus() });
});

api.post('/owner/social/schedules', requireOwner, ownerLimit, async (request, response) => {
  const rule = validateSchedule(request.body);
  if (typeof rule === 'string') { response.status(400).json({ error: rule }); return; }
  const schedule = await mutateDatabase((database) => {
    database.socialSchedules ||= [];
    if (database.socialSchedules.length >= 20) return null;
    const created = { ...rule, id: randomUUID(), createdAt: new Date().toISOString() };
    database.socialSchedules.push(created);
    return created;
  });
  if (!schedule) { response.status(400).json({ error: 'You can have up to 20 schedules' }); return; }
  response.status(201).json({ schedule });
});

api.patch('/owner/social/schedules/:id', requireOwner, ownerLimit, async (request, response) => {
  if (typeof request.body?.enabled !== 'boolean') { response.status(400).json({ error: 'Provide enabled as true or false' }); return; }
  const schedule = await mutateDatabase((database) => {
    const current = database.socialSchedules?.find((entry) => entry.id === request.params.id);
    if (current) current.enabled = request.body.enabled;
    return current ? structuredClone(current) : null;
  });
  if (!schedule) { response.status(404).json({ error: 'Schedule not found' }); return; }
  response.json({ schedule });
});

api.delete('/owner/social/schedules/:id', requireOwner, ownerLimit, async (request, response) => {
  const removed = await mutateDatabase((database) => {
    const before = database.socialSchedules?.length || 0;
    database.socialSchedules = (database.socialSchedules || []).filter((entry) => entry.id !== request.params.id);
    return database.socialSchedules.length < before;
  });
  if (!removed) { response.status(404).json({ error: 'Schedule not found' }); return; }
  response.status(204).end();
});

api.post('/owner/social/schedules/:id/run', requireOwner, adLimit, async (request, response) => {
  try { response.json({ posts: await runSchedule(String(request.params.id)) }); }
  catch (error) {
    if (error instanceof Error && error.message === 'SCHEDULE_NOT_FOUND') { response.status(404).json({ error: 'Schedule not found' }); return; }
    if (error instanceof Error && error.message === 'NO_PRODUCT_AVAILABLE') { response.status(409).json({ error: 'No in-stock product with a public image is available' }); return; }
    asyncError(response, error);
  }
});

api.post('/owner/social/posts/:id/publish', requireOwner, adLimit, async (request, response) => {
  const caption = request.body?.caption;
  if (caption !== undefined && !stringValue(caption, 2000)) { response.status(400).json({ error: 'Caption must be up to 2,000 characters' }); return; }
  try { response.json({ post: await publishSocialPost(String(request.params.id), caption) }); }
  catch (error) {
    if (error instanceof Error && error.message === 'POST_NOT_FOUND') { response.status(404).json({ error: 'Post not found' }); return; }
    asyncError(response, error);
  }
});

api.delete('/owner/social/posts/:id', requireOwner, ownerLimit, async (request, response) => {
  const removed = await mutateDatabase((database) => {
    const before = database.socialPosts?.length || 0;
    database.socialPosts = (database.socialPosts || []).filter((entry) => entry.id !== request.params.id || entry.status === 'posted');
    return database.socialPosts.length < before;
  });
  if (!removed) { response.status(404).json({ error: 'Draft or failed post not found' }); return; }
  response.status(204).end();
});

api.post('/owner/social-post', requireOwner, ownerLimit, async (request, response) => {
  const productId = request.body?.productId;
  const database = await getDatabase();
  const product = database.products.find((entry) => entry.id === productId && entry.active);
  if (!product) { response.status(404).json({ error: 'Active product not found' }); return; }
  try { response.json({ caption: await generateSocialPost(product.name, `${product.description} Category: ${product.category}`) }); }
  catch (error) { asyncError(response, error); }
});

api.get('/owner/marketing-automations', requireOwner, ownerLimit, async (_request, response) => { response.json(await listAutomations()); });

api.post('/owner/marketing-automations', requireOwner, ownerLimit, async (request, response) => {
  const rule = validateRule(request.body);
  if (typeof rule === 'string') { response.status(400).json({ error: rule }); return; }
  response.status(201).json({ rule: await createRule(rule) });
});

api.patch('/owner/marketing-automations/:id', requireOwner, ownerLimit, async (request, response) => {
  if (typeof request.body?.enabled !== 'boolean') { response.status(400).json({ error: 'Provide enabled true or false' }); return; }
  const rule = await mutateDatabase((database) => {
    const found = database.automations?.find((entry) => entry.id === request.params.id);
    if (found) found.enabled = request.body.enabled;
    return found ? structuredClone(found) : null;
  });
  if (!rule) { response.status(404).json({ error: 'Automation not found' }); return; }
  response.json({ rule });
});

api.delete('/owner/marketing-automations/:id', requireOwner, ownerLimit, async (request, response) => {
  const removed = await mutateDatabase((database) => {
    const before = database.automations?.length || 0;
    database.automations = (database.automations || []).filter((entry) => entry.id !== request.params.id);
    return before !== database.automations.length;
  });
  if (!removed) { response.status(404).json({ error: 'Automation not found' }); return; }
  response.status(204).end();
});

api.post('/owner/marketing-automations/preview', requireOwner, ownerLimit, async (request, response) => {
  const rule = validateRule({ trigger: 'win_back', delayDays: 0, ...request.body });
  if (typeof rule === 'string') { response.status(400).json({ error: rule }); return; }
  try { response.json(await generateMarketingEmail(rule.goal, JSON.stringify({ customerName: 'Sample Customer', lastOrderItems: ['Sample product'] }))); }
  catch (error) { asyncError(response, error); }
});

api.post('/owner/marketing-automations/run', requireOwner, ownerLimit, async (_request, response) => {
  try { response.json({ sent: await runAutomations() }); } catch (error) { asyncError(response, error); }
});

export async function expireReservationsOnStartup(): Promise<void> {
  await expirePendingOrders();
}

// MacroDroid Webhook Proxy
api.post('/macrodroid-proxy', requireOwner, ownerLimit, async (request, response) => {
  try {
    const { amount_paise, reference } = request.body ?? {};

    if (!Number.isSafeInteger(amount_paise) || amount_paise <= 0
      || typeof reference !== 'string' || reference.trim().length === 0 || reference.length > 64) {
      return response.status(400).json({ error: 'A positive amount_paise and reference are required' });
    }

    const secret = process.env.BANK_WEBHOOK_SECRET;
    const baseUrl = process.env.AHUZA_PAY_BASE_URL;
    if (!secret || !baseUrl) {
      return response.status(503).json({ error: 'Ahuza Pay webhook is not configured' });
    }
    const targetUrl = new URL('/api/bank/credit', baseUrl);
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      return response.status(503).json({ error: 'Ahuza Pay webhook URL must use HTTP or HTTPS' });
    }

    const rawBody = JSON.stringify({ amount_paise, reference: reference.trim() });
    const timestamp = String(Date.now());

    const signature = createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    const webhookResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Timestamp': timestamp,
        'X-Signature': signature,
      },
      body: rawBody,
      signal: AbortSignal.timeout(10_000),
    });

    const data: unknown = await webhookResponse.json();
    response.status(webhookResponse.status).json(data);
  } catch (error) {
    console.error('MacroDroid proxy error:', error);
    response.status(502).json({ error: 'Unable to forward bank credit notification' });
  }
});
