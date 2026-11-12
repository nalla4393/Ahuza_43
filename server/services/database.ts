import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { defaultStorefrontCopy, mergeStorefrontCopy, type StorefrontCopy } from '../../shared/storefrontCopy.js';

export type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  sku: string;
  stock: number;
  category: string;
  imageUrl: string;
  active: boolean;
  ghostMannequin: { imageUrl?: string; tags: string[]; background?: string };
  images?: ProductImage[];
  mainImageId?: string;
  sizes?: string[];
};

export type ProductImage = {
  id: string;
  url: string;
  originalUrl: string;
  variants: { width: number; url: string }[];
  width: number;
  height: number;
  size: number;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  hasAlpha: boolean;
  originalName: string;
  createdAt: string;
};

export type ImageSettings = {
  aspectRatio: '1:1' | '3:4' | '4:5' | '4:3' | 'original';
  fit: 'contain' | 'cover' | 'fill';
  alignment: 'center' | 'top' | 'bottom' | 'left' | 'right';
  background: 'white' | 'ivory' | 'neutral' | 'transparent';
  cornerRadius: number;
  displaySize: number;
  thumbnailSize: number;
  spacing: number;
  mobile: { aspectRatio: ImageSettings['aspectRatio']; displaySize: number; spacing: number };
  quality: { preserveOriginal: boolean; optimizedVersions: boolean; preserveTransparency: boolean };
  layout: { mode: 'single' | 'gallery'; thumbnails: boolean; thumbnailPlacement: 'bottom' | 'left' | 'right'; zoom: boolean; cardImage: 'main' | 'hover-second' };
};

export const defaultImageSettings: ImageSettings = {
  aspectRatio: '3:4', fit: 'contain', alignment: 'center', background: 'neutral', cornerRadius: 0, displaySize: 80, thumbnailSize: 64, spacing: 17,
  mobile: { aspectRatio: '3:4', displaySize: 100, spacing: 11 },
  quality: { preserveOriginal: true, optimizedVersions: true, preserveTransparency: true },
  layout: { mode: 'gallery', thumbnails: true, thumbnailPlacement: 'bottom', zoom: true, cardImage: 'main' },
};

export type Customer = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  wishlist?: string[];
  savedUpiIdEnc?: string;
};

export type StockAlert = {
  id: string;
  productId: string;
  customerId: string;
  createdAt: string;
  notifiedAt?: string;
};

export type ShippingAddress = {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
};

export type Order = {
  id: string;
  userId: string;
  shippingAddress: ShippingAddress;
  billingAddress?: ShippingAddress;
  items: { productId: string; name: string; sku: string; quantity: number; unitPrice: number; size?: string }[];
  amount: number;
  currency: string;
  trackingNumber?: string;
  trackingUrl?: string;
  paymentMethod?: 'upi' | 'cod';
  status: 'pending_payment' | 'confirmed' | 'paid' | 'shipped' | 'out_for_delivery' | 'delivered' | 'cancelled' | 'refunded';
  paymentStatus?: 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired' | 'refunded';
  marketingConsent?: boolean;
  subtotalAmount?: number;
  shippingAmount?: number;
  discountAmount?: number;
  taxAmount?: number;
  paymentAdjustmentAmount?: number;
  paymentReference?: string;
  instamojoRequestId?: string;
  payuTxnId?: string;
  payerUpiIdEnc?: string;
  paymentVerifiedAt?: string;
  manualPaymentReference?: string;
  manualPaymentProof?: { id: string; mimeType: 'image/jpeg' | 'image/png'; uploadedAt: string };
  paymentVerificationMethod?: 'manual_bank_reconciliation' | 'ahuza_pay' | 'instamojo' | 'payu';
  reservationExpiresAt?: string;
  createdAt: string;
  deliveredAt?: string;
  followUpSentAt?: string;
  returnRequest?: { action: 'return' | 'replacement'; reason: string; status: 'requested' | 'approved' | 'rejected'; createdAt: string };
  review?: { rating: number; comment?: string; createdAt: string };
};

export type OrderEmailKind = 'order_placed' | 'payment_confirmed' | 'shipped' | 'out_for_delivery' | 'delivered' | 'follow_up' | 'owner_new_order';
export type OrderEmailNotification = {
  id: string;
  orderId: string;
  kind: OrderEmailKind;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  dueAt: string;
  nextAttemptAt: string;
  sentAt?: string;
  lastError?: string;
};

export type BankPaymentAlert = {
  id: string;
  amount: number;
  transactionReference: string;
  receivedAt: string;
  status: 'pending' | 'review_required' | 'confirmed' | 'dismissed';
  transactionAt?: string;
  transactionTimezone?: 'IST';
  transactionType?: 'UPI/P2A';
  accountSuffix?: string;
  additionalReference?: string;
  sender?: string;
  duplicateConflict?: boolean;
  matchedOrderId?: string;
  reviewedAt?: string;
  history?: BankPaymentAlertEvent[];
};

export type BankPaymentAlertEvent = {
  at: string;
  action: 'received' | 'duplicate' | 'duplicate_conflict' | 'owner_confirmed' | 'owner_dismissed';
  messageId?: string;
  orderId?: string;
};

export function isUnreviewedBankPaymentAlert(alert: BankPaymentAlert): boolean {
  return alert.status === 'pending' || alert.status === 'review_required';
}

export type StoreEvent = { id: string; name: string; page?: string; campaign?: string; createdAt: string };

export type SupportTicket = {
  id: string;
  email: string;
  message: string;
  category: 'delivery' | 'complaint' | 'general';
  status: 'open' | 'resolved';
  createdAt: string;
};

export type NewsletterSubscriber = {
  id: string;
  email: string;
  consentedAt: string;
  consentText: string;
  source: 'storefront';
};

export type StorefrontContent = {
  announcement: string;
  heroEyebrow: string;
  heroTitle: string;
  heroDescription: string;
  heroImageUrl: string;
  storyHeading: string;
  storyBody: string;
  storyImageUrl: string;
  chatbotImageUrl: string;
  circleImages: Record<string, string>;
  circleLabels: Record<string, string>;
  bannerImages: Record<string, string>;
  copy: StorefrontCopy;
};

export const circleImageKeys = ['Women', 'Men', 'Kurtis', 'Frocks', 'Kurta Sets', 'Lehengas', 'Night Suits', 'Track Suits', 'New Arrivals', 'Bestsellers', 'Sale'];
export const bannerImageKeys = ['new', 'sale', 'festive'];

export const defaultStorefrontContent: StorefrontContent = {
  announcement: 'A softer kind of everyday Complimentary shipping over ₹2,500',
  heroEyebrow: 'The in-between collection · 01/26',
  heroTitle: 'Room to be yourself',
  heroDescription: 'Thoughtful layers for all the ways a day can unfold',
  heroImageUrl: 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=2200&q=85',
  storyHeading: 'Wear what feels like you',
  storyBody: 'We make pieces to live in, not just look at Easy silhouettes, tactile fabrics, and the quiet confidence of getting dressed without overthinking it',
  storyImageUrl: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1200&q=85',
  chatbotImageUrl: '',
  circleImages: {},
  circleLabels: {},
  bannerImages: {},
  copy: structuredClone(defaultStorefrontCopy),
};

export type AutomationTrigger = 'order_placed' | 'order_delivered' | 'win_back';
export type AutomationRule = {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  delayDays: number;
  goal: string;
  enabled: boolean;
  createdAt: string;
};
export type AutomationRun = { key: string; ruleId: string; ruleName: string; to: string; status: 'sent' | 'failed' | 'skipped'; detail?: string; at: string };

export type SocialPlatform = 'facebook' | 'instagram';
export type SocialSchedule = {
  id: string;
  name: string;
  platforms: SocialPlatform[];
  days: number[];
  time: string;
  productMode: 'rotate' | 'newest';
  tone: string;
  autoPublish: boolean;
  enabled: boolean;
  lastRunDate?: string;
  createdAt: string;
};
export type SocialPost = {
  id: string;
  scheduleId?: string;
  productId: string;
  productName: string;
  caption: string;
  imageUrl: string;
  platform: SocialPlatform;
  status: 'draft' | 'posted' | 'failed';
  detail?: string;
  externalId?: string;
  createdAt: string;
  postedAt?: string;
};

export type Database = {
  products: Product[];
  customers: Customer[];
  orders: Order[];
  events: StoreEvent[];
  supportTickets: SupportTicket[];
  newsletterSubscribers?: NewsletterSubscriber[];
  sitePublished?: boolean;
  seededProductIds?: string[];
  content: StorefrontContent;
  imageSettings?: ImageSettings;
  imageLibrary?: ProductImage[];
  automations?: AutomationRule[];
  automationRuns?: AutomationRun[];
  socialSchedules?: SocialSchedule[];
  socialPosts?: SocialPost[];
  stockAlerts?: StockAlert[];
  orderEmailNotifications?: OrderEmailNotification[];
  bankPaymentAlerts?: BankPaymentAlert[];
  gmailProcessedMessageIds?: string[];
  gmailLastScannedAt?: number;
  gmailHistoryId?: string;
  gmailAccountEmail?: string;
  gmailSenderKey?: string;
  paymentProviderSettings?: {
    provider: 'manual_upi' | 'payu';
    payuMerchantKeyEnc?: string;
    payuMerchantSaltEnc?: string;
    payuMode?: 'test' | 'production';
    payuCallbackUrl?: string;
    payuWebhookUrl?: string;
  };
};

const databasePath = path.resolve(process.env.DATA_FILE || 'data/ahuza-db.json');
const postgresUrl = process.env.STOREFRONT_DATABASE_URL?.trim();
if (process.env.STOREFRONT_DATABASE_URL !== undefined && !postgresUrl) throw new Error('STOREFRONT_DATABASE_URL must not be empty');
const postgres = postgresUrl ? new pg.Pool({ connectionString: postgresUrl, connectionTimeoutMillis: 10000 }) : undefined;
postgres?.on('error', (error) => console.error('Storefront PostgreSQL connection error:', error.message));
const seedProducts: Product[] = [
  { id: 'soft-form-shirt', name: 'Soft Form Shirt', description: 'Organic cotton · Cloud', price: 2490, sku: 'AH-SFS-001', stock: 24, category: 'Tops', imageUrl: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=82', active: true, ghostMannequin: { imageUrl: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=82', tags: ['cotton', 'relaxed fit', 'long sleeve'], background: '#eeece5' } },
  { id: 'everyday-trouser', name: 'Everyday Trouser', description: 'Tencel blend · Moss', price: 3290, sku: 'AH-ET-002', stock: 18, category: 'Bottoms', imageUrl: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=82', active: true, ghostMannequin: { imageUrl: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=82', tags: ['tencel', 'straight leg', 'mid rise'], background: '#e6e3da' } },
  { id: 'weekend-knit', name: 'Weekend Knit', description: 'Lightweight linen · Natural', price: 2890, sku: 'AH-WK-003', stock: 13, category: 'Knitwear', imageUrl: 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=82', active: true, ghostMannequin: { imageUrl: 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=82', tags: ['linen blend', 'relaxed fit'], background: '#efede6' } },
  { id: 'easy-layer', name: 'Easy Layer', description: 'Recycled cotton · Terracotta', price: 3790, sku: 'AH-EL-004', stock: 9, category: 'Layers', imageUrl: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=82', active: true, ghostMannequin: { imageUrl: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=82', tags: ['recycled cotton', 'lightweight', 'layering'], background: '#e9e5dc' } },
  { id: 'floral-wrap-dress', name: 'Floral Wrap Dress', description: 'Viscose crepe · Ivory bloom', price: 3990, sku: 'AH-FWD-005', stock: 15, category: 'Dresses', imageUrl: 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=900&q=82', active: true, sizes: ['XS', 'S', 'M', 'L', 'XL'], ghostMannequin: { imageUrl: 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=900&q=82', tags: ['viscose', 'wrap dress', 'floral print'], background: '#eeece5' } },
  { id: 'striped-wide-leg-trouser', name: 'Striped Wide-Leg Trouser', description: 'Crepe blend · Noir stripe', price: 3490, sku: 'AH-SWT-006', stock: 15, category: 'Bottoms', imageUrl: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=900&q=82', active: true, sizes: ['XS', 'S', 'M', 'L', 'XL'], ghostMannequin: { imageUrl: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=900&q=82', tags: ['wide leg', 'high rise', 'striped'], background: '#e6e3da' } },
  { id: 'sunshine-co-ord-set', name: 'Sunshine Co-ord Set', description: 'Soft fleece · Marigold', price: 4290, sku: 'AH-SCS-007', stock: 15, category: 'Sets', imageUrl: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=82', active: true, sizes: ['XS', 'S', 'M', 'L', 'XL'], ghostMannequin: { imageUrl: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=82', tags: ['co-ord set', 'fleece', 'relaxed fit'], background: '#efede6' } },
  { id: 'off-shoulder-midi', name: 'Off-Shoulder Midi', description: 'Stretch jersey · Plum', price: 3790, sku: 'AH-OSM-008', stock: 15, category: 'Dresses', imageUrl: 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?auto=format&fit=crop&w=900&q=82', active: true, sizes: ['XS', 'S', 'M', 'L', 'XL'], ghostMannequin: { imageUrl: 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?auto=format&fit=crop&w=900&q=82', tags: ['midi', 'off shoulder', 'stretch'], background: '#e9e5dc' } },
  { id: 'poppy-flare-dress', name: 'Poppy Flare Dress', description: 'Cotton poplin · Poppy red', price: 3890, sku: 'AH-PFD-009', stock: 15, category: 'Dresses', imageUrl: 'https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?auto=format&fit=crop&w=900&q=82', active: true, sizes: ['XS', 'S', 'M', 'L', 'XL'], ghostMannequin: { imageUrl: 'https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?auto=format&fit=crop&w=900&q=82', tags: ['flare', 'belted', 'floral print'], background: '#eeece5' } },
  { id: 'ruffle-romance-blouse', name: 'Ruffle Romance Blouse', description: 'Chiffon · Blush bloom', price: 2790, sku: 'AH-RRB-010', stock: 15, category: 'Tops', imageUrl: 'https://images.unsplash.com/photo-1581044777550-4cfa60707c03?auto=format&fit=crop&w=900&q=82', active: true, sizes: ['XS', 'S', 'M', 'L', 'XL'], ghostMannequin: { imageUrl: 'https://images.unsplash.com/photo-1581044777550-4cfa60707c03?auto=format&fit=crop&w=900&q=82', tags: ['chiffon', 'ruffle', 'off shoulder'], background: '#efede6' } },
  { id: 'pleated-mini-skirt', name: 'Pleated Mini Skirt', description: 'Twill · Black', price: 2190, sku: 'AH-PMS-011', stock: 15, category: 'Bottoms', imageUrl: 'https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?auto=format&fit=crop&w=900&q=82', active: true, sizes: ['XS', 'S', 'M', 'L', 'XL'], ghostMannequin: { imageUrl: 'https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?auto=format&fit=crop&w=900&q=82', tags: ['pleated', 'mini', 'twill'], background: '#e6e3da' } },
  { id: 'blush-jogger-trouser', name: 'Blush Jogger Trouser', description: 'Satin blend · Blush', price: 3190, sku: 'AH-BJT-012', stock: 15, category: 'Bottoms', imageUrl: 'https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?auto=format&fit=crop&w=900&q=82', active: true, sizes: ['XS', 'S', 'M', 'L', 'XL'], ghostMannequin: { imageUrl: 'https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?auto=format&fit=crop&w=900&q=82', tags: ['jogger', 'satin', 'cuffed hem'], background: '#e9e5dc' } },
];

// Adds seed products introduced after a database was created, once, so owner deletions stay deleted.
function newSeedProducts(existing: Product[], seeded?: string[]): Product[] {
  const known = new Set([...(seeded ?? []), ...existing.map((product) => product.id)]);
  return structuredClone(seedProducts.filter((product) => !known.has(product.id)));
}

let writeQueue: Promise<void> = Promise.resolve();
let loaded: Database | undefined;

function emptyDatabase(): Database {
  return { products: structuredClone(seedProducts), seededProductIds: seedProducts.map((product) => product.id), customers: [], orders: [], events: [], supportTickets: [], sitePublished: true, content: structuredClone(defaultStorefrontContent), imageSettings: structuredClone(defaultImageSettings), bankPaymentAlerts: [], gmailProcessedMessageIds: [], gmailLastScannedAt: undefined };
}

export function mergeImageSettings(value: unknown): ImageSettings {
  const base = structuredClone(defaultImageSettings);
  if (!value || typeof value !== 'object') return base;
  const input = value as Partial<ImageSettings>;
  return {
    ...base, ...input,
    mobile: { ...base.mobile, ...(input.mobile || {}) },
    quality: { ...base.quality, ...(input.quality || {}) },
    layout: { ...base.layout, ...(input.layout || {}) },
  };
}

function normalizeDatabase(parsed: Partial<Database>): Database {
  return {
    ...parsed,
    products: Array.isArray(parsed.products) ? [...parsed.products, ...newSeedProducts(parsed.products, parsed.seededProductIds)] : structuredClone(seedProducts),
    seededProductIds: seedProducts.map((product) => product.id),
    customers: Array.isArray(parsed.customers) ? parsed.customers : [],
    orders: Array.isArray(parsed.orders) ? parsed.orders : [],
    events: Array.isArray(parsed.events) ? parsed.events : [],
    supportTickets: Array.isArray(parsed.supportTickets) ? parsed.supportTickets : [],
    newsletterSubscribers: Array.isArray(parsed.newsletterSubscribers) ? parsed.newsletterSubscribers : [],
    sitePublished: parsed.sitePublished !== false,
    content: {
      ...structuredClone(defaultStorefrontContent),
      ...(parsed.content && typeof parsed.content === 'object' ? parsed.content : {}),
      circleImages: { ...defaultStorefrontContent.circleImages, ...(parsed.content?.circleImages || {}) },
      circleLabels: { ...defaultStorefrontContent.circleLabels, ...(parsed.content?.circleLabels || {}) },
      bannerImages: { ...defaultStorefrontContent.bannerImages, ...(parsed.content?.bannerImages || {}) },
      copy: mergeStorefrontCopy(parsed.content?.copy),
    },
    imageSettings: mergeImageSettings(parsed.imageSettings),
    imageLibrary: Array.isArray(parsed.imageLibrary) ? parsed.imageLibrary : [],
    automations: Array.isArray(parsed.automations) ? parsed.automations : [],
    automationRuns: Array.isArray(parsed.automationRuns) ? parsed.automationRuns : [],
    socialSchedules: Array.isArray(parsed.socialSchedules) ? parsed.socialSchedules : [],
    socialPosts: Array.isArray(parsed.socialPosts) ? parsed.socialPosts : [],
    stockAlerts: Array.isArray(parsed.stockAlerts) ? parsed.stockAlerts : [],
    orderEmailNotifications: Array.isArray(parsed.orderEmailNotifications) ? parsed.orderEmailNotifications : [],
    bankPaymentAlerts: Array.isArray(parsed.bankPaymentAlerts) ? parsed.bankPaymentAlerts : [],
    gmailProcessedMessageIds: Array.isArray(parsed.gmailProcessedMessageIds) ? parsed.gmailProcessedMessageIds : [],
    gmailLastScannedAt: typeof parsed.gmailLastScannedAt === 'number' ? parsed.gmailLastScannedAt : undefined,
    gmailHistoryId: typeof parsed.gmailHistoryId === 'string' ? parsed.gmailHistoryId : undefined,
    gmailAccountEmail: typeof parsed.gmailAccountEmail === 'string' ? parsed.gmailAccountEmail : undefined,
    gmailSenderKey: typeof parsed.gmailSenderKey === 'string' ? parsed.gmailSenderKey : undefined,
  };
}

async function loadDatabase(): Promise<Database> {
  if (loaded) return loaded;
  try {
    const raw = await readFile(databasePath, 'utf8');
    loaded = normalizeDatabase(JSON.parse(raw) as Partial<Database>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    loaded = emptyDatabase();
    await persist(loaded);
  }
  return loaded;
}

async function persist(database: Database): Promise<void> {
  await mkdir(path.dirname(databasePath), { recursive: true });
  const temporaryPath = `${databasePath}${randomUUID()}tmp`;
  await writeFile(temporaryPath, JSON.stringify(database, null, 2), { mode: 0o600 });
  await rename(temporaryPath, databasePath);
}

function validateImportedDatabase(value: unknown): asserts value is Partial<Database> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Storefront import must contain a JSON object');
  const record = value as Record<string, unknown>;
  for (const key of ['products', 'customers', 'orders', 'events', 'supportTickets']) {
    if (!Array.isArray(record[key])) throw new Error(`Storefront import is missing a valid ${key} array`);
  }
  if (!record.content || typeof record.content !== 'object' || Array.isArray(record.content)) {
    throw new Error('Storefront import is missing valid content');
  }
}

export async function importStorefrontDatabase(file: string): Promise<void> {
  if (!postgres) throw new Error('Set STOREFRONT_DATABASE_URL before importing the storefront database');
  const parsed: unknown = JSON.parse(await readFile(path.resolve(file), 'utf8'));
  validateImportedDatabase(parsed);
  const client = await postgres.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TABLE IF NOT EXISTS ahuza_storefront_state (
      id smallint PRIMARY KEY CHECK (id = 1),
      data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object')
    )`);
    const result = await client.query(
      'INSERT INTO ahuza_storefront_state (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id',
      [JSON.stringify(parsed)],
    );
    if (result.rowCount !== 1) throw new Error('Storefront PostgreSQL database already contains data; import refused');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closeStorefrontDatabase(): Promise<void> {
  await postgres?.end();
}

async function readPostgresDatabase(client: pg.Pool | pg.PoolClient, lock = false): Promise<Database> {
  const result = await client.query<{ data: unknown }>(
    `SELECT data FROM ahuza_storefront_state WHERE id = 1${lock ? ' FOR UPDATE' : ''}`,
  );
  const data = result.rows[0]?.data;
  if (!data) throw new Error('Storefront PostgreSQL database has not been imported; run npm run db:import');
  validateImportedDatabase(data);
  return normalizeDatabase(data);
}

export async function getDatabase(): Promise<Database> {
  await writeQueue;
  return postgres ? readPostgresDatabase(postgres) : loadDatabase();
}

export async function mutateDatabase<T>(mutator: (database: Database) => T | Promise<T>): Promise<T> {
  const operation = writeQueue.then(async () => {
    if (postgres) {
      const client = await postgres.connect();
      try {
        await client.query('BEGIN');
        const database = await readPostgresDatabase(client, true);
        const result = await mutator(database);
        await client.query('UPDATE ahuza_storefront_state SET data = $1::jsonb WHERE id = 1', [JSON.stringify(database)]);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    const database = await loadDatabase();
    const snapshot = structuredClone(database);
    try {
      const result = await mutator(database);
      await persist(database);
      return result;
    } catch (error) {
      loaded = snapshot;
      throw error;
    }
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}