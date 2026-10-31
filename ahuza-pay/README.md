# Ahuza Pay service

Run: `node ahuza-pay/server.mjs` (Node 20+, no dependencies).

| Variable | Purpose |
|---|---|
| `MERCHANT_API_KEY` | 32+ chars. Must equal `AHUZA_PAY_API_KEY` on the store. |
| `BANK_WEBHOOK_SECRET` | 16+ chars. Secret for the bank-credit webhook. |
| `PUBLIC_URL` | Public **https** URL of this service. Set the store's `AHUZA_PAY_URL` to it. |
| `UPI_VPA`, `UPI_PAYEE_NAME` | Owner's receiving UPI ID and name (default; editable from Owner Studio). |
| `STORE_NOTIFY_URL` | `https://<store>/api/payments/ahuza-pay/notify` for instant confirmation. |
| `STORE_RETURN_URL` | Where the pay page sends the customer after payment. |
| `DATA_FILE` | JSON store path (use a persistent volume). |

## MacroDroid bank-credit forwarding

The store has a `/api/macrodroid-proxy` endpoint that signs bank-credit notifications and forwards them to this service. Set a separate random `MACRODROID_WEBHOOK_SECRET` of at least 32 characters in the store's environment. Configure MacroDroid to send an HTTPS `POST` to `https://<store>/api/macrodroid-proxy` with:

- `Content-Type: application/json`
- `X-MacroDroid-Secret: <MACRODROID_WEBHOOK_SECRET>`
- JSON body containing `amount_paise` (credited rupees multiplied by 100), `reference` (bank transaction reference/UTR), and optionally `note` (bank payment narration, including the order ID if available).

Set up MacroDroid to trigger only for incoming credit notifications from your bank and map the amount, transaction reference, and narration from your bank's notification format. Do not trigger on debit or generic UPI notifications. Ahuza Pay ignores duplicate references and matches the exact amount plus an order ID in the narration, or a single unambiguous pending order for that amount. If two pending orders have the same amount and the narration has no matching order ID, the payment stays unconfirmed.

The dedicated secret protects the forwarding endpoint but does not prove a notification came from your bank. If your bank offers a signed webhook or transaction API, use that instead; MacroDroid parsing depends on the bank notification format and may miss or misread alerts. Never mark an order paid based only on the customer's UPI app or return redirect.

## Money reaching the owner account

Customers pay `UPI_VPA` directly, so funds settle in the owner's bank account. An order turns PAID only when your bank credit alert is posted:

```
TS=$(date +%s%3N); BODY='{"amount_paise":59900,"reference":"<bank UTR>","note":"<order id if present>"}'
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$BANK_WEBHOOK_SECRET" -hex | awk '{print $2}')
curl -X POST $PUBLIC_URL/api/bank/credit -H "X-Timestamp: $TS" -H "X-Signature: $SIG" -d "$BODY"
```

`X-Signature` is hex HMAC-SHA256 of `<X-Timestamp>.<raw body>` keyed with `BANK_WEBHOOK_SECRET`; timestamps (ms) older than 5 minutes are rejected, so replays fail. Unsigned or bearer-only requests get 401. Once an order is PAID the service calls `STORE_NOTIFY_URL` (retried with backoff) with the order id and transaction reference, and the store re-verifies with the gateway before confirming.

Feed this from your bank/payment-provider webhook or an SMS/email forwarder. A credit is matched by order id in the note, or by amount if exactly one pending order has it. Duplicate references are ignored.

The "Open UPI app" button uses a `upi://pay` deep link, which only opens on a phone with a UPI app installed.

## Wiring it into the store (already implemented in the store code)

1. Deploy this service (`npm run pay`) on a public https URL with the variables from `.env.example`.
2. In the **store's** `.env` set `AHUZA_PAY_URL=<PUBLIC_URL>` and `AHUZA_PAY_API_KEY=<MERCHANT_API_KEY>` (also set `OWNER_API_KEY`).
3. Checkout calls `POST /api/merchant/orders`, then redirects to `/pay/:id`.
4. When a bank credit arrives, this service marks the order PAID and calls the store's notify endpoint; the store re-verifies with `GET /api/merchant/orders/:id` and only then shows **Payment successful**. The customer's browser/UPI app is never trusted.
5. Make sure your bank-alert forwarder posts to `/api/bank/credit` — without it no order can become PAID.

Run tests: `npm test`.
