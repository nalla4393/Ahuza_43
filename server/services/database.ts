import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
};

export type Customer = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
};

export type ShippingAddress = {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: 'India';
  phone: string;
};

export type Order = {
  id: string;
  userId: string;
  shippingAddress: ShippingAddress;
  items: { productId: string; name: string; sku: string; quantity: number; unitPrice: number }[];
  amount: number;
  currency: string;
  trackingNumber?: string;
  status: 'pending_payment' | 'test_paid' | 'paid' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
  paymentStatus?: 'pending' | 'paid' | 'test_paid' | 'failed' | 'cancelled' | 'expired' | 'refunded';
  paymentEnvironment?: 'test' | 'live';
  marketingConsent?: boolean;
  subtotalAmount?: number;
  shippingAmount?: number;
  discountAmount?: number;
  taxAmount?: number;
  razorpayOrderId?: string;
  razorpayQrCodeId?: string;
  qrImageUrl?: string;
  paymentReference?: string;
  paymentId?: string;
  paymentVerifiedAt?: string;
  paymentReview?: { reason: string; paymentId: string; createdAt: string };
  refund?: {
    idempotencyKey: string;
    receipt: string;
    providerRefundId?: string;
    amount: number;
    status: 'initiating' | 'pending' | 'processed' | 'failed';
    createdAt: string;
    updatedAt: string;
  };
  reservationExpiresAt?: string;
  createdAt: string;
  deliveredAt?: string;
  followUpSentAt?: string;
  returnRequest?: { action: 'return' | 'replacement'; reason: string; status: 'requested' | 'approved' | 'rejected'; createdAt: string };
};

export type StoreEvent = { id: string; name: string; page?: string; campaign?: string; createdAt: string };

export type SupportTicket = {
  id: string;
  email: string;
  message: string;
  category: 'delivery' | 'complaint' | 'general';
  status: 'open' | 'resolved';
  createdAt: string;
};

export type PaymentReceiptReview = {
  id: string;
  orderId: string;
  userId: string;
  expectedAmount: number;
  extraction: {
    utrNumber: string | null;
    amountPaid: number | null;
    receiverUpiId: string | null;
    date: string | null;
    isSuccessful: boolean;
  };
  flags: string[];
  status: 'pending_admin_review' | 'reviewed';
  createdAt: string;
  reviewedAt?: string;
  reviewNote?: string;
};

export type PaymentAuditEvent = {
  eventId: string;
  type: string;
  orderId: string | null;
  paymentId: string | null;
  outcome: string;
  createdAt: string;
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
};

export const defaultStorefrontContent: StorefrontContent = {
  announcement: 'A softer kind of everyday. Complimentary shipping over ₹2,500.',
  heroEyebrow: 'The in-between collection · 01/26',
  heroTitle: 'Room to be yourself.',
  heroDescription: 'Thoughtful layers for all the ways a day can unfold.',
  heroImageUrl: 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=2200&q=85',
  storyHeading: 'Wear what feels like you.',
  storyBody: 'We make pieces to live in, not just look at. Easy silhouettes, tactile fabrics, and the quiet confidence of getting dressed without overthinking it.',
  storyImageUrl: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1200&q=85',
};

export type Database = {
  products: Product[];
  customers: Customer[];
  orders: Order[];
  events: StoreEvent[];
  supportTickets: SupportTicket[];
  paymentReceiptReviews?: PaymentReceiptReview[];
  paymentAuditEvents?: PaymentAuditEvent[];
  integrationWebhooks?: { googleAds?: string; zapier?: string };
  processedPaymentWebhookIds?: string[];
  sitePublished?: boolean;
  content: StorefrontContent;
};

const databasePath = path.resolve(process.env.DATA_FILE || '.data/ahuza-db.json');
const seedProducts: Product[] = [
  { id: 'soft-form-shirt', name: 'Soft Form Shirt', description: 'Organic cotton · Cloud', price: 2490, sku: 'AH-SFS-001', stock: 24, category: 'Tops', imageUrl: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=82', active: true, ghostMannequin: { imageUrl: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=82', tags: ['cotton', 'relaxed fit', 'long sleeve'], background: '#eeece5' } },
  { id: 'everyday-trouser', name: 'Everyday Trouser', description: 'Tencel blend · Moss', price: 3290, sku: 'AH-ET-002', stock: 18, category: 'Bottoms', imageUrl: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=82', active: true, ghostMannequin: { imageUrl: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=82', tags: ['tencel', 'straight leg', 'mid rise'], background: '#e6e3da' } },
  { id: 'weekend-knit', name: 'Weekend Knit', description: 'Lightweight linen · Natural', price: 2890, sku: 'AH-WK-003', stock: 13, category: 'Knitwear', imageUrl: 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=82', active: true, ghostMannequin: { imageUrl: 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=82', tags: ['linen blend', 'relaxed fit'], background: '#efede6' } },
  { id: 'easy-layer', name: 'Easy Layer', description: 'Recycled cotton · Terracotta', price: 3790, sku: 'AH-EL-004', stock: 9, category: 'Layers', imageUrl: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=82', active: true, ghostMannequin: { imageUrl: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=82', tags: ['recycled cotton', 'lightweight', 'layering'], background: '#e9e5dc' } },
];

let writeQueue: Promise<void> = Promise.resolve();
let loaded: Database | undefined;

function emptyDatabase(): Database {
  return { products: structuredClone(seedProducts), customers: [], orders: [], events: [], supportTickets: [], paymentReceiptReviews: [], paymentAuditEvents: [], sitePublished: true, content: structuredClone(defaultStorefrontContent) };
}

async function loadDatabase(): Promise<Database> {
  if (loaded) return loaded;
  try {
    const raw = await readFile(databasePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Database>;
    loaded = {
      products: Array.isArray(parsed.products) ? parsed.products : structuredClone(seedProducts),
      customers: Array.isArray(parsed.customers) ? parsed.customers : [],
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
      supportTickets: Array.isArray(parsed.supportTickets) ? parsed.supportTickets : [],
      paymentReceiptReviews: Array.isArray(parsed.paymentReceiptReviews) ? parsed.paymentReceiptReviews : [],
      paymentAuditEvents: Array.isArray(parsed.paymentAuditEvents) ? parsed.paymentAuditEvents : [],
      processedPaymentWebhookIds: Array.isArray(parsed.processedPaymentWebhookIds) ? parsed.processedPaymentWebhookIds.filter((id): id is string => typeof id === 'string') : [],
      sitePublished: parsed.sitePublished !== false,
      ...(parsed.integrationWebhooks && typeof parsed.integrationWebhooks === 'object' ? { integrationWebhooks: parsed.integrationWebhooks } : {}),
      content: { ...structuredClone(defaultStorefrontContent), ...(parsed.content && typeof parsed.content === 'object' ? parsed.content : {}) },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    loaded = emptyDatabase();
    await persist(loaded);
  }
  return loaded;
}

async function persist(database: Database): Promise<void> {
  await mkdir(path.dirname(databasePath), { recursive: true });
  const temporaryPath = `${databasePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(database, null, 2), { mode: 0o600 });
  await rename(temporaryPath, databasePath);
}

export async function getDatabase(): Promise<Database> {
  await writeQueue;
  return loadDatabase();
}

export async function mutateDatabase<T>(mutator: (database: Database) => T | Promise<T>): Promise<T> {
  const operation = writeQueue.then(async () => {
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