import AdStudio from './AdStudio';
import SocialScheduler from './SocialScheduler';
import MarketingAutomations from './MarketingAutomations';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { ArrowLeft, BarChart3, Box, Check, Headphones, Image, LoaderCircle, Mail, MessageCircle, Megaphone, PackageCheck, Plus, Send, Settings2, Sparkles, X } from 'lucide-react';
import { removeSentenceFullStops } from './siteCopy';
import ProductImageManager from './ProductImageManager';
import ImageSettingsPanel from './ImageSettingsPanel';
import type { ImageSettings, ProductImage } from './imageTypes';
import './owner-agent.css';
import { defaultStorefrontCopy, storefrontCopyFields, type StorefrontCopyId } from '../shared/storefrontCopy';

type Product = { id: string; name: string; description: string; price: number; sku: string; stock: number; category: string; imageUrl: string; active: boolean; ghostMannequin: { imageUrl?: string; tags: string[]; background?: string }; images?: ProductImage[]; mainImageId?: string; sizes?: string[] };
type Content = { announcement: string; heroEyebrow: string; heroTitle: string; heroDescription: string; heroImageUrl: string; storyHeading: string; storyBody: string; storyImageUrl: string; circleImages?: Record<string, string>; circleLabels?: Record<string, string>; bannerImages?: Record<string, string>; copy: Record<StorefrontCopyId, string> };
type Order = { id: string; status: string; amount: number; currency: string; createdAt: string; paymentMethod?: 'upi' | 'cod'; paymentReference?: string; trackingNumber?: string; trackingUrl?: string; paymentVerifiedAt?: string; paymentStatus?: string; manualPaymentReference?: string; paymentVerificationMethod?: string; shippingAddress: { name: string; addressLine1: string; addressLine2?: string; city: string; state: string; postalCode: string; phone: string }; items: { name: string; sku: string; quantity: number; size?: string }[]; review?: { rating: number; comment?: string; createdAt: string }; returnRequest?: { action: string; reason: string; status: string } };
type PaymentReceiptReview = { id: string; orderId: string; userId: string; expectedAmount: number; extraction: { utrNumber: string | null; amountPaid: number | null; receiverUpiId: string | null; date: string | null; isSuccessful: boolean }; flags: string[]; status: 'pending_admin_review' | 'reviewed'; createdAt: string; reviewedAt?: string; reviewNote?: string };
type Analytics = { eventCounts: Record<string, number>; orderCount: number; paidRevenue: number; currency: string; lowStock: { id: string; name: string; sku: string; stock: number }[] };
type IntegrationStatus = { email: boolean; followUps: boolean; ai: boolean };
type SupportTicket = { id: string; email: string; message: string; category: 'delivery' | 'complaint' | 'general'; status: 'open' | 'resolved'; createdAt: string };
type EmailKind = 'alert' | 'thank_you' | 'follow_up';
type EmailDraft = { orderId: string; kind: EmailKind; to: string; subject: string; body: string };
type AgentAction =
  | { type: 'update_stock'; productId: string; productName: string; sku: string; previousStock: number; stock: number }
  | { type: 'update_order_status'; orderId: string; previousStatus: string; status: 'shipped' | 'delivered' }
  | { type: 'draft_email'; orderId: string; kind: EmailKind };
type Tab = 'overview' | 'products' | 'imageSettings' | 'content' | 'orders' | 'support' | 'marketing' | 'ads' | 'email' | 'assistant' | 'social';
const circleLabels = ['Women', 'Men', 'Kurtis', 'Frocks', 'Kurta Sets', 'Lehengas', 'Night Suits', 'Track Suits', 'New Arrivals', 'Bestsellers', 'Sale'];
const bannerSlots = [{ key: 'new', label: 'New Arrivals banner' }, { key: 'sale', label: 'Season sale banner' }, { key: 'festive', label: 'Festive edit banner' }];
type Props = { onClose: () => void; onProductsChange: (products: Product[]) => void; onContentChange: (content: Content) => void; onSiteStatusChange: (published: boolean) => void; onImageSettingsChange: (settings: ImageSettings) => void };

const emptyContent: Content = { announcement: '', heroEyebrow: '', heroTitle: '', heroDescription: '', heroImageUrl: '', storyHeading: '', storyBody: '', storyImageUrl: '', circleImages: {}, circleLabels: {}, bannerImages: {}, copy: defaultStorefrontCopy };
const tabs: { id: Tab; label: string; icon: typeof BarChart3 }[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3 }, { id: 'products', label: 'Products & stock', icon: Box },
  { id: 'imageSettings', label: 'Image Settings', icon: Image }, { id: 'content', label: 'Storefront', icon: Image }, { id: 'orders', label: 'Orders & receipts', icon: PackageCheck },
  { id: 'support', label: 'Support tickets', icon: Headphones }, { id: 'marketing', label: 'Marketing', icon: Megaphone }, { id: 'ads', label: 'Ad agent', icon: Sparkles },
  { id: 'email', label: 'Email agent', icon: Mail }, { id: 'assistant', label: 'AI agent', icon: MessageCircle },
  { id: 'social', label: 'Social posting', icon: Sparkles },
];
const storefrontCopyGroups = [...new Set(storefrontCopyFields.map(({ group }) => group))];

async function ownerRequest<T>(key: string, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', 'X-Owner-Key': key, ...init.headers } });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || 'The request could not be completed');
  return payload;
}

const money = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
const initialProduct = (): Product => ({ id: '', name: '', description: '', price: 0, sku: '', stock: 0, category: '', imageUrl: '', active: true, ghostMannequin: { tags: [] } });
const standardSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'Free size'];

function AvailableSizes({ sizes, onChange }: { sizes: string[]; onChange: (sizes: string[]) => void }) {
  const [customSize, setCustomSize] = useState('');
  function toggle(size: string) {
    onChange(sizes.includes(size) ? sizes.filter((item) => item !== size) : [...sizes, size]);
  }
  function addCustomSize() {
    const size = customSize.trim();
    if (size && !sizes.some((item) => item.toLowerCase() === size.toLowerCase()) && sizes.length < 20) {
      onChange([...sizes, size]);
      setCustomSize('');
    }
  }
  return <fieldset className="available-sizes"><legend>Available sizes <small>Leave all unchecked if this product has no size options</small></legend>
    <div className="size-options">{standardSizes.map((size) => <label className={`size-option ${sizes.includes(size) ? 'selected' : ''}`} key={size}><input type="checkbox" checked={sizes.includes(size)} onChange={() => toggle(size)} /><span>{size}</span></label>)}
      {sizes.filter((size) => !standardSizes.includes(size)).map((size) => <label className="size-option selected custom-size-option" key={size}><input type="checkbox" checked onChange={() => toggle(size)} /><span>{size}</span></label>)}</div>
    <div className="custom-size-entry"><input aria-label="Add a custom size" value={customSize} maxLength={20} onChange={(event) => setCustomSize(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustomSize(); } }} placeholder="Add custom size (e.g 28, 30)" /><button type="button" className="studio-secondary" onClick={addCustomSize} disabled={!customSize.trim() || sizes.length >= 20}>Add size</button></div>
  </fieldset>;
}

function MarketingDashboard({ integrations, eventCounts }: { integrations: IntegrationStatus | null; eventCounts: Record<string, number> }) {
  return <section className="studio-section studio-marketing">
    <section className="studio-panel">
      <div className="studio-panel-heading"><div><h2>Connected services</h2><span>Status of the services the store uses</span></div><Settings2 size={18} /></div>
      {integrations && <div className="integration-grid">{([['Gemini AI', integrations.ai], ['Transactional email', integrations.email], ['7-day follow-up scheduler', integrations.followUps]] as [string, boolean][]).map(([label, enabled]) => <div className="integration-row" key={label}><span className={enabled ? 'integration-on' : 'integration-off'} />{label}<b>{enabled ? 'Connected' : 'Not configured'}</b></div>)}</div>}
    </section>
    <section className="studio-panel"><div className="studio-panel-heading"><div><h2>Event activity</h2><span>Counts recorded by the storefront</span></div></div><div className="event-chips">{Object.entries(eventCounts).map(([name, count]) => <span key={name}>{name.replaceAll('_', ' ')} <b>{count}</b></span>)}</div></section>
  </section>;
}

function EmailAgentPanel({ orders, emailEnabled, selectedOrderId, kind, draft, reviewed, sent, busy, onSelectOrder, onSelectKind, onGenerate, onDraftChange, onReview, onSend }: {
  orders: Order[];
  emailEnabled: boolean;
  selectedOrderId: string;
  kind: EmailKind;
  draft: EmailDraft | null;
  reviewed: boolean;
  sent: boolean;
  busy: boolean;
  onSelectOrder: (orderId: string) => void;
  onSelectKind: (kind: EmailKind) => void;
  onGenerate: () => void;
  onDraftChange: (field: 'subject' | 'body', value: string) => void;
  onReview: (reviewed: boolean) => void;
  onSend: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const eligibleOrders = orders.filter((order) => ['paid', 'shipped', 'delivered'].includes(order.status));
  const eligibleForKind = kind === 'follow_up' ? eligibleOrders.filter((order) => order.status === 'delivered') : eligibleOrders;

  return <section className="studio-section studio-email-agent">
    <section className="studio-panel">
      <div className="studio-panel-heading"><div><h2>AI customer email agent</h2><span>Generate a draft from verified order details, review it, then send</span></div><Sparkles size={18} /></div>
      <p className="studio-muted">Manual email drafts are separate from automatic order confirmations and shipping notices AI drafting needs OPENAI_API_KEY (or GEMINI_API_KEY)</p>
      <div className="studio-form-grid">
        <label>Order<select value={selectedOrderId} onChange={(event) => onSelectOrder(event.target.value)} disabled={eligibleOrders.length === 0}>
          {eligibleOrders.length === 0 && <option value="">No paid orders available</option>}
          {eligibleOrders.map((order) => <option key={order.id} value={order.id}>{order.shippingAddress.name} · {order.id.slice(0, 8)} · {order.status}</option>)}
        </select></label>
        <label>Email type<select value={kind} onChange={(event) => onSelectKind(event.target.value as EmailKind)}>
          <option value="alert">Order alert</option><option value="thank_you">Thank-you message</option><option value="follow_up">Post-delivery follow-up</option>
        </select></label>
      </div>
      {kind === 'follow_up' && eligibleForKind.length === 0 && <p className="studio-muted">A follow-up can be drafted after an order is marked delivered</p>}
      <button className="studio-primary" type="button" onClick={onGenerate} disabled={busy || eligibleForKind.length === 0}>{busy ? 'Drafting…' : 'Draft email with AI'} <Sparkles size={15} /></button>
      {draft && <form className="studio-email-draft" onSubmit={onSend}>
        <p className="studio-email-recipient"><Mail size={15} /> To: {draft.to}</p>
        <label>Subject<input value={draft.subject} onChange={(event) => onDraftChange('subject', event.target.value)} maxLength={180} required /></label>
        <label>Message<textarea value={draft.body} onChange={(event) => onDraftChange('body', event.target.value)} rows={8} maxLength={5000} required /></label>
        <label className="studio-email-review"><input type="checkbox" checked={reviewed} onChange={(event) => onReview(event.target.checked)} /> I reviewed this message and approve sending it to this customer</label>
        <button className="studio-secondary" type="submit" disabled={busy || sent || !reviewed || !emailEnabled}>{sent ? 'Email sent' : busy ? 'Sending…' : 'Send email'} <Send size={15} /></button>
      </form>}
    </section>
  </section>;
}

export default function OwnerStudio({ onClose, onProductsChange, onContentChange, onSiteStatusChange, onImageSettingsChange }: Props) {
  const [key, setKey] = useState('');
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [paymentReceiptReviews, setPaymentReceiptReviews] = useState<PaymentReceiptReview[]>([]);
  const [receiptReviewNotes, setReceiptReviewNotes] = useState<Record<string, string>>({});
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [content, setContent] = useState<Content>(emptyContent);
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null);
  const [emailOrderId, setEmailOrderId] = useState('');
  const [emailKind, setEmailKind] = useState<EmailKind>('thank_you');
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const [emailReviewed, setEmailReviewed] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [draft, setDraft] = useState<Product | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [chat, setChat] = useState<{ role: 'owner' | 'assistant'; text: string }[]>([]);
  const [pendingAgentAction, setPendingAgentAction] = useState<AgentAction | null>(null);
  const [caption, setCaption] = useState('');
  const [socialProductId, setSocialProductId] = useState('');
  const [busyAction, setBusyAction] = useState(false);
  const [sitePublished, setSitePublished] = useState(true);
  const [bankReferences, setBankReferences] = useState<Record<string, string>>({});
  const [imageSettings, setImageSettings] = useState<ImageSettings | null>(null);
  const [maxUploadMb, setMaxUploadMb] = useState(10);
  const [imagesPending, setImagesPending] = useState(false);

  function notify(text: string) { setMessage(text); setError(''); window.setTimeout(() => setMessage(''), 3500); }
  function fail(reason: unknown) { setError(reason instanceof Error ? reason.message : 'Something went wrong'); setMessage(''); }

  async function loadDashboard(ownerKey: string) {
    setLoading(true);
    setError('');
    try {
      const [analyticsResult, inventoryResult, ordersResult, supportResult, contentResult, integrationResult, receiptReviewsResult, siteStatusResult, imageSettingsResult] = await Promise.all([
        ownerRequest<{ analytics?: Analytics } & Analytics>(ownerKey, '/api/owner/analytics'),
        ownerRequest<{ products: Product[] }>(ownerKey, '/api/owner/inventory'),
        ownerRequest<{ orders: Order[] }>(ownerKey, '/api/owner/orders'),
        ownerRequest<{ tickets: SupportTicket[] }>(ownerKey, '/api/owner/support-tickets'),
        ownerRequest<{ content: Content }>(ownerKey, '/api/owner/content'),
        ownerRequest<{ integrations: IntegrationStatus }>(ownerKey, '/api/owner/integrations'),
        ownerRequest<{ reviews: PaymentReceiptReview[] }>(ownerKey, '/api/owner/payment-receipts'),
        ownerRequest<{ published: boolean }>(ownerKey, '/api/owner/site-status'),
        ownerRequest<{ imageSettings: ImageSettings; maxUploadMb: number }>(ownerKey, '/api/owner/image-settings'),
      ]);
      setImageSettings(imageSettingsResult.imageSettings);
      setMaxUploadMb(imageSettingsResult.maxUploadMb);
      setAnalytics('analytics' in analyticsResult ? analyticsResult.analytics || null : analyticsResult);
      setProducts(inventoryResult.products);
      onProductsChange(inventoryResult.products);
      setOrders(ordersResult.orders);
      setPaymentReceiptReviews(receiptReviewsResult.reviews);
      setEmailOrderId((current) => current || ordersResult.orders.find((order) => ['paid', 'shipped', 'delivered'].includes(order.status))?.id || '');
      setSupportTickets(supportResult.tickets);
      setContent(contentResult.content);
      onContentChange(contentResult.content);
      setSitePublished(siteStatusResult.published);
      onSiteStatusChange(siteStatusResult.published);
      setIntegrations(integrationResult.integrations);
      setReady(true);
      setSocialProductId(inventoryResult.products.find((product) => product.active)?.id || '');
    } catch (reason) { fail(reason); }
    finally { setLoading(false); }
  }

  async function toggleSitePublication() {
    setBusyAction(true);
    try {
      const published = !sitePublished;
      const result = await ownerRequest<{ published: boolean }>(key, '/api/owner/site-status', {
        method: 'PATCH',
        body: JSON.stringify({ published }),
      });
      setSitePublished(result.published);
      onSiteStatusChange(result.published);
      notify(result.published
        ? 'Storefront is live Visitors can browse and place orders'
        : 'Storefront unpublished Visitors now see the maintenance page; Owner Studio remains available');
    } catch (reason) { fail(reason); }
    finally { setBusyAction(false); }
  }

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!key.trim()) return;
    await loadDashboard(key.trim());
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || busyAction) return;
    if (imagesPending) { fail(new Error('Wait for image uploads to finish, or remove failed uploads, before saving')); return; }
    setBusyAction(true);
    try {
      const { images, mainImageId, ...rest } = draft;
      const payload = { ...rest, ...(images?.length ? { images: images.map((image) => image.id), mainImageId: mainImageId || images[0]?.id } : {}), ghostMannequin: { ...draft.ghostMannequin, tags: (draft.ghostMannequin.tags || []).filter(Boolean) } };
      const result = await ownerRequest<{ product: Product }>(key, isNew ? '/api/owner/inventory' : `/api/owner/inventory/${draft.id}`, { method: isNew ? 'POST' : 'PATCH', body: JSON.stringify(payload) });
      setProducts((current) => isNew ? [...current, result.product] : current.map((item) => item.id === result.product.id ? result.product : item));
      setDraft(result.product);
      setIsNew(false);
      notify(isNew ? 'Product added to the catalog' : 'Product changes saved');
      void loadDashboard(key);
    } catch (reason) { fail(reason); }
    finally { setBusyAction(false); }
  }

  async function saveImageSettings(next: ImageSettings) {
    setBusyAction(true);
    try {
      const result = await ownerRequest<{ imageSettings: ImageSettings }>(key, '/api/owner/image-settings', { method: 'PUT', body: JSON.stringify(next) });
      setImageSettings(result.imageSettings); onImageSettingsChange(result.imageSettings); notify('Image settings saved');
    } catch (reason) { fail(reason); }
    finally { setBusyAction(false); }
  }

  async function uploadContentImage(field: 'heroImageUrl' | 'storyImageUrl', event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { fail(new Error('Choose a JPG, PNG or WebP image')); return; }
    setUploadingField(field);
    try {
      const response = await fetch('/api/owner/images', { method: 'POST', headers: { 'Content-Type': file.type, 'X-Owner-Key': key, 'X-File-Name': encodeURIComponent(file.name) }, body: file });
      const payload = removeSentenceFullStops(await response.json().catch(() => ({})) as { image?: { url: string }; error?: string });
      if (!response.ok || !payload.image) throw new Error(payload.error || 'Upload failed Please retry');
      setContent((current) => ({ ...current, [field]: payload.image!.url }));
      notify('Image uploaded Click Publish to show it on the storefront');
    } catch (reason) { fail(reason); }
    finally { setUploadingField(null); }
  }

  async function uploadMappedImage(group: 'circleImages' | 'bannerImages', name: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { fail(new Error('Choose a JPG, PNG or WebP image')); return; }
    setUploadingField(`${group}:${name}`);
    try {
      const response = await fetch('/api/owner/images', { method: 'POST', headers: { 'Content-Type': file.type, 'X-Owner-Key': key, 'X-File-Name': encodeURIComponent(file.name) }, body: file });
      const payload = removeSentenceFullStops(await response.json().catch(() => ({})) as { image?: { url: string }; error?: string });
      if (!response.ok || !payload.image) throw new Error(payload.error || 'Upload failed Please retry');
      setContent((current) => ({ ...current, [group]: { ...(current[group] || {}), [name]: payload.image!.url } }));
      notify('Image uploaded Click Publish to show it on the storefront');
    } catch (reason) { fail(reason); }
    finally { setUploadingField(null); }
  }

  function resetMappedImage(group: 'circleImages' | 'bannerImages', name: string) {
    setContent((current) => ({ ...current, [group]: { ...(current[group] || {}), [name]: '' } }));
  }

  async function saveContent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusyAction(true);
    try {
      const result = await ownerRequest<{ content: Content }>(key, '/api/owner/content', { method: 'PATCH', body: JSON.stringify(content) });
      setContent(result.content); onContentChange(result.content); notify('Storefront content published');
    } catch (reason) { fail(reason); }
    finally { setBusyAction(false); }
  }

  async function updateOrder(order: Order, status: string) {
    setBusyAction(true);
    try {
      const result = await ownerRequest<{ order: Order }>(key, `/api/owner/orders/${order.id}/status`, { method: 'PATCH', body: JSON.stringify({ status, trackingNumber: order.trackingNumber, trackingUrl: order.trackingUrl }) });
      setOrders((current) => current.map((entry) => entry.id === order.id ? result.order : entry)); notify(`Order marked ${status}`);
    } catch (reason) { fail(reason); }
    finally { setBusyAction(false); }
  }

  async function confirmUpiPayment(order: Order) {
    const bankReference = bankReferences[order.id]?.trim() || '';
    if (!/^[A-Za-z0-9-]{6,80}$/.test(bankReference)) { fail(new Error('Enter the bank UTR/reference after verifying the settled transaction in the bank account')); return; }
    if (!window.confirm(`Confirm ${money(order.amount / 100)} received for ${order.id} only after matching the settled credit in the AHUZA bank account?`)) return;
    setBusyAction(true);
    try {
      const result = await ownerRequest<{ order: Order }>(key, `/api/owner/orders/${encodeURIComponent(order.id)}/upi-payment`, { method: 'PATCH', body: JSON.stringify({ status: 'paid', bankReference }) });
      setOrders((current) => current.map((entry) => entry.id === order.id ? result.order : entry));
      notify('UPI payment marked paid after owner bank reconciliation');
    } catch (reason) { fail(reason); }
    finally { setBusyAction(false); }
  }

  async function markCodPaid(order: Order) {
    setBusyAction(true);
    try {
      const result = await ownerRequest<{ order: Order }>(key, `/api/owner/orders/${encodeURIComponent(order.id)}/cod-payment`, { method: 'PATCH', body: JSON.stringify({ status: 'paid' }) });
      setOrders((current) => current.map((entry) => entry.id === order.id ? result.order : entry));
      notify('Cash collection recorded COD payment marked paid');
      void loadDashboard(key);
    } catch (reason) { fail(reason); }
    finally { setBusyAction(false); }
  }

  async function resolveReturn(order: Order, status: 'approved' | 'rejected') {
    setBusyAction(true);
    try {
      const result = await ownerRequest<{ order: Order }>(key, `/api/owner/orders/${order.id}/return`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setOrders((current) => current.map((entry) => entry.id === order.id ? result.order : entry)); notify(`Return request ${status}`);
    } catch (reason) { fail(reason); }
    finally { setBusyAction(false); }
  }

  async function markReceiptReviewed(review: PaymentReceiptReview) {
    setBusyAction(true);
    try {
      const result = await ownerRequest<{ review: PaymentReceiptReview }>(key, `/api/owner/payment-receipts/${encodeURIComponent(review.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ reviewNote: receiptReviewNotes[review.id] || '' }),
      });
      setPaymentReceiptReviews((current) => current.map((entry) => entry.id === review.id ? result.review : entry));
      notify('Receipt marked reviewed The order payment status was not changed');
    } catch (reason) { fail(reason); }
    finally { setBusyAction(false); }
  }

  async function askAssistant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = new FormData(event.currentTarget).get('message')?.toString().trim() || '';
    if (!prompt) return;
    setChat((current) => [...current, { role: 'owner', text: prompt }]); event.currentTarget.reset(); setBusyAction(true);
    try {
      const result = await ownerRequest<{ reply: string; action?: AgentAction }>(key, '/api/owner/chat', { method: 'POST', body: JSON.stringify({ message: prompt }) });
      setChat((current) => [...current, { role: 'assistant', text: result.reply }]);
      setPendingAgentAction(result.action || null);
    } catch (reason) { fail(reason); }
    finally { setBusyAction(false); }
  }

  async function approveAgentAction() {
    if (!pendingAgentAction) return;
    setBusyAction(true);
    try {
      if (pendingAgentAction.type === 'draft_email') {
        const action = pendingAgentAction;
        const result = await ownerRequest<Omit<EmailDraft, 'orderId' | 'kind'>>(key, '/api/owner/email-agent/draft', {
          method: 'POST', body: JSON.stringify({ orderId: action.orderId, kind: action.kind }),
        });
        setEmailOrderId(action.orderId);
        setEmailKind(action.kind);
        setEmailDraft({ ...result, orderId: action.orderId, kind: action.kind });
        setEmailReviewed(false);
        setEmailSent(false);
        setPendingAgentAction(null);
        setTab('email');
        notify('Email draft prepared Review it before sending');
        return;
      }
      const result = await ownerRequest<{ completed: boolean; message: string }>(key, '/api/owner/agent/execute', {
        method: 'POST', body: JSON.stringify({ action: pendingAgentAction }),
      });
      setChat((current) => [...current, { role: 'assistant', text: result.message }]);
      setPendingAgentAction(null);
      notify(result.message);
      void loadDashboard(key);
    } catch (reason) { fail(reason); }
    finally { setBusyAction(false); }
  }

  async function generateCaption() {
    if (!socialProductId) return;
    setBusyAction(true);
    try { const result = await ownerRequest<{ caption: string }>(key, '/api/owner/social-post', { method: 'POST', body: JSON.stringify({ productId: socialProductId }) }); setCaption(result.caption); }
    catch (reason) { fail(reason); }
    finally { setBusyAction(false); }
  }

  async function generateCustomerEmail() {
    if (!emailOrderId) return;
    setBusyAction(true);
    try {
      const result = await ownerRequest<Omit<EmailDraft, 'orderId' | 'kind'>>(key, '/api/owner/email-agent/draft', {
        method: 'POST', body: JSON.stringify({ orderId: emailOrderId, kind: emailKind }),
      });
      setEmailDraft({ ...result, orderId: emailOrderId, kind: emailKind });
      setEmailReviewed(false);
      setEmailSent(false);
      notify('AI email draft is ready for review');
    } catch (reason) { fail(reason); }
    finally { setBusyAction(false); }
  }

  async function sendCustomerEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!emailDraft || !emailReviewed || emailSent) return;
    setBusyAction(true);
    try {
      const result = await ownerRequest<{ sent: boolean; to: string }>(key, '/api/owner/email-agent/send', {
        method: 'POST',
        body: JSON.stringify({ orderId: emailDraft.orderId, kind: emailDraft.kind, subject: emailDraft.subject, body: emailDraft.body }),
      });
      setEmailSent(true);
      notify(`Email sent to ${result.to}`);
    } catch (reason) { fail(reason); }
    finally { setBusyAction(false); }
  }

  async function resolveSupportTicket(ticket: SupportTicket) {
    setBusyAction(true);
    try {
      const result = await ownerRequest<{ ticket: SupportTicket }>(key, `/api/owner/support-tickets/${encodeURIComponent(ticket.id)}`, {
        method: 'PATCH', body: JSON.stringify({ status: 'resolved' }),
      });
      setSupportTickets((current) => current.map((entry) => entry.id === ticket.id ? result.ticket : entry));
      notify(`Support ticket ${ticket.id} resolved`);
    } catch (reason) { fail(reason); }
    finally { setBusyAction(false); }
  }

  function patchDraft<K extends keyof Product>(field: K, value: Product[K]) { setDraft((current) => current ? { ...current, [field]: value } : current); }

  return <div className="studio-shell">
    <header className="studio-topbar" id="top"><a className="studio-brand" href="#top">AHUZA<span></span><small>OWNER STUDIO</small></a><div className="studio-top-actions"><span className={ready ? 'studio-connection connected' : 'studio-connection'}>{ready ? 'Connected' : 'Private workspace'}</span><button className="studio-icon-button" type="button" onClick={onClose} aria-label="Close Owner Studio"><X size={19} /></button></div></header>
    {!ready ? <main className="studio-gate"><div className="studio-gate-mark"><Settings2 size={20} /></div><p className="studio-eyebrow">AHUZA Apparel · Private</p><h1>Owner Studio</h1><p>Manage the storefront, catalog, orders, and marketing from one workspace</p><form onSubmit={(event) => void unlock(event)}><label>Owner access key<input type="password" value={key} onChange={(event) => setKey(event.target.value)} autoComplete="current-password" placeholder="Enter OWNER_API_KEY" required /></label><button className="studio-primary" disabled={loading}>{loading ? <LoaderCircle className="spin" size={16} /> : null}Open studio <ArrowLeft size={15} /></button></form>{error && <p className="studio-error" role="alert">{error}</p>}<small>The key stays in memory and is cleared when this view closes</small></main> : <div className="studio-layout">
      <aside className="studio-sidebar"><p className="studio-eyebrow">Workspace</p><nav>{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={17} /><span>{label}</span>{id === 'products' && analytics?.lowStock.length ? <b>{analytics.lowStock.length}</b> : id === 'orders' && paymentReceiptReviews.filter((review) => review.status === 'pending_admin_review').length ? <b>{paymentReceiptReviews.filter((review) => review.status === 'pending_admin_review').length}</b> : null}</button>)}</nav><div className="studio-sidebar-bottom"><span className="studio-live-dot" /> Store API online <button onClick={() => { setReady(false); setKey(''); }}>Lock studio</button></div></aside>
      <main className="studio-main"><div className="studio-page-heading"><div><p className="studio-eyebrow">AHUZA Apparel / {tabs.find((item) => item.id === tab)?.label}</p><h1>{tabs.find((item) => item.id === tab)?.label}</h1></div><div className="studio-page-actions"><span className={`site-publication-state ${sitePublished ? 'is-published' : 'is-unpublished'}`}><span />{sitePublished ? 'Published' : 'Unpublished'}</span><button className={sitePublished ? 'studio-unpublish-button' : 'studio-publish-button'} onClick={() => void toggleSitePublication()} disabled={busyAction}>{busyAction ? 'Updating…' : sitePublished ? 'Unpublish site' : 'Publish site'}</button><button className="studio-refresh" onClick={() => void loadDashboard(key)} disabled={loading}><LoaderCircle size={15} className={loading ? 'spin' : ''} /> Refresh</button></div></div>
        {message && <div className="studio-flash success"><Check size={16} />{message}</div>}{error && <div className="studio-flash error">{error}</div>}
        {tab === 'email' && <EmailAgentPanel orders={orders} emailEnabled={Boolean(integrations?.email)} selectedOrderId={emailOrderId} kind={emailKind} draft={emailDraft} reviewed={emailReviewed} sent={emailSent} busy={busyAction} onSelectOrder={(orderId) => { setEmailOrderId(orderId); setEmailDraft(null); setEmailReviewed(false); setEmailSent(false); }} onSelectKind={(kind) => { setEmailKind(kind); setEmailDraft(null); setEmailReviewed(false); setEmailSent(false); }} onGenerate={() => void generateCustomerEmail()} onDraftChange={(field, value) => setEmailDraft((current) => current ? { ...current, [field]: value } : current)} onReview={setEmailReviewed} onSend={(event) => void sendCustomerEmail(event)} />}
        {tab === 'overview' && <section className="studio-section"><div className="studio-metric-grid"><article><span>Paid revenue</span><strong>{money(analytics?.paidRevenue || 0)}</strong><small>Confirmed orders</small></article><article><span>Orders</span><strong>{analytics?.orderCount || 0}</strong><small>All order states</small></article><article><span>Live products</span><strong>{products.filter((product) => product.active).length}</strong><small>{products.length} in catalog</small></article><article className={(analytics?.lowStock.length || 0) > 0 ? 'metric-alert' : ''}><span>Low stock</span><strong>{analytics?.lowStock.length || 0}</strong><small>Fewer than 5 units</small></article></div><div className="studio-overview-grid"><section className="studio-panel"><div className="studio-panel-heading"><h2>Needs attention</h2><button onClick={() => setTab('products')}>Manage stock</button></div>{analytics?.lowStock.length ? analytics.lowStock.map((item) => <div className="studio-list-row" key={item.id}><div><strong>{item.name}</strong><small>{item.sku}</small></div><b className="stock-alert">{item.stock} left</b></div>) : <p className="studio-muted">No products are below the low-stock threshold</p>}</section><section className="studio-panel"><div className="studio-panel-heading"><h2>Recent orders</h2><button onClick={() => setTab('orders')}>View all</button></div>{orders.slice(0, 5).map((order) => <div className="studio-list-row" key={order.id}><div><strong>{order.shippingAddress.name}</strong><small>{order.id.slice(0, 8)} · {new Date(order.createdAt).toLocaleDateString()}</small></div><span className={`order-status status-${order.status}`}>{order.status.replaceAll('_', ' ')}</span></div>)}{orders.length === 0 && <p className="studio-muted">Orders will appear here after checkout</p>}</section></div><section className="studio-panel"><div className="studio-panel-heading"><h2>Store activity</h2><span>Recent tracked events</span></div><div className="event-chips">{Object.entries(analytics?.eventCounts || {}).map(([name, count]) => <span key={name}>{name.replaceAll('_', ' ')} <b>{count}</b></span>)}</div></section></section>}
        {tab === 'products' && <section className="studio-section studio-product-layout"><div className="studio-panel studio-product-list"><div className="studio-panel-heading"><h2>Catalog</h2><button className="studio-add" onClick={() => { setDraft(initialProduct()); setIsNew(true); }}><Plus size={15} /> Add product</button></div>{products.map((product) => <button key={product.id} className={`studio-product-row ${draft?.id === product.id && !isNew ? 'selected' : ''}`} onClick={() => { setDraft(structuredClone(product)); setIsNew(false); }}><img src={product.imageUrl} alt="" /><span><strong>{product.name}</strong><small>{product.sku} · {product.category}</small></span><span className={product.stock < 5 ? 'stock-alert' : ''}>{product.stock} in stock</span></button>)}</div><form className="studio-panel studio-editor" onSubmit={(event) => void saveProduct(event)}><div className="studio-panel-heading"><div><h2>{isNew ? 'New product' : draft?.name || 'Product editor'}</h2><span>Changes publish to the live catalog</span></div>{draft ? <label className="studio-status">Status<select value={draft.active ? 'published' : 'unpublished'} onChange={(event) => patchDraft('active', event.target.value === 'published')}><option value="published">Published</option><option value="unpublished">Unpublished</option></select></label> : null}</div>{draft ? <><div className="studio-form-grid"><label className="wide">Product name<input value={draft.name} onChange={(event) => patchDraft('name', event.target.value)} maxLength={120} required /></label><label className="wide">Description<textarea value={draft.description} onChange={(event) => patchDraft('description', event.target.value)} maxLength={1000} required /></label><label>Price (INR)<input type="number" min="1" max="10000000" step="1" value={draft.price || ''} onChange={(event) => patchDraft('price', Number(event.target.value))} required /></label><label>Category<input value={draft.category} onChange={(event) => patchDraft('category', event.target.value)} maxLength={80} required /></label><label>Product code / SKU<input value={draft.sku} onChange={(event) => patchDraft('sku', event.target.value)} maxLength={80} required /></label><label>Stock<input type="number" min="0" max="100000" step="1" value={draft.stock} onChange={(event) => patchDraft('stock', Number(event.target.value))} required /></label><div className="wide"><AvailableSizes sizes={draft.sizes || []} onChange={(sizes) => patchDraft('sizes', sizes)} /></div><div className="wide"><ProductImageManager ownerKey={key} images={draft.images || []} mainImageId={draft.mainImageId} legacyUrl={draft.imageUrl} maxMb={maxUploadMb} onChange={(images, mainImageId) => setDraft((current) => current ? { ...current, images, mainImageId } : current)} onPendingChange={setImagesPending} onMessage={notify} /></div><label className="wide">Ghost mannequin image URL<input type="url" value={draft.ghostMannequin.imageUrl || ''} onChange={(event) => patchDraft('ghostMannequin', { ...draft.ghostMannequin, imageUrl: event.target.value })} placeholder="Optional HTTPS image URL" /></label><label className="wide">Ghost mannequin tags<input value={draft.ghostMannequin.tags.join(', ')} onChange={(event) => patchDraft('ghostMannequin', { ...draft.ghostMannequin, tags: event.target.value.split(',').map((tag) => tag.trim()) })} placeholder="relaxed fit, cotton, front view" /></label><label className="wide">Display background<input value={draft.ghostMannequin.background || ''} onChange={(event) => patchDraft('ghostMannequin', { ...draft.ghostMannequin, background: event.target.value })} placeholder="#f4f1e9" /></label></div><button className="studio-primary" disabled={busyAction || imagesPending}>{busyAction ? 'Saving…' : imagesPending ? 'Uploading images…' : isNew ? 'Create product' : 'Save product'} <Check size={15} /></button></> : <p className="studio-muted studio-editor-empty">Choose a product to edit or add a new listing</p>}</form></section>}
        {tab === 'imageSettings' && imageSettings && <ImageSettingsPanel settings={imageSettings} maxUploadMb={maxUploadMb} busy={busyAction} onSave={saveImageSettings} />}
        {tab === 'content' && <form className="studio-section studio-content-form" onSubmit={(event) => void saveContent(event)}><section className="studio-panel"><div className="studio-panel-heading"><div><h2>Announcement bar</h2><span>Short message above the navigation</span></div><Megaphone size={18} /></div><label>Announcement text<input value={content.announcement} onChange={(event) => setContent({ ...content, announcement: event.target.value })} maxLength={200} required /></label></section><section className="studio-panel"><div className="studio-panel-heading"><div><h2>Homepage hero</h2><span>Primary campaign image and copy</span></div><Image size={18} /></div><div className="studio-form-grid"><label>Eyebrow<input value={content.heroEyebrow} onChange={(event) => setContent({ ...content, heroEyebrow: event.target.value })} maxLength={120} required /></label><label>Headline<input value={content.heroTitle} onChange={(event) => setContent({ ...content, heroTitle: event.target.value })} maxLength={120} required /></label><label className="wide">Supporting text<textarea value={content.heroDescription} onChange={(event) => setContent({ ...content, heroDescription: event.target.value })} maxLength={500} required /></label><div className="wide content-upload"><span>Hero image</span><label className="studio-secondary upload-trigger">{uploadingField === 'heroImageUrl' ? 'Uploading…' : content.heroImageUrl ? 'Replace image' : 'Upload image'}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={uploadingField !== null} onChange={(event) => void uploadContentImage('heroImageUrl', event)} /></label><small>JPG, PNG or WebP from your gallery or computer Click Publish to save</small></div></div>{content.heroImageUrl && <img className="studio-image-preview" src={content.heroImageUrl} alt="Hero image preview" />}</section><section className="studio-panel"><div className="studio-panel-heading"><div><h2>Our approach</h2><span>Story panel below the collection</span></div><Image size={18} /></div><div className="studio-form-grid"><label>Headline<input value={content.storyHeading} onChange={(event) => setContent({ ...content, storyHeading: event.target.value })} maxLength={120} required /></label><label className="wide">Story text<textarea value={content.storyBody} onChange={(event) => setContent({ ...content, storyBody: event.target.value })} maxLength={500} required /></label><div className="wide content-upload"><span>Story image</span><label className="studio-secondary upload-trigger">{uploadingField === 'storyImageUrl' ? 'Uploading…' : content.storyImageUrl ? 'Replace image' : 'Upload image'}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={uploadingField !== null} onChange={(event) => void uploadContentImage('storyImageUrl', event)} /></label><small>JPG, PNG or WebP from your gallery or computer Click Publish to save</small></div></div>{content.storyImageUrl && <img className="studio-image-preview story-preview" src={content.storyImageUrl} alt="Story image preview" />}</section><section className="studio-panel"><div className="studio-panel-heading"><div><h2>Category circles</h2><span>Round images under "Shop by category" Edit the name to fix spelling, and upload a photo or the first product image is used</span></div><Image size={18} /></div><div className="studio-slot-grid">{circleLabels.map((label) => { const url = content.circleImages?.[label]; const busy = uploadingField === `circleImages:${label}`; return <div className="studio-slot" key={label}><span className="studio-slot-circle">{url ? <img src={url} alt={`${label} circle preview`} /> : <em>Default</em>}</span><label className="studio-slot-name"><span className="sr-only">Display name for {label}</span><input value={content.circleLabels?.[label] ?? label} maxLength={40} onChange={(event) => setContent({ ...content, circleLabels: { ...(content.circleLabels || {}), [label]: event.target.value } })} /></label><label className="studio-secondary upload-trigger">{busy ? 'Uploading…' : url ? 'Replace' : 'Upload'}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={uploadingField !== null} onChange={(event) => void uploadMappedImage('circleImages', label, event)} /></label>{url && <button type="button" className="studio-link-button" onClick={() => resetMappedImage('circleImages', label)}>Use default</button>}</div>; })}</div></section><section className="studio-panel"><div className="studio-panel-heading"><div><h2>Campaign banners</h2><span>Extra homepage slides The main hero image is set above</span></div><Image size={18} /></div><div className="studio-slot-grid studio-slot-wide">{bannerSlots.map((slot) => { const url = content.bannerImages?.[slot.key]; const busy = uploadingField === `bannerImages:${slot.key}`; return <div className="studio-slot" key={slot.key}><span className="studio-slot-banner">{url ? <img src={url} alt={`${slot.label} preview`} /> : <em>Default</em>}</span><strong>{slot.label}</strong><label className="studio-secondary upload-trigger">{busy ? 'Uploading…' : url ? 'Replace' : 'Upload'}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={uploadingField !== null} onChange={(event) => void uploadMappedImage('bannerImages', slot.key, event)} /></label>{url && <button type="button" className="studio-link-button" onClick={() => resetMappedImage('bannerImages', slot.key)}>Use default</button>}</div>; })}</div></section><button className="studio-primary studio-publish" disabled={busyAction}>{busyAction ? 'Publishing…' : 'Publish storefront changes'} <Check size={16} /></button></form>}
        {tab === 'content' && <form className="studio-section studio-content-form" onSubmit={(event) => void saveContent(event)}>
          <section className="studio-panel">
            <div className="studio-panel-heading"><div><h2>Additional storefront text</h2><span>Edit homepage campaigns, section headings, service information, contact, newsletter, and footer copy</span></div><Megaphone size={18} /></div>
            {storefrontCopyGroups.map((group) => <fieldset className="studio-copy-group" key={group}>
              <legend>{group}</legend>
              <div className="studio-form-grid">
                {storefrontCopyFields.filter((field) => field.group === group).map((field) => <label key={field.id}>{field.label}
                  <textarea rows={field.defaultValue.length > 70 ? 3 : 1} maxLength={500} required value={content.copy?.[field.id] ?? defaultStorefrontCopy[field.id]} onChange={(event) => setContent({ ...content, copy: { ...content.copy, [field.id]: event.target.value } })} />
                </label>)}
              </div>
            </fieldset>)}
          </section>
          <button className="studio-primary studio-publish" disabled={busyAction}>{busyAction ? 'Publishing…' : 'Publish storefront text'} <Check size={16} /></button>
        </form>}
        {tab === 'orders' && <section className="studio-section studio-orders">
          <section className="studio-panel">
            <div className="studio-panel-heading"><div><h2>UPI receipt review queue</h2><span>Gemini extracts details only; independently verify any transfer</span></div></div>
            <p className="studio-payment-caution">Reviewing a receipt never marks an order paid Only a bank-settled transaction confirmed by an authorized owner can mark a direct UPI order paid</p>
            {paymentReceiptReviews.filter((review) => review.status === 'pending_admin_review').length === 0
              ? <p className="studio-muted">No receipts are awaiting review</p>
              : paymentReceiptReviews.filter((review) => review.status === 'pending_admin_review').map((review) => {
                const order = orders.find((entry) => entry.id === review.orderId);
                return <article className="studio-receipt-review" key={review.id}>
                  <div className="studio-panel-heading"><div><h3>{order?.shippingAddress.name || 'Customer'} · Order {review.orderId.slice(0, 8)}</h3><span>Submitted {new Date(review.createdAt).toLocaleString()}</span></div><span className="order-status status-pending_payment">Needs review</span></div>
                  <dl><div><dt>Expected</dt><dd>{money(review.expectedAmount)}</dd></div><div><dt>Extracted paid amount</dt><dd>{review.extraction.amountPaid === null ? 'Not found' : money(review.extraction.amountPaid)}</dd></div><div><dt>UTR/reference</dt><dd>{review.extraction.utrNumber || 'Not found'}</dd></div><div><dt>Receiver UPI</dt><dd>{review.extraction.receiverUpiId || 'Not found'}</dd></div><div><dt>Receipt date</dt><dd>{review.extraction.date || 'Not found'}</dd></div><div><dt>AI success text</dt><dd>{review.extraction.isSuccessful ? 'Appears successful' : 'Not successful / unclear'}</dd></div></dl>
                  {review.flags.length > 0 && <ul>{review.flags.map((flag) => <li key={flag}>{flag}</li>)}</ul>}
                  <label>Review note (optional)<textarea value={receiptReviewNotes[review.id] || ''} onChange={(event) => setReceiptReviewNotes((current) => ({ ...current, [review.id]: event.target.value }))} maxLength={500} rows={2} /></label>
                  <button className="studio-secondary" type="button" onClick={() => void markReceiptReviewed(review)} disabled={busyAction}>Mark reviewed <Check size={15} /></button>
                </article>;
              })}
          </section>
          {orders.length === 0 && <section className="studio-panel"><p className="studio-muted">There are no orders yet</p></section>}
          {orders.map((order) => <article className="studio-panel studio-order" key={order.id}>
            <div className="studio-order-heading"><div><span className="studio-eyebrow">{order.id}</span><h2>{order.shippingAddress.name}</h2><p>{new Date(order.createdAt).toLocaleString()} · {money(order.amount / 100)}</p><p>{order.paymentMethod === 'cod' ? 'Cash on delivery' : 'UPI'} ·             payment {order.paymentStatus || 'pending'}{order.paymentVerificationMethod === 'demo_webhook' ? ' · DEMO ONLY — no money moved' : ''}{order.paymentReference ? ` · reference ${order.paymentReference}` : ''}</p></div><span className={`order-status status-${order.status}`}>{order.status.replaceAll('_', ' ')}</span></div>
            <div className="studio-order-details"><div><h3>Delivery</h3><p>{order.shippingAddress.addressLine1}{order.shippingAddress.addressLine2 ? `, ${order.shippingAddress.addressLine2}` : ''}<br />{order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}<br />{order.shippingAddress.phone}</p><label>Tracking number<input value={order.trackingNumber || ''} onChange={(event) => setOrders((current) => current.map((entry) => entry.id === order.id ? { ...entry, trackingNumber: event.target.value } : entry))} placeholder="Carrier tracking reference" maxLength={100} /></label><label>Carrier tracking link<input type="url" value={order.trackingUrl || ''} onChange={(event) => setOrders((current) => current.map((entry) => entry.id === order.id ? { ...entry, trackingUrl: event.target.value } : entry))} placeholder="https://carrier.example/track/…" maxLength={2000} onBlur={(event) => { if (event.target.value && !event.target.value.startsWith('https://')) fail(new Error('Tracking link must start with https://')); }} /></label></div><div><h3>Items</h3>{order.items.map((item, index) => <p key={`${item.sku}-${index}`}>{item.quantity} × {item.name}{item.size ? ` · Size ${item.size}` : ''} <small>({item.sku})</small></p>)}{order.review && <div className="owner-order-review"><strong>Customer rating: {'★'.repeat(order.review.rating)}{'☆'.repeat(5 - order.review.rating)}</strong>{order.review.comment && <p>{order.review.comment}</p>}<small>{new Date(order.review.createdAt).toLocaleString()}</small></div>}</div></div>
                        {order.returnRequest && <div className="studio-return"><div><strong>{order.returnRequest.action} requested · {order.returnRequest.status}</strong><p>{order.returnRequest.reason}</p></div>{order.returnRequest.status === 'requested' && <div className="studio-return-actions"><button onClick={() => void resolveReturn(order, 'approved')} disabled={busyAction}>Approve</button><button onClick={() => void resolveReturn(order, 'rejected')} disabled={busyAction}>Decline</button></div>}</div>}
            {order.paymentMethod === 'upi' && ((order.status === 'pending_payment' && ['pending', 'failed', 'cancelled'].includes(order.paymentStatus || 'pending')) || (order.status === 'cancelled' && order.paymentStatus === 'expired')) && <div className="studio-payment-verification"><label>Bank UTR/reference (owner only)<input value={bankReferences[order.id] || ''} onChange={(event) => setBankReferences((current) => ({ ...current, [order.id]: event.target.value }))} minLength={6} maxLength={80} pattern="[A-Za-z0-9-]{6,80}" placeholder="Enter after checking settled bank credit" /></label><button className="studio-secondary" type="button" onClick={() => void confirmUpiPayment(order)} disabled={busyAction}>Confirm after bank verification <Check size={15} /></button><small>Never confirm from a customer claim, receipt, screenshot or UPI app screen Match the settled amount, merchant VPA and order reference in the bank account Expired payments can only be confirmed if all original items remain in stock</small></div>}
            <div className="studio-order-actions">{(order.status === 'paid' || (order.paymentMethod === 'cod' && order.status === 'confirmed')) && <button className="studio-primary" onClick={() => void updateOrder(order, 'shipped')} disabled={busyAction}>Mark shipped <PackageCheck size={15} /></button>}{order.status === 'shipped' && <button className="studio-primary" onClick={() => void updateOrder(order, 'out_for_delivery')} disabled={busyAction}>Mark out for delivery <PackageCheck size={15} /></button>}{order.status === 'out_for_delivery' && <button className="studio-primary" onClick={() => void updateOrder(order, 'delivered')} disabled={busyAction}>Mark delivered <Check size={15} /></button>}{order.paymentMethod === 'cod' && order.status === 'delivered' && order.paymentStatus === 'pending' && <button className="studio-secondary" onClick={() => void markCodPaid(order)} disabled={busyAction}>Mark cash collected / paid <Check size={15} /></button>}<small>Status updates email the customer Mark out for delivery when the carrier reports it; carrier status is not automatically connected</small><small>Returns and replacements are accepted within 7 days after delivery</small></div>
          </article>)}
        </section>}
        {tab === 'support' && <section className="studio-section studio-orders">{supportTickets.length === 0 ? <section className="studio-panel"><p className="studio-muted">No customer support tickets yet</p></section> : supportTickets.map((ticket) => <article className="studio-panel" key={ticket.id}><div className="studio-panel-heading"><div><span className="studio-eyebrow">{ticket.id}</span><h2>{ticket.category === 'delivery' ? 'Delivery issue' : ticket.category === 'complaint' ? 'Customer complaint' : 'Customer request'}</h2><span>{ticket.email} · {new Date(ticket.createdAt).toLocaleString()}</span></div><span className={`order-status status-${ticket.status}`}>{ticket.status}</span></div><p className="studio-ticket-message">{ticket.message}</p>{ticket.status === 'open' && <button className="studio-secondary" onClick={() => void resolveSupportTicket(ticket)} disabled={busyAction}>Mark resolved <Check size={15} /></button>}</article>)}</section>}
        {tab === 'marketing' && <><MarketingDashboard integrations={integrations} eventCounts={analytics?.eventCounts || {}} /><MarketingAutomations ownerKey={key} /></>}
        {tab === 'social' && <SocialScheduler ownerKey={key} />}
        {tab === 'ads' && <AdStudio ownerKey={key} products={products} aiReady={Boolean(integrations?.ai)} />}
        {tab === 'assistant' && <section className="studio-panel studio-assistant"><div className="studio-panel-heading"><div><h2>AHUZA AI agent</h2><span>Live store context with approval before changes</span></div><Sparkles size={18} /></div>{!integrations?.ai && <p className="studio-agent-setup">Set OPENAI_API_KEY to enable natural-language planning Exact stock commands still produce approval proposals</p>}<div className="assistant-thread">{chat.length === 0 && <div className="assistant-welcome"><Sparkles size={19} /><p>What should I look into or prepare?</p><small>Inventory, order updates, and customer email drafts</small></div>}{chat.map((entry, index) => <div className={`assistant-message ${entry.role}`} key={`${entry.role}-${index}`}><span>{entry.role === 'owner' ? 'You' : 'AHUZA agent'}</span><p>{entry.text}</p></div>)}{pendingAgentAction && <div className="assistant-action"><div><strong>{pendingAgentAction.type === 'update_stock' ? 'Inventory change' : pendingAgentAction.type === 'update_order_status' ? 'Order status change' : 'Customer email draft'}</strong><p>{pendingAgentAction.type === 'update_stock' ? `${pendingAgentAction.productName} (${pendingAgentAction.sku}): ${pendingAgentAction.previousStock} → ${pendingAgentAction.stock} units` : pendingAgentAction.type === 'update_order_status' ? `${pendingAgentAction.orderId}: ${pendingAgentAction.previousStatus} → ${pendingAgentAction.status}` : `${pendingAgentAction.kind.replaceAll('_', ' ')} for order ${pendingAgentAction.orderId}`}</p>{pendingAgentAction.type === 'draft_email' && <small>The agent will prepare a draft It will not send without your separate review</small>}</div><div><button type="button" className="studio-secondary" onClick={() => setPendingAgentAction(null)} disabled={busyAction}>Dismiss</button><button type="button" className="studio-primary" onClick={() => void approveAgentAction()} disabled={busyAction}>{pendingAgentAction.type === 'draft_email' ? 'Prepare draft' : 'Approve action'} <Check size={15} /></button></div></div>}{busyAction && <div className="assistant-typing"><LoaderCircle className="spin" size={15} /> Working…</div>}</div><form className="assistant-compose" onSubmit={(event) => void askAssistant(event)}><input name="message" maxLength={4000} placeholder="Ask the agent about your store…" aria-label="Message the AHUZA AI agent" required disabled={busyAction || Boolean(pendingAgentAction)} /><button aria-label="Send message" disabled={busyAction || Boolean(pendingAgentAction)}><Send size={17} /></button></form></section>}
        {tab === 'social' && <section className="studio-section studio-social"><section className="studio-panel"><div className="studio-panel-heading"><div><h2>Social post generator</h2><span>AI writes a product-aware caption using live catalog details</span></div><Sparkles size={18} /></div>{!integrations?.ai && <p className="studio-agent-setup" role="status">AI caption generation is unavailable until OPENAI_API_KEY is set in the server environment Configure the key and refresh Owner Studio to enable this tool</p>}<label>Choose a live product<select value={socialProductId} onChange={(event) => setSocialProductId(event.target.value)}>{products.filter((product) => product.active).map((product) => <option key={product.id} value={product.id}>{product.name} · {product.stock} in stock</option>)}</select></label><button className="studio-primary" onClick={() => void generateCaption()} disabled={busyAction || !socialProductId || !integrations?.ai}>{busyAction ? 'Writing…' : 'Generate caption'} <Sparkles size={15} /></button>{caption && <label className="caption-output">Generated copy<textarea value={caption} onChange={(event) => setCaption(event.target.value)} rows={7} /><small>Review product claims and pricing before publishing</small></label>}</section></section>}
      </main>
    </div>}
  </div>;
}
