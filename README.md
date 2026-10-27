# Ahuza_43
 Ahuza Apparel

Full-stack apparel storefront built with React 19, TypeScript, Vite, Tailwind CSS, and Express. The API persists catalog, customer, order, return, and event data in `.data/ahuza-db.json`. This repository's existing Node.js application is retained rather than replacing it with a separate Python service.

**Persistence limitation:** the current store is a JSON-file database and Railway deployment is documented for one instance. PostgreSQL models/migrations and multi-instance-safe storage are not implemented here; plan that migration before production scale or multiple service instances.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Run locally

```sh
npm install
cp .env.example .env
npm run dev
```

Vite serves the storefront at `http://localhost:5173` and proxies `/api` to the Express server using `PORT` (defaults to `3001`). The store is usable without third-party credentials; payments, AI and email integrations activate when configured.

Set `OWNER_API_KEY` in `.env` before using owner-only APIs. Set a long random `SESSION_SECRET` outside development. Never commit `.env` or `.data/`.

Local customer sessions are encrypted and stored under `.data/sessions`, expire after seven days, and are periodically cleaned up. Use a shared store such as Redis for multi-instance production deployments.

Open **Owner Studio** from the storefront footer and enter the configured owner key. The key stays in browser memory and is sent only to owner APIs using `X-Owner-Key`. The dashboard includes sales and low-stock overview, product and ghost-mannequin editing, storefront content, fulfillment and return requests, integration status, an AI owner agent, reviewed customer-email drafts, and social caption generation. **Owner Studio → Storefront** edits the announcement, hero and story, campaign banners, homepage section headings, service promises, contact and newsletter copy, and footer text. Product names and descriptions are edited in **Products & stock**. These changes are saved with the storefront content in the persistent database.

Owner Studio has a **Publish site / Unpublish site** control in its header. Unpublishing displays a maintenance page to visitors and blocks public storefront APIs and new checkouts; the owner can still access Owner Studio, existing customer orders and direct UPI status. The storefront publication setting is persisted with the database and defaults to published for existing installations.

## Customer support chatbot

The chat menus, preloaded options and messages are unchanged. Typed questions are answered by the AI agent. Set `OPENAI_API_KEY` (server-side only; optional `OPENAI_MODEL`, default `gpt-4o-mini`) and replies are written in a natural, human tone using the last few messages of the conversation. Without it, the bot falls back to `GEMINI_API_KEY`, then to the existing "contact support" message. Delivery problems and complaints are still routed to a human support ticket, and the bot only uses store details it is given.

The AI owner agent reads current store data and can propose inventory updates, order-status changes, and customer-email drafts. Write actions require owner approval; email drafts must still be reviewed before sending. Exact inventory commands such as `set stock AH-SFS-001 to 20` work without Gemini and produce an approval proposal. Set `GEMINI_API_KEY` for natural-language planning and email drafting. Configure `RESEND_API_KEY` in `.env` to enable Resend email.

## Direct UPI payments

The checkout is branded **AHUZA PAY** and the payment-processing code is isolated behind a `PaymentProvider` interface (`createPaymentRequest`, `getPaymentStatus`, and authenticated notification verification). Set `PAYMENT_PROVIDER=demo` for local development and testing. The development screen clearly says that no real payment is processed; its signed demo notifications are rejected in production and must never be represented as actual settlement. The automated tests use simulated notifications and move no money.

For an eligible live arrangement, set `PAYMENT_PROVIDER=upi-intent` and configure `UPI_VPA` and optionally `UPI_MERCHANT_NAME` on the server. Checkout uses a native `upi://pay` intent to open an installed UPI application. On desktop, checkout displays a QR encoding the same intent so a customer can scan it with a UPI app on their phone; the QR is rendered locally and does not send payment data to a third-party QR service. The VPA must be an AHUZA payment destination verified and approved by the bank/UPI provider. `GET /api/payments/config` exposes only the public VPA and whether it passes syntax validation. Syntax validation does not verify VPA ownership. Direct UPI links have no API credentials and no third-party gateway is used.

The backend calculates the order amount from current catalog prices, creates a unique order reference, pre-fills the merchant VPA, amount, INR currency and reference in the intent, and reserves stock for 20 minutes. At expiry, the order is cancelled and the reservation is released. A cancelled or expired link must not be reused.

**Automatic payment verification is not available.** A UPI intent can open an app but cannot securely report a bank settlement to this server. An app callback, success screen, customer claim, screenshot, receipt or AI extraction is not payment proof. Orders remain `pending_payment` until an authorized AHUZA owner matches the settled amount and bank UTR in the merchant bank account using **Owner Studio → Orders & receipts → Confirm after bank verification**. This owner-only operation records the bank reference and verification timestamp. The customer status endpoint never accepts client-supplied payment status and cannot mark an order paid. No external bank verification API is configured in this project; automatic confirmation requires a bank-supported API or a verified payment provider.

The demo webhook endpoint exists only for development and is HMAC-authenticated with `DEMO_PAYMENT_WEBHOOK_SECRET`; its events are stored for audit and deduplicated. It can mark a demo order as simulated-paid only in development. It is not an implementation for any bank or payment provider. The `upi-intent` provider deliberately refuses all notifications and cannot automatically verify live payments. A production provider adapter must be implemented against that provider's documented authentication, event format, and transaction lookup before enabling automatic confirmation.

Set these server variables (never use a `VITE_` prefix):

```dotenv
UPI_VPA=your-verified-merchant-vpa@bank
UPI_MERCHANT_NAME=AHUZA Apparel
```

`UPI_VPA` is public payment information, not an API secret. Do not deploy until you have verified the exact merchant VPA and completed a small real transaction. In local development, use `.env`; production environments should set these through their deployment variable manager. Without a syntactically valid VPA, direct UPI checkout is disabled while cash on delivery remains available.

`cp .env.example .env` selects the development-only demo provider, which remains disabled until you set `DEMO_PAYMENT_WEBHOOK_SECRET` locally to a random value of at least 32 characters (for example, generate one with `openssl rand -hex 32`). Never set `PAYMENT_PROVIDER=demo` in production. `.env` is ignored by Git.

Cash on delivery remains available. COD orders are saved as `confirmed` with payment status `pending` and reserve inventory. In **Owner Studio → Orders & receipts**, mark the order delivered, then use **Mark cash collected / paid** after cash has been received. COD revenue is counted only after the owner records payment.

Customers may optionally submit an image of payment proof for owner review. AI may extract visible details, but neither an AI result nor a receipt review confirms payment. Independently check the bank settlement before using the owner-only confirmation.

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
3. Add `SESSION_SECRET` (a stable random value of at least 32 characters) and `OWNER_API_KEY` in Railway's service variables. Railway supplies `PORT`. Set `PAYMENT_PROVIDER=upi-intent` and configure `UPI_VPA` only after your bank/payment arrangement is approved. Do not set the demo provider or its secret in production.
4. Create a Railway project token. In the GitHub repository, add it under **Settings → Secrets and variables → Actions → Secrets** as `RAILWAY_TOKEN`. Add the Railway web service name or ID under **Settings → Secrets and variables → Actions → Variables** as `RAILWAY_SERVICE`. Do not commit or paste the token into the repository.
5. Push to `main` or manually run **Actions → Verify and deploy to Railway**. The workflow runs `npm test` and `npm run build` first, then deploys only if those checks pass. Once Railway assigns a public domain, verify `/api/health` and the storefront.
6. Before accepting direct UPI payments, set `UPI_VPA` to the bank-verified AHUZA merchant VPA and complete a small live transaction. Payment confirmation is manual bank reconciliation; this project has no bank verification API.

Configure a Railway volume and stable secrets before treating the deployment as production-ready.

## Custom domain and search indexing

The canonical storefront URL is `https://www.ahuzawear.com/`. The built page declares this canonical URL, and `/robots.txt` points crawlers to `/sitemap.xml`. The Express server redirects requests for `ahuzawear.com` to the `www` hostname after the apex is routed to the app.

In Railway, attach both `www.ahuzawear.com` and `ahuzawear.com` to the production service. Use `railway domain status ahuzawear.com` to see the current required DNS records. Add those records in the domain DNS provider and wait for DNS and certificate validation. If the provider cannot flatten an apex CNAME or changing apex records would interfere with email, configure a permanent HTTPS redirect from `ahuzawear.com` to `https://www.ahuzawear.com/` instead; preserve existing MX and email-related TXT records.

After DNS is correct, add `https://www.ahuzawear.com/` as a URL-prefix property in Google Search Console, submit `https://www.ahuzawear.com/sitemap.xml`, and request indexing for the homepage. DNS propagation and Google's recrawl can take time; a code deployment alone cannot change DNS or guarantee when a search result updates.

## API overview

- `GET /api/products`, `GET /api/products/:id`
- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/payments/config`, `POST /api/payments/orders` (requires a per-attempt `Idempotency-Key`), `GET /api/payments/orders/:id/status`, `POST /api/payments/orders/:id/cancel` (the selected payment provider; customer status is never trusted for confirmation)
- `POST /api/payments/webhook` (development demo only; no live payment webhook is configured)
- `PATCH /api/owner/orders/:id/upi-payment` (owner-only; records manual bank reconciliation and requires the bank UTR/reference)
- `POST /api/orders/:id/payment-receipts` (authenticated JPEG/PNG/WebP image, maximum 5 MB); owners review extracted details via `GET /api/owner/payment-receipts` and `PATCH /api/owner/payment-receipts/:id`
- `GET /api/orders`, `GET /api/orders/:id`, `GET /api/orders/:id/invoice` (PDF after payment confirmation), `POST /api/orders/:id/returns`
- Storefront content: `GET /api/storefront`; owner edits via `PATCH /api/owner/content`
- Owner: `GET/PATCH/POST /api/owner/inventory`, `GET/PATCH /api/owner/orders`, `GET /api/owner/analytics`, `GET/PATCH /api/owner/integrations`, `GET/PATCH /api/owner/support-tickets`, `POST /api/owner/chat`, `POST /api/owner/agent/execute` to approve proposed actions, `POST /api/owner/email-agent/draft`, `POST /api/owner/email-agent/send`, `POST /api/owner/social-post`, and `POST /api/owner/automations/test` for non-conversion webhook diagnostics.
- `POST /api/customer-support/chat` answers customer questions about active products and store policies using Gemini when configured, with a scheduled-hours fallback. The support widget also provides guided issue menus and signed-in order/return lookups using these APIs; unsupported data (such as delivery PIN serviceability, measurements, or coupons) is not guessed. `POST /api/customer-support/tickets` creates a reference-numbered human support request.
- `POST /api/marketing/events` accepts consent-aware conversion events; avoid sending personal data to ad platforms.

## Deployment notes

This starter uses a JSON-file database and supports only a single server process; do not scale to multiple instances or high-volume commerce without migrating to PostgreSQL with transactions. Persistent storage is not a substitute for database backups. Use a shared production session store such as Redis before scaling horizontally, configure HTTPS and stable random secrets, and restrict CORS if deploying the API separately from the frontend. The email adapter sends through Resend when configured and otherwise logs the event; configure a real email provider before launch. Do not treat client-side ad events as verified purchases.

## Owner Studio image management

- **Products & stock** → *Upload Image* opens the phone gallery/photo picker (or the computer file picker). JPG, PNG and WebP, several files at once, with instant preview, progress, retry, replace, delete, set-main and reorder. A product cannot be saved while an upload is pending or failed. Status (Published/Unpublished) controls storefront visibility.
- **Out-of-stock alerts** → Signed-in customers can request an email when an unavailable product is restocked. Alerts are sent after inventory is replenished and periodically retried; email delivery must be configured.
- **Order tracking** → Add the carrier tracking number and HTTPS tracking link in Owner Studio before marking an order shipped. Customers see the status, reference and secure carrier link in their account order history.
- **Order email timeline** → Order received emails are queued immediately and retried after transient send errors; shipment, out-for-delivery and delivered updates are queued when the owner updates each order status. Mark an order out for delivery only after the carrier reports that status. Delivered emails invite the customer to leave a one-time 1–5-star rating and optional review from Account → Order history. Email delivery requires working SMTP/provider credentials; carrier events are not automatically integrated.
- **Image Settings** tab: aspect ratio, fit, alignment, background, radius, sizes, spacing (desktop and mobile), quality options, and gallery/thumbnail/zoom/card layout. Settings are saved in the database and applied only to product imagery.
- **Storage:** files are sent to `POST /api/owner/images` (owner key required, magic-byte validated, size-limited) and stored on the server disk under `UPLOAD_DIR` (default: an `uploads` folder next to `DATA_FILE`), served from `/uploads`. The original is kept plus responsive WebP versions; the database stores only references and metadata, never Base64. On Railway this lives on the existing volume at `/app/.data`, so no new service or credentials are needed. Without a persistent volume, uploads are lost on redeploy.
- **Configuration:** `MAX_UPLOAD_MB` (default 10) and optional `UPLOAD_DIR`. Existing products keep their current images until you upload replacements.

## Customer order emails

Order received, payment confirmed, shipped and 7-day follow-up emails are drafted by OpenAI (`OPENAI_API_KEY`) and sent automatically; a plain template is used if the AI call fails. Sending needs `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (Gmail: use an app password) or `RESEND_API_KEY`. UPI orders are only described as "received, payment pending" until the owner records the bank reference.

## Newsletter

The storefront footer newsletter form saves the normalized email address, consent text and timestamp in the persistent JSON database. Subscribing requires explicit consent, and new signups are recorded in Owner Studio event activity.
