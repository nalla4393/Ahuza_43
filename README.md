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

Vite serves the storefront at `http://localhost:5173` and proxies `/api` to the Express server using `PORT` (defaults to `3001`). The store is usable without third-party credentials; payments, AI and email integrations activate when configured.

Set `OWNER_API_KEY` in `.env` before using owner-only APIs. Set a long random `SESSION_SECRET` outside development. Never commit `.env` or `.data/`.

Local customer sessions are encrypted and stored under `.data/sessions`, expire after seven days, and are periodically cleaned up. Use a shared store such as Redis for multi-instance production deployments.

Open **Owner Studio** from the storefront footer and enter the configured owner key. The key stays in browser memory and is sent only to owner APIs using `X-Owner-Key`. The dashboard includes sales and low-stock overview, product and ghost-mannequin editing, storefront content, fulfillment and return requests, integration status, an AI owner agent, reviewed customer-email drafts, and social caption generation. **Owner Studio → Storefront** edits the announcement, hero and story, campaign banners, homepage section headings, service promises, contact and newsletter copy, and footer text. Product names and descriptions are edited in **Products & stock**. These changes are saved with the storefront content in the persistent database.

Owner Studio has a **Publish site / Unpublish site** control in its header. Unpublishing displays a maintenance page to visitors and blocks public storefront APIs and new checkouts; the owner can still access Owner Studio, existing customer orders and online payment status. The storefront publication setting is persisted with the database and defaults to published for existing installations.

## Customer support chatbot

The chat menus, preloaded options and messages are unchanged. Typed questions are answered by the AI agent. Set `OPENAI_API_KEY` (server-side only; optional `OPENAI_MODEL`, default `gpt-4o-mini`) and replies are written in a natural, human tone using the last few messages of the conversation. Without it, the bot falls back to `GEMINI_API_KEY`, then to the existing "contact support" message. Delivery problems and complaints are still routed to a human support ticket, and the bot only uses store details it is given.

The AI owner agent reads current store data and can propose inventory updates, order-status changes, and customer-email drafts. Write actions require owner approval; email drafts must still be reviewed before sending. Exact inventory commands such as `set stock AH-SFS-001 to 20` work without Gemini and produce an approval proposal. Set `GEMINI_API_KEY` for natural-language planning and email drafting. Configure `RESEND_API_KEY` in `.env` to enable Resend email.

## Online payments

Checkout supports billing addresses worldwide but delivery is currently limited to India.
Product pages show approximate USD prices using the INR/USD rate from Frankfurter; the server
caches the latest rate for up to one hour and rejects rates older than seven days. The browser
refreshes the estimate hourly and shows it as unavailable if the rate cannot be fetched.
All checkout charges remain in INR.

### Ahuza Pay (manual UPI verification)

To enable the self-hosted UPI checkout, configure the storefront service with
`PAYMENT_PROVIDER=manual_upi`, `UPI_VPA` (the receiving UPI ID), and
`UPI_PAYEE_NAME` (the recipient name shown in the UPI app). Verify the UPI ID
with a small controlled payment before accepting customer orders. The checkout
displays a QR code to scan with a UPI app on another device. The QR code is not
a payment processor and does not prove a payment was made. No separate Ahuza Pay server, bank API,
bank-alert forwarding, or automatic settlement matching is used.

Orders remain pending until an owner checks the actual bank statement, matches
the credit to the customer and order, and enters the bank transaction reference
in **Owner Studio → Orders → Confirm UPI payment received**. Never confirm from
a screenshot or amount alone. A transaction reference cannot be reused for a
different order. Pending orders reserve stock for 60 minutes; customers must not
pay after expiry. If a payment arrives after cancellation or expiry, review it
against the bank statement; confirmation can restore the order only if stock
is still available. Otherwise arrange a refund or other resolution manually.
Email notifications are queued when configured; delivery is not guaranteed.

### Instamojo

The default `PAYMENT_PROVIDER=instamojo` keeps the existing Instamojo flow.

The backend calculates the order amount, reserves stock, creates an Instamojo payment request and returns its `longurl` as `payUrl`. The browser redirects to Instamojo. The store polls Instamojo's authenticated API and confirms the order only after a matching successful payment is reported; browser redirects are not proof of payment.

Set these server variables (never use a `VITE_` prefix):

```dotenv
INSTAMOJO_API_KEY=<your API key>
INSTAMOJO_AUTH_TOKEN=<your authentication token>
INSTAMOJO_SALT=<your webhook salt>
INSTAMOJO_REDIRECT_URL=https://www.ahuzawear.com/
INSTAMOJO_WEBHOOK_URL=https://www.ahuzawear.com/api/payments/instamojo/webhook
```

Without the API key and auth token, online checkout is disabled while cash on delivery remains available. Set all three credentials in the production service environment to enable signed webhooks; the webhook URL must be publicly reachable over HTTPS. If no webhook salt is set, authenticated status checks remain the verification path. Customer redirects are never treated as proof of payment.

Payment methods and settlement details are managed in Instamojo. Orders created using the old Ahuza Pay service cannot be reconciled automatically through Instamojo; review their settlement separately. Bank-email and MacroDroid gateway integrations have been removed.

Cash on delivery remains available. COD orders are saved as `confirmed` with payment status `pending` and reserve inventory. In **Owner Studio → Orders**, mark the order delivered, then use **Mark cash collected / paid** after cash has been received. COD revenue is counted only after the owner records payment.


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
3. Add `SESSION_SECRET` (a stable random value of at least 32 characters) and `OWNER_API_KEY` in Railway's service variables. Railway supplies `PORT`. Configure either Instamojo or the manual UPI variables above to enable online checkout.
4. Create a Railway project token. In the GitHub repository, add it under **Settings → Secrets and variables → Actions → Secrets** as `RAILWAY_TOKEN`. Add the Railway web service name or ID under **Settings → Secrets and variables → Actions → Variables** as `RAILWAY_SERVICE`. Do not commit or paste the token into the repository.
5. Push to `main` or manually run **Actions → Verify and deploy to Railway**. The workflow runs `npm test` and `npm run build` first, then deploys only if those checks pass. Once Railway assigns a public domain, verify `/api/health` and the storefront.
6. Before accepting online payments, configure the selected payment method and complete a small live transaction end to end, including bank reconciliation for manual UPI.

Configure a Railway volume and stable secrets before treating the deployment as production-ready.

## Custom domain and search indexing

The canonical storefront URL is `https://www.ahuzawear.com/`. The built page declares this canonical URL, and `/robots.txt` points crawlers to `/sitemap.xml`. The Express server redirects requests for `ahuzawear.com` to the `www` hostname after the apex is routed to the app.

In Railway, attach both `www.ahuzawear.com` and `ahuzawear.com` to the production service. Use `railway domain status ahuzawear.com` to see the current required DNS records. Add those records in the domain DNS provider and wait for DNS and certificate validation. If the provider cannot flatten an apex CNAME or changing apex records would interfere with email, configure a permanent HTTPS redirect from `ahuzawear.com` to `https://www.ahuzawear.com/` instead; preserve existing MX and email-related TXT records.

After DNS is correct, add `https://www.ahuzawear.com/` as a URL-prefix property in Google Search Console, submit `https://www.ahuzawear.com/sitemap.xml`, and request indexing for the homepage. DNS propagation and Google's recrawl can take time; a code deployment alone cannot change DNS or guarantee when a search result updates.

## API overview

- `GET /api/products`, `GET /api/products/:id`
- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/payments/config`, `POST /api/payments/orders`, `GET /api/payments/orders/:id/status`, `POST /api/payments/orders/:id/cancel` (Instamojo hosted payment; customer status is never trusted for confirmation)
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
