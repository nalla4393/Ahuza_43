import { randomUUID, timingSafeEqual } from 'node:crypto';
import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import PDFDocument from 'pdfkit';
import { hashPassword, verifyPassword } from './services/auth.js';
import { extractPaymentReceipt, generateCustomerEmailBody, generateCustomerSupportReply, generateOwnerAgentPlan, generateSocialPost, isTextAiConfigured, type CustomerEmailKind, type OwnerAgentIntent } from './services/ai.js';
import { getDatabase, mergeImageSettings, mutateDatabase, type Database, type Order, type PaymentReceiptReview, type Product, type ShippingAddress, type StorefrontContent, type SupportTicket } from './services/database.js';
import { sendRestockAlerts } from './services/stock-alerts.js';
import { deleteProductImageFiles, detectImageType, maxUploadBytes, sanitizeImageSettings, saveProductImage } from './services/images.js';
import { createRule, listAutomations, runAutomations, validateRule } from './services/automations.js';
import { generateMarketingEmail } from './services/ai.js';
import { expirePendingOrders, getMarketingWebhookUrls, notifySupportTicket, recordMarketingEvent, isEmailConfigured, sendEmail, sendOrderEmail, sendOrderConfirmation, sendShippingNotice, testMarketingWebhooks, triggerAutomations } from './services/integrations.js';
import { createUpiIntent, getUpiConfiguration } from './services/upi.js';

export const api = Router();
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
const ownerLimit = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
const uploadLimit = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false });
const analyticsLimit = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false });
const supportLimit = rateLimit({ windowMs: 60 * 1000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false });
const paymentReceiptLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 3, standardHeaders: 'draft-8', legacyHeaders: false });
const paymentLimit = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });

function requireCustomer(request: Request, response: Response, next: NextFunction): void {
  if (!request.session.userId) { response.status(401).json({ error: 'Sign in is required.' }); return; }
  next();
}

function requireOwner(request: Request, response: Response, next: NextFunction): void {
  const expected = process.env.OWNER_API_KEY || '';
  const supplied = request.get('x-owner-key') || '';
  const valid = expected.length > 0 && supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  if (!valid) { response.status(403).json({ error: 'Owner access required.' }); return; }
  next();
}

function asyncError(response: Response, error: unknown): void {
  if (error instanceof Error && error.message === 'AI_NOT_CONFIGURED') { response.status(503).json({ error: 'AI integration is not configured. Set OPENAI_API_KEY (or GEMINI_API_KEY) in the server environment.' }); return; }
  console.error(error);
  response.status(502).json({ error: 'The requested integration is temporarily unavailable.' });
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

function detectReceiptMimeType(buffer: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
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
    || ((method === 'POST' || method === 'PATCH') && /^\/orders\/[^/]+(?:\/returns|\/payment-receipts)?$/.test(path));
  if (ownerApi || healthOrStatus || paymentReadOnly || customerAccount || existingOrders) { next(); return; }
  response.status(503).json({ error: 'The AHUZA storefront is temporarily unavailable. Please check back soon.' });
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
  if (!product) { response.status(404).json({ error: 'Product not found.' }); return; }
  response.json({ product });
});

api.post('/products/:id/stock-alert', requireCustomer, async (request, response) => {
  const result = await mutateDatabase<{ error: string; status: number } | { subscribed: true; alreadySubscribed: boolean }>((database) => {
    const product = database.products.find((entry) => entry.id === request.params.id && entry.active);
    if (!product) return { error: 'Product not found.', status: 404 };
    if (product.stock > 0) return { error: 'This item is available now.', status: 409 };
    const customer = database.customers.find((entry) => entry.id === request.session.userId);
    if (!customer) return { error: 'Sign in to receive a restock alert.', status: 401 };
    database.stockAlerts ||= [];
    const existing = database.stockAlerts.find((alert) => alert.productId === product.id && alert.customerId === customer.id && !alert.notifiedAt);
    if (existing) return { subscribed: true, alreadySubscribed: true };
    database.stockAlerts.push({ id: randomUUID(), productId: product.id, customerId: customer.id, createdAt: new Date().toISOString() });
    return { subscribed: true, alreadySubscribed: false };
  });
  if ('error' in result) { response.status(result.status).json({ error: result.error }); return; }
  response.status(result.alreadySubscribed ? 200 : 201).json({ ...result, emailConfigured: isEmailConfigured() });
});

api.post('/customer-support/chat', supportLimit, async (request, response) => {
  const message = request.body?.message;
  if (!stringValue(message, 1000)) { response.status(400).json({ error: 'A message is required (up to 1,000 characters).' }); return; }
  const deliveryIssue = /\b(?:delivery|shipping|shipment)\b.{0,40}\b(?:issue|problem|late|delay|delayed|missing|lost|not received)\b|\b(?:late delivery|delayed|missing parcel|lost parcel|not received|never arrived|wrong item|damaged|complaint|complain|refund request|replacement request)\b/i.test(message);
  if (deliveryIssue) {
    response.json({ reply: 'We’re sorry for the inconvenience. Please create a support ticket and our team will follow up within 48 working hours. Support hours are 10:00 AM–9:00 PM IST.', requiresHumanSupport: true });
    return;
  }
  try {
    const database = await getDatabase();
    const storeContext = JSON.stringify({
      contact: 'Info@ahuzawear.com, +91 95505 82277, Telangana, India',
      returns: 'Returns and replacements may be requested within 7 days after delivery.',
      products: database.products.filter((product) => product.active).map(({ name, description, price, stock, category }) => ({ name, description, price, stock, category })),
    });
    const history = Array.isArray(request.body?.history)
      ? request.body.history.slice(-8).filter((turn: unknown): turn is { role: 'assistant' | 'customer'; text: string } => {
        const entry = turn as { role?: unknown; text?: unknown };
        return (entry?.role === 'assistant' || entry?.role === 'customer') && typeof entry.text === 'string';
      })
      : [];
    response.json({ reply: await generateCustomerSupportReply(message, storeContext, history), requiresHumanSupport: false });
  } catch (error) {
    if (error instanceof Error && error.message === 'AI_NOT_CONFIGURED') {
      response.json({ reply: 'I’m sorry, I can’t answer that just now. Customer support is available from 10:00 AM to 9:00 PM IST. You can create a support ticket or email Info@ahuzawear.com for help.', requiresHumanSupport: false });
      return;
    }
    asyncError(response, error);
  }
});

api.post('/customer-support/tickets', supportLimit, async (request, response) => {
  const message = request.body?.message;
  const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : request.session.email || '';
  if (!stringValue(message, 2000) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    response.status(400).json({ error: 'Provide your support message and a valid email address.' }); return;
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
    ? `We’re sorry for the inconvenience. Your reference ID is ${ticket.id}. Our support team will reach out within 48 working hours. Support hours are 10:00 AM–9:00 PM IST.`
    : `Your support ticket ${ticket.id} was saved, but we could not notify our support team by email. Please contact Info@ahuzawear.com or +91 95505 82277 and include this reference.`;
  response.status(201).json({ ticket: { id: ticket.id, status: ticket.status }, notificationSent, message: notificationMessage });
});

api.post('/auth/signup', authLimit, async (request, response) => {
  const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
  const password = request.body?.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length < 12 || password.length > 200) {
    response.status(400).json({ error: 'Enter a valid email and a password of at least 12 characters.' }); return;
  }
  const customer = await mutateDatabase(async (database) => {
    if (database.customers.some((entry) => entry.email === email)) return null;
    const created = { id: randomUUID(), email, passwordHash: await hashPassword(password), createdAt: new Date().toISOString() };
    database.customers.push(created);
    return { id: created.id, email: created.email };
  });
  if (!customer) { response.status(409).json({ error: 'An account already exists for this email.' }); return; }
  await new Promise<void>((resolve, reject) => request.session.regenerate((error) => error ? reject(error) : resolve()));
  request.session.userId = customer.id;
  request.session.email = customer.email;
  response.status(201).json({ customer });
});

api.post('/auth/login', authLimit, async (request, response) => {
  const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
  const password = request.body?.password;
  if (!stringValue(email, 254) || typeof password !== 'string' || password.length > 200) { response.status(400).json({ error: 'Enter your email and password.' }); return; }
  const customer = (await getDatabase()).customers.find((entry) => entry.email === email);
  if (!customer || !await verifyPassword(password, customer.passwordHash)) { response.status(401).json({ error: 'Email or password is incorrect.' }); return; }
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
  if (!result) { response.status(404).json({ error: 'Product not found.' }); return; }
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
  if (!result) { response.status(404).json({ error: 'Account not found.' }); return; }
  response.json({ productIds: result });
});

async function createPaymentOrder(request: Request, response: Response): Promise<void> {
  const paymentMethod = request.body?.paymentMethod;
  if (paymentMethod !== 'upi' && paymentMethod !== 'cod') { response.status(400).json({ error: 'Choose UPI or cash on delivery.' }); return; }
  const upi = getUpiConfiguration();
  if (paymentMethod === 'upi' && !upi.configured) { response.status(503).json({ error: 'Direct UPI is unavailable. Configure a valid UPI_VPA on the server.' }); return; }
  const items = request.body?.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > 20) { response.status(400).json({ error: 'Provide one or more cart items.' }); return; }
  const address = request.body?.shippingAddress;
  const shippingAddress: ShippingAddress = {
    name: typeof address?.name === 'string' ? address.name.trim() : '',
    addressLine1: typeof address?.addressLine1 === 'string' ? address.addressLine1.trim() : '',
    ...(typeof address?.addressLine2 === 'string' && address.addressLine2.trim() ? { addressLine2: address.addressLine2.trim() } : {}),
    city: typeof address?.city === 'string' ? address.city.trim() : '',
    state: typeof address?.state === 'string' ? address.state.trim() : '',
    postalCode: typeof address?.postalCode === 'string' ? address.postalCode.trim() : '',
    country: 'India',
    phone: typeof address?.phone === 'string' ? address.phone.trim() : '',
  };
  if (!stringValue(shippingAddress.name, 100) || !stringValue(shippingAddress.addressLine1, 180) || (shippingAddress.addressLine2 && shippingAddress.addressLine2.length > 180) || !stringValue(shippingAddress.city, 80) || !stringValue(shippingAddress.state, 80) || !/^[1-9][0-9]{5}$/.test(shippingAddress.postalCode) || !/^\+?[0-9][0-9\s-]{8,16}$/.test(shippingAddress.phone)) {
    response.status(400).json({ error: 'Enter a valid name, Indian delivery address, six-digit PIN code, and phone number.' }); return;
  }
  const requested = new Map<string, { productId: string; size?: string; quantity: number }>();
  for (const item of items) {
    if (!stringValue(item?.productId, 100) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10
      || (item.size !== undefined && !stringValue(item.size, 20))) { response.status(400).json({ error: 'Each item needs a product ID, valid size (when required), and quantity from 1 to 10.' }); return; }
    const key = `${item.productId}:${typeof item.size === 'string' ? item.size.trim().toLowerCase() : ''}`;
    const existing = requested.get(key);
    const quantity = (existing?.quantity || 0) + item.quantity;
    if (quantity > 10) { response.status(400).json({ error: 'Each product is limited to 10 items per order.' }); return; }
    requested.set(key, { productId: item.productId, ...(typeof item.size === 'string' ? { size: item.size.trim() } : {}), quantity });
  }
  const products = (await getDatabase()).products;
  const orderItems: Order['items'] = [];
  for (const { productId, size, quantity } of requested.values()) {
    const product = products.find((entry) => entry.id === productId && entry.active);
    if (!product || product.stock < quantity) { response.status(409).json({ error: `Product ${productId} is unavailable in the requested quantity.` }); return; }
    if (product.sizes?.length && (!size || !product.sizes.some((available) => available.toLowerCase() === size.toLowerCase()))) {
      response.status(400).json({ error: `Choose an available size for ${product.name}.` }); return;
    }
    if (size && !product.sizes?.some((available) => available.toLowerCase() === size.toLowerCase())) {
      response.status(400).json({ error: `Size ${size} is not available for ${product.name}.` }); return;
    }
    orderItems.push({ productId, name: product.name, sku: product.sku, quantity, unitPrice: product.price, ...(size ? { size: product.sizes!.find((available) => available.toLowerCase() === size.toLowerCase()) } : {}) });
  }
  const subtotalAmount = orderItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0) * 100;
  const shippingAmount = subtotalAmount < 250000 ? 10000 : 0;
  const amount = subtotalAmount + shippingAmount;
  if (!Number.isSafeInteger(amount) || amount < 100) { response.status(400).json({ error: 'Order total is invalid.' }); return; }
  const localOrderId = randomUUID();
  const paymentReference = `AHUZA-${randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase()}`;
  const expiresAt = paymentMethod === 'upi' ? new Date(Date.now() + 20 * 60 * 1000) : null;
  const persisted = await mutateDatabase((database) => {
    const available = orderItems.every((item) => {
      const product = database.products.find((entry) => entry.id === item.productId && entry.active);
      return product && product.stock >= item.quantity && product.price === item.unitPrice;
    });
    if (!available) return false;
    for (const item of orderItems) database.products.find((entry) => entry.id === item.productId)!.stock -= item.quantity;
    database.orders.push({
      id: localOrderId, userId: request.session.userId!, shippingAddress, items: orderItems,
      amount, subtotalAmount, shippingAmount, discountAmount: 0, taxAmount: 0,
      currency: 'INR', status: paymentMethod === 'cod' ? 'confirmed' : 'pending_payment', paymentStatus: 'pending', paymentMethod,
      ...(paymentMethod === 'upi' ? { paymentReference, reservationExpiresAt: expiresAt!.toISOString() } : {}),
      marketingConsent: request.body?.marketingConsent === true,
      createdAt: new Date().toISOString(),
    });
    return true;
  });
  if (!persisted) { response.status(409).json({ error: 'Inventory changed while placing your order. Please refresh your bag.' }); return; }
  const placed = (await getDatabase()).orders.find((entry) => entry.id === localOrderId);
  const customerEmail = (await getDatabase()).customers.find((entry) => entry.id === request.session.userId)?.email;
  if (placed && customerEmail) void sendOrderEmail('order_placed', placed, customerEmail).catch((error) => console.error('Order received email failed:', error));
  if (paymentMethod === 'cod') {
    response.status(201).json({ orderId: localOrderId, paymentMethod, status: 'confirmed', amount, currency: 'INR' });
    return;
  }
  const upiIntent = createUpiIntent({ vpa: upi.vpa!, merchantName: upi.merchantName, amountPaise: amount, orderReference: paymentReference });
  response.status(201).json({ orderId: localOrderId, paymentMethod, paymentReference, upiIntent, merchantVpa: upi.vpa, merchantName: upi.merchantName, amount, currency: 'INR', expiresAt: expiresAt!.toISOString(), status: 'pending' });
}

api.get('/payments/config', (_request, response) => {
  const config = getUpiConfiguration();
  response.json({ configured: config.configured, upiVpa: config.vpa, merchantName: config.merchantName, automaticVerification: false });
});

api.post('/payments/orders', requireCustomer, paymentLimit, async (request, response) => {
  await createPaymentOrder(request, response);
});

api.get('/payments/orders/:id/status', requireCustomer, paymentLimit, async (request, response) => {
  const order = (await getDatabase()).orders.find((entry) => entry.id === request.params.id && entry.userId === request.session.userId);
  if (!order) { response.status(404).json({ error: 'Order not found.' }); return; }
  response.json({ orderId: order.id, status: order.paymentStatus || 'pending', orderStatus: order.status, paymentReference: order.paymentReference, expiresAt: order.reservationExpiresAt, verification: 'manual_bank_reconciliation_required' });
});

api.post('/payments/orders/:id/failure', requireCustomer, paymentLimit, async (request, response) => {
  if (!request.body || request.body.failed !== true || Object.keys(request.body).length !== 1) {
    response.status(400).json({ error: 'Report only that the UPI app did not complete the attempt.' }); return;
  }
  const updated = await mutateDatabase((database) => {
    const order = database.orders.find((entry) => entry.id === request.params.id && entry.userId === request.session.userId);
    if (!order || order.paymentMethod !== 'upi' || order.status !== 'pending_payment' || !['pending', 'failed'].includes(order.paymentStatus || 'pending')) return false;
    order.paymentStatus = 'failed';
    return true;
  });
  if (!updated) { response.status(409).json({ error: 'This UPI order is no longer pending.' }); return; }
  response.json({ status: 'failed', note: 'Customer-reported attempt only; AHUZA bank verification is still required.' });
});

api.post('/payments/orders/:id/cancel', requireCustomer, paymentLimit, async (request, response) => {
  const result = await mutateDatabase((database) => {
    const order = database.orders.find((entry) => entry.id === request.params.id && entry.userId === request.session.userId);
    if (!order) return 'missing';
    if (order.paymentMethod !== 'upi' || order.status !== 'pending_payment' || !['pending', 'failed', 'cancelled'].includes(order.paymentStatus || 'pending')) return 'conflict';
    order.paymentStatus = 'cancelled';
    return 'cancelled';
  });
  if (result === 'missing') { response.status(404).json({ error: 'Order not found.' }); return; }
  if (result === 'conflict') { response.status(409).json({ error: 'This order cannot be cancelled.' }); return; }
  response.json({ status: result });
});

api.get('/orders/:id', requireCustomer, async (request, response) => {
  const order = (await getDatabase()).orders.find((entry) => entry.id === request.params.id && entry.userId === request.session.userId);
  if (!order) { response.status(404).json({ error: 'Order not found.' }); return; }
  response.json({ order });
});

api.post('/orders/:id/payment-receipts', requireCustomer, paymentReceiptLimit, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }), async (request, response) => {
  if (!Buffer.isBuffer(request.body)) { response.status(415).json({ error: 'Upload a JPEG, PNG, or WebP receipt image.' }); return; }
  const mimeType = detectReceiptMimeType(request.body);
  const declaredMimeType = request.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (!mimeType || mimeType !== declaredMimeType) { response.status(415).json({ error: 'The uploaded file is not a valid JPEG, PNG, or WebP image.' }); return; }

  const database = await getDatabase();
  const order = database.orders.find((entry) => entry.id === request.params.id && entry.userId === request.session.userId);
  if (!order) { response.status(404).json({ error: 'Order not found.' }); return; }
  if (!['pending_payment', 'cancelled'].includes(order.status)) { response.status(409).json({ error: 'A receipt can only be submitted for an unpaid order.' }); return; }
  if (database.paymentReceiptReviews?.some((entry) => entry.orderId === order.id && entry.status === 'pending_admin_review')) {
    response.status(409).json({ error: 'A receipt for this order is already waiting for owner review.' }); return;
  }

  let extraction;
  try {
    extraction = await extractPaymentReceipt(request.body, mimeType);
  } catch (error) {
    if (error instanceof Error && error.message === 'AI_NOT_CONFIGURED') {
      response.status(503).json({ error: 'Receipt review is unavailable until the server has GEMINI_API_KEY configured.' }); return;
    }
    if (error instanceof Error && error.message === 'RECEIPT_PARSE_FAILED') {
      response.status(422).json({ error: 'The receipt details could not be read safely. Try a clearer image.' }); return;
    }
    asyncError(response, error);
    return;
  }

  const saved = await mutateDatabase((current) => {
    current.paymentReceiptReviews ||= [];
    const currentOrder = current.orders.find((entry) => entry.id === order.id && entry.userId === request.session.userId);
    if (!currentOrder || !['pending_payment', 'cancelled'].includes(currentOrder.status)
      || current.paymentReceiptReviews.some((entry) => entry.orderId === order.id && entry.status === 'pending_admin_review')) return null;
    const flags: string[] = [];
    if (!extraction.isSuccessful) flags.push('AI extraction indicates a possibly unsuccessful transaction; verify independently.');
    if (extraction.amountPaid === null) flags.push('Amount was not clearly extracted.');
    else if (Math.abs(extraction.amountPaid - currentOrder.amount / 100) > 0.01) flags.push('Extracted amount differs from the order amount.');
    if (!extraction.utrNumber) flags.push('UTR/reference number was not clearly extracted.');
    const normalizedUtr = extraction.utrNumber?.replace(/\s+/g, '').toLowerCase();
    if (normalizedUtr && current.paymentReceiptReviews.some((entry) => entry.extraction.utrNumber?.replace(/\s+/g, '').toLowerCase() === normalizedUtr)) {
      flags.push('This UTR/reference number appears in another receipt submission.');
    }
    const review: PaymentReceiptReview = {
      id: randomUUID(),
      orderId: currentOrder.id,
      userId: currentOrder.userId,
      expectedAmount: currentOrder.amount / 100,
      extraction,
      flags,
      status: 'pending_admin_review',
      createdAt: new Date().toISOString(),
    };
    current.paymentReceiptReviews.push(review);
    return review;
  });
  if (!saved) { response.status(409).json({ error: 'Order status changed or a receipt was submitted while processing. Refresh your orders and try again.' }); return; }
  response.status(202).json({ review: { id: saved.id, orderId: saved.orderId, status: saved.status, flags: saved.flags } });
});

api.get('/orders', requireCustomer, async (request, response) => {
  const database = await getDatabase();
  const orders = database.orders
    .filter((order) => order.userId === request.session.userId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map(({ id, amount, currency, status, paymentMethod, paymentStatus, paymentVerifiedAt, createdAt, items, trackingNumber, trackingUrl }) => ({
      id, amount, currency, status, paymentMethod, paymentStatus, paymentVerifiedAt, createdAt, items, trackingNumber, trackingUrl,
      hasPendingReceiptReview: database.paymentReceiptReviews?.some((review) => review.orderId === id && review.status === 'pending_admin_review') || false,
    }));
  response.json({ orders });
});

api.get('/orders/:id/invoice', requireCustomer, async (request, response) => {
  const database = await getDatabase();
  const order = database.orders.find((entry) => entry.id === request.params.id && entry.userId === request.session.userId);
  if (!order) { response.status(404).json({ error: 'Order not found.' }); return; }
  if (!['paid', 'shipped', 'delivered'].includes(order.status) || order.paymentStatus !== 'paid'
    || (order.paymentMethod === 'upi' && !order.paymentVerifiedAt)) {
    response.status(409).json({ error: 'An invoice is available only after payment is confirmed.' }); return;
  }
  const customerEmail = database.customers.find((customer) => customer.id === order.userId)?.email || 'Not available';
  const safePdfText = (value: string) => value.normalize('NFKD').replace(/[^\x20-\x7e]/g, '?');

  const document = new PDFDocument({ size: 'A4', margin: 48 });
  response.setHeader('Content-Type', 'application/pdf');
  response.setHeader('Content-Disposition', `attachment; filename="ahuza-invoice-${order.id}.pdf"`);
  document.pipe(response);
  document.fontSize(22).font('Helvetica-Bold').text('AHUZA APPAREL');
  document.moveDown(0.5).fontSize(18).text('INVOICE');
  document.moveDown(0.5).fontSize(10).font('Helvetica')
    .text(`Invoice / order reference: ${order.id}`)
    .text(`Order date: ${new Date(order.createdAt).toLocaleDateString('en-IN')}`)
    .text(`Payment status: ${order.status}`);
  document.moveDown().font('Helvetica-Bold').text('Bill to');
  document.font('Helvetica')
    .text(safePdfText(order.shippingAddress.name))
    .text(safePdfText(order.shippingAddress.addressLine1))
    .text(safePdfText(order.shippingAddress.addressLine2 || ''))
    .text(safePdfText(`${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.postalCode}`))
    .text(order.shippingAddress.country)
    .text(`Email: ${safePdfText(customerEmail)}`);
  document.moveDown().font('Helvetica-Bold').text('Items');
  document.moveDown(0.4);
  for (const item of order.items) {
    const lineTotal = item.unitPrice * item.quantity;
    document.font('Helvetica-Bold').text(safePdfText(`${item.name}${item.size ? ` · Size ${item.size}` : ''}`));
    document.font('Helvetica').fontSize(9).text(`SKU: ${safePdfText(item.sku)}  |  Quantity: ${item.quantity}  |  Unit price: INR ${item.unitPrice.toFixed(2)}  |  Line total: INR ${lineTotal.toFixed(2)}`);
    document.moveDown(0.6);
  }
  document.moveDown().fontSize(12).font('Helvetica-Bold').text(`Total paid: ${order.currency} ${(order.amount / 100).toFixed(2)}`, { align: 'right' });
  document.moveDown(2).fontSize(9).font('Helvetica').text('Thank you for shopping with AHUZA Apparel.');
  document.end();
});

api.post('/orders/:id/returns', requireCustomer, async (request, response) => {
  const action = request.body?.action;
  const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim().slice(0, 500) : '';
  if (!['return', 'replacement'].includes(action) || !reason) { response.status(400).json({ error: 'Choose return or replacement and provide a reason.' }); return; }
  const result = await mutateDatabase<{ order: Order } | { error: string; status: number }>((database) => {
    const order = database.orders.find((entry) => entry.id === request.params.id && entry.userId === request.session.userId);
    if (!order) return { error: 'Order not found.', status: 404 };
    if (order.status !== 'delivered' || !order.deliveredAt || Date.now() > new Date(order.deliveredAt).getTime() + 7 * 24 * 60 * 60 * 1000) return { error: 'Returns and replacements are available within 7 days of delivery.', status: 400 };
    if (order.returnRequest) return { error: 'A request has already been submitted for this order.', status: 409 };
    order.returnRequest = { action, reason, status: 'requested', createdAt: new Date().toISOString() };
    return { order };
  });
  if ('error' in result) { response.status(result.status).json({ error: result.error }); return; }
  response.status(201).json({ order: result.order });
});

api.post('/marketing/events', analyticsLimit, async (request, response) => {
  const { name, page, campaign, consent } = request.body || {};
  if (!stringValue(name, 64) || !/^[a-z0-9_]+$/i.test(name)) { response.status(400).json({ error: 'A valid event name is required.' }); return; }
  const event = { name, ...(stringValue(page, 200) ? { page } : {}), ...(stringValue(campaign, 100) ? { campaign } : {}) };
  await recordMarketingEvent(event);
  if (consent === true) void triggerAutomations(event);
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
    response.status(400).json({ error: 'Provide only a boolean published value.' }); return;
  }
  const published = await mutateDatabase((database) => {
    database.sitePublished = request.body.published;
    return database.sitePublished;
  });
  console.info(`Storefront ${published ? 'published' : 'unpublished'} by owner.`);
  response.json({ published });
});

api.get('/owner/inventory', requireOwner, ownerLimit, async (_request, response) => response.json({ products: (await getDatabase()).products }));

api.post('/owner/inventory', requireOwner, ownerLimit, async (request, response) => {
  const { name, description, price, sku, stock, category, imageUrl, ghostMannequin, images, mainImageId, active, sizes } = request.body || {};
  const hasImages = Array.isArray(images) && images.length > 0;
  if (!stringValue(name, 120) || !stringValue(description, 1000) || !Number.isFinite(price) || price <= 0 || price > 10000000 || !stringValue(sku, 80) || !Number.isInteger(stock) || stock < 0 || stock > 100000 || !stringValue(category, 80) || (!hasImages && !httpsUrl(imageUrl))) {
    response.status(400).json({ error: 'Provide a title, description, positive price, SKU, stock, category, and at least one uploaded image.' }); return;
  }
  if (images !== undefined && !validImageIds(images, mainImageId)) { response.status(400).json({ error: 'Image list is invalid.' }); return; }
  if (sizes !== undefined && !validProductSizes(sizes)) { response.status(400).json({ error: 'Sizes must be a list of up to 20 unique labels, each 1 to 20 characters.' }); return; }
  if (active !== undefined && typeof active !== 'boolean') { response.status(400).json({ error: 'Status must be Published or Unpublished.' }); return; }
  if (ghostMannequin !== undefined && !validGhostMannequin(ghostMannequin)) { response.status(400).json({ error: 'Ghost mannequin metadata is invalid.' }); return; }
  const product = await mutateDatabase((database) => {
    if (database.products.some((entry) => entry.sku.toLowerCase() === sku.trim().toLowerCase())) return null;
    const created: Product = { id: randomUUID(), name: name.trim(), description: description.trim(), price, sku: sku.trim(), stock, category: category.trim(), imageUrl: imageUrl || '', active: active ?? true, ghostMannequin: { tags: [], ...(ghostMannequin as Product['ghostMannequin'] | undefined) }, ...(sizes?.length ? { sizes } : {}) };
    if (images !== undefined && !applyImages(database, created, images, mainImageId)) return 'bad-images' as const;
    database.products.push(created);
    return created;
  });
  if (product === 'bad-images') { response.status(400).json({ error: 'One or more images were not uploaded successfully.' }); return; }
  if (!product) { response.status(409).json({ error: 'SKU is already assigned to another product.' }); return; }
  response.status(201).json({ product });
});

api.patch('/owner/inventory/:id', requireOwner, ownerLimit, async (request, response) => {
  const { name, description, price, category, imageUrl, stock, sku, active, ghostMannequin, images, mainImageId, sizes } = request.body || {};
  if (images !== undefined && !validImageIds(images, mainImageId)) { response.status(400).json({ error: 'Image list is invalid.' }); return; }
  if (sizes !== undefined && !validProductSizes(sizes)) { response.status(400).json({ error: 'Sizes must be a list of up to 20 unique labels, each 1 to 20 characters.' }); return; }
  if (name !== undefined && !stringValue(name, 120)) { response.status(400).json({ error: 'Title must be 1 to 120 characters.' }); return; }
  if (description !== undefined && !stringValue(description, 1000)) { response.status(400).json({ error: 'Description must be 1 to 1,000 characters.' }); return; }
  if (price !== undefined && (!Number.isFinite(price) || price <= 0 || price > 10000000)) { response.status(400).json({ error: 'Price must be greater than zero.' }); return; }
  if (category !== undefined && !stringValue(category, 80)) { response.status(400).json({ error: 'Category must be 1 to 80 characters.' }); return; }
  if (imageUrl !== undefined && !httpsUrl(imageUrl)) { response.status(400).json({ error: 'Image URL must use HTTPS.' }); return; }
  if (stock !== undefined && (!Number.isInteger(stock) || stock < 0 || stock > 100000)) { response.status(400).json({ error: 'Stock must be a non-negative whole number.' }); return; }
  if (sku !== undefined && !stringValue(sku, 80)) { response.status(400).json({ error: 'SKU must be 1 to 80 characters.' }); return; }
  if (active !== undefined && typeof active !== 'boolean') { response.status(400).json({ error: 'Active must be a boolean.' }); return; }
  if (ghostMannequin !== undefined && !validGhostMannequin(ghostMannequin)) { response.status(400).json({ error: 'Ghost mannequin metadata is invalid.' }); return; }
  const removedImageIds: string[] = [];
  const result = await mutateDatabase<{ product: Product } | { error: string; status: number }>((database) => {
    const product = database.products.find((entry) => entry.id === request.params.id);
    if (!product) return { error: 'Product not found.', status: 404 };
    const previousIds = (product.images || []).map((image) => image.id);
    if (sku && database.products.some((entry) => entry.id !== product.id && entry.sku.toLowerCase() === sku.toLowerCase())) return { error: 'SKU is already assigned to another product.', status: 409 };
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
      if (!applyImages(database, product, images, mainImageId)) return { error: 'One or more images were not uploaded successfully.', status: 400 };
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
  if (!Buffer.isBuffer(request.body) || request.body.length === 0) { response.status(415).json({ error: 'Upload a JPG, PNG, or WebP image.' }); return; }
  const detected = detectImageType(request.body);
  if (!detected || detected !== request.get('content-type')?.split(';')[0]?.trim().toLowerCase()) { response.status(415).json({ error: 'The file is not a valid JPG, PNG, or WebP image.' }); return; }
  const name = decodeURIComponent(request.get('x-file-name') || 'image').replace(/[^\w .()-]/g, '_');
  try {
    const database = await getDatabase();
    const image = await saveProductImage(request.body, detected, name, mergeImageSettings(database.imageSettings));
    await mutateDatabase((db) => { (db.imageLibrary ||= []).push(image); });
    response.status(201).json({ image });
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_IMAGE') { response.status(415).json({ error: 'The image could not be read.' }); return; }
    console.error('Image upload failed:', error);
    response.status(500).json({ error: 'The image could not be saved. Please retry.' });
  }
});

api.delete('/owner/images/:id', requireOwner, ownerLimit, async (request, response) => {
  const id = String(request.params.id);
  const removed = await mutateDatabase((database) => {
    if (database.products.some((product) => product.images?.some((image) => image.id === id))) return false;
    database.imageLibrary = (database.imageLibrary || []).filter((image) => image.id !== id);
    return true;
  });
  if (!removed) { response.status(409).json({ error: 'Image is used by a product. Remove it from the product first.' }); return; }
  await deleteProductImageFiles(id);
  response.json({ ok: true });
});

api.get('/owner/image-settings', requireOwner, ownerLimit, async (_request, response) => response.json({ imageSettings: mergeImageSettings((await getDatabase()).imageSettings), maxUploadMb: Math.round(maxUploadBytes / 1024 / 1024) }));

api.put('/owner/image-settings', requireOwner, ownerLimit, async (request, response) => {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) { response.status(400).json({ error: 'Provide image settings.' }); return; }
  const imageSettings = sanitizeImageSettings(request.body);
  await mutateDatabase((database) => { database.imageSettings = imageSettings; });
  response.json({ imageSettings });
});

api.patch('/owner/content', requireOwner, ownerLimit, async (request, response) => {
  const patch = request.body;
  const allowed: (keyof StorefrontContent)[] = ['announcement', 'heroEyebrow', 'heroTitle', 'heroDescription', 'heroImageUrl', 'storyHeading', 'storyBody', 'storyImageUrl'];
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).length === 0) { response.status(400).json({ error: 'Provide at least one storefront field.' }); return; }
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.includes(key as keyof StorefrontContent)) { response.status(400).json({ error: `Unknown storefront field: ${key}.` }); return; }
    if (key.endsWith('ImageUrl') ? !httpsUrl(value) : !stringValue(value, key === 'heroTitle' ? 120 : 500)) { response.status(400).json({ error: `Invalid value for ${key}.` }); return; }
  }
  const content = await mutateDatabase((database) => {
    database.content = { ...database.content, ...patch };
    return database.content;
  });
  response.json({ content });
});

api.get('/owner/orders', requireOwner, ownerLimit, async (_request, response) => response.json({ orders: (await getDatabase()).orders }));

api.get('/owner/payment-receipts', requireOwner, ownerLimit, async (_request, response) => {
  const reviews = (await getDatabase()).paymentReceiptReviews || [];
  response.json({ reviews: [...reviews].sort((left, right) => right.createdAt.localeCompare(left.createdAt)) });
});

api.patch('/owner/payment-receipts/:id', requireOwner, ownerLimit, async (request, response) => {
  const body = request.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => key !== 'reviewNote')
    || (body.reviewNote !== undefined && (typeof body.reviewNote !== 'string' || body.reviewNote.length > 500))) {
    response.status(400).json({ error: 'Review note must be at most 500 characters.' }); return;
  }
  const review = await mutateDatabase((database) => {
    const current = database.paymentReceiptReviews?.find((entry) => entry.id === request.params.id);
    if (!current || current.status !== 'pending_admin_review') return null;
    current.status = 'reviewed';
    current.reviewedAt = new Date().toISOString();
    if (typeof body.reviewNote === 'string' && body.reviewNote.trim()) current.reviewNote = body.reviewNote.trim();
    return current;
  });
  if (!review) { response.status(404).json({ error: 'Pending receipt review not found.' }); return; }
  response.json({ review });
});

api.get('/owner/integrations', requireOwner, ownerLimit, async (_request, response) => {
  const urls = await getMarketingWebhookUrls();
  response.json({ integrations: {
    googleAds: Boolean(urls.googleAds),
    zapier: Boolean(urls.zapier),
    email: isEmailConfigured(),
    followUps: isEmailConfigured(),
    ai: isTextAiConfigured(),
  } });
});

api.patch('/owner/integrations', requireOwner, ownerLimit, async (request, response) => {
  const settings = request.body;
  const allowed = ['googleAds', 'zapier'];
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) || Object.keys(settings).length === 0 || Object.keys(settings).some((key) => !allowed.includes(key))) {
    response.status(400).json({ error: 'Provide a Google Ads and/or Zapier webhook URL.' }); return;
  }
  for (const key of allowed) {
    const value = settings[key];
    if (value !== undefined && value !== '' && !httpsUrl(value)) { response.status(400).json({ error: `${key === 'googleAds' ? 'Google Ads' : 'Zapier'} webhook URL must use HTTPS.` }); return; }
    if (value !== undefined && typeof value === 'string' && value.length > 2000) { response.status(400).json({ error: 'Webhook URLs must be at most 2,000 characters.' }); return; }
  }
  await mutateDatabase((database) => {
    database.integrationWebhooks ||= {};
    for (const key of allowed as ('googleAds' | 'zapier')[]) {
      if (settings[key] !== undefined) database.integrationWebhooks[key] = settings[key].trim();
    }
  });
  const urls = await getMarketingWebhookUrls();
  response.json({ integrations: { googleAds: Boolean(urls.googleAds), zapier: Boolean(urls.zapier) } });
});

api.get('/owner/support-tickets', requireOwner, ownerLimit, async (_request, response) => {
  response.json({ tickets: (await getDatabase()).supportTickets });
});

api.patch('/owner/support-tickets/:id', requireOwner, ownerLimit, async (request, response) => {
  if (request.body?.status !== 'resolved') { response.status(400).json({ error: 'Ticket status must be resolved.' }); return; }
  const ticket = await mutateDatabase((database) => {
    const current = database.supportTickets.find((entry) => entry.id === request.params.id);
    if (!current) return null;
    current.status = 'resolved';
    return current;
  });
  if (!ticket) { response.status(404).json({ error: 'Support ticket not found.' }); return; }
  response.json({ ticket });
});

function validTrackingUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch { return false; }
}

api.patch('/owner/orders/:id/status', requireOwner, ownerLimit, async (request, response) => {
  const status = request.body?.status;
  const trackingNumber = request.body?.trackingNumber;
  const trackingUrl = request.body?.trackingUrl;
  if (!['shipped', 'delivered'].includes(status)) { response.status(400).json({ error: 'Status must be shipped or delivered.' }); return; }
  if (trackingNumber !== undefined && (typeof trackingNumber !== 'string' || trackingNumber.length > 100)) { response.status(400).json({ error: 'Tracking reference must be at most 100 characters.' }); return; }
  if (trackingUrl !== undefined && trackingUrl !== '' && !validTrackingUrl(trackingUrl)) { response.status(400).json({ error: 'Tracking link must be a valid HTTPS URL.' }); return; }
  const result = await mutateDatabase((database) => {
    const order = database.orders.find((entry) => entry.id === request.params.id);
    if (!order) return null;
    const validCurrentStatuses = order.paymentMethod === 'cod' ? ['confirmed', 'shipped', 'delivered'] : ['paid', 'shipped', 'delivered'];
    if (!validCurrentStatuses.includes(order.status) || (order.status === 'delivered' && status === 'shipped')) return null;
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

  if (!result) { response.status(404).json({ error: 'Paid order not found or status transition is invalid.' }); return; }
  const email = (await getDatabase()).customers.find((entry) => entry.id === result.order.userId)?.email;
  if (result.changed && email && status === 'shipped') void sendShippingNotice(result.order, email).catch((error) => console.error('Shipping email failed:', error));
  if (result.changed) void triggerAutomations({ name: `order_${status}`, orderId: result.order.id, amount: result.order.amount / 100, currency: result.order.currency });
  response.json({ order: result.order });
});

api.patch('/owner/orders/:id/cod-payment', requireOwner, ownerLimit, async (request, response) => {
  if (request.body?.status !== 'paid' || Object.keys(request.body || {}).some((key) => key !== 'status')) {
    response.status(400).json({ error: 'Cash-on-delivery payment status must be set to paid.' }); return;
  }
  const result = await mutateDatabase((database) => {
    const order = database.orders.find((entry) => entry.id === request.params.id);
    if (!order || order.paymentMethod !== 'cod' || order.status !== 'delivered' || order.paymentStatus !== 'pending') return null;
    order.paymentStatus = 'paid';
      order.paymentVerifiedAt = new Date().toISOString();
      return { order, changed: true };
  });
  if (!result) { response.status(409).json({ error: 'Only a delivered, unpaid cash-on-delivery order can be marked paid.' }); return; }
  if (result.order.marketingConsent) {
    void triggerAutomations({ name: 'purchase', orderId: result.order.id, amount: result.order.amount / 100, currency: result.order.currency, consent: true });
  }
  response.json({ order: result.order });
});

api.patch('/owner/orders/:id/upi-payment', requireOwner, ownerLimit, async (request, response) => {
  const bankReference = request.body?.bankReference;
  if (request.body?.status !== 'paid' || Object.keys(request.body || {}).some((key) => !['status', 'bankReference'].includes(key))
    || typeof bankReference !== 'string' || !/^[A-Za-z0-9-]{6,80}$/.test(bankReference.trim())) {
    response.status(400).json({ error: 'Confirm only after checking the settled payment in your bank account, and provide its bank reference.' }); return;
  }
  const order = await mutateDatabase((database) => {
    const current = database.orders.find((entry) => entry.id === request.params.id);
    if (!current || current.paymentMethod !== 'upi') return null;
    const activeReservation = current.status === 'pending_payment'
      && ['pending', 'failed', 'cancelled'].includes(current.paymentStatus || 'pending')
      && Boolean(current.reservationExpiresAt && Date.parse(current.reservationExpiresAt) > Date.now());
    const expiredReservation = current.paymentStatus === 'expired'
      && (current.status === 'cancelled' || (current.status === 'pending_payment' && current.reservationExpiresAt && Date.parse(current.reservationExpiresAt) <= Date.now()));
    if (!activeReservation && !expiredReservation) return null;
    const normalizedReference = bankReference.trim().toLowerCase();
    if (database.orders.some((entry) => entry.id !== current.id && entry.manualPaymentReference?.toLowerCase() === normalizedReference)) return 'duplicate' as const;
    if (expiredReservation) {
      const available = current.items.every((item) => {
        const product = database.products.find((entry) => entry.id === item.productId);
        return product && product.stock >= item.quantity;
      });
      if (!available) return 'stock_unavailable' as const;
      for (const item of current.items) database.products.find((entry) => entry.id === item.productId)!.stock -= item.quantity;
    }
    current.status = 'paid';
    current.paymentStatus = 'paid';
    current.manualPaymentReference = bankReference.trim();
    current.paymentVerificationMethod = 'manual_bank_reconciliation';
    current.paymentVerifiedAt = new Date().toISOString();
    delete current.reservationExpiresAt;
    return structuredClone(current);
  });
  if (order === 'duplicate') { response.status(409).json({ error: 'This bank reference has already been recorded for another order.' }); return; }
  if (order === 'stock_unavailable') { response.status(409).json({ error: 'The payment must be manually reconciled, but the original items are no longer in stock. Contact the customer before fulfillment.' }); return; }
  if (!order) { response.status(409).json({ error: 'Only an unpaid, pending UPI order can be confirmed. Check the order and bank settlement.' }); return; }
  const email = (await getDatabase()).customers.find((entry) => entry.id === order.userId)?.email;
  if (email) void sendOrderConfirmation(order, email).catch((error) => console.error('Confirmation email failed:', error));
  if (order.marketingConsent) void triggerAutomations({ name: 'purchase', orderId: order.id, amount: order.amount / 100, currency: order.currency, consent: true });
  response.json({ order });
});

api.patch('/owner/orders/:id/return', requireOwner, ownerLimit, async (request, response) => {
  const status = request.body?.status;
  if (!['approved', 'rejected'].includes(status)) { response.status(400).json({ error: 'Status must be approved or rejected.' }); return; }
  const order = await mutateDatabase((database) => {
    const current = database.orders.find((entry) => entry.id === request.params.id);
    if (!current?.returnRequest) return null;
    current.returnRequest.status = status;
    return current;
  });
  if (!order) { response.status(404).json({ error: 'Return request not found.' }); return; }
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
  if (!stringValue(message, 4000)) { response.status(400).json({ error: 'Message is required (up to 4,000 characters).' }); return; }
  try {
    const database = await getDatabase();
    const stockCommand = message.trim().match(/^(?:set|update)\s+(?:stock|inventory)\s+(?:for\s+)?([a-z0-9_-]+)\s+(?:to|=)\s*(\d+)$/i);
    if (stockCommand) {
      const intent: OwnerAgentIntent = { type: 'update_stock', productIdOrSku: stockCommand[1], stock: Number(stockCommand[2]) };
      const action = validateOwnerAgentIntent(intent, database);
      if (!action || action.type !== 'update_stock') { response.status(400).json({ error: 'Check the product ID or SKU and choose stock from 0 to 100,000.' }); return; }
      response.json({ reply: `I can change ${action.productName} (${action.sku}) from ${action.previousStock} to ${action.stock} units.`, action });
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
    if (!action) { response.json({ reply: 'I could not verify that product or order action against the current store data. Refresh the dashboard and try again.' }); return; }
    response.json({ ...plan, action });
  } catch (error) { asyncError(response, error); }
});

api.post('/owner/agent/execute', requireOwner, ownerLimit, async (request, response) => {
  const action = request.body?.action;
  if (action?.type === 'update_stock') {
    if (!stringValue(action.productId, 100) || !Number.isInteger(action.previousStock) || !Number.isInteger(action.stock) || action.stock < 0 || action.stock > 100000) {
      response.status(400).json({ error: 'The inventory action is invalid.' }); return;
    }
    const product = await mutateDatabase((database) => {
      const current = database.products.find((entry) => entry.id === action.productId);
      if (!current || current.stock !== action.previousStock) return null;
      current.stock = action.stock;
      return { id: current.id, name: current.name, sku: current.sku, stock: current.stock };
    });
    if (!product) { response.status(409).json({ error: 'Inventory changed since this proposal. Refresh and ask the agent again.' }); return; }
    if (product.stock > 0) void sendRestockAlerts().catch((error) => console.error('Restock alert scan failed:', error));
    void triggerAutomations({ name: 'inventory_updated', orderId: product.id });
    response.json({ completed: true, message: `Updated ${product.name} (${product.sku}) stock to ${product.stock}.` });
    return;
  }
  if (action?.type === 'update_order_status') {
    if (!stringValue(action.orderId, 100) || !['paid', 'shipped', 'delivered'].includes(action.previousStatus) || !['shipped', 'delivered'].includes(action.status)) {
      response.status(400).json({ error: 'The order action is invalid.' }); return;
    }
    const result = await mutateDatabase((database) => {
      const order = database.orders.find((entry) => entry.id === action.orderId);
      if (!order || order.status !== action.previousStatus || !['paid', 'shipped'].includes(order.status) || (order.status === 'delivered' && action.status === 'shipped')) return null;
      const changed = order.status !== action.status;
      order.status = action.status;
      if (action.status === 'delivered' && !order.deliveredAt) order.deliveredAt = new Date().toISOString();
      return { order, changed };
    });
    if (!result) { response.status(409).json({ error: 'Order status changed or this transition is not allowed. Refresh and ask the agent again.' }); return; }
    const email = (await getDatabase()).customers.find((entry) => entry.id === result.order.userId)?.email;
    if (result.changed && email && action.status === 'shipped') void sendShippingNotice(result.order, email).catch((error) => console.error('Shipping email failed:', error));
    if (result.changed) void triggerAutomations({ name: `order_${action.status}`, orderId: result.order.id, amount: result.order.amount / 100, currency: result.order.currency });
    response.json({ completed: true, message: `Marked order ${result.order.id} ${action.status}.` });
    return;
  }
  response.status(400).json({ error: 'The agent action is unsupported.' });
});

const customerEmailKinds: CustomerEmailKind[] = ['alert', 'thank_you', 'follow_up'];

function customerEmailSubject(kind: CustomerEmailKind, orderId: string): string {
  if (kind === 'thank_you') return `Thank you for your AHUZA order ${orderId}`;
  if (kind === 'follow_up') return `Checking in on your AHUZA order ${orderId}`;
  return `An update on your AHUZA order ${orderId}`;
}

async function getEmailOrder(orderId: unknown, kind: unknown, response: Response): Promise<{ order: Order; email: string; kind: CustomerEmailKind } | null> {
  if (!stringValue(orderId, 100) || typeof kind !== 'string' || !customerEmailKinds.includes(kind as CustomerEmailKind)) {
    response.status(400).json({ error: 'Choose an order and a valid email type.' });
    return null;
  }
  const database = await getDatabase();
  const order = database.orders.find((entry) => entry.id === orderId);
  if (!order) { response.status(404).json({ error: 'Order not found.' }); return null; }
  if (!['paid', 'shipped', 'delivered'].includes(order.status)) {
    response.status(400).json({ error: 'Emails can be sent only for paid orders.' }); return null;
  }
  if (kind === 'follow_up' && order.status !== 'delivered') {
    response.status(400).json({ error: 'Follow-up messages are available after delivery.' }); return null;
  }
  const customer = database.customers.find((entry) => entry.id === order.userId);
  if (!customer) { response.status(404).json({ error: 'Customer email is unavailable for this order.' }); return null; }
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
    response.status(400).json({ error: 'Review and provide an email subject and message.' }); return;
  }
  if (!isEmailConfigured()) { response.status(503).json({ error: 'Email sending is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS (or RESEND_API_KEY).' }); return; }
  try {
    await sendEmail(selected.email, request.body.subject.trim(), request.body.body.trim());
    response.status(202).json({ sent: true, to: selected.email });
  } catch (error) { asyncError(response, error); }
});

api.post('/owner/social-post', requireOwner, ownerLimit, async (request, response) => {
  const productId = request.body?.productId;
  const database = await getDatabase();
  const product = database.products.find((entry) => entry.id === productId && entry.active);
  if (!product) { response.status(404).json({ error: 'Active product not found.' }); return; }
  try { response.json({ caption: await generateSocialPost(product.name, `${product.description}. Category: ${product.category}.`) }); }
  catch (error) { asyncError(response, error); }
});

api.get('/owner/marketing-automations', requireOwner, ownerLimit, async (_request, response) => { response.json(await listAutomations()); });

api.post('/owner/marketing-automations', requireOwner, ownerLimit, async (request, response) => {
  const rule = validateRule(request.body);
  if (typeof rule === 'string') { response.status(400).json({ error: rule }); return; }
  response.status(201).json({ rule: await createRule(rule) });
});

api.patch('/owner/marketing-automations/:id', requireOwner, ownerLimit, async (request, response) => {
  if (typeof request.body?.enabled !== 'boolean') { response.status(400).json({ error: 'Provide enabled true or false.' }); return; }
  const rule = await mutateDatabase((database) => {
    const found = database.automations?.find((entry) => entry.id === request.params.id);
    if (found) found.enabled = request.body.enabled;
    return found ? structuredClone(found) : null;
  });
  if (!rule) { response.status(404).json({ error: 'Automation not found.' }); return; }
  response.json({ rule });
});

api.delete('/owner/marketing-automations/:id', requireOwner, ownerLimit, async (request, response) => {
  const removed = await mutateDatabase((database) => {
    const before = database.automations?.length || 0;
    database.automations = (database.automations || []).filter((entry) => entry.id !== request.params.id);
    return before !== database.automations.length;
  });
  if (!removed) { response.status(404).json({ error: 'Automation not found.' }); return; }
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

api.post('/owner/automations/test', requireOwner, ownerLimit, async (_request, response) => {
  response.json({ results: await testMarketingWebhooks() });
});

export async function expireReservationsOnStartup(): Promise<void> {
  await expirePendingOrders();
}