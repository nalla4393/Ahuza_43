import { useEffect, useState, type FormEvent } from 'react';
import { LoaderCircle, MessageCircle, Send, X } from 'lucide-react';
import './customer-support.css';
import { removeSentenceFullStops } from './siteCopy';

type ChatMessage = { role: 'assistant' | 'customer'; text: string };
type Choice = { label: string; value: string };
type ChatOrder = { id: string; status: string; trackingNumber?: string; deliveredAt?: string; returnRequest?: { action: string; status: string; reason: string; createdAt: string } };
type SupportTask = 'tracking' | 'return-status' | 'return-order' | 'return-reason' | 'pincode' | 'coupon' | 'product' | 'general';
type ReturnDetails = { orderId: string; action: 'return' | 'replacement' };

const menus: Record<string, { prompt: string; choices: Choice[] }> = {
  home: { prompt: 'Hi! How can we help you today? Please select the type of issue you’re facing:', choices: [
    { label: 'Billing / Order', value: 'billing' }, { label: 'Product Related', value: 'product-menu' },
    { label: 'Enquiry', value: 'enquiry' }, { label: 'Other', value: 'other' },
  ] },
  billing: { prompt: 'What do you need help with?', choices: [
    { label: 'Order Tracking', value: 'tracking' }, { label: 'Delivery Issue', value: 'delivery-menu' },
    { label: 'Return / Exchange', value: 'return-menu' }, { label: 'Discount / Coupon Issue', value: 'coupon' },
    { label: 'Payment / Billing Issue', value: 'payment-menu' },
  ] },
  'delivery-menu': { prompt: 'What issue are you facing with your delivery?', choices: [
    { label: 'Delivery delayed', value: 'delivery-details' }, { label: 'Order not received', value: 'delivery-details' },
    { label: 'Wrong delivery address', value: 'delivery-details' }, { label: 'Delivery to my PIN code', value: 'pincode' },
    { label: 'Damaged package', value: 'delivery-details' }, { label: 'Other delivery issue', value: 'delivery-details' },
  ] },
  'return-menu': { prompt: 'What do you need help with?', choices: [
    { label: 'Return a product', value: 'return-product' }, { label: 'Exchange a product', value: 'exchange-product' },
    { label: 'Return / exchange status', value: 'return-status' }, { label: 'Return / exchange policy', value: 'return-policy' },
    { label: 'Product received damaged', value: 'delivery-details' }, { label: 'Wrong product received', value: 'delivery-details' },
  ] },
  'payment-menu': { prompt: 'What payment or billing issue are you facing?', choices: [
    { label: 'Payment failed', value: 'payment-details' }, { label: 'Payment deducted but order not confirmed', value: 'payment-details' },
    { label: 'Refund issue', value: 'payment-details' }, { label: 'Invoice / bill issue', value: 'payment-details' },
    { label: 'Other payment issue', value: 'payment-details' },
  ] },
  'product-menu': { prompt: 'What information do you need about a product?', choices: [
    { label: 'Size Issue', value: 'size-menu' }, { label: 'Measurements', value: 'measurements-menu' },
    { label: 'Colour Related', value: 'colour-menu' }, { label: 'Model / Design Related', value: 'design-menu' },
    { label: 'Product Description', value: 'product-details' }, { label: 'Product Specifications', value: 'product-details' },
  ] },
  'size-menu': { prompt: 'What would you like help with?', choices: [
    { label: 'Which size should I choose?', value: 'product-details' }, { label: 'Size chart', value: 'product-details' },
    { label: 'Size unavailable', value: 'product-details' }, { label: 'Size exchange', value: 'exchange-product' },
    { label: 'Fit-related question', value: 'product-details' },
  ] },
  'measurements-menu': { prompt: 'Which measurement do you need?', choices: [
    { label: 'Bust', value: 'product-details' }, { label: 'Waist', value: 'product-details' },
    { label: 'Hip', value: 'product-details' }, { label: 'Length', value: 'product-details' },
    { label: 'Sleeve length', value: 'product-details' }, { label: 'Kurti / bottom length', value: 'product-details' },
    { label: 'Other measurement', value: 'product-details' },
  ] },
  'colour-menu': { prompt: 'What would you like to know about the colour?', choices: [
    { label: 'Available colours', value: 'product-details' }, { label: 'Colour availability', value: 'product-details' },
    { label: 'Colour shown in the image', value: 'product-details' }, { label: 'Other colour question', value: 'product-details' },
  ] },
  'design-menu': { prompt: 'What would you like to know about the design?', choices: [
    { label: 'Design details', value: 'product-details' }, { label: 'Pattern', value: 'product-details' },
    { label: 'Neck / sleeve design', value: 'product-details' }, { label: 'Fit / style', value: 'product-details' },
    { label: 'Available variants', value: 'product-details' },
  ] },
  enquiry: { prompt: 'What would you like to enquire about?', choices: [
    { label: 'Product enquiry', value: 'product-details' }, { label: 'Availability enquiry', value: 'product-details' },
    { label: 'Bulk / wholesale enquiry', value: 'general-details' }, { label: 'Delivery enquiry', value: 'delivery-details' },
    { label: 'Business enquiry', value: 'general-details' }, { label: 'General enquiry', value: 'general-details' },
    { label: 'Other', value: 'general-details' },
  ] },
  other: { prompt: 'Please select what you need help with:', choices: [
    { label: 'Complaint', value: 'support-ticket' }, { label: 'Subscription', value: 'general-details' },
    { label: 'Profile / Account', value: 'general-details' }, { label: 'Address', value: 'general-details' },
    { label: 'Delivery to PIN Code', value: 'pincode' }, { label: 'Product Specifications', value: 'product-details' },
    { label: 'Other', value: 'general-details' },
  ] },
};

const childMenus: Record<string, string> = {
  billing: 'billing', 'product-menu': 'product-menu', enquiry: 'enquiry', other: 'other',
  'delivery-menu': 'delivery-menu', 'return-menu': 'return-menu', 'payment-menu': 'payment-menu',
  'size-menu': 'size-menu', 'measurements-menu': 'measurements-menu', 'colour-menu': 'colour-menu', 'design-menu': 'design-menu',
};

function statusLabel(status: string): string {
  return ({
    pending_payment: 'Order placed — awaiting payment confirmation',
    paid: 'Confirmed / processing',
    shipped: 'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
  } as Record<string, string>)[status] || 'Status unavailable';
}

async function readJsonResponse<T>(response: Response, serviceName: string): Promise<T> {
  const body = await response.text();
  if (!body) throw new Error(`${serviceName} returned an empty response Please try again`);
  try { return removeSentenceFullStops(JSON.parse(body) as T); }
  catch { throw new Error(`${serviceName} returned an invalid response Please try again`); }
}

type Props = { onOpenAccount: () => void };

export default function CustomerSupportChat({ onOpenAccount }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ticketBusy, setTicketBusy] = useState(false);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [requiresHumanSupport, setRequiresHumanSupport] = useState(false);
  const [supportAvailable, setSupportAvailable] = useState(false);
  const [menuPath, setMenuPath] = useState(['home']);
  const [leafOpen, setLeafOpen] = useState(false);
  const [task, setTask] = useState<SupportTask | null>(null);
  const [returnDetails, setReturnDetails] = useState<ReturnDetails | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', text: menus.home.prompt },
  ]);

  useEffect(() => {
    const toggle = () => setOpen((current) => !current);
    window.addEventListener('ahuza:toggle-support', toggle);
    return () => window.removeEventListener('ahuza:toggle-support', toggle);
  }, []);

  useEffect(() => {
    const updateHours = () => {
      const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
      setSupportAvailable(hour >= 10 && hour < 21);
    };
    updateHours();
    const timer = window.setInterval(updateHours, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  function addMessage(message: ChatMessage) {
    setMessages((current) => [...current.slice(-38), { ...message, text: removeSentenceFullStops(message.text) }]);
  }

  function resetToMainMenu() {
    setMenuPath(['home']);
    setLeafOpen(false);
    setTask(null);
    setReturnDetails(null);
    setTicketOpen(false);
    setRequiresHumanSupport(false);
    addMessage({ role: 'assistant', text: menus.home.prompt });
  }

  function goBack() {
    if (leafOpen) {
      setLeafOpen(false);
      setTask(null);
      setReturnDetails(null);
      addMessage({ role: 'assistant', text: menus[menuPath.at(-1) || 'home'].prompt });
      return;
    }
    if (menuPath.length > 1) {
      const previous = menuPath.slice(0, -1);
      setMenuPath(previous);
      addMessage({ role: 'assistant', text: menus[previous.at(-1) || 'home'].prompt });
    }
  }

  function beginLeaf(value: string, label: string) {
    setLeafOpen(true);
    setTask(null);
    setReturnDetails(null);
    if (value === 'tracking' || value === 'return-status') {
      setTask(value);
      addMessage({ role: 'assistant', text: 'Please enter your order ID Sign in to your AHUZA account first so I can show only your order information' });
    } else if (value === 'return-product' || value === 'exchange-product') {
      setTask('return-order');
      setReturnDetails({ orderId: '', action: value === 'exchange-product' ? 'replacement' : 'return' });
      addMessage({ role: 'assistant', text: 'Please enter the order ID for the delivered order Returns and replacements may be requested within 7 days after delivery; eligibility will be checked by the order system' });
    } else if (value === 'return-policy') {
      addMessage({ role: 'assistant', text: 'AHUZA accepts return or replacement requests within 7 days after delivery The order system checks eligibility when a request is submitted' });
    } else if (value === 'pincode') {
      setTask('pincode');
      addMessage({ role: 'assistant', text: 'Please enter your 6-digit PIN code I do not have access to AHUZA delivery serviceability data, so I will not guess availability' });
    } else if (value === 'coupon') {
      setTask('coupon');
      addMessage({ role: 'assistant', text: 'Coupon and discount data is not available in the store system, so I cannot verify a code or eligibility You can enter the code and details for a support request' });
    } else if (value === 'product-details') {
      setTask('product');
      addMessage({ role: 'assistant', text: `Please enter the product name and your question about ${label.toLowerCase()} I’ll use only information in the product catalogue; measurements or variants not listed there are unavailable` });
    } else if (value === 'support-ticket') {
      setRequiresHumanSupport(true);
      setTicketOpen(true);
      addMessage({ role: 'assistant', text: 'Please share your complaint and a contact email so I can create a support ticket' });
    } else {
      setTask('general');
      addMessage({ role: 'assistant', text: `Please describe your ${label.toLowerCase()} question I’ll answer from available store information or help you contact support` });
    }
  }

  function chooseOption(choice: Choice) {
    addMessage({ role: 'customer', text: choice.label });
    const nextMenu = childMenus[choice.value];
    if (nextMenu) {
      setMenuPath((current) => [...current, nextMenu]);
      setLeafOpen(false);
      setTask(null);
      addMessage({ role: 'assistant', text: menus[nextMenu].prompt });
      return;
    }
    beginLeaf(choice.value, choice.label);
  }

  function routeNaturalMessage(message: string): boolean {
    const normalized = message.toLowerCase();
    const paths: [RegExp, string[], string, string][] = [
      [/\b(order|package|parcel).{0,25}\b(track|where|status|arrive)|\bwhere('?s| is) my order\b/i, ['home', 'billing'], 'tracking', 'Order Tracking'],
      [/\b(coupon|promo|discount)\b/i, ['home', 'billing'], 'coupon', 'Discount / Coupon Issue'],
      [/\b\d{6}\b.{0,30}\bdeliver|deliver.{0,30}\b\d{6}\b|serviceability/i, ['home', 'other'], 'pincode', 'Delivery to PIN Code'],
      [/\b(size|tight|loose|fit|measurement|bust|waist|hip)\b/i, ['home', 'product-menu'], 'product-details', 'Size / Measurements'],
      [/\b(colou?r|fabric|material|specification|design|product|stock|available)\b/i, ['home', 'product-menu'], 'product-details', 'Product Information'],
      [/\b(return|exchange|replacement)\b/i, ['home', 'billing', 'return-menu'], 'return-product', 'Return / Exchange'],
      [/\b(payment|paid|billing|refund|invoice)\b/i, ['home', 'billing', 'payment-menu'], 'payment-details', 'Payment / Billing Issue'],
      [/\b(delivery|shipping|shipped|damaged|wrong item)\b/i, ['home', 'billing', 'delivery-menu'], 'delivery-details', 'Delivery Issue'],
      [/\b(complaint|human|person|support agent)\b/i, ['home', 'other'], 'support-ticket', 'Talk to Support'],
    ];
    const matched = paths.find(([pattern]) => pattern.test(normalized));
    if (!matched) return false;
    const [, path, leaf, label] = matched;
    setMenuPath(path);
    beginLeaf(leaf, label);
    return true;
  }

  async function lookUpOrder(orderId: string): Promise<ChatOrder | null> {
    const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}`);
    const result = await readJsonResponse<{ order?: ChatOrder; error?: string }>(response, 'Order service');
    if (response.status === 401) {
      addMessage({ role: 'assistant', text: 'Please sign in to look up an order I’ll open the secure account sign-in' });
      onOpenAccount();
      return null;
    }
    if (!response.ok || !result.order) throw new Error(result.error || 'I could not find that order in your account');
    return result.order;
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = new FormData(form).get('message')?.toString().trim() || '';
    if (!message || busy) return;
    form.reset();
    addMessage({ role: 'customer', text: message });
    if (!leafOpen && routeNaturalMessage(message)) return;
    setBusy(true);
    try {
      if (task === 'pincode') {
        if (!/^[1-9]\d{5}$/.test(message)) throw new Error('Please enter a valid 6-digit Indian PIN code');
        addMessage({ role: 'assistant', text: 'Serviceability information is unavailable in AHUZA’s system, so I cannot confirm delivery to this PIN code Would you like to contact support?' });
        setRequiresHumanSupport(true);
      } else if (task === 'tracking' || task === 'return-status' || task === 'return-order') {
        const order = await lookUpOrder(message);
        if (order && task === 'tracking') {
          addMessage({ role: 'assistant', text: `Order ${order.id}: ${statusLabel(order.status)}${order.trackingNumber ? ` Tracking reference: ${order.trackingNumber}` : ' Live courier milestones are not available in the order system'}` });
        } else if (order && task === 'return-status') {
          const returnRequest = order.returnRequest;
          addMessage({ role: 'assistant', text: returnRequest
            ? `Your ${returnRequest.action} request for order ${order.id} is ${returnRequest.status}`
            : `There is no return or exchange request recorded for order ${order.id}` });
        } else if (order && task === 'return-order') {
          setReturnDetails((current) => current ? { ...current, orderId: order.id } : null);
          if (order.status !== 'delivered') {
            addMessage({ role: 'assistant', text: `The order system shows this order as ${statusLabel(order.status)} A return or replacement cannot be submitted from chat unless the order is delivered Contact support if you need help` });
            setRequiresHumanSupport(true);
          } else {
            setTask('return-reason');
            addMessage({ role: 'assistant', text: 'Please describe the reason for your return or replacement request The order system will confirm whether it is eligible' });
          }
        }
      } else if (task === 'return-reason' && returnDetails) {
        const response = await fetch(`/api/orders/${encodeURIComponent(returnDetails.orderId)}/returns`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: returnDetails.action, reason: message }),
        });
        const result = await readJsonResponse<{ order?: { returnRequest?: { status: string } }; error?: string }>(response, 'Returns service');
        if (!response.ok) throw new Error(result.error || 'The order system could not accept this request');
        addMessage({ role: 'assistant', text: `Your ${returnDetails.action === 'return' ? 'return' : 'replacement'} request was submitted Current status: ${result.order?.returnRequest?.status || 'requested'}` });
        setTask(null);
      } else if (task === 'coupon') {
        addMessage({ role: 'assistant', text: 'I do not have coupon or discount records to validate that code Please contact support for an accurate answer' });
        setRequiresHumanSupport(true);
      } else {
        const response = await fetch('/api/customer-support/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: task === 'product' ? `Product question (${menuPath.at(-1) || 'catalogue'}): ${message}` : message, history: messages.slice(-8) }),
        });
        const result = await readJsonResponse<{ reply?: string; error?: string; requiresHumanSupport?: boolean }>(response, 'Support chat');
        if (!response.ok || !result.reply) throw new Error(result.error || 'Support chat is temporarily unavailable Email Info@ahuzawear.com for help');
        addMessage({ role: 'assistant', text: result.reply });
        if (result.requiresHumanSupport) setRequiresHumanSupport(true);
      }
    } catch (error) {
      addMessage({ role: 'assistant', text: error instanceof Error ? error.message : 'Support chat is temporarily unavailable Please try again' });
      setRequiresHumanSupport(true);
    } finally {
      setBusy(false);
    }
  }

  async function raiseTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const email = values.get('email')?.toString().trim() || '';
    const details = values.get('details')?.toString().trim() || '';
    const conversation = messages.slice(-10).map(({ role, text }) => `${role === 'customer' ? 'Customer' : 'AHUZA support'}: ${text}`).join('\n');
    setTicketBusy(true);
    try {
      const response = await fetch('/api/customer-support/tickets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, message: `${conversation}\nCustomer request: ${details}`.slice(-2000) }),
      });
      const result = await readJsonResponse<{ message?: string; error?: string }>(response, 'Support ticket service');
      if (!response.ok || !result.message) throw new Error(result.error || 'Could not create your support ticket Please email Info@ahuzawear.com');
      addMessage({ role: 'assistant', text: result.message });
      setRequiresHumanSupport(false);
      setTicketOpen(false);
      form.reset();
    } catch (error) {
      addMessage({ role: 'assistant', text: error instanceof Error ? error.message : 'Could not create your support ticket Please email Info@ahuzawear.com' });
    } finally {
      setTicketBusy(false);
    }
  }

  const activeMenu = menus[menuPath.at(-1) || 'home'];

  return <div className="customer-support">
    {open && <section className="customer-support-panel" role="dialog" aria-label="AHUZA customer support">
      <header className="customer-support-header"><div><strong>Beulah · AHUZA Support</strong><span className={supportAvailable ? 'support-status is-open' : 'support-status'}><i />{supportAvailable ? 'Available now' : 'Replies 10:00 AM–9:00 PM IST'}</span></div><button type="button" onClick={() => setOpen(false)} aria-label="Close support chat"><X size={18} /></button></header>
      <div className="customer-support-messages" aria-live="polite">
        {messages.map((message, index) => <div className={`support-message ${message.role}`} key={`${message.role}-${index}`}><p>{message.text}</p></div>)}
        {busy && <div className="support-thinking"><LoaderCircle size={15} className="support-spin" /> Checking…</div>}
      </div>
      {!ticketOpen && <div className="support-flow-controls">
        {!leafOpen && activeMenu.choices.map((choice) => <button className="support-choice" type="button" key={`${choice.value}-${choice.label}`} onClick={() => chooseOption(choice)} disabled={busy}>{choice.label}</button>)}
        {requiresHumanSupport && <div className="support-escalation"><p>I’m unable to resolve this issue automatically Would you like to contact AHUZA Support?</p><button type="button" onClick={() => { setTicketOpen(true); addMessage({ role: 'assistant', text: 'Please share the details needed for a support request' }); }}>Contact Support</button><button type="button" onClick={resetToMainMenu}>Back to Main Menu</button></div>}
        <div className="support-navigation"><button type="button" onClick={goBack} disabled={menuPath.length === 1 && !leafOpen}>← Back</button><button type="button" onClick={resetToMainMenu}>Main Menu</button><button type="button" onClick={() => { setTicketOpen(true); setRequiresHumanSupport(true); addMessage({ role: 'assistant', text: 'Please share the details needed for a support request' }); }}>Talk to Support</button></div>
      </div>}
      {ticketOpen && <form className="customer-support-ticket" onSubmit={(event) => void raiseTicket(event)}>
        <label>Email for follow-up<input type="email" name="email" autoComplete="email" maxLength={254} required disabled={ticketBusy} /></label>
        <label>How can we help?<textarea name="details" maxLength={1000} required disabled={ticketBusy} /></label>
        <div className="support-ticket-actions"><button type="submit" disabled={ticketBusy}>{ticketBusy ? 'Creating ticket…' : 'Raise support ticket'}</button><button type="button" disabled={ticketBusy} onClick={() => setTicketOpen(false)}>Back to chat</button></div>
      </form>}
      <form className="customer-support-compose" onSubmit={(event) => void sendMessage(event)}>
        <input name="message" aria-label="Message customer support" placeholder={ticketOpen ? 'Complete the support form above' : task === 'tracking' || task === 'return-status' || task === 'return-order' ? 'Enter your order ID…' : task === 'pincode' ? 'Enter a 6-digit PIN code…' : 'Type a question…'} maxLength={1000} required disabled={busy || ticketOpen} />
        <button type="submit" aria-label="Send message" disabled={busy || ticketOpen}><Send size={17} /></button>
      </form>
    </section>}
    <button className="customer-support-launcher" type="button" onClick={() => setOpen((current) => !current)} aria-label={open ? 'Close customer support' : 'Ask Ahuza'} aria-expanded={open} title={open ? 'Close customer support' : 'Ask Ahuza'}>
      {open ? <X size={18} /> : <MessageCircle size={18} />}
      <span>{open ? 'Close' : 'Ask Ahuza'}</span>
    </button>
  </div>;
}
