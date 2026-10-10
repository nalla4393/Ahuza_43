# Ahuza_43
 Ahuza Apparel

Full-stack apparel storefront built with React 19, TypeScript, Vite, Tailwind CSS, and Express. The API persists catalog, customer, order, return, and event data in `.data/ahuza-db.json`.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Run locally

```sh
npm install
cp .env.example .env
npm run dev
```

Vite serves the storefront at `http://localhost:5173` and proxies `/api` to the Express server using `PORT` (defaults to `3001`). The store is usable without third-party credentials; payments, AI, email, ads, and Zapier integrations activate when configured.

Set `OWNER_API_KEY` in `.env` before using owner-only APIs. Set a long random `SESSION_SECRET` outside development. Never commit `.env` or `.data/`.

Local customer sessions are encrypted and stored under `.data/sessions`, expire after seven days, and are periodically cleaned up. Use a shared store such as Redis for multi-instance production deployments.

Open **Owner Studio** from the storefront footer and enter the configured owner key. The key stays in browser memory and is sent only to owner APIs using `X-Owner-Key`. The dashboard includes sales and low-stock overview, product and ghost-mannequin editing, storefront content, fulfillment and return requests, integration status, an AI owner agent, reviewed customer-email drafts, and social caption generation.

Owner Studio has a **Publish site / Unpublish site** control in its header. Unpublishing displays a maintenance page to visitors and blocks public storefront APIs and new checkouts; the owner can still access Owner Studio, existing customer orders and payment status, and provider webhooks. The storefront publication setting is persisted with the database and defaults to published for existing installations.

The AI owner agent reads current store data and can propose inventory updates, order-status changes, and customer-email drafts. Write actions require owner approval; email drafts must still be reviewed before sending. Exact inventory commands such as `set stock AH-SFS-001 to 20` work without Gemini and produce an approval proposal. Set `GEMINI_API_KEY` for natural-language planning and email drafting. Configure `RESEND_API_KEY`, `ZAPIER_WEBHOOK_URL`, and `GOOGLE_ADS_WEBHOOK_URL` in `.env` to enable those integrations.

## UPI payments

Checkout uses a custom AHUZA interface with a Razorpay one-time, fixed-amount UPI QR. The customer pays with a supported UPI app by scanning the QR; this Razorpay API flow does **not** supply an UPI intent/deep link or hosted checkout, so neither is fabricated. A scan, browser redirect, or uploaded receipt never confirms payment. The backend computes subtotal from current server catalog prices, adds ₹100 shipping below ₹2,500 (free shipping at/above ₹2,500), applies no currently configured discounts or extra taxes, then polls Razorpay's authenticated QR/payment APIs and accepts signed `qr_code.credited` webhooks. Amount, currency, UPI method, merchant account, QR, internal reference, and order must match before a live order is settled.

Without configured approved merchant credentials, `GET /api/payments/config` reports payments unavailable and checkout stays disabled. For a Razorpay test account, set these server environment values (for local development, copy `.env.example` to the ignored `.env`; in Codespaces, add them as repository/environment Secrets):

```dotenv
PAYMENT_PROVIDER=razorpay
PAYMENT_ENVIRONMENT=test
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
RAZORPAY_ACCOUNT_ID=...
```

Obtain the API key ID/secret and account ID from the approved Razorpay merchant dashboard, and create a webhook secret when registering the webhook. Never put these values in frontend variables, source control, `VITE_*` variables, or screenshots. The configured key prefix must match the environment (`rzp_test_` for test; `rzp_live_` for live). Use GitHub Codespaces **Settings → Secrets and variables → Codespaces** (or repository/environment secrets with least privilege) for hosted development. `.env` is ignored by Git; `.env.example` contains only placeholders.

For a reachable deployment, register `https://<your-public-host>/api/payments/razorpay/webhook` in Razorpay and subscribe to `qr_code.credited`, `refund.created`, `refund.processed`, and `refund.failed`. Use the exact webhook secret in `RAZORPAY_WEBHOOK_SECRET`; the server verifies the signature against the unparsed raw request bytes and checks the configured account ID. Razorpay must be able to reach this HTTPS URL. Never mark an order paid from browser-controlled fields. Cancellation/expiry first queries and closes the QR, checks for captures, and only then releases reserved stock.

Test flow: use `PAYMENT_ENVIRONMENT=test` and Razorpay test-mode keys; sign in, add an in-stock product, create a checkout QR, complete a test UPI payment in the provider's supported test setup, then confirm status through both the customer checkout and the Razorpay dashboard/webhook delivery log. Test orders are marked `test_paid`, inventory is restored, invoices/fulfillment/revenue automation are not enabled. The unit suite is `npm test`. Test refusal cases by testing an invalid webhook signature, duplicate event delivery, wrong amount/currency/reference, failed and pending UPI attempts, cancellation, and repeated refund requests using provider sandbox tooling where available. Full refund controls are owner-only, live-mode-only, require a verified payment, and reuse the exact persisted idempotency key/body after an uncertain network result.

For production, obtain Razorpay's live UPI QR/API approval and live credentials from the merchant account, set `PAYMENT_ENVIRONMENT=live`, deploy the Node server with persistent storage, HTTPS, stable `SESSION_SECRET`, an owner key, and the server-side variables above. Configure the production webhook URL before opening checkout. Verify end to end with a small real UPI transaction: check the captured payment in Razorpay, ensure a matching signed webhook or authenticated server poll records the same payment/amount/currency/reference, confirm the order and invoice become available, then test a full refund and verify Razorpay's final refund event/status. This integration has not been verified with production merchant credentials; do not enable live checkout until this test passes.

For an unpaid order, a customer can optionally submit a payment receipt image for owner review. When `GEMINI_API_KEY` is configured, Gemini extracts visible details, but the image is not stored and AI never approves a payment or changes an order's payment status. The owner reviews extracted details against independent records in **Owner Studio → Orders & receipts**. Marking a receipt reviewed is only an acknowledgement; payment status and invoices still require Razorpay's signed capture webhook.

## Build and run

```sh
npm run build
npm start
```

The production server serves the built frontend and API from one origin on `PORT` (default `3001`).
`npm start` sets `NODE_ENV=production` for the server; leave `NODE_ENV` out of `.env` so Vite can select its own build mode.

## Deploy from GitHub with Railway

GitHub Pages cannot host this application because it needs the Express API for the catalog, customer accounts, orders, checkout, and Owner Studio. GitHub Actions deploys the full Node application to Railway after the checks pass:

1. Create a Railway project and an empty service for this application. In the service settings, set the build command to `npm ci && npm run build`, the start command to `npm start`, and the health-check path to `/api/health`. Do not enable Railway's own GitHub auto-deploy; GitHub Actions performs the deploy after verification.
2. Add a Railway volume to the service mounted at `/app/.data`. Set `DATA_FILE=/app/.data/ahuza-db.json` and `SESSION_FILE_PATH=/app/.data/sessions` so the database and customer sessions survive deploys and restarts. Keep this as a single service instance; the JSON database and file-backed sessions are not safe for multiple instances.
3. Add `SESSION_SECRET` (a stable random value of at least 32 characters) and `OWNER_API_KEY` in Railway's service variables. Railway supplies `PORT`. Leave payment and other integration variables unset until their providers are configured; payment checkout stays disabled without approved Razorpay credentials.
4. Create a Railway project token. In the GitHub repository, add it under **Settings → Secrets and variables → Actions → Secrets** as `RAILWAY_TOKEN`. Add the Railway web service name or ID under **Settings → Secrets and variables → Actions → Variables** as `RAILWAY_SERVICE`. Do not commit or paste the token into the repository.
5. Push to `main` or manually run **Actions → Verify and deploy to Railway**. The workflow runs `npm test` and `npm run build` first, then deploys only if those checks pass. Once Railway assigns a public domain, verify `/api/health` and the storefront.
6. Before accepting payments, configure the Razorpay webhook at `https://<railway-domain>/api/payments/razorpay/webhook` and complete the provider's test and live verification described above.

Configure a Railway volume and stable secrets before treating the deployment as production-ready.

## API overview

- `GET /api/products`, `GET /api/products/:id`
- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/payments/config`, `POST /api/payments/orders`, `GET /api/payments/orders/:id/status`, `POST /api/payments/orders/:id/cancel`, `POST /api/payments/razorpay/webhook` (raw-body signature verified)
- `POST /api/owner/orders/:id/refund` (owner-only, full live-payment refund using provider idempotency)
- `POST /api/orders/:id/payment-receipts` (authenticated JPEG/PNG/WebP image, maximum 5 MB); owners review extracted details via `GET /api/owner/payment-receipts` and `PATCH /api/owner/payment-receipts/:id`
- `GET /api/orders`, `GET /api/orders/:id`, `GET /api/orders/:id/invoice` (PDF after payment confirmation), `POST /api/orders/:id/returns`
- Storefront content: `GET /api/storefront`; owner edits via `PATCH /api/owner/content`
- Owner: `GET/PATCH/POST /api/owner/inventory`, `GET/PATCH /api/owner/orders`, `GET /api/owner/analytics`, `GET/PATCH /api/owner/integrations`, `GET/PATCH /api/owner/support-tickets`, `POST /api/owner/chat`, `POST /api/owner/agent/execute` to approve proposed actions, `POST /api/owner/email-agent/draft`, `POST /api/owner/email-agent/send`, `POST /api/owner/social-post`, and `POST /api/owner/automations/test` for non-conversion webhook diagnostics.
- `POST /api/customer-support/chat` answers customer questions about active products and store policies using Gemini when configured, with a scheduled-hours fallback. The support widget also provides guided issue menus and signed-in order/return lookups using these APIs; unsupported data (such as delivery PIN serviceability, measurements, or coupons) is not guessed. `POST /api/customer-support/tickets` creates a reference-numbered human support request.
- `POST /api/marketing/events` accepts consent-aware conversion events; avoid sending personal data to ad platforms.

## Deployment notes

This starter uses a JSON-file database and supports only a single server process; do not scale to multiple instances or high-volume commerce without migrating to PostgreSQL with transactions. Persistent storage is not a substitute for database backups. Use a shared production session store such as Redis before scaling horizontally, configure HTTPS and stable random secrets, and restrict CORS if deploying the API separately from the frontend. The email adapter sends through Resend when configured and otherwise logs the event; configure a real email provider before launch. Do not treat client-side ad events as verified purchases.
