// Ahuza Pay: minimal payment gateway for the AHUZA store.
// Customers pay the owner's UPI ID; an order becomes PAID only when a bank-credit
// notification (authenticated with BANK_WEBHOOK_SECRET) matches its amount.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual, createHmac } from 'node:crypto';

let QRCode = null;
try { QRCode = (await import('qrcode')).default; } catch { /* QR code unavailable; the pay page falls back to the UPI app button */ }

const PORT = Number(process.env.PORT) || 4100;
const MERCHANT_API_KEY = process.env.MERCHANT_API_KEY || '';
const BANK_WEBHOOK_SECRET = process.env.BANK_WEBHOOK_SECRET || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const STORE_NOTIFY_URL = process.env.STORE_NOTIFY_URL || ''; // e.g. https://store.example/api/payments/ahuza-pay/notify
const DEFAULT_VPA = process.env.UPI_VPA || '';
const DEFAULT_PAYEE = process.env.UPI_PAYEE_NAME || 'AHUZA';
const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;
const EXPIRY_MS = 60 * 60 * 1000;
const DATA_FILE = process.env.DATA_FILE || path.join(process.cwd(), 'ahuza-pay-data.json');

if (MERCHANT_API_KEY.length < 32) throw new Error('MERCHANT_API_KEY must be at least 32 characters');
if (BANK_WEBHOOK_SECRET.length < 16) throw new Error('BANK_WEBHOOK_SECRET must be at least 16 characters');

let db = { orders: {}, payee: null, credits: {} };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }; } catch { /* first run */ }
const save = () => { fs.writeFileSync(`${DATA_FILE}.tmp`, JSON.stringify(db)); fs.renameSync(`${DATA_FILE}.tmp`, DATA_FILE); };

const safeEqual = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && x.length > 0 && timingSafeEqual(x, y); };
const bearer = (req) => { const h = req.headers.authorization || ''; return h.startsWith('Bearer ') ? h.slice(7).trim() : ''; };
const payee = () => db.payee || { vpa: DEFAULT_VPA, payee_name: DEFAULT_PAYEE, source: db.payee ? 'saved' : 'default' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function refresh(order) {
  if (order.payment_status === 'PENDING' && Date.now() > order.expires_at) { order.payment_status = 'EXPIRED'; save(); }
  return order;
}

function upiLink(order) {
  const p = payee();
  const query = new URLSearchParams({ pa: p.vpa, pn: p.payee_name, am: (order.total_amount_paise / 100).toFixed(2), cu: 'INR', tn: order.external_order_id });
  return `upi://pay?${query}`;
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 100_000) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => resolve(raw));
  });
}
const parseJson = (raw) => { try { return raw ? JSON.parse(raw) : {}; } catch { throw new Error('bad json'); } };
const readBody = async (req) => parseJson(await readRaw(req));

// Signature = hex HMAC-SHA256(BANK_WEBHOOK_SECRET, `${X-Timestamp}.${rawBody}`); timestamp must be within 5 minutes.
export function verifySignature(raw, timestamp, signature, secret = BANK_WEBHOOK_SECRET, now = Date.now()) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > SIGNATURE_TOLERANCE_MS) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  return typeof signature === 'string' && safeEqual(signature.trim().toLowerCase(), expected);
}

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

async function notifyStore(order) {
  if (!STORE_NOTIFY_URL) return;
  const body = JSON.stringify({ external_order_id: order.external_order_id, transaction_reference: order.transaction_reference, payment_status: 'PAID' });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(STORE_NOTIFY_URL, { method: 'POST', headers: { Authorization: `Bearer ${MERCHANT_API_KEY}`, 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(10000) });
      if (response.ok) return;
      console.error(`Store notify returned ${response.status}`);
    } catch (error) { console.error('Store notify failed:', error.message); }
    await new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** attempt));
  }
  console.error(`Store notify gave up for ${order.external_order_id}; the store will confirm on its next status poll`);
}

async function qrSvg(order) {
  if (!QRCode) return '';
  try { return await QRCode.toString(upiLink(order), { type: 'svg', margin: 1, width: 240, errorCorrectionLevel: 'M' }); } catch { return ''; }
}

async function payPage(order) {
  const paid = order.payment_status === 'PAID';
  const open = order.payment_status === 'PENDING';
  const amount = `₹${(order.total_amount_paise / 100).toFixed(2)}`;
  const qr = open ? await qrSvg(order) : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pay AHUZA</title>
<style>body{font-family:'DM Sans','Helvetica Neue',Arial,sans-serif;background:#f6f3ec;color:#222822;margin:0;display:grid;place-items:center;min-height:100vh}.c{background:#fff;max-width:400px;width:92%;border-radius:4px;box-shadow:0 4px 24px #0001;text-align:center;overflow:hidden}.h{background:#c43d58;color:#fff;padding:22px}.h b{display:block;font-size:28px;letter-spacing:.14em}.h span{font-size:11px;letter-spacing:.22em;color:#f6dfe4}.b2{padding:24px 28px 28px}h1{margin:0 0 4px;font-size:32px}p{margin:8px 0}.ok{width:64px;height:64px;border-radius:50%;background:#c43d58;color:#fff;font-size:36px;line-height:64px;margin:6px auto 14px}
a.b,button{display:block;width:100%;box-sizing:border-box;padding:14px;margin-top:12px;border:0;border-radius:4px;background:#c43d58;color:#fff;font-size:16px;font-weight:700;letter-spacing:.04em;text-decoration:none;cursor:pointer}.qr{margin:16px auto 0;width:240px;max-width:100%}.qr svg{width:100%;height:auto;display:block}small{color:#777b71}#st{font-weight:700;color:#c43d58}</style></head>
<body><div class="c"><div class="h"><b>AHUZA</b><span>APPAREL</span></div><div class="b2">${paid ? '<div class="ok">✓</div>' : ''}<h1>${amount}</h1><p>Order ${esc(order.external_order_id.slice(0, 8))}</p>
<p id="st">${paid ? 'Payment successful. Thank you! Check your email for your order confirmation.' : open ? 'Waiting for your payment…' : `Order ${esc(order.payment_status.toLowerCase())}`}</p>
${open ? `${qr ? `<div class="qr" role="img" aria-label="UPI payment QR code for ${esc(amount)}">${qr}</div><p><small>Scan with any UPI app (GPay, PhonePe, Paytm, BHIM) and pay exactly ${esc(amount)}.</small></p>` : ''}
<a class="b" id="open" href="${esc(upiLink(order))}">Open UPI app</a>
<small>This page confirms automatically once the money reaches AHUZA's bank account.</small>` : ''}
</div></div><script>
const id=${JSON.stringify(order.external_order_id)};let t;
async function poll(){try{const r=await fetch('/pay/'+encodeURIComponent(id)+'/status');const d=await r.json();
if(d.payment_status==='PAID'){document.getElementById('st').textContent='Payment successful! Check your email for your order confirmation.';setTimeout(()=>location.href=${JSON.stringify(process.env.STORE_RETURN_URL || '/')},1500);return}
if(d.payment_status!=='PENDING'){location.reload();return}}catch{}t=setTimeout(poll,2000)}
${open ? 'poll();' : paid && process.env.STORE_RETURN_URL ? `setTimeout(()=>location.href=${JSON.stringify(process.env.STORE_RETURN_URL)},1500);` : ''}
</script></body></html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, PUBLIC_URL);
    const p = url.pathname;

    if (req.method === 'GET' && p === '/health') return send(res, 200, { ok: true });

    // Hosted customer page (public; order ids are unguessable UUIDs from the store)
    const pay = p.match(/^\/pay\/([^/]+)(\/status)?$/);
    if (req.method === 'GET' && pay) {
      const order = db.orders[decodeURIComponent(pay[1])];
      if (!order) return send(res, 404, 'Order not found', 'text/plain');
      refresh(order);
      if (pay[2]) return send(res, 200, { payment_status: order.payment_status });
      return send(res, 200, await payPage(order), 'text/html; charset=utf-8');
    }

    // Bank credit notification (from the bank/SMS/email forwarder owned by the merchant)
    if (req.method === 'POST' && p === '/api/bank/credit') {
      const raw = await readRaw(req);
      if (!verifySignature(raw, req.headers['x-timestamp'], req.headers['x-signature'])) return send(res, 401, { error: 'Invalid signature' });
      const body = parseJson(raw);
      const amount = Number(body.amount_paise);
      const reference = String(body.reference || '').slice(0, 64);
      if (!Number.isInteger(amount) || amount <= 0 || !reference) return send(res, 400, { error: 'amount_paise and reference are required' });
      if (db.credits[reference]) return send(res, 200, { matched: db.credits[reference], duplicate: true });
      const pending = Object.values(db.orders).map(refresh).filter((o) => o.payment_status === 'PENDING' && o.total_amount_paise === amount);
      const note = String(body.note || '');
      // Prefer an explicit order id in the payment note; otherwise accept only an unambiguous amount match.
      const order = pending.find((o) => note.includes(o.external_order_id)) || (pending.length === 1 ? pending[0] : null);
      if (!order) return send(res, 200, { matched: null, candidates: pending.length });
      order.payment_status = 'PAID'; order.order_confirmed = true; order.transaction_reference = reference; order.paid_at = Date.now();
      db.credits[reference] = order.external_order_id;
      save();
      void notifyStore(order);
      return send(res, 200, { matched: order.external_order_id });
    }

    // Merchant API (the store server)
    if (p.startsWith('/api/merchant/')) {
      if (!safeEqual(bearer(req), MERCHANT_API_KEY)) return send(res, 401, { error: 'Authentication required' });

      if (p === '/api/merchant/orders' && req.method === 'POST') {
        const b = await readBody(req);
        const id = b.external_order_id;
        if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) return send(res, 400, { error: 'external_order_id is invalid' });
        if (!Number.isInteger(b.total_amount_paise) || b.total_amount_paise <= 0) return send(res, 400, { error: 'total_amount_paise is invalid' });
        if (!payee().vpa) return send(res, 503, { error: 'No receiving UPI ID is configured' });
        if (!db.orders[id]) {
          db.orders[id] = { external_order_id: id, total_amount_paise: b.total_amount_paise, customer_name: b.customer_name, customer_email: b.customer_email, items: b.items, payment_status: 'PENDING', order_confirmed: false, created_at: Date.now(), expires_at: Date.now() + EXPIRY_MS };
          save();
        }
        return send(res, 200, { pay_url: `${PUBLIC_URL}/pay/${encodeURIComponent(id)}` });
      }

      const one = p.match(/^\/api\/merchant\/orders\/([^/]+)$/);
      if (one && req.method === 'GET') {
        const order = db.orders[decodeURIComponent(one[1])];
        if (!order) return send(res, 404, { error: 'Order not found' });
        refresh(order);
        return send(res, 200, { payment_status: order.payment_status, order_confirmed: order.order_confirmed, transaction_reference: order.transaction_reference });
      }

      if (p === '/api/merchant/payee') {
        if (req.method === 'GET') return send(res, 200, payee());
        if (req.method === 'PUT') {
          const b = await readBody(req);
          const current = payee();
          const vpa = b.vpa === undefined ? current.vpa : String(b.vpa).trim();
          if (!/^[\w.-]{2,64}@[A-Za-z]{2,32}$/.test(vpa)) return send(res, 400, { error: 'Invalid UPI ID' });
          db.payee = { vpa, payee_name: b.payee_name === undefined ? current.payee_name : String(b.payee_name).trim().slice(0, 60), source: 'saved' };
          save();
          return send(res, 200, db.payee);
        }
        if (req.method === 'DELETE') { db.payee = null; save(); return send(res, 200, payee()); }
      }
    }
    send(res, 404, { error: 'Not found' });
  } catch (error) {
    send(res, 400, { error: error.message === 'too large' ? 'Request too large' : 'Bad request' });
  }
});

server.listen(PORT, () => console.log(`Ahuza Pay listening on ${PORT}`));
