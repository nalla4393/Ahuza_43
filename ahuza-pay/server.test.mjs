import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHmac } from 'node:crypto';

const port = 4122;
const base = `http://localhost:${port}`;
const key = 'm'.repeat(40);
const secret = 'bank-secret-123456';
const data = path.join(os.tmpdir(), `ahuza-pay-test-${process.pid}.json`);
let child;

before(async () => {
  child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    env: { ...process.env, PORT: String(port), PUBLIC_URL: base, MERCHANT_API_KEY: key, BANK_WEBHOOK_SECRET: secret, UPI_VPA: 'owner@okbank', UPI_PAYEE_NAME: 'AHUZA', DATA_FILE: data },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i += 1) { try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('service did not start');
});
after(() => { child.kill(); fs.rmSync(data, { force: true }); });

const merchant = { Authorization: `Bearer ${key}` };
const bank = (body, auth = secret, ts = String(Date.now())) => {
  const raw = JSON.stringify(body);
  const sig = createHmac('sha256', auth).update(`${ts}.${raw}`).digest('hex');
  return fetch(`${base}/api/bank/credit`, { method: 'POST', headers: { 'X-Timestamp': ts, 'X-Signature': sig }, body: raw });
};

test('merchant API requires the bearer key', async () => {
  assert.equal((await fetch(`${base}/api/merchant/orders/x`)).status, 401);
});

test('order is created, shows a UPI link, and is PAID only after a matching bank credit', async () => {
  const created = await fetch(`${base}/api/merchant/orders`, { method: 'POST', headers: merchant, body: JSON.stringify({ external_order_id: 'o-1', total_amount_paise: 59900 }) });
  assert.equal((await created.json()).pay_url, `${base}/pay/o-1`);
  const html = await (await fetch(`${base}/pay/o-1`)).text();
  assert.match(html, /upi:\/\/pay\?pa=owner%40okbank/);
  assert.match(html, /Open UPI app/);
  const pending = await (await fetch(`${base}/api/merchant/orders/o-1`, { headers: merchant })).json();
  assert.deepEqual([pending.payment_status, pending.order_confirmed], ['PENDING', false]);

  assert.equal((await bank({ amount_paise: 59900, reference: 'UTR1' }, 'wrong-secret-1234')).status, 401);
  assert.equal((await bank({ amount_paise: 59900, reference: 'UTR1' }, secret, String(Date.now() - 10 * 60 * 1000))).status, 401);
  assert.equal((await fetch(`${base}/api/bank/credit`, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, body: '{}' })).status, 401);
  assert.equal((await (await bank({ amount_paise: 100, reference: 'UTR0' })).json()).matched, null);
  assert.equal((await (await bank({ amount_paise: 59900, reference: 'UTR1' })).json()).matched, 'o-1');
  assert.equal((await (await bank({ amount_paise: 59900, reference: 'UTR1' })).json()).duplicate, true);

  const paid = await (await fetch(`${base}/api/merchant/orders/o-1`, { headers: merchant })).json();
  assert.deepEqual([paid.payment_status, paid.order_confirmed, paid.transaction_reference], ['PAID', true, 'UTR1']);
});

test('ambiguous amounts are not auto-matched unless the note names the order', async () => {
  for (const id of ['a-1', 'a-2']) await fetch(`${base}/api/merchant/orders`, { method: 'POST', headers: merchant, body: JSON.stringify({ external_order_id: id, total_amount_paise: 7000 }) });
  assert.equal((await (await bank({ amount_paise: 7000, reference: 'UTR2' })).json()).matched, null);
  assert.equal((await (await bank({ amount_paise: 7000, reference: 'UTR3', note: 'pay a-2' })).json()).matched, 'a-2');
});
