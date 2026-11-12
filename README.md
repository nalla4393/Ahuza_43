# Ahuza_43
 Ahuza Apparel

Full-stack apparel storefront built with React 19, TypeScript, Vite, Tailwind CSS, and Express. The API persists catalog, customer, order, return, and event data in a JSON file by default, or in PostgreSQL when configured.

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

In the bag and billing drawer, customers can review product images, sizes, quantities and totals, change quantities or remove a product, and return to the catalogue to add more before placing an order.

Set `OWNER_API_KEY` in `.env` before using owner-only APIs. Set a long random `SESSION_SECRET` outside development. Never commit `.env` or `.data/`.

Local customer sessions are encrypted and stored under `.data/sessions`, expire after seven days, and are periodically cleaned up. Use a shared store such as Redis for multi-instance production deployments.

### Storefront PostgreSQL migration

The storefront can use the PostgreSQL database provisioned for Ahuza Pay, but
stores its data in its own `ahuza_storefront_state` table. It does not read or
modify Ahuza Pay's tables, and this migration does not integrate its payment
service or automatically verify payments. The table contains one JSONB
document preserving the existing storefront model; database transactions lock
the row when updating it. This is a compatibility-first migration, not a
normalized relational schema.

To migrate an existing store:

1. Stop **all** storefront instances and background workers so the JSON file
   cannot change during migration. Back up the JSON file and PostgreSQL securely.
   The JSON file contains customer and order information.
2. Set `STOREFRONT_DATABASE_URL` in the storefront environment to the PostgreSQL
   connection URL supplied by your database provider. Do not commit the URL.
   The database role must be allowed to create the storefront table during
   import and read and update it afterwards. Configure TLS according to the
   database provider's connection instructions.
3. With development dependencies installed, run
   `npm run db:import -- /absolute/path/to/ahuza-db.json` against the stopped
   store's actual data file. This creates the table and imports the file once.
   It refuses to overwrite an existing storefront row and leaves the file intact.
4. Start the storefront with `STOREFRONT_DATABASE_URL` set and verify orders,
   customers, products, inventory and Owner Studio before resuming checkout.
   PostgreSQL errors do not fall back to the JSON file. Keep the original file
   as a protected backup; it will not receive subsequent changes. Rolling back
   to it after accepting new writes would lose those changes.

Without `STOREFRONT_DATABASE_URL`, the original JSON backend remains in use.
Keep the persistent volume for file-backed sessions, uploads and payment
screenshots. Continue running a single storefront instance: sessions, files and
background jobs have not been made safe for multiple instances.

Open **Owner Studio** from the storefront footer and enter the configured owner key. The key stays in browser memory and is sent only to owner APIs using `X-Owner-Key`. The dashboard includes sales and low-stock overview, product and ghost-mannequin editing, storefront content, fulfillment and return requests, integration status, an AI owner agent, reviewed customer-email drafts, and social caption generation. **Owner Studio → Storefront** edits the announcement, hero and story, campaign banners, homepage section headings, service promises, contact and newsletter copy, and footer text. Product names and descriptions are edited in **Products & stock**. These changes are saved with the storefront content in the persistent database.

To change the customer-support chatbot portrait, open **Owner Studio → Storefront → Chatbot portrait**, upload a JPG, PNG or WebP, and select **Publish storefront text**. The preview shows the circular crop. Custom portraits are static; choose **Use default portrait** and publish to restore the animated default.
Use **Search storefront settings and text** at the top of the Storefront editor to find an editing field or section and jump to it.

A shopping assistant appears briefly when customers open a product image or add an item to the bag. A portrait character is shown while the 3D version loads or if it cannot start. With reduced motion enabled, the assistant appears without animation.

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

### Legacy manual UPI orders

New UPI orders use PayU hosted checkout; direct manual UPI and the paise
identification adjustment are no longer offered for new orders. Until PayU is
configured, UPI checkout is unavailable and cash on delivery remains available.
Existing manual UPI orders retain their original amounts, payment instructions,
and owner-review workflow; they cannot be automatically reconciled by PayU.

The experimental `/api/webhooks/payment` endpoint accepts a raw JSON body with
an `x-signature` containing a hex HMAC-SHA256 computed using `WEBHOOK_SECRET`.
This is not a provider integration: even a valid signature receives HTTP 503,
and no order is marked paid. Do not configure a payment provider to use it
until its signature format, trusted payment status, order matching, and replay
handling have been implemented and tested against that provider.

Customers with an existing manual UPI order can upload a PNG or JPEG screenshot from the pending order
screen. Uploading only attaches private evidence to the order; it never marks
the order paid. Screenshot files are stored outside the public `/uploads` path,
and only the owner API can retrieve them. An optional `PAYMENT_PROOF_DIR` can
set the private storage directory; by default it is `.data/payment-proofs`,
which should be on the persistent application volume in production.

Legacy manual UPI orders remain pending until an owner checks the actual bank statement, matches
the credit to the customer and order, and enters the bank transaction reference
in **Owner Studio → Orders → Confirm UPI payment received**. Never confirm from
a screenshot or amount alone. Customers can also email a screenshot, order
number and bank reference to the storefront contact email if upload is
unavailable. The screenshot is for reference only; never ask for a UPI PIN or OTP.
A transaction reference cannot be reused for a
different order. Pending orders reserve stock for 60 minutes; customers must not
pay after expiry. If a payment arrives after cancellation or expiry, review it
against the bank statement; confirmation can restore the order only if stock
is still available. Otherwise arrange a refund or other resolution manually.
Email notifications are queued when configured; delivery is not guaranteed.
If the customer session expires while checking a payment, sign in again using
the account that placed the order. The status check then resumes; a 401 on that
endpoint means the customer session is missing, not that the payment failed.
Do not pay again merely because the status cannot be checked.

#### Gmail credit-alert review

The optional Gmail reader uses the Gmail API with read-only OAuth access. Set
`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, and
`GMAIL_TRUSTED_BANK_SENDERS` (a comma-separated list of exact sender email
addresses) on the server. Leave the sender list empty until the bank's actual
alert addresses have been independently confirmed.
The refresh token must have been authorized for the
`https://www.googleapis.com/auth/gmail.readonly` scope. The watcher only accepts
Axis Bank messages from configured exact addresses at `axisbank.com` or
`axis.bank.in` with an aligned Google DMARC pass. Explicit DKIM, SPF, or DMARC
failures cause rejection. The observed `alerts@axis.bank.in` format is supported
only when that exact address is configured: the subject and body amounts must
agree, and a masked account, IST date/time, and complete UPI/P2A transaction
information are required. Two-digit years are interpreted as 2000–2099. The
transaction-info references are bank data, not order IDs; the first is used for
deduplication and the second is retained separately. The Gmail message ID,
references, amount, masked account suffix, sender and timestamps are stored;
email bodies are not stored. Forwarded messages are not accepted as original
bank alerts. A repeated bank reference with conflicting amount, transaction
time, or account suffix is flagged for owner review.

The watcher polls Gmail history every minute. On first setup it scans all
matching sender messages, including spam and trash, before storing a Gmail
history checkpoint; later polls process additions since that checkpoint. If
Gmail expires the checkpoint, it rescans all matching sender messages. Adding
or removing trusted senders also triggers a rescan. Message IDs and transaction
references are deduplicated in the storefront database; PostgreSQL updates use
the existing locked storefront transaction. The first successful connection
binds this sync state to that Gmail account, and a different account is refused.
If scans fail, check server logs and restore access promptly. Emails deleted
before processing cannot be recovered by the watcher. Gmail Pub/Sub push and
watch renewal are not implemented; polling is the only synchronization method.
Review the initial backlog and validate the sender, authentication headers and
format against an original bank email before relying on alerts.

Parsed alerts are marked `review_required` and appear in **Owner Studio → Payments**
as candidates. They never
mark an order paid automatically: an owner must verify the credit in the bank
statement and explicitly associate it with an order. Amount-only matching can
be ambiguous and an authenticated email is not proof that a credit belongs to a
specific checkout. If OAuth is incomplete or Gmail cannot be reached, alerts
are not processed and orders remain pending for manual bank reconciliation.

The Payments tab also provides searchable alert history. New alerts record their
receipt, duplicate messages and owner actions; older alerts may not have a
detailed history. These events are stored with the existing storefront state;
no database migration is needed. A manual bank-statement reconciliation is not
an automatic `EMAIL_CONFIRMED` or independent `BANK_VERIFIED` result. Neither
level is implemented or enabled: the observed message does not establish a
validated order association, and no official independent bank integration is
configured. The customer-editable UPI note, screenshots and customer-entered
references are not independent proof.

### PayU India hosted checkout

Configure your PayU India merchant key and salt on the server:

```dotenv
PAYU_MERCHANT_KEY=<merchant key>
PAYU_MERCHANT_SALT=<merchant salt>
PAYU_MODE=test
PAYU_CALLBACK_URL=https://www.ahuzawear.com/api/payments/payu/callback
PAYU_WEBHOOK_URL=https://www.ahuzawear.com/api/payments/payu/webhook
```

`PAYU_MODE=test` uses PayU's test checkout and verify-payment API. After test
transactions succeed, set `PAYU_MODE=production` and use the production
credentials. Register the webhook URL for successful and failed payment events
in the PayU merchant dashboard. Both
callback and webhook requests are hash-validated; successful payments are
confirmed only after the server checks PayU's `verify_payment` API and matches
the transaction ID and INR amount to the stored order. Browser redirects and
webhook notifications alone never mark an order paid. Keep the merchant salt
server-side and configure the callback/webhook URLs to the publicly reachable
HTTPS address for this deployment.

The PayU key, salt, mode, and endpoints can also be edited or deleted from
**Owner Studio → Payments → PayU India checkout**. Credentials entered there
are encrypted in the storefront database using `PAYMENT_CONFIG_KEY` (or
`SESSION_SECRET` when the dedicated key is unset); only configured/not-configured
status is returned to the dashboard. Removing the saved settings disables PayU
for new orders and clears its encrypted credentials; it also prevents
verification of outstanding PayU payments until the appropriate credentials
are restored. If older Owner Studio settings select manual UPI, save PayU
settings in Owner Studio to replace them; those saved settings override
environment credentials.

The Owner Studio payment review assistant ranks exact-amount Gmail alert
candidates using any trusted bank transaction timestamp and the order's stock
reservation window. It also queues customer-submitted screenshots for owner
inspection. These are review hints, not verification: screenshots are not
proof of settlement, matching amounts/times do not confirm a transfer, and
only the owner checking the bank statement or PayU's server-verified API can
confirm payment. No customer receipt image or bank data is sent to an AI
provider.

### Legacy Instamojo integration

Instamojo is not available for new checkout orders. Existing Instamojo payment
requests can still be reconciled while their API credentials are configured.

For those existing orders, the store polls Instamojo's authenticated API and
confirms payment only after a matching successful transaction is reported.
Browser redirects are not proof of payment.

Set these server variables (never use a `VITE_` prefix):

```dotenv
INSTAMOJO_API_KEY=<your API key>
INSTAMOJO_AUTH_TOKEN=<your authentication token>
INSTAMOJO_SALT=<your webhook salt>
INSTAMOJO_WEBHOOK_URL=https://www.ahuzawear.com/api/payments/instamojo/webhook
```

These credentials are needed only to reconcile historical Instamojo orders;
they do not enable new Instamojo checkout. The webhook URL must be publicly
reachable over HTTPS to receive signed notifications. Authenticated status
checks remain available when the webhook salt is not set.

Orders created by the old standalone Ahuza Pay service cannot be reconciled
through Instamojo; review their settlement separately.

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
2. Add a Railway volume to the service mounted at `/app/.data`. Set `DATA_FILE=/app/.data/ahuza-db.json` and `SESSION_FILE_PATH=/app/.data/sessions` so the JSON database, customer sessions and files survive deploys and restarts. To use PostgreSQL instead, follow the explicit import procedure above and set `STOREFRONT_DATABASE_URL`; retain the volume for sessions and files. Keep this as a single service instance.
3. Add `SESSION_SECRET` (a stable random value of at least 32 characters) and `OWNER_API_KEY` in Railway's service variables. Railway supplies `PORT`. Configure PayU credentials and its webhook as described above for UPI checkout. Gmail OAuth is optional for reviewing legacy bank credits.
4. Create a Railway project token. In the GitHub repository, add it under **Settings → Secrets and variables → Actions → Secrets** as `RAILWAY_TOKEN`. Add the Railway web service name or ID under **Settings → Secrets and variables → Actions → Variables** as `RAILWAY_SERVICE`. Do not commit or paste the token into the repository.
5. Push to `main` or manually run **Actions → Verify and deploy to Railway**. The workflow runs `npm test` and `npm run build` first, then deploys only if those checks pass. Once Railway assigns a public domain, verify `/api/health` and the storefront.
6. Before accepting online payments, configure Ahuza Pay and complete a small live transaction end to end, including bank reconciliation.

Configure a Railway volume and stable secrets before treating the deployment as production-ready.

## Custom domain and search indexing

The canonical storefront URL is `https://www.ahuzawear.com/`. The built page declares this canonical URL, and `/robots.txt` points crawlers to `/sitemap.xml`. The Express server redirects requests for `ahuzawear.com` to the `www` hostname after the apex is routed to the app.

In Railway, attach both `www.ahuzawear.com` and `ahuzawear.com` to the production service. Use `railway domain status ahuzawear.com` to see the current required DNS records. Add those records in the domain DNS provider and wait for DNS and certificate validation. If the provider cannot flatten an apex CNAME or changing apex records would interfere with email, configure a permanent HTTPS redirect from `ahuzawear.com` to `https://www.ahuzawear.com/` instead; preserve existing MX and email-related TXT records.

After DNS is correct, add `https://www.ahuzawear.com/` as a URL-prefix property in Google Search Console, submit `https://www.ahuzawear.com/sitemap.xml`, and request indexing for the homepage. DNS propagation and Google's recrawl can take time; a code deployment alone cannot change DNS or guarantee when a search result updates.

## API overview

- `GET /api/products`, `GET /api/products/:id`
- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/payments/config`, `POST /api/payments/orders`, `GET /api/payments/orders/:id/status`, `POST /api/payments/orders/:id/cancel` (Ahuza Pay UPI checkout; customer status is never trusted for confirmation)
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

Order received, payment confirmed, shipped and 7-day follow-up emails are drafted by OpenAI (`OPENAI_API_KEY`) and sent automatically; a plain template is used if the AI call fails. Sending needs `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (Gmail: use an app password) or `RESEND_API_KEY`. PayU orders remain payment-pending until PayU verifies them; legacy manual UPI orders require bank reconciliation.

## Newsletter

The storefront footer newsletter form saves the normalized email address, consent text and timestamp in the persistent JSON database. Subscribing requires explicit consent, and new signups are recorded in Owner Studio event activity.
