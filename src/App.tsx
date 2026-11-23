import { lazy, Suspense, useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent } from 'react';
import { User, ArrowRight, ArrowUpRight, Heart, MessageCircle, Mail, MapPin, Menu, Phone, Search, ShoppingBag, SlidersHorizontal, X, CheckCircle2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { countries, regionsForCountry } from './addressData';
import CustomerSupportChat from './CustomerSupportChat';
import ProductRail from './ProductRail';
import HeroCarousel, { type BannerSlide } from './HeroCarousel';
import PaymentQr from './PaymentQr';
import ManualPaymentInstructions from './ManualPaymentInstructions';
import CheckoutItems from './CheckoutItems';
import PaymentSuccess from './PaymentSuccess';
import { defaultImageSettings, imageSettingsVars, mainImage, srcSet, type ImageSettings, type ProductImage } from './imageTypes';
import { defaultStorefrontCopy, type StorefrontCopyId } from '../shared/storefrontCopy';
import { freeShippingThreshold, maxShippingCharge, shippingForSubtotal } from '../shared/shipping';
import { productPath } from '../shared/productUrl';
import type { ProductDetails as ProductDetailsData, ProductStockStatus } from '../shared/productDetails';
import { productIsPurchasable, productPricing, productStockStatus } from '../shared/productPricing';
import ProductDetails from './ProductDetails';
import { copyProductLink, shareProduct } from './productSharing';

const OwnerStudio = lazy(() => import('./OwnerStudio'));
const FIXED_PAYU_PAYMENT_LINK = 'https://u.payu.in/PAYUMN/YrNhcvnJ3Ya5';

type Product = ProductDetailsData & {
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
  stockStatus?: ProductStockStatus;
  discountPercent?: number;
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
const formatPaymentAmount = (amount: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(amount / 100);

type Customer = { id: string; email: string };
type CustomerOrder = { id: string; amount: number; currency: string; status: string; paymentMethod?: 'upi' | 'cod'; paymentStatus?: string; payuPaymentIssue?: 'initiation_failed' | 'provider_failed'; paymentVerifiedAt?: string; createdAt: string; trackingNumber?: string; trackingUrl?: string; review?: { rating: number; comment?: string; createdAt: string }; items: { name: string; quantity: number; size?: string }[] };
type StorefrontContent = { announcement: string; heroEyebrow: string; heroTitle: string; heroDescription: string; heroImageUrl: string; storyHeading: string; storyBody: string; storyImageUrl: string; brandLogoUrl?: string; circleImages?: Record<string, string>; circleLabels?: Record<string, string>; bannerImages?: Record<string, string>; copy?: Record<StorefrontCopyId, string> };
type CartLine = { productId: string; quantity: number; size?: string };
const orderStatusLabel = (order: { status: string; paymentStatus?: string; paymentMethod?: string; payuPaymentIssue?: 'initiation_failed' | 'provider_failed' }) => {
  if (order.status === 'paid') return 'Order confirmed · payment received';
  if (order.status === 'confirmed') return order.paymentMethod === 'cod' ? 'Order confirmed · pay on delivery' : 'Order confirmed';
  if (order.status === 'pending_payment' && order.payuPaymentIssue === 'initiation_failed') return 'Payment initiation failed · contact AHUZAH';
  if (order.status === 'pending_payment' && order.payuPaymentIssue === 'provider_failed') return 'PayU payment failed';
  if (order.status === 'pending_payment') return 'Awaiting payment confirmation';
  return `${order.status.replaceAll('_', ' ')}${order.paymentStatus === 'paid' ? ' · payment received' : ''}`;
};
type PaymentOrder = { orderId: string; paymentMethod: 'upi' | 'cod'; provider?: 'manual_upi' | 'payu'; checkoutMode?: 'qr' | 'intent'; paymentReference?: string; payUrl?: string; intentUri?: string; amount: number; paymentAdjustmentAmount?: number; currency: string; expiresAt?: string; status?: string; orderStatus?: string; items?: { name: string; quantity: number; size?: string }[] };

function isPayUIntentUri(value: unknown, expectedAmount?: number): value is string {
  if (typeof value !== 'string') return false;
  try {
    const intent = new URL(value);
    const payee = intent.searchParams.get('pa') || '';
    const amount = intent.searchParams.get('am') || '';
    const amountMatch = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
    const amountPaise = amountMatch
      ? Number(amountMatch[1]) * 100 + Number((amountMatch[2] || '').padEnd(2, '0'))
      : null;
    return intent.protocol === 'upi:' && intent.hostname === 'pay' && !intent.username && !intent.password
      && !intent.pathname && !intent.hash
      && intent.searchParams.getAll('pa').length === 1 && /^[\w.-]{2,256}@[\w.-]{2,64}$/.test(payee)
      && intent.searchParams.getAll('am').length === 1 && Number.isSafeInteger(amountPaise)
      && (expectedAmount === undefined || amountPaise === expectedAmount)
      && intent.searchParams.getAll('cu').length === 1 && intent.searchParams.get('cu') === 'INR'
      && intent.searchParams.getAll('tr').length === 1 && Boolean(intent.searchParams.get('tr'));
  } catch {
    return false;
  }
}

function isMobileDevice(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

type AddressValues = { name: string; addressLine1: string; addressLine2: string; city: string; state: string; country: string; postalCode: string; phone: string };
const emptyAddress: AddressValues = { name: '', addressLine1: '', addressLine2: '', city: '', state: '', country: 'India', postalCode: '', phone: '' };

function AddressFields({ section, value, onChange, readOnly = false }: { section: 'billing' | 'shipping'; value: AddressValues; onChange: (value: AddressValues) => void; readOnly?: boolean }) {
  const [regions, setRegions] = useState<Awaited<ReturnType<typeof regionsForCountry>> | null>(null);
  const [regionError, setRegionError] = useState('');
  const bind = (field: keyof AddressValues) => ({ name: `${section}-${field}`, value: value[field], readOnly, onChange: (event: ChangeEvent<HTMLInputElement>) => onChange({ ...value, [field]: event.target.value }) });
  useEffect(() => {
    let active = true;
    setRegions(null);
    setRegionError('');
    void regionsForCountry(value.country).then((result) => {
      if (active) setRegions(result);
    }).catch((error: unknown) => {
      if (!active) return;
      setRegionError(error instanceof Error ? error.message : 'Could not load address regions');
    });
    return () => { active = false; };
  }, [value.country]);
  return <>
    <label>Full name<input {...bind('name')} autoComplete={`${section} name`} maxLength={100} required /></label>
    <label>Address line 1<input {...bind('addressLine1')} autoComplete={`${section} address-line1`} maxLength={180} required /></label>
    <label>Address line 2 <span>Optional</span><input {...bind('addressLine2')} autoComplete={`${section} address-line2`} maxLength={180} /></label>
    <label>Country<select name={`${section}-country`} value={value.country} disabled={readOnly} onChange={(event) => onChange({ ...value, country: event.target.value, state: '', postalCode: '' })} required>{countries.map((country) => <option key={country.isoCode} value={country.name}>{country.name}</option>)}</select></label>
    <div className="address-row"><label>City<input {...bind('city')} autoComplete={`${section} address-level2`} maxLength={80} required /></label><label>State / region<select name={`${section}-state`} value={value.state} disabled={readOnly || regions === null || !regions.length} onChange={(event) => onChange({ ...value, state: event.target.value })} required={Boolean(regions?.length)}><option value="">{regions === null ? 'Loading regions…' : regions.length ? 'Select a state or region' : 'Not applicable'}</option>{regions?.map((region) => <option key={region.isoCode} value={region.name}>{region.name}</option>)}</select></label></div>
    {regionError && <p className="payment-config-warning" role="alert">{regionError}</p>}
    <div className="address-row"><label>{value.country === 'India' ? 'PIN code' : 'Postal code'}<input {...bind('postalCode')} inputMode={value.country === 'India' ? 'numeric' : 'text'} autoComplete={`${section} postal-code`} pattern={value.country === 'India' ? '[1-9][0-9]{5}' : undefined} maxLength={value.country === 'India' ? 6 : 20} required /></label><label>Phone<input {...bind('phone')} type="tel" inputMode="tel" autoComplete={`${section} tel`} pattern="\+?[0-9][0-9\s-]{8,16}" maxLength={18} required /></label></div>
  </>;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let result: T;
  try {
    result = JSON.parse(text) as T;
  } catch {
    throw new Error(response.ok ? 'The server returned an unreadable response' : `Request failed (${response.status})`);
  }
  return result;
}
export default function App() {
  const cartDrawer = useRef<HTMLElement>(null);
  const pendingPaymentStorageKey = 'ahuzah.pendingPayment';
  const [payuPaymentLink, setPayuPaymentLink] = useState(FIXED_PAYU_PAYMENT_LINK);
  useEffect(() => {
    fetch('/api/payments/config')
      .then(async (response) => {
        if (!response.ok) return;
        const config = await response.json() as { paymentLink?: unknown };
        if (typeof config.paymentLink === 'string' && config.paymentLink.startsWith('https://u.payu.in/')) setPayuPaymentLink(config.paymentLink);
      })
      .catch(() => undefined);
  }, []);
  const [exchangeRate, setExchangeRate] = useState<{ usdPerInr: number; date: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      fetch('/api/exchange-rate', { signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error('USD estimate unavailable');
        const rate: { usdPerInr: number; date: string } = await response.json();
        setExchangeRate(rate);
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) { setExchangeRate(null); console.error('USD estimate unavailable:', error); }
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 3600000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);
  const usdEstimate = (price: number) => exchangeRate
    ? `Approx. ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(price * exchangeRate.usdPerInr)} USD · rate ${exchangeRate.date} · charged in INR`
    : 'USD estimate unavailable · charged in INR';
  const [storeContent, setStoreContent] = useState<StorefrontContent>({
    announcement: 'A softer kind of everyday Complimentary shipping over ₹2,500',
    heroEyebrow: 'The in-between collection · 01/26', heroTitle: 'Room to be yourself',
    heroDescription: 'Thoughtful layers for all the ways a day can unfold',
    heroImageUrl: 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=2200&q=85',
    storyHeading: 'Wear what feels like you',
    storyBody: 'We make pieces to live in, not just look at Easy silhouettes, tactile fabrics, and the quiet confidence of getting dressed without overthinking it',
    storyImageUrl: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1200&q=85',
    copy: defaultStorefrontCopy,
  });
  const [products, setProducts] = useState<Product[]>([]);
  const [routePath, setRoutePath] = useState(window.location.pathname);
  const seoRouteInitialized = useRef(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [notice, setNotice] = useState('');
  const [cartOpen, setCartOpen] = useState(false);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountPageOpen, setAccountPageOpen] = useState(false);
  const [accountPageSection, setAccountPageSection] = useState<'profile' | 'orders'>('profile');
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [reviewBusy, setReviewBusy] = useState('');
  const [reviewMessages, setReviewMessages] = useState<Record<string, string>>({});
  const [paymentOrder, setPaymentOrder] = useState<PaymentOrder | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(pendingPaymentStorageKey) || localStorage.getItem('ahuza.pendingPayment') || 'null') as PaymentOrder | null;
      const returnedId = window.location.pathname === '/order-success' ? new URLSearchParams(window.location.search).get('order') : null;
      if (returnedId && saved?.orderId !== returnedId) return null;
      return saved?.paymentMethod === 'upi' && saved.orderId ? saved : null;
    } catch { return null; }
  });
  const [paymentStatus, setPaymentStatus] = useState(paymentOrder ? 'checking' : 'pending');
  const [paymentOrderStatus, setPaymentOrderStatus] = useState('');
  const [ordersRefresh, setOrdersRefresh] = useState(0);
  const [returnedPaymentId, setReturnedPaymentId] = useState(() => window.location.pathname === '/order-success' ? new URLSearchParams(window.location.search).get('order') : null);
  const [paymentRecoveryMessage, setPaymentRecoveryMessage] = useState('');
  const [paymentLaunchError, setPaymentLaunchError] = useState('');
  const [payuPaymentIssue, setPayuPaymentIssue] = useState<'initiation_failed' | 'provider_failed' | null>(null);
  const [payuQr, setPayuQr] = useState<{ orderId: string; value: string; expiresAt: string } | null>(null);
  const [paymentMessage, setPaymentMessage] = useState('');
  const [paymentSignInRequired, setPaymentSignInRequired] = useState(false);
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
  const [paymentProofPreview, setPaymentProofPreview] = useState('');
  const [paymentProofSubmitted, setPaymentProofSubmitted] = useState(false);
  const [paymentProofBusy, setPaymentProofBusy] = useState(false);
  const [paymentProofError, setPaymentProofError] = useState('');
  const [orderSuccessPage, setOrderSuccessPage] = useState(window.location.pathname === '/order-success');
  const [checkoutError, setCheckoutError] = useState('');
  const [sitePublished, setSitePublished] = useState<boolean | null>(null);
  const [shippingChargeAmount, setShippingChargeAmount] = useState<number | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);
  const [billingAddress, setBillingAddress] = useState<AddressValues>(emptyAddress);
  const [deliveryAddress, setDeliveryAddress] = useState<AddressValues>(emptyAddress);
  const [sameAsBilling, setSameAsBilling] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [savedUpiId, setSavedUpiId] = useState<string | null>(null);
  const [upiSavingAvailable, setUpiSavingAvailable] = useState(true);
  const [accountUpiInput, setAccountUpiInput] = useState('');
  const [accountUpiMessage, setAccountUpiMessage] = useState('');
  const [newsletterBusy, setNewsletterBusy] = useState(false);
  const [newsletterMessage, setNewsletterMessage] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'upi' | 'cod'>('upi');
  const [ownerStudioOpen, setOwnerStudioOpen] = useState(false);
  const [imageSettings, setImageSettings] = useState<ImageSettings>(defaultImageSettings);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [sharingMessage, setSharingMessage] = useState('');
  const [detailIndex, setDetailIndex] = useState(0);
  const [cardView, setCardView] = useState<Record<string, number>>({});
  const [selectedSize, setSelectedSize] = useState('');
  const [zoomed, setZoomed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [megaOpen, setMegaOpen] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedSizeFilter, setSelectedSizeFilter] = useState('All');
  const [sortOrder, setSortOrder] = useState<'recommended' | 'newest' | 'price-low' | 'price-high'>('recommended');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(12);
  const cartCount = cart.reduce((count, item) => count + item.quantity, 0);
  const cartLines = cart.map((line) => ({ ...line, product: products.find((product) => product.id === line.productId) })).filter((line): line is CartLine & { product: Product } => Boolean(line.product));
  const cartTotal = cartLines.reduce((total, line) => total + line.product.price * line.quantity, 0);
  const storefrontText = (id: StorefrontCopyId) => storeContent.copy?.[id] ?? defaultStorefrontCopy[id];
  const estimatedShipping = shippingChargeAmount === null ? null : shippingForSubtotal(Math.round(cartTotal * 100), shippingChargeAmount);
  const looseText = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/s$/, '');
  const categories = ['All', ...Array.from(new Set(products.map((product) => product.category)))];
  const sizes = ['All', ...Array.from(new Set(products.flatMap((product) => product.sizes || [])))];
  const matchingProducts = products.filter((product) => {
    const term = looseText(searchTerm);
    const searchable = looseText(`${product.name} ${product.category} ${product.description} ${product.ghostMannequin?.tags?.join(' ') || ''}`);
    return (!term || searchable.includes(term))
      && (selectedCategory === 'All' || product.category === selectedCategory)
      && (selectedSizeFilter === 'All' || product.sizes?.includes(selectedSizeFilter))
      && (!minPrice || product.price >= Number(minPrice))
      && (!maxPrice || product.price <= Number(maxPrice))
      && (!inStockOnly || productIsPurchasable(product))
      && (!savedOnly || wishlist.includes(product.id));
  }).sort((a, b) => sortOrder === 'price-low' ? a.price - b.price : sortOrder === 'price-high' ? b.price - a.price : sortOrder === 'newest' ? b.id.localeCompare(a.id) : 0);
  const resetFilters = () => { setSelectedCategory('All'); setSelectedSizeFilter('All'); setSearchTerm(''); setMinPrice(''); setMaxPrice(''); setInStockOnly(false); setSavedOnly(false); };
  const openCollection = (category: string, size: string) => {
    setSelectedCategory(category); setSelectedSizeFilter(size); setSearchTerm(''); setMobileMenuOpen(false); setCatalogOpen(true);
    window.setTimeout(() => document.querySelector('#shop')?.scrollIntoView({ behavior: 'smooth' }), 0);
  };
  const navItems = ['Women', 'Men', 'Kurtis', 'Frocks', 'Kurta Sets', 'Lehengas', 'Night Suits', 'Track Suits', 'New Arrivals', 'Bestsellers', 'Sale'];
  const megaItems = ['Women', 'Men', 'Sale'];
  const showAllLabels = ['Women', 'New Arrivals', 'Bestsellers', 'Sale'];
  const productsForNavItem = (label: string) => {
    if (showAllLabels.includes(label)) return products;
    if (label === 'Men') return products.filter((product) => /\bmen('s)?\b/i.test(`${product.name} ${product.category}`));
    const term = looseText(label);
    return products.filter((product) => looseText(`${product.name} ${product.category}`).includes(term));
  };
  const openNavItem = (label: string) => {
    setMegaOpen(null);
    if (label === 'New Arrivals') setSortOrder('newest');
    openCollection('All', 'All');
    if (!showAllLabels.includes(label)) setSearchTerm(label === 'Men' ? 'Men' : label);
  };
  const circleFallbacks = ['photo-1515886657613-9f3515b0c78f', 'photo-1483985988355-763728e1935b', 'photo-1469334031218-e382a71b716b', 'photo-1539109136881-3be0616acf4b'];
  const circleItems = navItems.filter((label) => productsForNavItem(label).length > 0).map((label, position) => {
    const product = productsForNavItem(label)[0];
    const image = storeContent.circleImages?.[label] || (product ? (galleryImages(product)[0]?.url || product.imageUrl) : `https://images.unsplash.com/${circleFallbacks[position % circleFallbacks.length]}?auto=format&fit=crop&w=400&h=400&q=70`);
    return { label, image, display: storeContent.circleLabels?.[label] || label };
  });
  const bannerSlides: BannerSlide[] = [
    { id: 'collection', eyebrow: storeContent.heroEyebrow, title: storeContent.heroTitle, description: storeContent.heroDescription, cta: 'Shop the collection', desktopImage: storeContent.heroImageUrl, onSelect: () => openCollection('All', 'All') },
    { id: 'new', eyebrow: storefrontText('newBannerEyebrow'), title: storefrontText('newBannerTitle'), description: storefrontText('newBannerDescription'), cta: storefrontText('newBannerCta'), desktopImage: storeContent.bannerImages?.new || 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=2200&q=80', mobileImage: storeContent.bannerImages?.new || 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&h=1100&q=80', onSelect: () => openNavItem('New Arrivals') },
    { id: 'sale', eyebrow: storefrontText('saleBannerEyebrow'), title: storefrontText('saleBannerTitle'), description: storefrontText('saleBannerDescription'), cta: storefrontText('saleBannerCta'), desktopImage: storeContent.bannerImages?.sale || 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=2200&q=80', mobileImage: storeContent.bannerImages?.sale || 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&h=1100&q=80', onSelect: () => openNavItem('Sale') },
    { id: 'festive', eyebrow: storefrontText('festiveBannerEyebrow'), title: storefrontText('festiveBannerTitle'), description: storefrontText('festiveBannerDescription'), cta: storefrontText('festiveBannerCta'), desktopImage: storeContent.bannerImages?.festive || 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?auto=format&fit=crop&w=2200&q=80', mobileImage: storeContent.bannerImages?.festive || 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?auto=format&fit=crop&w=900&h=1100&q=80', onSelect: () => openNavItem('Kurta Sets') },
  ];
  const shownProducts = matchingProducts.slice(0, visibleCount);
  const newArrivals = products.slice().sort((a, b) => b.id.localeCompare(a.id)).slice(0, 12);
  const readyToShip = products.filter(productIsPurchasable).slice(0, 12);

  useEffect(() => { setVisibleCount(12); }, [searchTerm, selectedCategory, selectedSizeFilter, sortOrder, minPrice, maxPrice, inStockOnly, savedOnly]);

  useEffect(() => {
    fetch('/api/site-status')
      .then(async (response) => {
        const result = await parseResponse<{ published?: boolean; error?: string }>(response);
        if (!response.ok || typeof result.published !== 'boolean') throw new Error(result.error || 'Could not check storefront status');
        setSitePublished(result.published);
      })
      .catch(() => setSitePublished(false));

    fetch('/api/products')
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load the collection');
        const data = await response.json() as { products: Product[] };
        setProducts(data.products);
      })
      .catch(() => setNotice('The collection is taking a moment Refresh to try again'));

    fetch('/api/storefront', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load storefront content');
        const data = await response.json() as { content: StorefrontContent; imageSettings?: ImageSettings; shippingChargeAmount?: number };
        if (typeof data.shippingChargeAmount !== 'number' || !Number.isSafeInteger(data.shippingChargeAmount) || data.shippingChargeAmount < 0 || data.shippingChargeAmount > maxShippingCharge) throw new Error('Shipping charge unavailable');
        setStoreContent(data.content);
        setShippingChargeAmount(data.shippingChargeAmount);
        if (data.imageSettings) setImageSettings(data.imageSettings);
      })
      .catch(() => setNotice('Shipping information is unavailable. Refresh to try again.'));

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
      if (!product || !productIsPurchasable(product)) return [];
      return [{ ...line, quantity: Math.min(line.quantity, product.stock, 10) }];
    }));
  }, [products]);

  useEffect(() => {
    if (sitePublished !== true) { setDetailProduct(null); return; }
    const product = products.find((entry) => routePath === productPath(entry));
    const category = products.find((entry) => routePath === `/collections/${encodeURIComponent(entry.category)}`)?.category;
    setDetailProduct(product || null);
    setDetailIndex(0);
    setSelectedSize('');
    setZoomed(false);
    setSharingMessage('');
    if (category) {
      setSelectedCategory(category);
      setCatalogOpen(true);
      window.setTimeout(() => document.querySelector('#shop')?.scrollIntoView(), 0);
    }
  }, [products, sitePublished, routePath]);

  useEffect(() => {
    if (!seoRouteInitialized.current) { seoRouteInitialized.current = true; return; }
    const controller = new AbortController();
    void fetch(routePath, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(`SEO page returned ${response.status}`);
      const page = new DOMParser().parseFromString(await response.text(), 'text/html');
      const markers = (head: HTMLHeadElement) => {
        const walker = document.createTreeWalker(head, NodeFilter.SHOW_COMMENT);
        let start: Node | null = null;
        let end: Node | null = null;
        while (walker.nextNode()) {
          if (walker.currentNode.textContent?.trim() === 'SEO_START') start = walker.currentNode;
          if (walker.currentNode.textContent?.trim() === 'SEO_END') { end = walker.currentNode; break; }
        }
        return { start, end };
      };
      const source = markers(page.head);
      const target = markers(document.head);
      if (!source.start || !source.end || !target.start || !target.end) throw new Error('SEO markers are missing');
      const range = document.createRange();
      range.setStartAfter(target.start);
      range.setEndBefore(target.end);
      range.deleteContents();
      let node = source.start.nextSibling;
      while (node && node !== source.end) {
        target.end.parentNode!.insertBefore(document.importNode(node, true), target.end);
        node = node.nextSibling;
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) console.error('Could not update page metadata:', error);
    });
    return () => controller.abort();
  }, [routePath]);

  // Recheck the order after returning from the payment app or reloading the confirmation.
  useEffect(() => {
    try {
      if (paymentOrder?.paymentMethod === 'upi') localStorage.setItem(pendingPaymentStorageKey, JSON.stringify(paymentOrder));
      else localStorage.removeItem(pendingPaymentStorageKey);
    } catch { /* storage unavailable */ }
  }, [paymentOrder]);

  useEffect(() => {
    if (paymentOrder) setCartOpen(true);
  }, []);

  useEffect(() => {
    if (!returnedPaymentId || paymentOrder?.orderId === returnedPaymentId) return;
    const controller = new AbortController();
    setCartOpen(true);
    setPaymentRecoveryMessage('Checking your payment. Please do not pay again if money was debited.');
    fetch(`/api/orders/${encodeURIComponent(returnedPaymentId)}`, { signal: controller.signal }).then(async (response) => {
      if (response.status === 401) {
        setAuthMode('login');
        setAccountOpen(true);
        setPaymentRecoveryMessage('Sign in with the account used for this order to check your payment.');
        return;
      }
      const result = await parseResponse<{ order?: { id: string; amount: number; currency: string; paymentMethod?: string; payuTxnId?: string; payuCheckoutMode?: 'qr'; paymentReference?: string; reservationExpiresAt?: string; items: { name: string; quantity: number; size?: string }[] }; error?: string }>(response);
      if (!response.ok || !result.order || result.order.id !== returnedPaymentId || result.order.paymentMethod !== 'upi' || !result.order.payuTxnId) {
        throw new Error(result.error || 'Could not find this PayU order. Contact AHUZAH if money was debited.');
      }
      const order = result.order;
      setPaymentOrder({ orderId: order.id, paymentMethod: 'upi', provider: 'payu', checkoutMode: order.payuCheckoutMode, amount: order.amount, currency: order.currency, paymentReference: order.paymentReference, expiresAt: order.reservationExpiresAt, items: order.items });
      setPaymentStatus('checking');
      setPaymentSignInRequired(false);
      setPaymentRecoveryMessage('');
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      console.error('PayU order recovery failed:', error);
      setPaymentRecoveryMessage(error instanceof Error ? error.message : 'Could not recover your PayU order. Contact AHUZAH if money was debited.');
    });
    return () => controller.abort();
  }, [returnedPaymentId, paymentOrder?.orderId, customer]);

  useEffect(() => {
    if (!paymentOrder || paymentOrder.checkoutMode !== 'qr' || paymentSignInRequired || payuPaymentIssue
      || !['checking', 'pending', 'failed'].includes(paymentStatus)) return;
    let stopped = false;
    let timer = 0;
    setPayuQr(null);
    setPaymentLaunchError('');
    const load = async () => {
      try {
        const response = await fetch(`/api/payments/orders/${encodeURIComponent(paymentOrder.orderId)}/qr`, { method: 'POST' });
        if (stopped) return;
        if (response.status === 401) { requirePaymentSignIn(); return; }
        const result = await parseResponse<{ qr?: string; expiresAt?: string; intentUri?: string; pending?: boolean; error?: string }>(response);
        if (response.status === 202 && result.pending) { timer = window.setTimeout(() => void load(), 2000); return; }
        if (response.ok && result.intentUri && isPayUIntentUri(result.intentUri, paymentOrder.amount)) {
          setPaymentOrder((current) => current ? { ...current, checkoutMode: 'intent', intentUri: result.intentUri } : current);
          if (isMobileDevice()) window.location.assign(result.intentUri);
          return;
        }
        if (!response.ok || !result.qr || !result.expiresAt) throw new Error(result.error || 'Could not load the PayU QR');
        setPayuQr({ orderId: paymentOrder.orderId, value: result.qr, expiresAt: result.expiresAt });
        timer = window.setTimeout(() => {
          setPayuQr(null);
          setPaymentLaunchError('This QR has expired. Do not pay again if money was debited; contact AHUZAH.');
        }, Math.max(0, Date.parse(result.expiresAt) - Date.now()));
      } catch (error) {
        if (!stopped) {
          console.error('PayU QR checkout failed:', error);
          setPaymentLaunchError(error instanceof Error ? error.message : 'Could not load the PayU QR');
          setPayuPaymentIssue('initiation_failed');
        }
      }
    };
    void load();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [paymentOrder?.orderId, paymentOrder?.checkoutMode, paymentSignInRequired, paymentStatus, payuPaymentIssue]);

  useEffect(() => {
    if (paymentOrder && cartOpen) cartDrawer.current?.scrollTo({ top: 0 });
  }, [paymentOrder?.orderId, cartOpen]);

  useEffect(() => {
    if (!paymentOrder || paymentSignInRequired || !['checking', 'pending', 'failed', 'cancelled', 'expired'].includes(paymentStatus)) return;
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      try {
        const response = await fetch(`/api/payments/orders/${encodeURIComponent(paymentOrder.orderId)}/status`);
        if (stopped) return;
        if (response.status === 401) {
          stopped = true;
          window.clearTimeout(timer);
          requirePaymentSignIn();
          return;
        }
        if (response.status === 404) {
          stopped = true;
          window.clearTimeout(timer);
          requirePaymentSignIn(true);
          return;
        }
        const result = await parseResponse<{ status?: string; orderStatus?: string; paymentProofSubmitted?: boolean; payuPaymentIssue?: 'initiation_failed' | 'provider_failed'; error?: string }>(response);
        if (!response.ok || !result.status) throw new Error(result.error || 'Could not check order status');
        if (stopped) return;
        setPaymentStatus(result.status);
        if (result.payuPaymentIssue || result.status === 'paid') setPayuPaymentIssue(result.payuPaymentIssue || null);
        if (result.orderStatus) setPaymentOrderStatus(result.orderStatus);
        setPaymentProofSubmitted(result.paymentProofSubmitted === true);
        if (result.status === 'paid') {
          setCart([]);
          setOrdersRefresh((value) => value + 1);
          setPaymentMessage(result.orderStatus === 'cancelled'
            ? 'Your payment was received, but the order could not be confirmed because stock is unavailable. AHUZAH will contact you about the next steps.'
            : 'Your payment has been received and your order is confirmed. A confirmation email with your invoice is on its way');
        } else if (result.status === 'expired' || result.status === 'cancelled') {
          setPaymentMessage(result.orderStatus === 'pending_payment'
            ? 'The UPI attempt was cancelled Inventory remains reserved briefly in case a bank credit is delayed Do not reuse the link; contact AHUZAH if you sent money'
            : 'This order is closed or expired Do not use its old UPI payment link Contact AHUZAH if you already sent a payment');
          if (result.orderStatus === 'pending_payment' || result.paymentProofSubmitted) timer = window.setTimeout(() => void poll(), 2500);
        } else if (result.status === 'failed') {
          setPaymentMessage(result.payuPaymentIssue === 'provider_failed'
            ? 'PayU reports that this payment failed. If money was debited, contact AHUZAH with the bank reference.'
            : result.payuPaymentIssue === 'initiation_failed'
              ? 'The payment request could not be started. Its outcome may be uncertain; contact AHUZAH before trying again.'
              : 'The UPI attempt was reported as failed; this is not bank verification If money was debited, contact AHUZAH with the bank reference before retrying');
          timer = window.setTimeout(() => void poll(), 2500);
        } else {
          setPaymentMessage(paymentOrder.provider === 'payu'
            ? 'Payment is pending. Your order will be confirmed after PayU verifies the payment.'
            : 'Payment is pending. AHUZAH will confirm only after the bank credit is checked.');
          timer = window.setTimeout(() => void poll(), 2500);
        }
      } catch (error) {
        if (!stopped) {
          setPaymentMessage(error instanceof Error ? error.message : 'Could not refresh the order status');
          timer = window.setTimeout(() => void poll(), 2500);
        }
      }
    };
    void poll();
    // Browsers throttle timers while the customer is in their UPI app, so re-check the moment they return.
    const recheck = () => {
      if (document.visibilityState === 'hidden' || stopped) return;
      window.clearTimeout(timer);
      void poll();
    };
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    window.addEventListener('pageshow', recheck);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('focus', recheck);
      window.removeEventListener('pageshow', recheck);
    };
  }, [paymentOrder, paymentStatus, paymentSignInRequired, paymentProofSubmitted]);

  useEffect(() => {
    if (!paymentProofFile) { setPaymentProofPreview(''); return; }
    const preview = URL.createObjectURL(paymentProofFile);
    setPaymentProofPreview(preview);
    return () => URL.revokeObjectURL(preview);
  }, [paymentProofFile]);

  useEffect(() => {
    const updateRoute = () => {
      setOrderSuccessPage(window.location.pathname === '/order-success');
      setRoutePath(window.location.pathname);
    };
    window.addEventListener('popstate', updateRoute);
    return () => window.removeEventListener('popstate', updateRoute);
  }, []);

  useEffect(() => {
    if (!paymentOrder || paymentStatus !== 'paid' || paymentOrderStatus === 'cancelled') return;
    if (window.location.pathname !== '/order-success') window.history.pushState({ paymentSuccess: true }, '', '/order-success');
    setRoutePath(window.location.pathname);
    setOrderSuccessPage(true);
  }, [paymentOrder?.orderId, paymentStatus, paymentOrderStatus]);

  useEffect(() => {
    if (!customer) { setSavedUpiId(null); setAccountUpiInput(''); return; }
    fetch('/api/account/upi').then(async (response) => {
      const result = await parseResponse<{ upiId?: string | null; available?: boolean }>(response);
      if (!response.ok) return;
      setSavedUpiId(result.upiId || null);
      setAccountUpiInput(result.upiId || '');
      setUpiSavingAvailable(result.available !== false);
    }).catch(() => undefined);
  }, [customer]);

  useEffect(() => {
    if (!accountOpen || !customer) return;
    const controller = new AbortController();
    setOrdersLoading(true);
    setOrdersError('');
    fetch('/api/orders', { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { orders?: CustomerOrder[]; error?: string };
        if (!response.ok || !result.orders) throw new Error(result.error || 'Could not load your order history');
        setOrders(result.orders);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setOrdersError(error instanceof Error ? error.message : 'Could not load your order history');
      })
      .finally(() => { if (!controller.signal.aborted) setOrdersLoading(false); });
    return () => controller.abort();
  }, [accountOpen, customer, ordersRefresh]);

  useEffect(() => {
    if (!accountPageOpen || accountPageSection !== 'orders' || !customer) return;
    window.requestAnimationFrame(() => document.querySelector('#order-history-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [accountPageOpen, accountPageSection, customer]);

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
      setNotice('Create an account or log in to save your wishlist');
      window.setTimeout(() => setNotice(''), 3000);
      return;
    }
    const saved = wishlist.includes(product.id);
    const response = await fetch(`/api/wishlist/${encodeURIComponent(product.id)}`, { method: saved ? 'DELETE' : 'PUT' }).catch(() => null);
    if (response?.ok) {
      setWishlist(((await response.json()) as { productIds: string[] }).productIds);
      setNotice(saved ? `${product.name} removed from your wishlist` : `${product.name} saved to your wishlist`);
    } else setNotice('Could not update your wishlist Please try again');
    window.setTimeout(() => setNotice(''), 2400);
  }

  async function requestRestockAlert(product: Product) {
    if (!customer) {
      setAuthMode('signup');
      setAccountOpen(true);
      setNotice('Create an account or sign in to get a restock email');
      window.setTimeout(() => setNotice(''), 3500);
      return;
    }
    try {
      const response = await fetch(`/api/products/${encodeURIComponent(product.id)}/stock-alert`, { method: 'POST' });
      const result = await response.json() as { error?: string; alreadySubscribed?: boolean; emailConfigured?: boolean };
      if (!response.ok) throw new Error(result.error || 'Could not save your restock alert');
      setNotice(result.alreadySubscribed
        ? `You're already signed up for a ${product.name} restock alert`
        : result.emailConfigured
          ? `We'll email you when ${product.name} is back in stock`
          : `Restock alert saved for ${product.name} Email sending is not configured yet`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save your restock alert');
    }
    window.setTimeout(() => setNotice(''), 4000);
  }

  function openProduct(product: Product) {
    const path = productPath(product);
    if (window.location.pathname !== path) {
      window.history.pushState({ productReturnUrl: window.location.pathname + window.location.search + window.location.hash }, '', path);
      setRoutePath(path);
    }
    setDetailProduct(product);
    setDetailIndex(0);
    setSelectedSize('');
    setZoomed(false);
    setSharingMessage('');
  }

  function closeProduct() {
    const returnUrl = window.history.state?.productReturnUrl;
    const destination = typeof returnUrl === 'string' && returnUrl.startsWith('/') && !returnUrl.startsWith('//') ? returnUrl : '/';
    window.history.pushState({}, '', destination);
    setRoutePath(window.location.pathname);
    setDetailProduct(null);
  }

  async function handleProductSharing(product: Product, action: 'copy' | 'share') {
    setSharingMessage('');
    try {
      if (action === 'copy') {
        await copyProductLink(product, window.location.origin, navigator);
        setSharingMessage('Product link copied.');
      } else {
        await shareProduct(product, window.location.origin, navigator);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setSharingMessage(error instanceof Error ? error.message : 'Could not share this product. Please try again.');
    }
  }

  function addToBag(product: Product, size?: string) {
    if (product.sizes?.length && !size) {
      openProduct(product);
      setNotice('Choose an available size before adding this item to your bag');
      window.setTimeout(() => setNotice(''), 3000);
      return;
    }
    if (!productIsPurchasable(product)) {
      setNotice(`${product.name} is sold out`);
      window.setTimeout(() => setNotice(''), 3000);
      return;
    }
    const maxQuantity = Math.min(product.stock, 10);
    const currentQuantity = cart.reduce((total, line) => line.productId === product.id ? total + line.quantity : total, 0);
    if (currentQuantity >= maxQuantity) {
      setNotice(`You can add up to ${maxQuantity} of ${product.name}`);
      return;
    }
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id && line.size === size);
      return existing
        ? current.map((line) => line.productId === product.id && line.size === size ? { ...line, quantity: Math.min(line.quantity + 1, maxQuantity) } : line)
        : [...current, { productId: product.id, quantity: 1, ...(size ? { size } : {}) }];
    });
    setNotice(`${product.name}${size ? ` · Size ${size}` : ''} added to your cart`);
    window.setTimeout(() => setNotice(''), 2400);
  }

  function changeQuantity(productId: string, size: string | undefined, change: number) {
    const product = products.find((entry) => entry.id === productId);
    if (!product) return;
    const currentQuantity = cart.reduce((total, line) => line.productId === productId ? total + line.quantity : total, 0);
    if (change > 0 && !productIsPurchasable(product)) {
      setNotice(`${product.name} is sold out`);
      window.setTimeout(() => setNotice(''), 3000);
      return;
    }
    const maxQuantity = productIsPurchasable(product) ? Math.min(product.stock, 10) : 0;
    if (change > 0 && currentQuantity >= maxQuantity) {
      setNotice(`You can add up to ${maxQuantity} of ${product.name}`);
      return;
    }
    setCart((current) => current.flatMap((line) => {
      if (line.productId !== productId || line.size !== size) return [line];
      const quantity = Math.min(line.quantity + change, maxQuantity);
      return quantity > 0 ? [{ ...line, quantity }] : [];
    }));
  }

  function removeFromBag(productId: string, size: string | undefined) {
    setCart((current) => current.filter((line) => line.productId !== productId || line.size !== size));
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
      if (!response.ok || !result.customer) throw new Error(result.error || 'Could not sign in');
      setCustomer(result.customer);
      if (paymentSignInRequired) setPaymentStatus('checking');
      setPaymentSignInRequired(false);
      if (!accountPageOpen) setAccountOpen(false);
      setNotice(accountPageOpen ? '' : `Signed in as ${result.customer.email}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  }

  function requirePaymentSignIn(orderNotFound = false) {
    setCustomer(null);
    setPaymentSignInRequired(true);
    setPaymentMessage(orderNotFound
      ? 'This order was not found for the signed-in account. Sign in to the account used for the order, or contact AHUZAH. Do not pay again if money was debited.'
      : 'Sign in to the account used for this order to check its status. Do not pay again if money was debited.');
  }

  async function submitPaymentProof() {
    if (!paymentOrder || !paymentProofFile) return;
    setPaymentProofBusy(true);
    setPaymentProofError('');
    try {
      const response = await fetch(`/api/payments/orders/${encodeURIComponent(paymentOrder.orderId)}/proof`, {
        method: 'POST',
        headers: { 'Content-Type': paymentProofFile.type },
        body: paymentProofFile,
      });
      const result = await parseResponse<{ submitted?: boolean; error?: string }>(response);
      if (response.status === 401) {
        requirePaymentSignIn();
        return;
      }
      if (!response.ok || result.submitted !== true) throw new Error(result.error || 'Could not submit the screenshot');
      setPaymentProofSubmitted(true);
      setPaymentProofFile(null);
      setPaymentMessage('Screenshot submitted for review. AHUZAH will confirm payment only after checking the bank credit. Do not pay again if money was debited.');
      setPaymentStatus((status) => status === 'checking' ? 'pending' : status);
    } catch (error) {
      setPaymentProofError(error instanceof Error ? error.message : 'Could not submit the screenshot');
    } finally {
      setPaymentProofBusy(false);
    }
  }

  async function checkout() {
    setCheckoutError('');
    setPaymentLaunchError('');
    if (estimatedShipping === null) {
      setCheckoutError('Shipping information is unavailable. Refresh to try again.');
      return;
    }
    if (!customer) {
      setAccountOpen(true);
      setCheckoutError('Sign in to continue to checkout.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/payments/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map(({ productId, quantity, size }) => ({ productId, quantity, ...(size ? { size } : {}) })),
          paymentMethod,
          expectedShippingAmount: estimatedShipping,
          marketingConsent,
          shippingAddress: sameAsBilling ? billingAddress : deliveryAddress,
          billingAddress,
        }),
      }).catch((error: unknown) => {
        console.error('Checkout request failed:', error);
        throw new Error('Could not confirm whether your order was created. Check your order history and contact AHUZAH before trying again.');
      });
      const order = await parseResponse<PaymentOrder & { error?: string; shippingChargeAmount?: number; payuPaymentIssue?: 'initiation_failed' }>(response).catch((error: unknown) => {
        console.error('Checkout response was unreadable:', error);
        throw new Error('Could not read the checkout response. Check your order history and contact AHUZAH before trying again.');
      });
      if (response.status === 409 && typeof order.shippingChargeAmount === 'number' && Number.isSafeInteger(order.shippingChargeAmount) && order.shippingChargeAmount >= 0 && order.shippingChargeAmount <= maxShippingCharge) {
        setShippingChargeAmount(order.shippingChargeAmount);
      }
      if (response.status === 401) {
        setCustomer(null);
        setAuthMode('login');
        setAccountOpen(true);
        throw new Error('Your session has expired. Sign in again to continue checkout.');
      }
      if (response.status === 503 && paymentMethod === 'upi' && order.payuPaymentIssue === 'initiation_failed'
        && order.orderId && order.provider === 'payu' && order.paymentMethod === 'upi' && typeof order.amount === 'number') {
        setPaymentOrder(order);
        setPaymentSignInRequired(false);
        setPaymentStatus('failed');
        setPaymentOrderStatus('pending_payment');
        setPayuPaymentIssue('initiation_failed');
        setPaymentLaunchError(order.error || 'Could not start PayU checkout');
        window.history.replaceState({}, '', `/order-success?order=${encodeURIComponent(order.orderId)}`);
        setReturnedPaymentId(order.orderId);
        return;
      }
      if (!response.ok || !order.orderId || order.paymentMethod !== paymentMethod || typeof order.amount !== 'number') {
        throw new Error(`${order.error || 'Could not start checkout'}${order.orderId ? ` Order: ${order.orderId}.` : ''}`);
      }
      if (paymentMethod === 'upi' && (order.provider !== 'payu' || !order.paymentReference
        || (order.checkoutMode !== 'qr' && (order.checkoutMode !== 'intent' || !isPayUIntentUri(order.intentUri, order.amount))))) {
        throw new Error(`The server returned an incomplete PayU payment request. Check order ${order.orderId} and contact AHUZAH before trying again.`);
      }
      setPaymentOrder(order);
      setPayuPaymentIssue(null);
      setPaymentSignInRequired(false);
      setPaymentProofFile(null);
      setPaymentProofSubmitted(false);
      setPaymentProofError('');
      setPaymentStatus(paymentMethod === 'cod' ? 'confirmed' : 'pending');
      setPaymentOrderStatus(paymentMethod === 'cod' ? 'confirmed' : 'pending_payment');
      setPaymentMessage(paymentMethod === 'cod'
        ? 'Your order is confirmed Please pay the delivery partner in cash when your order arrives'
        : 'Your order is awaiting payment. It will be confirmed after PayU verifies the payment.');
      if (paymentMethod === 'cod') setCart([]);
      else {
        window.history.replaceState({}, '', `/order-success?order=${encodeURIComponent(order.orderId)}`);
        setReturnedPaymentId(order.orderId);
        try {
          localStorage.setItem(pendingPaymentStorageKey, JSON.stringify(order));
        } catch (error) {
          console.warn('Payment recovery storage is unavailable; the return link can recover the order:', error);
        }
        if (paymentMethod === 'upi') window.location.assign(payuPaymentLink);
      }
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : 'Could not start checkout. Check your order history before trying again.');
    } finally {
      setBusy(false);
    }
  }

  async function retryPayUCheckout() {
    if (!paymentOrder) return;
    setPaymentLaunchError('');
    setBusy(true);
    try {
      const response = await fetch(`/api/payments/orders/${encodeURIComponent(paymentOrder.orderId)}/checkout`, { method: 'POST' });
      if (response.status === 401) { requirePaymentSignIn(); return; }
      const result = await parseResponse<{ intentUri?: string; error?: string }>(response);
      if (!response.ok || !isPayUIntentUri(result.intentUri, paymentOrder.amount)) throw new Error(result.error || 'Could not open the UPI app');
      setPaymentOrder((current) => current ? { ...current, checkoutMode: 'intent', intentUri: result.intentUri } : current);
      if (isMobileDevice()) window.location.assign(result.intentUri);
    } catch (error) {
      console.error('PayU checkout retry failed:', error);
      setPaymentLaunchError(error instanceof Error ? error.message : 'Could not open the UPI app');
      setPayuPaymentIssue('initiation_failed');
    } finally { setBusy(false); }
  }

  async function refreshPaymentStatus() {
    if (!paymentOrder) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/payments/orders/${encodeURIComponent(paymentOrder.orderId)}/status`);
      if (response.status === 401) {
        requirePaymentSignIn();
        return;
      }
      if (response.status === 404) {
        requirePaymentSignIn(true);
        return;
      }
      const result = await parseResponse<{ status?: string; orderStatus?: string; paymentProofSubmitted?: boolean; payuPaymentIssue?: 'initiation_failed' | 'provider_failed'; error?: string }>(response);
      if (!response.ok || !result.status) throw new Error(result.error || 'Could not refresh order status');
      setPaymentStatus(result.status);
      if (result.payuPaymentIssue || result.status === 'paid') setPayuPaymentIssue(result.payuPaymentIssue || null);
      if (result.orderStatus) setPaymentOrderStatus(result.orderStatus);
      setPaymentProofSubmitted(result.paymentProofSubmitted === true);
      if (result.status === 'paid') {
        setCart([]);
        setOrdersRefresh((value) => value + 1);
      }
      setPaymentMessage(result.status === 'paid' && result.orderStatus === 'cancelled'
        ? 'Your payment was received, but the order could not be confirmed because stock is unavailable. AHUZAH will contact you about the next steps.'
        : result.status === 'paid'
          ? 'Your payment has been received and your order is confirmed. A confirmation email with your invoice is on its way'
        : result.payuPaymentIssue === 'provider_failed'
          ? 'PayU reports that this payment failed. If money was debited, contact AHUZAH with the bank reference.'
        : result.payuPaymentIssue === 'initiation_failed'
          ? 'The payment request could not be started. Its outcome may be uncertain; contact AHUZAH before trying again.'
        : result.status === 'cancelled' || result.status === 'expired'
          ? 'This order is closed Do not use its old UPI link'
          : paymentOrder.provider === 'manual_upi'
            ? 'Payment is pending. AHUZAH must manually verify the settled bank credit. Contact AHUZAH with your bank reference if you have paid.'
            : paymentOrder.provider === 'payu'
              ? 'Payment is still pending. PayU has not confirmed it yet.'
              : 'Payment is still pending.');
    } catch (error) { setPaymentMessage(error instanceof Error ? error.message : 'Could not refresh order status'); }
    finally { setBusy(false); }
  }

  async function cancelPayment() {
    if (!paymentOrder) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/payments/orders/${encodeURIComponent(paymentOrder.orderId)}/cancel`, { method: 'POST' });
      if (response.status === 401) {
        requirePaymentSignIn();
        return;
      }
      const result = await parseResponse<{ status?: string; error?: string }>(response);
      if (!response.ok || result.status !== 'cancelled') throw new Error(result.error || 'Could not safely cancel the payment request');
      setPaymentStatus('cancelled');
      setPaymentMessage('The UPI attempt was cancelled Inventory remains reserved briefly in case a bank credit is delayed Do not reuse the link; contact AHUZAH if you sent money');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not cancel payment request');
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
      if (response.status === 401) {
        requirePaymentSignIn();
        return;
      }
      const result = await parseResponse<{ status?: string; error?: string }>(response);
      if (!response.ok || result.status !== 'failed') throw new Error(result.error || 'Could not update the order');
      setPaymentStatus('failed');
      setPaymentMessage('The failed UPI attempt is recorded, but this does not prove no money was sent Check your bank statement before retrying');
    } catch (error) { setPaymentMessage(error instanceof Error ? error.message : 'Could not update the order'); }
    finally { setBusy(false); }
  }

  async function saveAccountUpi() {
    setBusy(true);
    setAccountUpiMessage('');
    try {
      const response = await fetch('/api/account/upi', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ upiId: accountUpiInput.trim(), consent: true }) });
      const result = await parseResponse<{ upiId?: string; error?: string }>(response);
      if (!response.ok || !result.upiId) throw new Error(result.error || 'Could not save your UPI ID');
      setSavedUpiId(result.upiId);
      setAccountUpiInput(result.upiId);
      setAccountUpiMessage('Your UPI ID is saved');
    } catch (error) { setAccountUpiMessage(error instanceof Error ? error.message : 'Could not save your UPI ID'); }
    finally { setBusy(false); }
  }

  async function deleteAccountUpi() {
    setBusy(true);
    setAccountUpiMessage('');
    try {
      const response = await fetch('/api/account/upi', { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not delete your UPI ID');
      setSavedUpiId(null);
      setAccountUpiInput('');
      setAccountUpiMessage('Your saved UPI ID was deleted');
    } catch (error) { setAccountUpiMessage(error instanceof Error ? error.message : 'Could not delete your UPI ID'); }
    finally { setBusy(false); }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setCustomer(null);
    if (paymentOrder?.paymentMethod === 'upi' && paymentStatus !== 'paid') requirePaymentSignIn();
    setOrders([]);
    setAccountOpen(false);
    setAccountPageOpen(false);
  }

  function openCustomerPage(section: 'profile' | 'orders') {
    setMobileMenuOpen(false);
    setAccountPageSection(section);
    setAuthMode('login');
    setAccountPageOpen(true);
    setAccountOpen(true);
  }

  function closePaymentSuccess() {
    window.history.replaceState({}, '', '/');
    setRoutePath('/');
    setReturnedPaymentId(null);
    setOrderSuccessPage(false);
    setPaymentOrder(null);
    setPaymentStatus('pending');
    setCartOpen(false);
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
      if (!response.ok) throw new Error(result.error || 'Could not subscribe right now');
      form.reset();
      setNewsletterMessage(result.alreadySubscribed ? 'This email is already subscribed to AHUZAH updates' : 'Thank you You are subscribed to AHUZAH updates');
    } catch (error) {
      setNewsletterMessage(error instanceof Error ? error.message : 'Could not subscribe right now Please try again');
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
      if (!response.ok || !result.review) throw new Error(result.error || 'Could not submit your review');
      setOrders((current) => current.map((order) => order.id === orderId ? { ...order, review: result.review } : order));
      setReviewMessages((current) => ({ ...current, [orderId]: 'Thank you for rating your order' }));
    } catch (error) {
      setReviewMessages((current) => ({ ...current, [orderId]: error instanceof Error ? error.message : 'Could not submit your review' }));
    } finally { setReviewBusy(''); }
  }

  async function downloadInvoice(order: CustomerOrder) {
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(order.id)}/invoice`);
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(result.error || 'Could not download this invoice');
      }
      const invoice = await response.blob();
      const url = URL.createObjectURL(invoice);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ahuzah-invoice-${order.id}pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setOrdersError(error instanceof Error ? error.message : 'Could not download this invoice');
    }
  }

  function renderProductCard(product: Product, index: number) {
    const gallery = galleryImages(product);
    const displayImage = gallery[Math.min(cardView[product.id] ?? 0, gallery.length - 1)]!;
    const hoverImage = imageSettings.layout.cardImage === 'hover-second' ? gallery[1] : undefined;
    const displayBackground = product.ghostMannequin?.background || `var(--tone-${index % 4})`;
    const quantityInBag = cart.reduce((total, line) => line.productId === product.id ? total + line.quantity : total, 0);
    const available = productIsPurchasable(product);
    const quantityLimit = available ? Math.min(product.stock, 10) : 0;
    const pricing = productPricing(product.price, product.discountPercent);
    const stockStatus = productStockStatus(product);
    return <article className="product" key={product.id}>
      <div className={`product-image image-tone-${index % 4} ${product.images?.length ? 'has-upload' : ''}`} style={product.images?.length ? undefined : { background: displayBackground }}>
        <a href={productPath(product)} className="product-open" onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); openProduct(product); }} aria-label={`View ${product.name}`}>
          <img src={displayImage.url} srcSet={displayImage.srcSet} sizes="(max-width: 760px) 50vw, 25vw" alt={product.name} loading="lazy" className={product.images?.length ? 'upload-product-image' : 'ghost-product-image'} />
          {hoverImage && <img src={hoverImage.url} srcSet={hoverImage.srcSet} sizes="(max-width: 760px) 50vw, 25vw" alt="" loading="lazy" className="upload-product-image hover-image" />}
        </a>
        <span className="product-number">{String(index + 1).padStart(2, '0')}</span>
        <button className={`wishlist-toggle ${wishlist.includes(product.id) ? 'saved' : ''}`} type="button" onClick={() => void toggleWishlist(product)} aria-pressed={wishlist.includes(product.id)} aria-label={wishlist.includes(product.id) ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`}><Heart size={17} fill={wishlist.includes(product.id) ? 'currentColor' : 'none'} /></button>
        <button className={`quick-add ${!available ? 'notify-stock-button' : ''}`} type="button" onClick={() => !available ? void requestRestockAlert(product) : product.sizes?.length ? openProduct(product) : addToBag(product)} disabled={available && quantityInBag >= quantityLimit} aria-label={!available ? `Notify me when ${product.name} is back in stock` : quantityInBag >= quantityLimit ? `${product.name} quantity limit reached` : product.sizes?.length ? `Choose a size for ${product.name}` : `Add ${product.name} to cart`}>
          {available ? <ShoppingBag size={18} /> : storefrontText('cardNotify')}
        </button>
      </div>
      {gallery.length > 1 && <div className="card-swatches" role="group" aria-label={`${product.name} views`}>{gallery.slice(0, 6).map((image, position) => <button key={image.id} type="button" className={position === (cardView[product.id] ?? 0) ? 'active' : ''} aria-label={`Show view ${position + 1} of ${product.name}`} aria-pressed={position === (cardView[product.id] ?? 0)} onClick={() => setCardView((views) => ({ ...views, [product.id]: position }))}><img src={image.thumb} alt="" loading="lazy" /></button>)}{gallery.length > 6 && <small>+{gallery.length - 6}</small>}</div>}
      <a className="product-meta" href={productPath(product)} onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); openProduct(product); }} aria-label={`View details for ${product.name}`}>
        <span><strong>{product.name}</strong><small>{product.description}</small></span>
        <b className="product-card-price">{pricing && <del>{formatPrice(pricing.mrp)}</del>}{formatPrice(product.price)} <small>{usdEstimate(product.price)}</small>{pricing && <em>{pricing.discountPercent}% OFF</em>}</b>
        {product.sizes?.length ? <em className="card-sizes">Sizes: {product.sizes.join(' · ')}</em> : null}
        {stockStatus === 'sold_out' ? <em className="card-stock out">Sold Out</em> : stockStatus === 'limited_stock' ? <em className="card-stock low">Limited Stock{product.stock ? ` · ${product.stock} left` : ''}</em> : <em className="card-stock">In Stock</em>}
      </a>
    </article>;
  }

  return (
    <main>
      {sitePublished === null ? <section className="store-maintenance"><p className="eyebrow">AHUZAH</p><h1>{storefrontText('statusChecking')}</h1><p>{storefrontText('statusWait')}</p></section> : sitePublished ? <>
      <div className="announcement">{storeContent.announcement}</div>
      <header className="site-header">
        <button className="icon-button mobile-menu" type="button" aria-label="Open women's collection menu" aria-expanded={mobileMenuOpen} aria-controls="collection-drawer" onClick={() => setMobileMenuOpen(true)}><Menu size={22} /></button>
        <nav className="main-nav" id="main-navigation" aria-label="Main navigation" onMouseLeave={() => setMegaOpen(null)} onKeyDown={(event) => { if (event.key === 'Escape') setMegaOpen(null); }}>
          {navItems.map((label) => megaItems.includes(label)
            ? <div className="nav-item" key={label} onMouseEnter={() => setMegaOpen(label)}>
              <button type="button" aria-haspopup="true" aria-expanded={megaOpen === label} onFocus={() => setMegaOpen(label)} onClick={() => openNavItem(label)}>{label}</button>
              {megaOpen === label && <div className="mega-menu" role="region" aria-label={`${label} menu`}>
                <div className="mega-column"><strong>{storefrontText('megaCategoryTitle')}</strong>{categories.slice(1).map((category) => <button key={category} type="button" onClick={() => { setMegaOpen(null); openCollection(category, 'All'); }}>{category}</button>)}</div>
                <div className="mega-column"><strong>{storefrontText('megaFeaturedTitle')}</strong>{['New Arrivals', 'Bestsellers', 'Sale'].map((item) => <button key={item} type="button" onClick={() => openNavItem(item)}>{item}</button>)}</div>
                <button type="button" className="mega-campaign" onClick={() => openNavItem(label === 'Sale' ? 'Sale' : 'New Arrivals')}><img src="https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=600&q=70" alt="" loading="lazy" /><span>{label === 'Sale' ? storefrontText('megaSaleCampaign') : storefrontText('megaNewCampaign')}</span></button>
              </div>}
            </div>
            : <button key={label} type="button" onClick={() => openNavItem(label)}>{label}</button>)}
        </nav>
        <a className="wordmark" href="#home" aria-label="AHUZAH home"><span className="wordmark-mark"><svg className="wordmark-star" viewBox="0 0 120 120" aria-hidden="true"><polygon points="60,4 72,43 114,43 80,68 93,109 60,84 27,109 40,68 6,43 48,43" /></svg><span className="wordmark-sparkles" aria-hidden="true"><i>✦</i><i>✦</i><i>✦</i><i>✦</i><i>✦</i></span><img className="wordmark-logo" src={storeContent.brandLogoUrl || '/ahuzah-logo.svg?v=2'} alt="AHUZAH" /></span></a>
        <form className="header-search" role="search" onSubmit={(event) => { event.preventDefault(); setCatalogOpen(true); document.querySelector('#shop')?.scrollIntoView({ behavior: 'smooth' }); }}>
          <label className="sr-only" htmlFor="header-search-input">Search AHUZAH</label>
          <input id="header-search-input" type="search" value={searchTerm} onChange={(event) => { setSearchTerm(event.target.value); if (event.target.value) setCatalogOpen(true); }} placeholder={storefrontText('searchPlaceholder')} autoComplete="off" />
          {searchTerm && <button type="button" className="header-search-clear" aria-label="Clear search" onClick={() => setSearchTerm('')}><X size={16} /></button>}
          <button type="submit" className="header-search-submit" aria-label="Search"><Search size={18} /></button>
        </form>
        <div className="header-actions"><button className="header-icon chat-link" type="button" aria-label="Ask Ahuzah" onClick={() => window.dispatchEvent(new Event('ahuzah:toggle-support'))}><MessageCircle size={18} /><span className="chat-label">{storefrontText('askAhuzaLabel')}</span></button><button className={`header-icon wishlist-link${savedOnly ? ' active' : ''}`} type="button" aria-label={`Wishlist, ${wishlist.length} saved`} aria-pressed={savedOnly} onClick={() => { if (!customer) { setAuthMode('login'); setAccountOpen(true); return; } setSavedOnly(true); setCatalogOpen(true); document.querySelector('#shop')?.scrollIntoView({ behavior: 'smooth' }); }}><Heart size={18} fill={wishlist.length ? 'currentColor' : 'none'} />{wishlist.length > 0 && <span className="count-badge">{wishlist.length}</span>}</button><button className="account-link" aria-label={customer ? 'My account' : 'Account'} onClick={() => setAccountOpen(true)}><User size={18} aria-hidden="true" /><span>{customer ? 'My account' : 'Account'}</span></button><button className="bag-button" aria-label={`Shopping bag, ${cartCount} items`} onClick={() => setCartOpen(true)}><ShoppingBag size={18} /><span>Bag ({cartCount})</span></button></div>
      </header>
      {mobileMenuOpen && <div className="menu-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setMobileMenuOpen(false); }}>
        <aside className="menu-drawer" id="collection-drawer" role="dialog" aria-modal="true" aria-labelledby="menu-title">
          <div className="menu-drawer-head"><h2 id="menu-title">{storefrontText('menuTitle')}</h2><button type="button" className="icon-button" aria-label="Close menu" onClick={() => setMobileMenuOpen(false)}><X size={22} /></button></div>
          <div className="menu-section">
            <h3>{storefrontText('menuTypeTitle')}</h3>
            <ul>
              <li><button type="button" onClick={() => openCollection('All', 'All')}>{storefrontText('menuAllWear')} <span>{products.length}</span></button></li>
              {categories.slice(1).map((category) => <li key={category}><button type="button" onClick={() => openCollection(category, 'All')}>{category} <span>{products.filter((product) => product.category === category).length}</span></button></li>)}
            </ul>
          </div>
          {sizes.length > 1 && <div className="menu-section">
            <h3>{storefrontText('menuSizeTitle')}</h3>
            <div className="menu-sizes">{sizes.slice(1).map((size) => <button key={size} type="button" onClick={() => openCollection('All', size)}>{size}</button>)}</div>
          </div>}
          {categories.length > 1 && sizes.length > 1 && <div className="menu-section">
            <h3>{storefrontText('menuTypeSizeTitle')}</h3>
            {categories.slice(1).map((category) => {
              const available = Array.from(new Set(products.filter((product) => product.category === category).flatMap((product) => product.sizes || [])));
              return available.length ? <div className="menu-type-sizes" key={category}><strong>{category}</strong><div className="menu-sizes">{available.map((size) => <button key={size} type="button" onClick={() => openCollection(category, size)}>{size}</button>)}</div></div> : null;
            })}
          </div>}
          <div className="menu-section menu-links">
            <button type="button" onClick={() => { setSortOrder('newest'); openCollection('All', 'All'); }}>{storefrontText('menuNewArrivals')}</button>
            <button type="button" onClick={() => openCustomerPage('profile')}>{storefrontText('menuAccount')}</button>
            <button type="button" onClick={() => openCustomerPage('orders')}>{storefrontText('menuOrders')}</button>
            <a href="#contact" onClick={() => setMobileMenuOpen(false)}>{storefrontText('menuContact')}</a>
          </div>
        </aside>
      </div>}
      <nav className="category-strip" aria-label="Shop categories"><button type="button" className={selectedCategory === 'All' && !catalogOpen ? 'active' : ''} onClick={() => { setSelectedCategory('All'); setCatalogOpen(true); }}>{storefrontText('stripShopAll')}</button>{categories.slice(1).map((category) => <button key={category} type="button" className={selectedCategory === category && catalogOpen ? 'active' : ''} onClick={() => { setSelectedCategory(category); setCatalogOpen(true); }}>{category}</button>)}<button type="button" onClick={() => { setSortOrder('newest'); setCatalogOpen(true); document.querySelector('#shop')?.scrollIntoView({ behavior: 'smooth' }); }}>{storefrontText('stripNewArrivals')}</button></nav>

      <HeroCarousel slides={bannerSlides} />

      <section className="promo-tiles" aria-label="Featured">
        <button type="button" onClick={() => { setSortOrder('newest'); openCollection('All', 'All'); }}><span>{storefrontText('newPromoEyebrow')}</span><strong>{storefrontText('newPromoTitle')}</strong><em>{storefrontText('newPromoLink')} <ArrowRight size={14} /></em></button>
        <button type="button" onClick={() => openCollection('All', 'All')}><span>{storefrontText('allPromoEyebrow')}</span><strong>{storefrontText('allPromoTitle')}</strong><em>{storefrontText('allPromoLink')} <ArrowRight size={14} /></em></button>
      </section>

      <ProductRail id="shop-by-category" className="circle-rail" eyebrow={storefrontText('categoryEyebrow')} title={storefrontText('categoryTitle')} linkLabel={storefrontText('categoryLink')} onLink={() => openCollection('All', 'All')}>
        {circleItems.map((item) => <button type="button" className="category-circle" key={item.label} onClick={() => openNavItem(item.label)}>
          <span className="circle-img"><img src={item.image} alt="" loading="lazy" /></span>
          <span className="circle-label">{item.display}</span>
        </button>)}
      </ProductRail>

      {!catalogOpen && <>
        <ProductRail id="new-arrivals" eyebrow={storefrontText('arrivalsEyebrow')} title={storefrontText('arrivalsTitle')} linkLabel={storefrontText('arrivalsLink')} onLink={() => { setSortOrder('newest'); openCollection('All', 'All'); }} style={imageSettingsVars(imageSettings) as CSSProperties}>
          {newArrivals.map((product, index) => renderProductCard(product, index))}
        </ProductRail>
        {readyToShip.length > 0 && <ProductRail id="ready-to-ship" eyebrow={storefrontText('readyEyebrow')} title={storefrontText('readyTitle')} linkLabel={storefrontText('readyLink')} onLink={() => { setInStockOnly(true); openCollection('All', 'All'); }} style={imageSettingsVars(imageSettings) as CSSProperties}>
          {readyToShip.map((product, index) => renderProductCard(product, index))}
        </ProductRail>}
      </>}

      <section className={`collection section-wrap${catalogOpen ? ' catalog-view' : ' is-home-anchor'}`} id="shop">
        <div className="section-heading catalog-heading">
          <div><p className="eyebrow dark-eyebrow">{catalogOpen ? storefrontText('catalogEyebrowShop') : storefrontText('catalogEyebrowHome')}</p><h2>{catalogOpen ? (searchTerm ? `Results for “${searchTerm}”` : selectedCategory === 'All' ? storefrontText('catalogTitleAll') : selectedCategory) : storefrontText('homeNewArrivalsTitle')}</h2></div>
          {!catalogOpen && <button className="text-link" type="button" onClick={() => setCatalogOpen(true)}>Shop all <ArrowUpRight size={15} /></button>}
        </div>
        {catalogOpen && <div className="catalog-toolbar">
          <label className="catalog-search"><Search size={17} /><span className="sr-only">Search products</span><input id="catalog-search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={storefrontText('catalogSearchPlaceholder')} /><button type="button" aria-label="Clear search" onClick={() => setSearchTerm('')}><X size={15} /></button></label>
          <button className="filter-toggle" type="button" onClick={() => setFiltersOpen((open) => !open)}><SlidersHorizontal size={16} /> {storefrontText('catalogFilters')}</button>
          <label className="sort-control">{storefrontText('sortLabel')} <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as typeof sortOrder)}><option value="recommended">{storefrontText('sortRecommended')}</option><option value="newest">{storefrontText('sortNewest')}</option><option value="price-low">{storefrontText('sortPriceLow')}</option><option value="price-high">{storefrontText('sortPriceHigh')}</option></select></label>
        </div>}
        {catalogOpen && <div className={`catalog-filters${filtersOpen ? ' is-open' : ''}`}><label>{storefrontText('filterCategory')}<select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label><label>{storefrontText('filterSize')}<select value={selectedSizeFilter} onChange={(event) => setSelectedSizeFilter(event.target.value)}>{sizes.map((size) => <option key={size}>{size}</option>)}</select></label><label>{storefrontText('filterMinPrice')}<input type="number" inputMode="numeric" min="0" value={minPrice} onChange={(event) => setMinPrice(event.target.value)} placeholder="0" /></label><label>{storefrontText('filterMaxPrice')}<input type="number" inputMode="numeric" min="0" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="Any" /></label><label className="check-filter"><input type="checkbox" checked={inStockOnly} onChange={(event) => setInStockOnly(event.target.checked)} /> {storefrontText('filterInStock')}</label><label className="check-filter"><input type="checkbox" checked={savedOnly} onChange={(event) => setSavedOnly(event.target.checked)} /> {storefrontText('filterSaved')}</label><button type="button" onClick={resetFilters}>{storefrontText('filterClear')}</button></div>}
        {notice && <p className="notice" role="status">{notice}</p>}
        {products.length === 0 && !notice ? <p className="loading">{storefrontText('catalogLoading')}</p> : null}
        {catalogOpen && products.length > 0 && <p className="result-count" role="status" aria-live="polite">{matchingProducts.length} {matchingProducts.length === 1 ? 'product' : 'products'}</p>}
        {catalogOpen && matchingProducts.length === 0 && <div className="empty-catalog"><Search size={24} /><h3>{savedOnly ? storefrontText('savedEmptyTitle') : storefrontText('catalogEmptyTitle')}</h3><p>{savedOnly ? storefrontText('savedEmptyBody') : storefrontText('catalogEmptyBody')}</p><button className="dark-button" type="button" onClick={resetFilters}>{storefrontText('catalogViewAll')}</button></div>}
        <div className="product-grid" style={imageSettingsVars(imageSettings) as CSSProperties}>
          {(catalogOpen ? shownProducts : newArrivals).map((product, index) => renderProductCard(product, index))}
        </div>
        {catalogOpen && matchingProducts.length > visibleCount && <div className="load-more"><button className="dark-button" type="button" onClick={() => setVisibleCount((count) => count + 12)}>Load more ({matchingProducts.length - visibleCount} remaining)</button></div>}
      </section>

      <section className="trust-strip" aria-label="AHUZAH service promises">
        <div><strong>{storefrontText('trustDeliveryTitle')}</strong><span>{storefrontText('trustDeliveryBody')}</span></div>
        <div><strong>{storefrontText('trustCheckoutTitle')}</strong><span>{storefrontText('trustCheckoutBody')}</span></div>
        <div><strong>{storefrontText('trustHelpTitle')}</strong><span>{storefrontText('trustHelpBody')}</span></div>
      </section>

      <section className="contact-section" id="contact">
        <div className="contact-copy">
          <p className="eyebrow">{storefrontText('contactEyebrow')}</p>
          <h2>{storefrontText('contactTitle')}</h2>
          <p>{storefrontText('contactBody')}</p>
        </div>
        <address className="contact-grid">
          <a className="contact-card" href={`mailto:${storefrontText('contactEmail')}`}>
            <Mail className="contact-icon" size={20} aria-hidden="true" />
            <div className="contact-card-copy"><h3>{storefrontText('contactEmailLabel')}</h3><span className="contact-value">{storefrontText('contactEmail')}</span></div>
          </a>
          <a className="contact-card" href={`tel:${storefrontText('contactPhone').replace(/\s+/g, '')}`}>
            <Phone className="contact-icon" size={20} aria-hidden="true" />
          <div className="contact-card-copy"><h3>{storefrontText('contactPhoneLabel')}</h3><span className="contact-value">{storefrontText('contactPhone')}</span></div>
          </a>
          <div className="contact-card">
            <MapPin className="contact-icon" size={20} aria-hidden="true" />
            <div className="contact-card-copy"><h3>{storefrontText('contactLocationLabel')}</h3><span className="contact-value">{storefrontText('contactLocation')}</span></div>
          </div>
        </address>
      </section>

      <section className="newsletter" id="journal"><div><p className="eyebrow">{storefrontText('newsletterEyebrow')}</p><h2>{storefrontText('newsletterTitle')}</h2><p className="newsletter-copy">{storefrontText('newsletterBody')}</p></div><form onSubmit={(event) => void subscribeToNewsletter(event)}><label className="sr-only" htmlFor="newsletter-email">{storefrontText('authEmail')}</label><input id="newsletter-email" name="email" type="email" autoComplete="email" placeholder={storefrontText('newsletterPlaceholder')} maxLength={254} required disabled={newsletterBusy} /><label className="newsletter-consent"><input name="consent" type="checkbox" required disabled={newsletterBusy} /> {storefrontText('newsletterConsent')}</label><button type="submit" disabled={newsletterBusy}>{newsletterBusy ? 'Subscribing…' : storefrontText('newsletterSubmit')} <ArrowRight size={16} /></button>{newsletterMessage && <p className="newsletter-message" role="status">{newsletterMessage}</p>}</form></section>
      <footer className="site-footer">
        <div className="footer-top"><button type="button" className="back-to-top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>{storefrontText('footerBackToTop')}</button></div>
        <div className="footer-columns">
          <div><h3>{storefrontText('footerShopTitle')}</h3><ul><li><button type="button" onClick={() => openCollection('All', 'All')}>{storefrontText('footerAllWear')}</button></li>{categories.slice(1).map((category) => <li key={category}><a href={`/collections/${encodeURIComponent(category)}`} onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); openCollection(category, 'All'); }}>{category}</a></li>)}<li><button type="button" onClick={() => { setSortOrder('newest'); openCollection('All', 'All'); }}>{storefrontText('footerNewArrivals')}</button></li></ul></div>
          <div><h3>{storefrontText('footerCustomerTitle')}</h3><ul><li><a href="#contact">{storefrontText('footerContact')}</a></li><li><a href={`mailto:${storefrontText('contactEmail')}`}>{storefrontText('contactEmail')}</a></li><li><a href={`tel:${storefrontText('contactPhone').replace(/\s+/g, '')}`}>{storefrontText('contactPhone')}</a></li></ul></div>
          <div><h3>AHUZAH</h3><p className="footer-tagline">{storefrontText('footerBrandTagline')}</p><p className="footer-loc">{storefrontText('footerLocation')}</p></div>
        </div>
        <div className="footer-bottom"><a className="wordmark" href="#home" aria-label="AHUZAH home"><img src={storeContent.brandLogoUrl || '/ahuzah-wordmark.svg'} alt="AHUZAH" className="wordmark-logo" /></a><span>© AHUZAH 2026</span><a className="footer-terms" href="/terms.html">Terms and Conditions</a><button className="owner-entry" onClick={() => setOwnerStudioOpen(true)}>Owner Studio</button></div>
      </footer>

      {orderSuccessPage && paymentOrder?.paymentMethod === 'upi' && paymentStatus === 'paid' && <PaymentSuccess
        orderId={paymentOrder.orderId} amount={formatPaymentAmount(paymentOrder.amount)} reference={paymentOrder.paymentReference}
        items={paymentOrder.items} needsReview={paymentOrderStatus === 'cancelled'}
        onContinueShopping={closePaymentSuccess} onViewOrders={() => { closePaymentSuccess(); openCustomerPage('orders'); }}
      />}
      {cartOpen && <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setCartOpen(false); }}>
        <aside ref={cartDrawer} className="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="bag-title">
          <div className="drawer-heading"><div><p className="eyebrow dark-eyebrow">AHUZAH</p><h2 id="bag-title">{storefrontText('bagTitle')} <span>({cartCount})</span></h2></div><button className="icon-button" aria-label="Close bag" onClick={() => setCartOpen(false)}><X size={21} /></button></div>
          {paymentOrder ? <section className="payment-panel" aria-live="polite">
            {paymentOrder.paymentMethod === 'upi' && paymentStatus === 'paid' && <CheckCircle2 className="payment-success-icon" size={46} aria-hidden="true" />}
            <p className="eyebrow dark-eyebrow">{paymentOrder.paymentMethod === 'cod' ? storefrontText('checkoutCod') : paymentOrder.provider === 'manual_upi' ? 'Ahuzah Pay · UPI' : 'PayU checkout'}</p>
            <h3>{paymentOrder.paymentMethod === 'cod' ? storefrontText('payOrderConfirmed') : paymentStatus === 'paid' && paymentOrderStatus === 'cancelled' ? 'Payment received — order needs review' : paymentStatus === 'paid' ? storefrontText('payConfirmed') : paymentStatus === 'expired' || paymentStatus === 'cancelled' ? storefrontText('payClosed') : payuPaymentIssue === 'initiation_failed' ? 'Could not start PayU checkout' : payuPaymentIssue === 'provider_failed' ? 'PayU payment failed' : paymentStatus === 'failed' ? storefrontText('payFailed') : paymentStatus === 'pending' ? storefrontText('payUpiPending') : storefrontText('payPending')}</h3>
            <p>{payuPaymentIssue === 'initiation_failed' && paymentStatus !== 'paid' ? 'The payment request could not be started. Its outcome may be uncertain; contact AHUZAH before trying again.' : paymentMessage || storefrontText('payWaiting')}</p>
            <p><strong>{formatPaymentAmount(paymentOrder.amount)}</strong>{paymentOrder.paymentReference ? ` · Reference ${paymentOrder.paymentReference}` : ` · Order ${paymentOrder.orderId.slice(0, 8)}`}</p>
            {paymentOrder.paymentAdjustmentAmount && <p>Includes a {formatPaymentAmount(paymentOrder.paymentAdjustmentAmount)} UPI identification adjustment. Pay the exact total shown.</p>}
            {paymentSignInRequired && <button className="dark-button" type="button" onClick={() => { setAuthMode('login'); setAccountPageOpen(false); setAccountOpen(true); }}>Sign in to check payment</button>}
            {paymentLaunchError && <p className="payment-config-warning" role="alert">{paymentLaunchError}</p>}
            {paymentOrder.paymentMethod === 'upi' && !paymentSignInRequired && ['pending', 'failed', 'cancelled'].includes(paymentStatus) && <>{paymentStatus !== 'cancelled' && !payuPaymentIssue && (!paymentOrder.expiresAt || Date.parse(paymentOrder.expiresAt) > Date.now()) && (paymentOrder.provider === 'manual_upi' && paymentOrder.payUrl?.startsWith('upi://pay?') ? <PaymentQr reference={paymentOrder.paymentReference} /> : paymentOrder.provider === 'payu' && paymentOrder.checkoutMode === 'qr' ? payuQr?.orderId === paymentOrder.orderId ? <div className="payment-qr"><QRCodeSVG value={payuQr.value} size={224} level="M" marginSize={4} title="Scan to pay with UPI" /><p>Scan with your UPI app, or open the payment link on your phone.</p><a className="dark-button" href={payuQr.value}>Open UPI app</a></div> : !paymentLaunchError && <p>Preparing your PayU QR code…</p> : paymentOrder.provider === 'payu' && paymentOrder.checkoutMode === 'intent' && isPayUIntentUri(paymentOrder.intentUri, paymentOrder.amount) ? <div className="payment-qr"><QRCodeSVG value={paymentOrder.intentUri} size={224} level="M" marginSize={4} title="Scan to pay with UPI" /><p>On your phone, open the UPI app to pay. On desktop, scan this QR with your UPI app.</p><a className="dark-button" href={paymentOrder.intentUri}>Open UPI app</a></div> : paymentOrder.provider === 'payu' ? <button className="dark-button" type="button" disabled={busy} onClick={() => void retryPayUCheckout()}>{paymentStatus === 'failed' ? storefrontText('payTryAgain') : 'Open UPI app'}</button> : paymentOrder.provider !== 'manual_upi' && <a className="dark-button" href={paymentOrder.payUrl} onClick={() => setPaymentMessage(storefrontText('payAppOpened'))}>{paymentStatus === 'failed' ? storefrontText('payTryAgain') : storefrontText('checkoutPayUpi')}</a>)}<p className="payment-pending"><span className="payment-spinner" /> {storefrontText('payChecking')}</p><button className="invoice-button" type="button" disabled={busy} onClick={() => void refreshPaymentStatus()}>{storefrontText('payRefresh')}</button>{!payuPaymentIssue && paymentOrder.provider !== 'manual_upi' && paymentStatus === 'pending' && <button className="invoice-button" type="button" disabled={busy} onClick={() => void reportPaymentFailure()}>{storefrontText('payReportFailure')}</button>}{paymentStatus !== 'cancelled' && <button className="invoice-button" type="button" disabled={busy} onClick={() => void cancelPayment()}>{storefrontText('payCancel')}</button>}</>}
            {paymentOrder.paymentMethod === 'upi' && paymentOrder.provider === 'manual_upi' && paymentStatus !== 'paid' && !paymentSignInRequired && <section className="payment-proof">
              <h4>Manual UPI / QR Payment</h4>
              <p>{paymentProofSubmitted ? 'Screenshot received and awaiting owner review. Payment is not confirmed until the bank credit is checked.' : 'Already paid? Upload your UPI payment screenshot for review. A screenshot is not proof of settlement and will not mark the order paid.'}</p>
              {paymentProofPreview && <img className="payment-proof-preview" src={paymentProofPreview} alt="Preview of your payment screenshot" />}
              <label className="payment-proof-upload">{paymentProofSubmitted ? 'Choose a replacement screenshot' : 'Choose payment screenshot'}
                <input type="file" accept="image/png,image/jpeg" onChange={(event) => {
                  const file = event.currentTarget.files?.[0] || null;
                  setPaymentProofError('');
                  if (file && !['image/png', 'image/jpeg'].includes(file.type)) {
                    setPaymentProofFile(null);
                    setPaymentProofError('Choose a PNG or JPEG screenshot.');
                    return;
                  }
                  setPaymentProofFile(file);
                }} disabled={paymentProofBusy} />
              </label>
              {paymentProofFile && <button className="invoice-button" type="button" disabled={paymentProofBusy} onClick={() => void submitPaymentProof()}>{paymentProofBusy ? 'Submitting…' : 'Submit Payment for Verification'}</button>}
              {paymentProofError && <p className="payment-proof-error" role="alert">{paymentProofError}</p>}
            </section>}
            {paymentStatus === 'failed' && !payuPaymentIssue && <p>{storefrontText('payFailureNote')}</p>}
            {(paymentOrder.paymentMethod === 'cod' || paymentStatus === 'paid' || paymentStatus === 'cancelled' || paymentStatus === 'expired') && <button className="dark-button" type="button" onClick={() => { window.history.replaceState({}, '', '/'); setRoutePath('/'); setReturnedPaymentId(null); setPaymentOrder(null); setPayuPaymentIssue(null); setPaymentStatus('pending'); setCartOpen(false); }}>{paymentStatus === 'cancelled' ? storefrontText('payReturn') : 'Done'}</button>}
            {paymentOrder.paymentMethod === 'upi' && paymentStatus === 'paid' && paymentOrderStatus === 'cancelled' && <p className="payment-next-steps">Please contact AHUZAH if you need an update about fulfillment or refund arrangements.</p>}
            {paymentOrder.paymentMethod === 'upi' && paymentStatus === 'paid' && paymentOrderStatus !== 'cancelled' && <p className="payment-next-steps">Thank you for choosing AHUZAH. Please check your email for payment confirmation and order approval. Your invoice and receipt are also available under Account › Order history. We’ll email you tracking details as soon as your order is on its way.</p>}
            {paymentOrder.paymentMethod === 'upi' && paymentOrder.provider === 'manual_upi' && paymentStatus !== 'paid' && <ManualPaymentInstructions email={storefrontText('contactEmail')} orderId={paymentOrder.orderId} />}
            {paymentOrder.paymentMethod === 'upi' && paymentStatus !== 'paid' && <small>{paymentOrder.provider === 'manual_upi' ? 'Manual confirmation is required. Do not pay after the 60-minute reservation expires. If you have already paid, contact AHUZAH with your order and bank transaction reference.' : paymentOrder.provider === 'payu' ? 'On supported phones, PayU opens a UPI app. Your order is confirmed only after PayU verifies the payment. Do not pay again if money was debited; contact AHUZAH if confirmation is delayed.' : storefrontText('payVerificationNote')}</small>}
          </section> : returnedPaymentId ? <section className="payment-panel" role="status"><p>{paymentRecoveryMessage || 'Checking your payment…'}</p>{!customer && <button className="dark-button" type="button" onClick={() => { setAuthMode('login'); setAccountOpen(true); }}>Sign in to check payment</button>}</section> : cartLines.length === 0 ? <div className="empty-bag"><ShoppingBag size={25} /><p>{storefrontText('bagEmpty')}</p><button className="dark-button" onClick={() => { setCartOpen(false); setCatalogOpen(true); document.querySelector('#shop')?.scrollIntoView({ behavior: 'smooth' }); }}>{storefrontText('bagExplore')}</button></div> : <>
            <CheckoutItems items={cartLines.map(({ product, quantity, size }) => {
              const pricing = productPricing(product.price, product.discountPercent);
              return {
                id: product.id,
                name: product.name,
                imageUrl: mainImage(product)?.variants[0]?.url || product.imageUrl,
                size,
                quantity,
                unitPrice: formatPrice(product.price),
                mrp: pricing ? formatPrice(pricing.mrp) : undefined,
                discountPercent: pricing?.discountPercent,
                lineTotal: formatPrice(product.price * quantity),
                canIncrease: productIsPurchasable(product) && cart.reduce((total, line) => line.productId === product.id ? total + line.quantity : total, 0) < Math.min(product.stock, 10),
              };
            })} busy={busy} onChangeQuantity={changeQuantity} onRemove={removeFromBag} onContinueShopping={() => { setCartOpen(false); setCatalogOpen(true); document.querySelector('#shop')?.scrollIntoView({ behavior: 'smooth' }); }} />
            <div className="bag-footer"><div className="subtotal"><span>{storefrontText('bagSubtotal')}</span><strong>{formatPrice(cartTotal)}</strong></div><div className="subtotal"><span>{storefrontText('bagShipping')}</span><strong>{estimatedShipping === null ? 'Unavailable' : estimatedShipping ? formatPaymentAmount(estimatedShipping) : storefrontText('bagComplimentary')}</strong></div><div className="subtotal"><span>{storefrontText('bagTotal')}</span><strong>{estimatedShipping === null ? 'Unavailable' : formatPaymentAmount(Math.round(cartTotal * 100) + estimatedShipping)}</strong></div>{shippingChargeAmount !== null && <p>{formatPaymentAmount(shippingChargeAmount)} shipping below {formatPaymentAmount(freeShippingThreshold)}; complimentary shipping at or above {formatPaymentAmount(freeShippingThreshold)}.</p>}<p>{storefrontText('bagShippingNote')}</p><form className="checkout-details" onSubmit={(event) => { event.preventDefault(); void checkout(); }}>
              <fieldset className="payment-method-options"><legend>{storefrontText('checkoutPaymentMethod')}</legend><label><input type="radio" name="paymentMethod" value="upi" checked={paymentMethod === 'upi'} onChange={() => setPaymentMethod('upi')} /> {storefrontText('checkoutPayUpi')}</label><label><input type="radio" name="paymentMethod" value="cod" checked={paymentMethod === 'cod'} onChange={() => setPaymentMethod('cod')} /> {storefrontText('checkoutCod')}</label></fieldset>
              <p className="address-title">{storefrontText('checkoutBilling')}</p>
              <AddressFields section="billing" value={billingAddress} onChange={setBillingAddress} />
              <div className="address-title-row"><p className="address-title">{storefrontText('checkoutDelivery')}</p><label className="same-address-check"><input type="checkbox" checked={sameAsBilling} onChange={(event) => setSameAsBilling(event.target.checked)} /> (same as billing address)</label></div>
              <AddressFields section="shipping" value={sameAsBilling ? billingAddress : deliveryAddress} onChange={setDeliveryAddress} readOnly={sameAsBilling} />
              {(sameAsBilling ? billingAddress : deliveryAddress).country !== 'India' && <p className="payment-config-warning" role="alert">Delivery is currently available only within India.</p>}
              {paymentMethod === 'upi' && <p className="payment-config-warning">{storefrontText('checkoutUpiNote')}</p>}
              {checkoutError && <p className="payment-config-warning" role="alert">{checkoutError}</p>}
              <label className="consent-check"><input type="checkbox" checked={marketingConsent} onChange={(event) => setMarketingConsent(event.target.checked)} />{storefrontText('checkoutConsent')}</label>{paymentMethod === 'upi' && customer && <p className="payment-config-warning">Your order is created and stock is reserved before opening the fixed PayU link. The fixed link does not receive your cart total or automatically match the payment to this order; confirm the amount with AHUZAH before paying.</p>}<button className="dark-button checkout-button" disabled={busy || estimatedShipping === null}>{busy ? storefrontText('checkoutPlacing') : customer ? paymentMethod === 'cod' ? storefrontText('checkoutPlaceCod') : storefrontText('checkoutContinueUpi') : storefrontText('checkoutSignIn')} <ArrowRight size={16} /></button>
              </form><small>{storefrontText('checkoutPolicy')}</small></div>
          </>}
        </aside>
      </div>}

      {accountOpen && <div className={`overlay${accountPageOpen ? ' account-page-overlay' : ''}`} onMouseDown={(event) => { if (event.target === event.currentTarget) { setAccountOpen(false); setAccountPageOpen(false); } }}>
        <section className={`account-dialog${accountPageOpen ? ' account-page-dialog' : ''}`} role="dialog" aria-modal="true" aria-labelledby="account-title">
          {accountPageOpen && <button className="account-page-back" type="button" onClick={() => { setAccountOpen(false); setAccountPageOpen(false); }}><ArrowRight size={16} /> {storefrontText('accountBack')}</button>}
          <button className="icon-button dialog-close" aria-label={accountPageOpen ? 'Close account page' : 'Close account'} onClick={() => { setAccountOpen(false); setAccountPageOpen(false); }}><X size={20} /></button>
          {customer ? <><p className="eyebrow dark-eyebrow">{storefrontText('accountEyebrow')}</p><h2 id="account-title">{storefrontText('accountWelcome')}</h2><nav className="customer-account-nav" aria-label="Account sections"><a href="#profile-section">{storefrontText('accountProfile')}</a><a href="#upi-section">UPI ID</a><a href="#wishlist-section">Wishlist ({wishlist.length})</a><a href="#order-history-title">Orders ({orders.length})</a></nav><section className="customer-profile" id="profile-section" aria-labelledby="customer-profile-title"><h3 id="customer-profile-title">{storefrontText('accountProfile')}</h3><p className="account-email">{customer.email}</p></section><section className="customer-upi" id="upi-section" aria-labelledby="customer-upi-title"><h3 id="customer-upi-title">Saved UPI ID (optional)</h3><p className="upi-assurance">Your UPI ID is stored encrypted and is used only to match your payment to your order. We never sell it, share it with anyone, or use it for marketing. Saving is optional, and you can delete it any time.</p>{upiSavingAvailable ? <><label>UPI ID<input value={accountUpiInput} onChange={(event) => setAccountUpiInput(event.target.value)} placeholder="name@bank" autoComplete="off" inputMode="email" maxLength={256} /></label><div className="upi-actions"><button className="dark-button" type="button" disabled={busy || !accountUpiInput.trim() || accountUpiInput.trim() === savedUpiId} onClick={() => void saveAccountUpi()}>{savedUpiId ? 'Update UPI ID' : 'Save UPI ID'}</button>{savedUpiId && <button className="invoice-button" type="button" disabled={busy} onClick={() => void deleteAccountUpi()}>Delete saved UPI ID</button>}</div>{accountUpiMessage && <p className="upi-message" role="status">{accountUpiMessage}</p>}</> : <p>Saving a UPI ID is unavailable right now You can still enter it at checkout.</p>}</section><section className="customer-wishlist" id="wishlist-section" aria-labelledby="wishlist-title"><h3 id="wishlist-title">Wishlist ({wishlist.length})</h3>{wishlist.length === 0 && <p>{storefrontText('accountWishlistEmpty')}</p>}{wishlist.map((id) => products.find((product) => product.id === id)).filter((product): product is Product => Boolean(product)).map((product) => <div className="wishlist-item" key={product.id}><span>{product.name} · {formatPrice(product.price)}</span>{product.stock < 1 ? <button type="button" className="dark-button" onClick={() => void requestRestockAlert(product)}>{storefrontText('cardNotify')}</button> : <button type="button" className="dark-button" onClick={() => addToBag(product)}>{product.sizes?.length ? storefrontText('accountChooseSize') : storefrontText('addToCart')}</button>}<button type="button" className="icon-button" aria-label={`Remove ${product.name} from wishlist`} onClick={() => void toggleWishlist(product)}><X size={16} /></button></div>)}</section><section className="customer-order-history" aria-labelledby="order-history-title"><h3 id="order-history-title">{storefrontText('accountOrderHistory')}</h3>{ordersLoading && <p>{storefrontText('accountOrdersLoading')}</p>}{ordersError && <p className="order-history-error" role="alert">{ordersError}</p>}{!ordersLoading && !ordersError && orders.length === 0 && <p>{storefrontText('accountOrdersEmpty')}</p>}{orders.map((order) => <article className="customer-order" key={order.id}><div><strong>{order.id.slice(0, 8)}</strong><span>{new Date(order.createdAt).toLocaleDateString('en-IN')} · {orderStatusLabel(order)}</span><span>{order.items.map((item) => `${item.name}${item.size ? ` (Size ${item.size})` : ''} × ${item.quantity}`).join(', ')}</span>{order.trackingNumber && <span>Tracking number: {order.trackingNumber}</span>}{order.trackingUrl && <a className="customer-track-link" href={order.trackingUrl} target="_blank" rel="noopener noreferrer">{storefrontText('accountTrack')} <ArrowRight size={14} /></a>}{order.status === 'out_for_delivery' && <strong className="delivery-update">{storefrontText('accountOutForDelivery')}</strong>}</div><div className="customer-order-actions"><button className="invoice-button" type="button" onClick={() => void downloadInvoice(order)} disabled={!order.paymentVerifiedAt || !['paid', 'shipped', 'out_for_delivery', 'delivered'].includes(order.status)}>{order.paymentVerifiedAt && ['paid', 'shipped', 'out_for_delivery', 'delivered'].includes(order.status) ? storefrontText('accountInvoice') : storefrontText('accountInvoiceLater')}</button>{order.review ? <p className="order-review-result" aria-label={`Your rating: ${order.review.rating} out of 5`}>{'★'.repeat(order.review.rating)}{'☆'.repeat(5 - order.review.rating)}{order.review.comment ? ` · ${order.review.comment}` : ''}</p> : order.status === 'delivered' ? <form className="order-review-form" onSubmit={(event) => { event.preventDefault(); void submitOrderReview(order.id, new FormData(event.currentTarget)); }}><label>{storefrontText('accountRate')}<select name="rating" defaultValue="5"><option value="5">★★★★★ · Loved it</option><option value="4">★★★★ · Great</option><option value="3">★★★ · Good</option><option value="2">★★ · Could be better</option><option value="1">★ · Not satisfied</option></select></label><label>{storefrontText('accountReviewLabel')}<textarea name="comment" maxLength={1000} rows={2} placeholder="Share your experience" /></label><button className="invoice-button" type="submit" disabled={reviewBusy === order.id}>{reviewBusy === order.id ? 'Sending…' : storefrontText('accountSubmitReview')}</button>{reviewMessages[order.id] && <small role="status">{reviewMessages[order.id]}</small>}</form> : null}</div></article>)}</section><button className="dark-button" onClick={() => void logout()}>{storefrontText('accountSignOut')}</button></> : <>
            <p className="eyebrow dark-eyebrow">{storefrontText('accountEyebrow')}</p><h2 id="account-title">{authMode === 'login' ? storefrontText('authLoginTitle') : storefrontText('authSignupTitle')}</h2>
            <form className="auth-form" onSubmit={(event) => void handleAuth(event)}><label>{storefrontText('authEmail')}<input name="email" type="email" autoComplete="email" required /></label><label>{storefrontText('authPassword')}<input name="password" type="password" minLength={authMode === 'signup' ? 12 : 1} autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} required />{authMode === 'signup' && <small>{storefrontText('authPasswordHint')}</small>}</label><button className="dark-button" disabled={busy}>{busy ? storefrontText('authBusy') : authMode === 'login' ? storefrontText('authSignIn') : storefrontText('authCreate')} <ArrowRight size={16} /></button></form>
            <button className="mode-switch" onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}>{authMode === 'login' ? storefrontText('authSwitchToSignup') : storefrontText('authSwitchToLogin')}</button>
          </>}
        </section>
      </div>}
      </> : <section className="store-maintenance">
        <p className="eyebrow">AHUZAH</p>
        <h1>{storefrontText('maintenanceTitle')}</h1>
        <p>{storefrontText('maintenanceBody')}</p>
        <button className="dark-button" type="button" onClick={() => setOwnerStudioOpen(true)}>Owner Studio</button>
      </section>}
      {detailProduct && (() => {
        const gallery = galleryImages(detailProduct);
        const layout = imageSettings.layout;
        const showAll = layout.mode === 'gallery' && gallery.length > 1;
        const current = gallery[Math.min(detailIndex, gallery.length - 1)]!;
        const pricing = productPricing(detailProduct.price, detailProduct.discountPercent);
        const stockStatus = productStockStatus(detailProduct);
        const available = productIsPurchasable(detailProduct);
        return <div className="overlay product-detail-backdrop" onClick={closeProduct}>
          <section className={`product-detail thumbs-${layout.thumbnailPlacement}`} role="dialog" aria-modal="true" aria-label={detailProduct.name} style={imageSettingsVars(imageSettings) as CSSProperties} onClick={(event) => event.stopPropagation()}>
            <button className="icon-button dialog-close" aria-label="Close product" onClick={closeProduct}><X size={20} /></button>
            <div className="pd-gallery">
              <div className={`pd-main ${layout.zoom ? 'can-zoom' : ''} ${zoomed ? 'is-zoomed' : ''}`} onClick={() => layout.zoom && setZoomed((value) => !value)}>
                <img src={current.url} srcSet={current.srcSet} sizes="(max-width: 760px) 100vw, 50vw" alt={detailProduct.name} />
              </div>
              {showAll && layout.thumbnails && <div className="pd-thumbs">{gallery.map((image, position) => <button key={image.id} type="button" className={position === detailIndex ? 'active' : ''} onClick={() => { setDetailIndex(position); setZoomed(false); }} aria-label={`Show image ${position + 1}`}><img src={image.thumb} alt="" /></button>)}</div>}
            </div>
            <div className="pd-copy"><p className="eyebrow dark-eyebrow">{detailProduct.category} · {detailProduct.sku}</p><h2>{detailProduct.name}</h2><h3 className="product-description-heading">Product description</h3><p>{detailProduct.description}</p><div className="product-detail-price">{pricing && <del>{formatPrice(pricing.mrp)}</del>}<strong>{formatPrice(detailProduct.price)}</strong>{pricing && <em>{pricing.discountPercent}% OFF</em>}</div><small>{usdEstimate(detailProduct.price)}</small><p className={`product-availability ${stockStatus}`}>{stockStatus === 'sold_out' ? 'Sold Out' : stockStatus === 'limited_stock' ? `Limited Stock${detailProduct.stock ? ` · ${detailProduct.stock} left` : ''}` : 'In Stock'}</p><p className="product-delivery-note">{storefrontText('bagShippingNote')}</p>
              <ProductDetails product={detailProduct} text={storefrontText} />
              <div className="product-sharing"><button className="text-link" type="button" onClick={() => void handleProductSharing(detailProduct, 'share')}>Share Product</button><button className="text-link" type="button" onClick={() => void handleProductSharing(detailProduct, 'copy')}>Copy Link</button></div>
              {sharingMessage && <small role="status">{sharingMessage}</small>}
              {detailProduct.sizes?.length ? <fieldset className="customer-size-picker"><legend>{storefrontText('detailChooseSize')}</legend><div className="size-options">{detailProduct.sizes.map((size) => <button key={size} type="button" className={`size-option size-choice ${selectedSize === size ? 'selected' : ''}`} aria-pressed={selectedSize === size} onClick={() => setSelectedSize(size)}>{size}</button>)}</div></fieldset> : null}
              {!available ? <button className="dark-button" type="button" onClick={() => void requestRestockAlert(detailProduct)}>{storefrontText('detailNotify')}</button> : <button className="dark-button" type="button" disabled={Boolean(detailProduct.sizes?.length && !selectedSize)} onClick={() => { addToBag(detailProduct, selectedSize || undefined); closeProduct(); }}>{detailProduct.sizes?.length && !selectedSize ? storefrontText('detailChooseSizeButton') : storefrontText('addToCart')}</button>}</div>
          </section>
        </div>;
      })()}
      {ownerStudioOpen && <Suspense fallback={<div className="store-maintenance" role="status">Opening Owner Studio…</div>}><OwnerStudio onClose={() => setOwnerStudioOpen(false)} onProductsChange={setProducts} onContentChange={setStoreContent} onSiteStatusChange={setSitePublished} onImageSettingsChange={setImageSettings} onShippingChargeChange={setShippingChargeAmount} /></Suspense>}
      {sitePublished && <CustomerSupportChat onOpenAccount={() => setAccountOpen(true)} />}
    </main>
  );
}