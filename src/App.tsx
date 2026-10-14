import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Mail, Heart, MapPin, Menu, Minus, Phone, Plus, ShoppingBag, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import OwnerStudio from './OwnerStudio';
import CustomerSupportChat from './CustomerSupportChat';
import { defaultImageSettings, imageSettingsVars, mainImage, srcSet, type ImageSettings, type ProductImage } from './imageTypes';

type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  sku: string;
  stock: number;
  imageUrl: string;
  category: string;
  ghostMannequin?: { imageUrl?: string; tags?: string[]; background?: string };
  images?: ProductImage[];
  mainImageId?: string;
  sizes?: string[];
};

const galleryImages = (product: Product): { id: string; url: string; srcSet?: string; thumb: string }[] => {
  if (product.images?.length) {
    const main = mainImage(product)!;
    return [main, ...product.images.filter((image) => image.id !== main.id)].map((image) => ({ id: image.id, url: image.url, srcSet: srcSet(image), thumb: image.variants[0]?.url || image.url }));
  }
  const legacy = product.ghostMannequin?.imageUrl || product.imageUrl;
  return [{ id: 'legacy', url: legacy, thumb: legacy }];
};

const formatPrice = (price: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0,
}).format(price);

type Customer = { id: string; email: string };
type CustomerOrder = { id: string; amount: number; currency: string; status: string; paymentMethod?: 'upi' | 'cod'; paymentStatus?: string; paymentVerifiedAt?: string; hasPendingReceiptReview?: boolean; createdAt: string; trackingNumber?: string; trackingUrl?: string; review?: { rating: number; comment?: string; createdAt: string }; items: { name: string; quantity: number; size?: string }[] };
type StorefrontContent = { announcement: string; heroEyebrow: string; heroTitle: string; heroDescription: string; heroImageUrl: string; storyHeading: string; storyBody: string; storyImageUrl: string };
type CartLine = { productId: string; quantity: number; size?: string };
type PaymentOrder = { orderId: string; paymentMethod: 'upi' | 'cod'; paymentReference?: string; upiIntent?: string; merchantVpa?: string; merchantName?: string; amount: number; currency: string; expiresAt?: string; status?: string };
type PaymentConfiguration = { configured: boolean; upiVpa: string | null; merchantName: string; automaticVerification: false };

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let result: T;
  try {
    result = JSON.parse(text) as T;
  } catch {
    throw new Error(response.ok ? 'The server returned an unreadable response.' : `Request failed (${response.status}).`);
  }
  return result;
}
export default function App() {
  const [storeContent, setStoreContent] = useState<StorefrontContent>({
    announcement: 'A softer kind of everyday. Complimentary shipping over ₹2,500.',
    heroEyebrow: 'The in-between collection · 01/26', heroTitle: 'Room to be yourself.',
    heroDescription: 'Thoughtful layers for all the ways a day can unfold.',
    heroImageUrl: 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=2200&q=85',
    storyHeading: 'Wear what feels like you.',
    storyBody: 'We make pieces to live in, not just look at. Easy silhouettes, tactile fabrics, and the quiet confidence of getting dressed without overthinking it.',
    storyImageUrl: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1200&q=85',
  });
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [notice, setNotice] = useState('');
  const [cartOpen, setCartOpen] = useState(false);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [accountOpen, setAccountOpen] = useState(false);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [reviewBusy, setReviewBusy] = useState('');
  const [reviewMessages, setReviewMessages] = useState<Record<string, string>>({});
  const [receiptUploadOrder, setReceiptUploadOrder] = useState('');
  const [receiptMessages, setReceiptMessages] = useState<Record<string, string>>({});
  const [paymentOrder, setPaymentOrder] = useState<PaymentOrder | null>(null);
  const [paymentStatus, setPaymentStatus] = useState('pending');
  const [paymentMessage, setPaymentMessage] = useState('');
  const [paymentConfiguration, setPaymentConfiguration] = useState<PaymentConfiguration | null>(null);
  const [sitePublished, setSitePublished] = useState<boolean | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [newsletterBusy, setNewsletterBusy] = useState(false);
  const [newsletterMessage, setNewsletterMessage] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'upi' | 'cod'>('upi');
  const [ownerStudioOpen, setOwnerStudioOpen] = useState(false);
  const [imageSettings, setImageSettings] = useState<ImageSettings>(defaultImageSettings);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [detailIndex, setDetailIndex] = useState(0);
  const [selectedSize, setSelectedSize] = useState('');
  const [zoomed, setZoomed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const cartCount = cart.reduce((count, item) => count + item.quantity, 0);
  const cartLines = cart.map((line) => ({ ...line, product: products.find((product) => product.id === line.productId) })).filter((line): line is CartLine & { product: Product } => Boolean(line.product));
  const cartTotal = cartLines.reduce((total, line) => total + line.product.price * line.quantity, 0);
  const estimatedShipping = cartTotal < 2500 ? 100 : 0;

  useEffect(() => {
    fetch('/api/site-status')
      .then(async (response) => {
        const result = await parseResponse<{ published?: boolean; error?: string }>(response);
        if (!response.ok || typeof result.published !== 'boolean') throw new Error(result.error || 'Could not check storefront status.');
        setSitePublished(result.published);
      })
      .catch(() => setSitePublished(false));

    fetch('/api/payments/config')
      .then(async (response) => {
        const result = await parseResponse<PaymentConfiguration>(response);
        if (!response.ok) throw new Error('Payment configuration unavailable.');
        setPaymentConfiguration(result);
      })
      .catch(() => setPaymentConfiguration({ configured: false, upiVpa: null, merchantName: 'AHUZA Apparel', automaticVerification: false }));

    fetch('/api/products')
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load the collection.');
        const data = await response.json() as { products: Product[] };
        setProducts(data.products);
      })
      .catch(() => setNotice('The collection is taking a moment. Refresh to try again.'));

    fetch('/api/storefront')
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load storefront content.');
        const data = await response.json() as { content: StorefrontContent; imageSettings?: ImageSettings };
        setStoreContent(data.content);
        if (data.imageSettings) setImageSettings(data.imageSettings);
      })
      .catch(() => undefined);

    fetch('/api/auth/me').then(async (response) => {
      if (response.ok) {
        const data = await response.json() as { customer: Customer };
        setCustomer(data.customer);
      }
    }).catch(() => undefined);

    fetch('/api/marketing/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'store_view', consent: false }),
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (products.length === 0) return;
    setCart((current) => current.flatMap((line) => {
      const product = products.find((entry) => entry.id === line.productId);
      if (!product || product.stock < 1) return [];
      return [{ ...line, quantity: Math.min(line.quantity, product.stock, 10) }];
    }));
  }, [products]);

  useEffect(() => {
    if (!paymentOrder || !['pending', 'failed', 'cancelled'].includes(paymentStatus)) return;
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      try {
        const response = await fetch(`/api/payments/orders/${encodeURIComponent(paymentOrder.orderId)}/status`);
        const result = await parseResponse<{ status?: string; orderStatus?: string; error?: string }>(response);
        if (!response.ok || !result.status) throw new Error(result.error || 'Could not check order status.');
        if (stopped) return;
        setPaymentStatus(result.status);
        if (result.status === 'paid') {
          setCart([]);
          setPaymentMessage('AHUZA has confirmed the bank settlement. Your order is confirmed.');
        } else if (result.status === 'expired' || result.status === 'cancelled') {
          setPaymentMessage(result.orderStatus === 'pending_payment'
            ? 'The UPI attempt was cancelled. Inventory remains reserved briefly in case a bank credit is delayed. Do not reuse the link; contact AHUZA if you sent money.'
            : 'This order is closed or expired. Do not use its old UPI payment link. Contact AHUZA if you already sent a payment.');
          if (result.orderStatus === 'pending_payment') timer = window.setTimeout(() => void poll(), 15000);
        } else if (result.status === 'failed') {
          setPaymentMessage('The UPI attempt was reported as failed; this is not bank verification. If money was debited, contact AHUZA with the bank reference before retrying.');
          timer = window.setTimeout(() => void poll(), 15000);
        } else {
          setPaymentMessage('Payment is pending. UPI app success screens are not verified; AHUZA will confirm only after the settled amount appears in its bank account.');
          timer = window.setTimeout(() => void poll(), 15000);
        }
      } catch (error) {
        if (!stopped) {
          setPaymentMessage(error instanceof Error ? error.message : 'Could not refresh the order status.');
          timer = window.setTimeout(() => void poll(), 15000);
        }
      }
    };
    void poll();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [paymentOrder, paymentStatus]);

  useEffect(() => {
    if (!accountOpen || !customer) return;
    const controller = new AbortController();
    setOrdersLoading(true);
    setOrdersError('');
    fetch('/api/orders', { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { orders?: CustomerOrder[]; error?: string };
        if (!response.ok || !result.orders) throw new Error(result.error || 'Could not load your order history.');
        setOrders(result.orders);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setOrdersError(error instanceof Error ? error.message : 'Could not load your order history.');
      })
      .finally(() => { if (!controller.signal.aborted) setOrdersLoading(false); });
    return () => controller.abort();
  }, [accountOpen, customer]);

  useEffect(() => {
    if (!customer) { setWishlist([]); return; }
    fetch('/api/wishlist').then(async (response) => {
      if (response.ok) setWishlist(((await response.json()) as { productIds: string[] }).productIds);
    }).catch(() => undefined);
  }, [customer]);

  async function toggleWishlist(product: Product) {
    if (!customer) {
      setAuthMode('signup');
      setAccountOpen(true);
      setNotice('Create an account or log in to save your wishlist.');
      window.setTimeout(() => setNotice(''), 3000);
      return;
    }
    const saved = wishlist.includes(product.id);
    const response = await fetch(`/api/wishlist/${encodeURIComponent(product.id)}`, { method: saved ? 'DELETE' : 'PUT' }).catch(() => null);
    if (response?.ok) {
      setWishlist(((await response.json()) as { productIds: string[] }).productIds);
      setNotice(saved ? `${product.name} removed from your wishlist` : `${product.name} saved to your wishlist`);
    } else setNotice('Could not update your wishlist. Please try again.');
    window.setTimeout(() => setNotice(''), 2400);
  }

  async function requestRestockAlert(product: Product) {
    if (!customer) {
      setAuthMode('signup');
      setAccountOpen(true);
      setNotice('Create an account or sign in to get a restock email.');
      window.setTimeout(() => setNotice(''), 3500);
      return;
    }
    try {
      const response = await fetch(`/api/products/${encodeURIComponent(product.id)}/stock-alert`, { method: 'POST' });
      const result = await response.json() as { error?: string; alreadySubscribed?: boolean; emailConfigured?: boolean };
      if (!response.ok) throw new Error(result.error || 'Could not save your restock alert.');
      setNotice(result.alreadySubscribed
        ? `You're already signed up for a ${product.name} restock alert.`
        : result.emailConfigured
          ? `We'll email you when ${product.name} is back in stock.`
          : `Restock alert saved for ${product.name}. Email sending is not configured yet.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save your restock alert.');
    }
    window.setTimeout(() => setNotice(''), 4000);
  }

  function openProduct(product: Product) {
    setDetailProduct(product);
    setDetailIndex(0);
    setSelectedSize('');
    setZoomed(false);
  }

  function addToBag(product: Product, size?: string) {
    if (product.sizes?.length && !size) {
      openProduct(product);
      setNotice('Choose an available size before adding this item to your bag.');
      window.setTimeout(() => setNotice(''), 3000);
      return;
    }
    if (product.stock < 1) return;
    const maxQuantity = Math.min(product.stock, 10);
    const currentQuantity = cart.reduce((total, line) => line.productId === product.id ? total + line.quantity : total, 0);
    if (currentQuantity >= maxQuantity) {
      setNotice(`You can add up to ${maxQuantity} of ${product.name}.`);
      return;
    }
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id && line.size === size);
      return existing
        ? current.map((line) => line.productId === product.id && line.size === size ? { ...line, quantity: Math.min(line.quantity + 1, maxQuantity) } : line)
        : [...current, { productId: product.id, quantity: 1, ...(size ? { size } : {}) }];
    });
    setNotice(`${product.name}${size ? ` · Size ${size}` : ''} added to your cart.`);
    window.setTimeout(() => setNotice(''), 2400);
  }

  function changeQuantity(productId: string, size: string | undefined, change: number) {
    const product = products.find((entry) => entry.id === productId);
    if (!product) return;
    const currentQuantity = cart.reduce((total, line) => line.productId === productId ? total + line.quantity : total, 0);
    const maxQuantity = Math.min(product.stock, 10);
    if (change > 0 && currentQuantity >= maxQuantity) {
      setNotice(`You can add up to ${maxQuantity} of ${product.name}.`);
      return;
    }
    setCart((current) => current.flatMap((line) => {
      if (line.productId !== productId || line.size !== size) return [line];
      const quantity = Math.min(line.quantity + change, maxQuantity);
      return quantity > 0 ? [{ ...line, quantity }] : [];
    }));
  }

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch(`/api/auth/${authMode === 'signup' ? 'signup' : 'login'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      });
      const result = await response.json() as { customer?: Customer; error?: string };
      if (!response.ok || !result.customer) throw new Error(result.error || 'Could not sign in.');
      setCustomer(result.customer);
      setAccountOpen(false);
      setNotice(`Signed in as ${result.customer.email}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  async function checkout(formData: FormData) {
    if (!customer) {
      setAccountOpen(true);
      setNotice('Sign in to continue to checkout.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/payments/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map(({ productId, quantity, size }) => ({ productId, quantity, ...(size ? { size } : {}) })),
          paymentMethod,
          marketingConsent,
          shippingAddress: Object.fromEntries(formData.entries()),
        }),
      });
      const order = await parseResponse<PaymentOrder & { error?: string }>(response);
      if (!response.ok || !order.orderId || order.paymentMethod !== paymentMethod || typeof order.amount !== 'number') {
        throw new Error(order.error || 'Could not start checkout.');
      }
      if (paymentMethod === 'upi' && (!order.paymentReference || !order.upiIntent || !order.merchantVpa)) {
        throw new Error('The server returned an incomplete direct UPI payment request.');
      }
      setPaymentOrder(order);
      setPaymentStatus(paymentMethod === 'cod' ? 'confirmed' : 'pending');
      setPaymentMessage(paymentMethod === 'cod'
        ? 'Your order is confirmed. Please pay the delivery partner in cash when your order arrives.'
        : 'Pay using the AHUZA UPI intent. The order remains pending until AHUZA manually verifies settlement in its bank account.');
      if (paymentMethod === 'cod') setCart([]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not start checkout.');
    } finally {
      setBusy(false);
    }
  }

  async function refreshPaymentStatus() {
    if (!paymentOrder) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/payments/orders/${encodeURIComponent(paymentOrder.orderId)}/status`);
      const result = await parseResponse<{ status?: string; error?: string }>(response);
      if (!response.ok || !result.status) throw new Error(result.error || 'Could not refresh order status.');
      setPaymentStatus(result.status);
      setPaymentMessage(result.status === 'paid'
        ? 'AHUZA has confirmed the bank settlement. Your order is confirmed.'
        : result.status === 'cancelled' || result.status === 'expired'
          ? 'This order is closed. Do not use its old UPI link.'
          : 'Payment is still pending. An authorized AHUZA owner must verify the settled credit in the bank account.');
    } catch (error) { setPaymentMessage(error instanceof Error ? error.message : 'Could not refresh order status.'); }
    finally { setBusy(false); }
  }

  async function cancelPayment() {
    if (!paymentOrder) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/payments/orders/${encodeURIComponent(paymentOrder.orderId)}/cancel`, { method: 'POST' });
      const result = await parseResponse<{ status?: string; error?: string }>(response);
      if (!response.ok || result.status !== 'cancelled') throw new Error(result.error || 'Could not safely cancel the payment request.');
      setPaymentStatus('cancelled');
      setPaymentMessage('The UPI attempt was cancelled. Inventory remains reserved briefly in case a bank credit is delayed. Do not reuse the link; contact AHUZA if you sent money.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not cancel payment request.');
    } finally {
      setBusy(false);
    }

  }

  async function reportPaymentFailure() {
    if (!paymentOrder) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/payments/orders/${encodeURIComponent(paymentOrder.orderId)}/failure`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ failed: true }),
      });
      const result = await parseResponse<{ status?: string; error?: string }>(response);
      if (!response.ok || result.status !== 'failed') throw new Error(result.error || 'Could not update the order.');
      setPaymentStatus('failed');
      setPaymentMessage('The failed UPI attempt is recorded, but this does not prove no money was sent. Check your bank statement before retrying.');
    } catch (error) { setPaymentMessage(error instanceof Error ? error.message : 'Could not update the order.'); }
    finally { setBusy(false); }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setCustomer(null);
    setOrders([]);
    setAccountOpen(false);
  }

  async function subscribeToNewsletter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newsletterBusy) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    setNewsletterBusy(true);
    setNewsletterMessage('');
    try {
      const response = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.get('email'), consent: formData.get('consent') === 'on' }),
      });
      const result = await response.json() as { error?: string; alreadySubscribed?: boolean };
      if (!response.ok) throw new Error(result.error || 'Could not subscribe right now.');
      form.reset();
      setNewsletterMessage(result.alreadySubscribed ? 'This email is already subscribed to AHUZA updates.' : 'Thank you. You are subscribed to AHUZA updates.');
    } catch (error) {
      setNewsletterMessage(error instanceof Error ? error.message : 'Could not subscribe right now. Please try again.');
    } finally {
      setNewsletterBusy(false);
    }
  }

  async function submitOrderReview(orderId: string, formData: FormData) {
    setReviewBusy(orderId);
    setReviewMessages((current) => ({ ...current, [orderId]: '' }));
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: Number(formData.get('rating')), comment: formData.get('comment') }),
      });
      const result = await response.json() as { review?: NonNullable<CustomerOrder['review']>; error?: string };
      if (!response.ok || !result.review) throw new Error(result.error || 'Could not submit your review.');
      setOrders((current) => current.map((order) => order.id === orderId ? { ...order, review: result.review } : order));
      setReviewMessages((current) => ({ ...current, [orderId]: 'Thank you for rating your order.' }));
    } catch (error) {
      setReviewMessages((current) => ({ ...current, [orderId]: error instanceof Error ? error.message : 'Could not submit your review.' }));
    } finally { setReviewBusy(''); }
  }

  async function downloadInvoice(order: CustomerOrder) {
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(order.id)}/invoice`);
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(result.error || 'Could not download this invoice.');
      }
      const invoice = await response.blob();
      const url = URL.createObjectURL(invoice);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ahuza-invoice-${order.id}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setOrdersError(error instanceof Error ? error.message : 'Could not download this invoice.');
    }
  }

  async function uploadPaymentReceipt(orderId: string, fileValue: FormDataEntryValue | null) {
    if (!(fileValue instanceof File)) {
      setReceiptMessages((current) => ({ ...current, [orderId]: 'Choose a receipt image to upload.' }));
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(fileValue.type) || fileValue.size > 5 * 1024 * 1024) {
      setReceiptMessages((current) => ({ ...current, [orderId]: 'Choose a JPEG, PNG, or WebP image no larger than 5 MB.' }));
      return;
    }
    setReceiptUploadOrder(orderId);
    setReceiptMessages((current) => ({ ...current, [orderId]: '' }));
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/payment-receipts`, {
        method: 'POST',
        headers: { 'Content-Type': fileValue.type },
        body: fileValue,
      });
      const result = await parseResponse<{ review?: { status: string }; error?: string }>(response);
      if (!response.ok || !result.review) throw new Error(result.error || 'Could not submit this receipt for review.');
      setOrders((current) => current.map((entry) => entry.id === orderId ? { ...entry, hasPendingReceiptReview: true } : entry));
      setReceiptMessages((current) => ({ ...current, [orderId]: 'Receipt sent for owner review. It does not confirm payment or release the order.' }));
    } catch (error) {
      setReceiptMessages((current) => ({ ...current, [orderId]: error instanceof Error ? error.message : 'Could not submit this receipt for review.' }));
    } finally {
      setReceiptUploadOrder('');
    }
  }

  return (
    <main>
      {sitePublished === null ? <section className="store-maintenance"><p className="eyebrow">AHUZA APPAREL</p><h1>Checking storefront status</h1><p>Please wait a moment.</p></section> : sitePublished ? <>
      <div className="announcement">{storeContent.announcement}</div>
      <header className="site-header">
        <button className="icon-button mobile-menu" type="button" aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'} aria-expanded={mobileMenuOpen} aria-controls="main-navigation" onClick={() => setMobileMenuOpen((open) => !open)}>{mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}</button>
        <nav className={`main-nav${mobileMenuOpen ? ' is-open' : ''}`} id="main-navigation" aria-label="Main navigation">
          <a href="#home" onClick={() => setMobileMenuOpen(false)}>Home</a><a href="#about" onClick={() => setMobileMenuOpen(false)}>About</a><a href="#why-ahuza" onClick={() => setMobileMenuOpen(false)}>Why AHUZA</a><a href="#contact" onClick={() => setMobileMenuOpen(false)}>Contact</a>
        </nav>
        <a className="wordmark" href="#home" aria-label="AHUZA home">AHUZA<span>.</span></a>
        <div className="header-actions"><button className="account-link" onClick={() => setAccountOpen(true)}>{customer ? 'My account' : 'Account'}</button><button className="bag-button" aria-label={`Shopping bag, ${cartCount} items`} onClick={() => setCartOpen(true)}><ShoppingBag size={18} /><span>Bag ({cartCount})</span></button></div>
      </header>

      <section className="hero" id="home">
         <img className="hero-image" src={storeContent.heroImageUrl} alt="AHUZA's featured collection" />
        <div className="hero-shade" />
        <div className="hero-copy">
          <p className="eyebrow">{storeContent.heroEyebrow}</p>
          <h1>{storeContent.heroTitle}</h1>
          <p>{storeContent.heroDescription}</p>
          <a className="light-link" href="#collection">Explore the collection <ArrowRight size={16} /></a>
        </div>
        <span className="hero-index">01 — 04</span>
        <a className="scroll-cue" href="#collection" aria-label="Scroll to collection"><ArrowDown size={17} /></a>
      </section>

      <section className="collection section-wrap" id="collection">
        <div className="section-heading">
          <div><p className="eyebrow dark-eyebrow">Made for repeat wear</p><h2>Good things, on rotation.</h2></div>
          <a className="text-link" href="#collection">Shop all <ArrowUpRight size={15} /></a>
        </div>
        {notice && <p className="notice" role="status">{notice}</p>}
        {products.length === 0 && !notice ? <p className="loading">Gathering the collection…</p> : null}
        <div className="product-grid" style={imageSettingsVars(imageSettings) as CSSProperties}>
          {products.map((product, index) => {
            const gallery = galleryImages(product);
            const displayImage = gallery[0]!;
            const hoverImage = imageSettings.layout.cardImage === 'hover-second' ? gallery[1] : undefined;
            const displayBackground = product.ghostMannequin?.background || `var(--tone-${index % 4})`;
            const quantityInBag = cart.reduce((total, line) => line.productId === product.id ? total + line.quantity : total, 0);
            const quantityLimit = Math.min(product.stock, 10);

            return (
              <article className="product" key={product.id}>
                <div className={`product-image image-tone-${index % 4} ${product.images?.length ? 'has-upload' : ''}`} style={product.images?.length ? undefined : { background: displayBackground }}>
                  <button type="button" className="product-open" onClick={() => openProduct(product)} aria-label={`View ${product.name}`}>
                    <img src={displayImage.url} srcSet={displayImage.srcSet} sizes="(max-width: 760px) 50vw, 25vw" alt={product.name} loading="lazy" className={product.images?.length ? 'upload-product-image' : 'ghost-product-image'} />
                    {hoverImage && <img src={hoverImage.url} srcSet={hoverImage.srcSet} sizes="(max-width: 760px) 50vw, 25vw" alt="" loading="lazy" className="upload-product-image hover-image" />}
                  </button>
                  <span className="product-number">0{index + 1}</span>
                  <button className={`wishlist-toggle ${wishlist.includes(product.id) ? 'saved' : ''}`} type="button" onClick={() => void toggleWishlist(product)} aria-pressed={wishlist.includes(product.id)} aria-label={wishlist.includes(product.id) ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`}><Heart size={17} fill={wishlist.includes(product.id) ? 'currentColor' : 'none'} /></button>
                  <button className={`quick-add ${product.stock < 1 ? 'notify-stock-button' : ''}`} type="button" onClick={() => product.stock < 1 ? void requestRestockAlert(product) : product.sizes?.length ? openProduct(product) : addToBag(product)} disabled={product.stock > 0 && quantityInBag >= quantityLimit} aria-label={product.stock < 1 ? `Notify me when ${product.name} is back in stock` : quantityInBag >= quantityLimit ? `${product.name} quantity limit reached` : product.sizes?.length ? `Choose a size for ${product.name}` : `Add ${product.name} to cart`}>
                    {product.stock > 0 ? <ShoppingBag size={18} /> : 'Notify me'}
                  </button>
                </div>
                <div className="product-meta"><div><h3>{product.name}</h3><p>{product.description}</p></div><span>{formatPrice(product.price)}</span></div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="story" id="about">
        <div className="story-image"><img src={storeContent.storyImageUrl} alt="A considered wardrobe made to last" loading="lazy" /></div>
        <div className="story-copy">
          <p className="eyebrow dark-eyebrow">About AHUZA</p>
          <h2>{storeContent.storyHeading}</h2>
          <p>{storeContent.storyBody}</p>
          <p>AHUZA creates elevated everyday essentials for women and modern wardrobes—pieces designed to move fluidly from work to weekends, with comfort, confidence, and silhouette-driven ease at the centre of every collection.</p>
          <a className="text-link" href="#why-ahuza">Why AHUZA <ArrowUpRight size={15} /></a>
        </div>
      </section>

      <section className="why-ahuza section-wrap" id="why-ahuza">
        <div className="section-heading">
          <div><p className="eyebrow dark-eyebrow">Why AHUZA</p><h2>Designed for real life.</h2></div>
        </div>
        <div className="why-grid">
          <article className="why-card">
            <span>01</span>
            <h3>Modern essentials</h3>
            <p>Refined silhouettes, relaxed comfort, and premium textures that work across every moment of the day.</p>
          </article>
          <article className="why-card">
            <span>02</span>
            <h3>Thoughtful quality</h3>
            <p>Each piece is selected and built for durability, softness, and a polished look that feels elevated without being loud.</p>
          </article>
          <article className="why-card">
            <span>03</span>
            <h3>Confidence first</h3>
            <p>We design for ease, body confidence, and effortless styling—so every outfit helps you feel your best.</p>
          </article>
        </div>
      </section>

      <section className="contact-section" id="contact">
        <div className="contact-copy">
          <p className="eyebrow">Contact us</p>
          <h2>Let’s build your next favourite fit.</h2>
          <p>From styling advice to bulk orders and partnerships, we’d love to hear from you.</p>
        </div>
        <address className="contact-grid">
          <a className="contact-card" href="mailto:Info@ahuzawear.com">
            <Mail className="contact-icon" size={20} aria-hidden="true" />
            <div className="contact-card-copy"><h3>Email</h3><span className="contact-value">Info@ahuzawear.com</span></div>
          </a>
          <a className="contact-card" href="tel:+919550582277">
            <Phone className="contact-icon" size={20} aria-hidden="true" />
          <div className="contact-card-copy"><h3>Phone</h3><span className="contact-value">+91 95505 82277</span></div>
          </a>
          <div className="contact-card">
            <MapPin className="contact-icon" size={20} aria-hidden="true" />
            <div className="contact-card-copy"><h3>Location</h3><span className="contact-value">Telangana, India</span></div>
          </div>
        </address>
      </section>

      <section className="newsletter" id="journal"><div><p className="eyebrow">Ahuza updates</p><h2>Stay in style.</h2><p className="newsletter-copy">New collections, thoughtful notes and offers from AHUZA.</p></div><form onSubmit={(event) => void subscribeToNewsletter(event)}><label className="sr-only" htmlFor="newsletter-email">Email address</label><input id="newsletter-email" name="email" type="email" autoComplete="email" placeholder="Your email address" maxLength={254} required disabled={newsletterBusy} /><label className="newsletter-consent"><input name="consent" type="checkbox" required disabled={newsletterBusy} /> I agree to receive AHUZA news and offers by email.</label><button type="submit" disabled={newsletterBusy}>{newsletterBusy ? 'Subscribing…' : 'Subscribe'} <ArrowRight size={16} /></button>{newsletterMessage && <p className="newsletter-message" role="status">{newsletterMessage}</p>}</form></section>
      <footer className="site-footer"><a className="wordmark" href="#home">AHUZA<span>.</span></a><p>Considered essentials for everyday living.</p><span>© AHUZA Apparel 2026</span><button className="owner-entry" onClick={() => setOwnerStudioOpen(true)}>Owner Studio</button></footer>

      {cartOpen && <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setCartOpen(false); }}>
        <aside className="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="bag-title">
          <div className="drawer-heading"><div><p className="eyebrow dark-eyebrow">AHUZA Apparel</p><h2 id="bag-title">Your bag <span>({cartCount})</span></h2></div><button className="icon-button" aria-label="Close bag" onClick={() => setCartOpen(false)}><X size={21} /></button></div>
          {paymentOrder ? <section className="payment-panel" aria-live="polite">
            <p className="eyebrow dark-eyebrow">{paymentOrder.paymentMethod === 'cod' ? 'Cash on delivery' : 'Custom UPI checkout'}</p>
            <h3>{paymentOrder.paymentMethod === 'cod' ? 'Order confirmed' : paymentStatus === 'paid' ? 'Payment confirmed' : paymentStatus === 'failed' ? 'UPI attempt reported failed' : paymentStatus === 'expired' || paymentStatus === 'cancelled' ? 'Payment request closed' : paymentStatus === 'pending' ? 'UPI payment pending' : 'Payment pending'}</h3>
            <p>{paymentMessage || 'Waiting for verified payment status…'}</p>
            <p><strong>{formatPrice(paymentOrder.amount / 100)}</strong>{paymentOrder.paymentReference ? ` · Reference ${paymentOrder.paymentReference}` : ` · Order ${paymentOrder.orderId.slice(0, 8)}`}</p>
            {paymentOrder.paymentMethod === 'upi' && ['pending', 'failed', 'cancelled'].includes(paymentStatus) && <>{paymentStatus !== 'cancelled' && <><div className="upi-qr-fallback"><QRCodeSVG className="payment-qr" value={paymentOrder.upiIntent!} size={210} level="M" bgColor="#ffffff" fgColor="#1c241c" /><p>Scan with a UPI app to pay on your phone.</p></div><a className="dark-button" href={paymentOrder.upiIntent} onClick={() => setPaymentMessage('UPI app opened. After returning, AHUZA will confirm settlement from its bank account; the app success screen alone does not confirm payment.')}>{paymentStatus === 'failed' ? 'Try Pay via UPI again' : 'Pay via UPI'}</a><p>Paying {paymentOrder.merchantVpa} · {paymentOrder.merchantName}. The amount and order reference are pre-filled in Google Pay, PhonePe, Paytm or another installed UPI app.</p></>}<p className="payment-pending"><span className="payment-spinner" /> Checking AHUZA order status. This does not read your UPI app or bank.</p><button className="invoice-button" type="button" disabled={busy} onClick={() => void refreshPaymentStatus()}>Refresh order status</button>{paymentStatus === 'pending' && <button className="invoice-button" type="button" disabled={busy} onClick={() => void reportPaymentFailure()}>UPI app reported failure</button>}{paymentStatus !== 'cancelled' && <button className="invoice-button" type="button" disabled={busy} onClick={() => void cancelPayment()}>Cancel unpaid order</button>}</>}
            {paymentStatus === 'failed' && <p>The failure status is customer-reported only. If money was debited, contact AHUZA with the bank reference before retrying.</p>}
            {(paymentOrder.paymentMethod === 'cod' || paymentStatus === 'paid' || paymentStatus === 'cancelled' || paymentStatus === 'expired') && <button className="dark-button" type="button" onClick={() => { setPaymentOrder(null); setPaymentStatus('pending'); setCartOpen(false); }}>{paymentStatus === 'cancelled' ? 'Return to bag' : 'Done'}</button>}
            {paymentOrder.paymentMethod === 'upi' && <small>No gateway or bank verification API is connected. A UPI callback, screenshot, receipt or customer claim is never treated as proof. An authorized AHUZA owner must match the settled transaction in the bank account before confirming the order. The payment link expires after 20 minutes.</small>}
          </section> : cartLines.length === 0 ? <div className="empty-bag"><ShoppingBag size={25} /><p>Your bag is taking a quiet moment.</p><button className="dark-button" onClick={() => { setCartOpen(false); document.querySelector('#collection')?.scrollIntoView({ behavior: 'smooth' }); }}>Explore the collection</button></div> : <>
            <div className="bag-lines">{cartLines.map(({ product, quantity, size }) => <div className="bag-line" key={`${product.id}-${size || 'standard'}`}><img src={mainImage(product)?.variants[0]?.url || product.imageUrl} alt="" /><div className="bag-line-copy"><h3>{product.name}</h3><p>{formatPrice(product.price)}{size ? ` · Size ${size}` : ''}</p><div className="quantity-control"><button type="button" aria-label={`Remove one ${product.name}${size ? ` size ${size}` : ''}`} onClick={() => changeQuantity(product.id, size, -1)}><Minus size={13} /></button><span>{quantity}</span><button type="button" aria-label={`Add one ${product.name}${size ? ` size ${size}` : ''}`} onClick={() => changeQuantity(product.id, size, 1)} disabled={cart.reduce((total, line) => line.productId === product.id ? total + line.quantity : total, 0) >= Math.min(product.stock, 10)}><Plus size={13} /></button></div></div><span className="line-total">{formatPrice(product.price * quantity)}</span></div>)}</div>
            <div className="bag-footer"><div className="subtotal"><span>Subtotal</span><strong>{formatPrice(cartTotal)}</strong></div><div className="subtotal"><span>Shipping</span><strong>{estimatedShipping ? formatPrice(estimatedShipping) : 'Complimentary'}</strong></div><div className="subtotal"><span>Total</span><strong>{formatPrice(cartTotal + estimatedShipping)}</strong></div><p>₹100 shipping below ₹2,500. Complimentary shipping at or above ₹2,500. No discounts or additional taxes are currently applied.</p><form className="checkout-details" onSubmit={(event) => { event.preventDefault(); void checkout(new FormData(event.currentTarget)); }}>
              <p className="address-title">Delivery address · India</p><label>Full name<input name="name" autoComplete="name" maxLength={100} required /></label><label>Address line 1<input name="addressLine1" autoComplete="address-line1" maxLength={180} required /></label><label>Address line 2 <span>Optional</span><input name="addressLine2" autoComplete="address-line2" maxLength={180} /></label><div className="address-row"><label>City<input name="city" autoComplete="address-level2" maxLength={80} required /></label><label>State<input name="state" autoComplete="address-level1" maxLength={80} required /></label></div><div className="address-row"><label>PIN code<input name="postalCode" inputMode="numeric" autoComplete="postal-code" pattern="[1-9][0-9]{5}" maxLength={6} required /></label><label>Phone<input name="phone" type="tel" inputMode="tel" autoComplete="tel" pattern="\+?[0-9][0-9\s-]{8,16}" maxLength={18} required /></label></div>
              <fieldset className="payment-method-options"><legend>Payment method</legend><label><input type="radio" name="paymentMethod" value="upi" checked={paymentMethod === 'upi'} onChange={() => setPaymentMethod('upi')} disabled={!paymentConfiguration?.configured} /> Pay via UPI</label><label><input type="radio" name="paymentMethod" value="cod" checked={paymentMethod === 'cod'} onChange={() => setPaymentMethod('cod')} /> Cash on delivery</label></fieldset>
              {paymentMethod === 'upi' && !paymentConfiguration?.configured && <p className="payment-config-warning" role="status">{paymentConfiguration ? 'Direct UPI is unavailable until the server has a valid UPI_VPA. Cash on delivery is still available.' : 'Checking UPI availability… Cash on delivery is available.'}</p>}
              {paymentMethod === 'upi' && paymentConfiguration?.configured && <p className="payment-config-warning">UPI opens directly in your app. Payment remains pending until AHUZA manually verifies the bank settlement.</p>}
              <label className="consent-check"><input type="checkbox" checked={marketingConsent} onChange={(event) => setMarketingConsent(event.target.checked)} />Share purchase conversion with AHUZA's ad partners</label><button className="dark-button checkout-button" disabled={busy || (paymentMethod === 'upi' && paymentConfiguration?.configured !== true)}>{busy ? 'Placing your order…' : customer ? paymentMethod === 'cod' ? 'Place COD order' : paymentConfiguration?.configured ? 'Continue to UPI' : 'UPI unavailable' : 'Sign in to checkout'} <ArrowRight size={16} /></button></form><small>Pay via direct UPI intent or in cash when your COD order is delivered. Returns and replacements within 7 days of delivery.</small></div>
          </>}
        </aside>
      </div>}

      {accountOpen && <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setAccountOpen(false); }}>
        <section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-title">
          <button className="icon-button dialog-close" aria-label="Close account" onClick={() => setAccountOpen(false)}><X size={20} /></button>
          {customer ? <><p className="eyebrow dark-eyebrow">Your AHUZA account</p><h2 id="account-title">Welcome back.</h2><p className="account-email">{customer.email}</p><section className="customer-wishlist" aria-labelledby="wishlist-title"><h3 id="wishlist-title">Wishlist ({wishlist.length})</h3>{wishlist.length === 0 && <p>Tap the heart on any piece to save it here.</p>}{wishlist.map((id) => products.find((product) => product.id === id)).filter((product): product is Product => Boolean(product)).map((product) => <div className="wishlist-item" key={product.id}><span>{product.name} · {formatPrice(product.price)}</span>{product.stock < 1 ? <button type="button" className="dark-button" onClick={() => void requestRestockAlert(product)}>Notify me</button> : <button type="button" className="dark-button" onClick={() => addToBag(product)}>{product.sizes?.length ? 'Choose size' : 'Add to cart'}</button>}<button type="button" className="icon-button" aria-label={`Remove ${product.name} from wishlist`} onClick={() => void toggleWishlist(product)}><X size={16} /></button></div>)}</section><section className="customer-order-history" aria-labelledby="order-history-title"><h3 id="order-history-title">Order history</h3>{ordersLoading && <p>Loading your orders…</p>}{ordersError && <p className="order-history-error" role="alert">{ordersError}</p>}{!ordersLoading && !ordersError && orders.length === 0 && <p>Your orders will appear here.</p>}{orders.map((order) => <article className="customer-order" key={order.id}><div><strong>{order.id.slice(0, 8)}</strong><span>{new Date(order.createdAt).toLocaleDateString('en-IN')} · {order.status.replaceAll('_', ' ')} · payment {order.paymentStatus || 'pending'}</span><span>{order.items.map((item) => `${item.name}${item.size ? ` (Size ${item.size})` : ''} × ${item.quantity}`).join(', ')}</span>{order.trackingNumber && <span>Tracking number: {order.trackingNumber}</span>}{order.trackingUrl && <a className="customer-track-link" href={order.trackingUrl} target="_blank" rel="noopener noreferrer">Track package <ArrowRight size={14} /></a>}{order.status === 'out_for_delivery' && <strong className="delivery-update">Your parcel is out for delivery.</strong>}</div><div className="customer-order-actions"><button className="invoice-button" type="button" onClick={() => void downloadInvoice(order)} disabled={!order.paymentVerifiedAt || !['paid', 'shipped', 'out_for_delivery', 'delivered'].includes(order.status)}>{order.paymentVerifiedAt && ['paid', 'shipped', 'out_for_delivery', 'delivered'].includes(order.status) ? 'Download invoice' : 'Invoice after payment'}</button>{order.review ? <p className="order-review-result" aria-label={`Your rating: ${order.review.rating} out of 5`}>{'★'.repeat(order.review.rating)}{'☆'.repeat(5 - order.review.rating)}{order.review.comment ? ` · ${order.review.comment}` : ''}</p> : order.status === 'delivered' ? <form className="order-review-form" onSubmit={(event) => { event.preventDefault(); void submitOrderReview(order.id, new FormData(event.currentTarget)); }}><label>Rate this order<select name="rating" defaultValue="5"><option value="5">★★★★★ · Loved it</option><option value="4">★★★★ · Great</option><option value="3">★★★ · Good</option><option value="2">★★ · Could be better</option><option value="1">★ · Not satisfied</option></select></label><label>Review (optional)<textarea name="comment" maxLength={1000} rows={2} placeholder="Share your experience" /></label><button className="invoice-button" type="submit" disabled={reviewBusy === order.id}>{reviewBusy === order.id ? 'Sending…' : 'Submit review'}</button>{reviewMessages[order.id] && <small role="status">{reviewMessages[order.id]}</small>}</form> : null}{['pending_payment', 'cancelled'].includes(order.status) && (order.hasPendingReceiptReview ? <small>Receipt waiting for owner review. This does not confirm payment.</small> : <form className="receipt-upload-form" onSubmit={(event) => { event.preventDefault(); void uploadPaymentReceipt(order.id, new FormData(event.currentTarget).get('receipt')); }}><label htmlFor={`receipt-${order.id}`}>If an owner requested payment proof<input id={`receipt-${order.id}`} type="file" name="receipt" accept="image/jpeg,image/png,image/webp" required /></label><button className="invoice-button" type="submit" disabled={receiptUploadOrder === order.id}>{receiptUploadOrder === order.id ? 'Sending…' : 'Submit for review'}</button><small>Gemini extracts receipt details for owner review only. The image is not stored, and AI cannot confirm payment.</small>{receiptMessages[order.id] && <small role="status">{receiptMessages[order.id]}</small>}</form>)}</div></article>)}</section><button className="dark-button" onClick={() => void logout()}>Sign out</button></> : <>
            <p className="eyebrow dark-eyebrow">Your AHUZA account</p><h2 id="account-title">{authMode === 'login' ? 'A good thing to come back to.' : 'Make yourself at home.'}</h2>
            <form className="auth-form" onSubmit={(event) => void handleAuth(event)}><label>Email address<input name="email" type="email" autoComplete="email" required /></label><label>Password<input name="password" type="password" minLength={authMode === 'signup' ? 12 : 1} autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} required />{authMode === 'signup' && <small>Use at least 12 characters.</small>}</label><button className="dark-button" disabled={busy}>{busy ? 'One moment…' : authMode === 'login' ? 'Sign in' : 'Create account'} <ArrowRight size={16} /></button></form>
            <button className="mode-switch" onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}>{authMode === 'login' ? 'New here? Create an account' : 'Already with us? Sign in'}</button>
          </>}
        </section>
      </div>}
      </> : <section className="store-maintenance">
        <p className="eyebrow">AHUZA APPAREL</p>
        <h1>We’ll be back soon.</h1>
        <p>Our storefront is temporarily closed while we make a few updates. Please check back soon.</p>
        <button className="dark-button" type="button" onClick={() => setOwnerStudioOpen(true)}>Owner Studio</button>
      </section>}
      {detailProduct && (() => {
        const gallery = galleryImages(detailProduct);
        const layout = imageSettings.layout;
        const showAll = layout.mode === 'gallery' && gallery.length > 1;
        const current = gallery[Math.min(detailIndex, gallery.length - 1)]!;
        return <div className="overlay product-detail-backdrop" onClick={() => setDetailProduct(null)}>
          <section className={`product-detail thumbs-${layout.thumbnailPlacement}`} role="dialog" aria-modal="true" aria-label={detailProduct.name} style={imageSettingsVars(imageSettings) as CSSProperties} onClick={(event) => event.stopPropagation()}>
            <button className="icon-button dialog-close" aria-label="Close product" onClick={() => setDetailProduct(null)}><X size={20} /></button>
            <div className="pd-gallery">
              <div className={`pd-main ${layout.zoom ? 'can-zoom' : ''} ${zoomed ? 'is-zoomed' : ''}`} onClick={() => layout.zoom && setZoomed((value) => !value)}>
                <img src={current.url} srcSet={current.srcSet} sizes="(max-width: 760px) 100vw, 50vw" alt={detailProduct.name} />
              </div>
              {showAll && layout.thumbnails && <div className="pd-thumbs">{gallery.map((image, position) => <button key={image.id} type="button" className={position === detailIndex ? 'active' : ''} onClick={() => { setDetailIndex(position); setZoomed(false); }} aria-label={`Show image ${position + 1}`}><img src={image.thumb} alt="" /></button>)}</div>}
            </div>
            <div className="pd-copy"><p className="eyebrow dark-eyebrow">{detailProduct.category} · {detailProduct.sku}</p><h2>{detailProduct.name}</h2><p>{detailProduct.description}</p><strong>{formatPrice(detailProduct.price)}</strong>
              {detailProduct.sizes?.length ? <fieldset className="customer-size-picker"><legend>Choose your size</legend><div className="size-options">{detailProduct.sizes.map((size) => <button key={size} type="button" className={`size-option size-choice ${selectedSize === size ? 'selected' : ''}`} aria-pressed={selectedSize === size} onClick={() => setSelectedSize(size)}>{size}</button>)}</div></fieldset> : null}
              {detailProduct.stock < 1 ? <button className="dark-button" type="button" onClick={() => void requestRestockAlert(detailProduct)}>Notify me when available</button> : <button className="dark-button" type="button" disabled={Boolean(detailProduct.sizes?.length && !selectedSize)} onClick={() => { addToBag(detailProduct, selectedSize || undefined); setDetailProduct(null); }}>{detailProduct.sizes?.length && !selectedSize ? 'Choose a size' : 'Add to cart'}</button>}</div>
          </section>
        </div>;
      })()}
      {ownerStudioOpen && <OwnerStudio onClose={() => setOwnerStudioOpen(false)} onProductsChange={setProducts} onContentChange={setStoreContent} onSiteStatusChange={setSitePublished} onImageSettingsChange={setImageSettings} />}
      {sitePublished && <CustomerSupportChat onOpenAccount={() => setAccountOpen(true)} />}
    </main>
  );
}