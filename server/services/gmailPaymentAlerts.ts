import { getDatabase, mutateDatabase } from './database.js';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const BANK_DOMAIN = 'axisbank.com';
const MAX_PROCESSED_MESSAGE_IDS = 2000;

type GmailHeader = { name?: unknown; value?: unknown };
type GmailPart = {
  mimeType?: unknown;
  body?: { data?: unknown };
  parts?: GmailPart[];
};
type GmailMessage = {
  id?: unknown;
  internalDate?: unknown;
  payload?: GmailPart & { headers?: GmailHeader[] };
};
type GmailApiMessageList = { messages?: { id?: unknown }[]; nextPageToken?: unknown };

export type ParsedBankCredit = {
  amount: number;
  transactionReference: string;
  receivedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function textParts(part: GmailPart): string[] {
  const contents: string[] = [];
  if (typeof part.body?.data === 'string') {
    const text = Buffer.from(part.body.data, 'base64url').toString('utf8');
    contents.push(part.mimeType === 'text/html'
      ? text.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
      : text);
  }
  for (const child of part.parts || []) contents.push(...textParts(child));
  return contents;
}

export function parseAxisBankCreditEmail(input: {
  from: string;
  authenticationResults: string[];
  subject: string;
  body: string;
  internalDate: string;
}): ParsedBankCredit | null {
  const address = input.from.match(/<([^<>]+)>/)?.[1] || input.from.trim();
  const senderDomain = address.toLowerCase().split('@').at(-1);
  if (senderDomain !== BANK_DOMAIN) return null;

  const authenticatedByGoogle = input.authenticationResults.some((value) => /^mx\.google\.com;/i.test(value.trim()));
  const dmarcPassed = input.authenticationResults.some((value) =>
    /^mx\.google\.com;/i.test(value.trim())
      && /\bdmarc=pass\b[^;]*\bheader\.from=axisbank\.com\b/i.test(value));
  if (!authenticatedByGoogle || !dmarcPassed) return null;

  const body = `${input.subject}\n${input.body}`.replace(/\s+/g, ' ');
  if (/\b(debited|debit alert|you paid|you sent|withdrawn)\b/i.test(body)
    || !/\bcredited\b/i.test(body)) return null;

  const amountMatch = /\bcredited\s+(?:by|with)\s*(?:INR|Rs\.?|₹)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i.exec(body);
  if (!amountMatch) return null;
  const rupees = Number(amountMatch[1].replace(/,/g, ''));
  const amount = Math.round(rupees * 100);
  if (!Number.isSafeInteger(amount) || amount < 100) return null;

  const referenceMatch = /\bUPI\s*(?:ref(?:erence)?|transaction)\s*(?:no\.?|number|id)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{5,39})/i.exec(body);
  if (!referenceMatch) return null;

  const receivedAtMs = Number(input.internalDate);
  if (!Number.isSafeInteger(receivedAtMs) || receivedAtMs <= 0) return null;
  return {
    amount,
    transactionReference: referenceMatch[1]!,
    receivedAt: new Date(receivedAtMs).toISOString(),
  };
}

export function gmailPaymentAlertsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GMAIL_CLIENT_ID?.trim() && env.GMAIL_CLIENT_SECRET?.trim() && env.GMAIL_REFRESH_TOKEN?.trim());
}

async function responseJson(response: Response, description: string): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(`${description} returned HTTP ${response.status}`);
  const value: unknown = await response.json();
  if (!isRecord(value)) throw new Error(`${description} returned an invalid response`);
  return value;
}

async function getAccessToken(): Promise<string> {
  if (!gmailPaymentAlertsConfigured()) throw new Error('Gmail payment alert OAuth is not configured');
  const body = new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID!.trim(),
    client_secret: process.env.GMAIL_CLIENT_SECRET!.trim(),
    refresh_token: process.env.GMAIL_REFRESH_TOKEN!.trim(),
    grant_type: 'refresh_token',
  });
  const token = await responseJson(await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000),
  }), 'Google OAuth');
  if (typeof token.access_token !== 'string' || !token.access_token) throw new Error('Google OAuth did not return an access token');
  return token.access_token;
}

async function gmailRequest(path: string, accessToken: string): Promise<Record<string, unknown>> {
  return responseJson(await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  }), 'Gmail API');
}

function parsedCredit(message: GmailMessage): ParsedBankCredit | null {
  if (!message.payload || typeof message.id !== 'string' || typeof message.internalDate !== 'string') return null;
  const headers = message.payload.headers || [];
  const getHeader = (name: string) => headers
    .filter((header) => typeof header.name === 'string' && header.name.toLowerCase() === name.toLowerCase())
    .map((header) => typeof header.value === 'string' ? header.value : '');
  return parseAxisBankCreditEmail({
    from: getHeader('From')[0] || '',
    authenticationResults: getHeader('Authentication-Results'),
    subject: getHeader('Subject')[0] || '',
    body: textParts(message.payload).join('\n'),
    internalDate: message.internalDate,
  });
}

export async function scanGmailPaymentAlerts(): Promise<void> {
  if (!gmailPaymentAlertsConfigured()) return;
  const accessToken = await getAccessToken();
  const database = await getDatabase();
  const knownIds = new Set(database.gmailProcessedMessageIds || []);
  const scanStartedAt = Date.now();
  const lastScannedAt = database.gmailLastScannedAt ?? scanStartedAt - 7 * 24 * 60 * 60 * 1000;
  const after = Math.floor((lastScannedAt - 2 * 60 * 1000) / 1000);
  let pageToken: string | undefined;

  do {
    const query = new URLSearchParams({ q: `from:${BANK_DOMAIN} after:${after}`, maxResults: '500' });
    if (pageToken) query.set('pageToken', pageToken);
    const listed = await gmailRequest(`/messages?${query}`, accessToken) as GmailApiMessageList;
    const messages = Array.isArray(listed.messages) ? listed.messages : [];

    for (const entry of messages) {
      if (typeof entry.id !== 'string' || knownIds.has(entry.id)) continue;
      const messageId = entry.id;
      const message = await gmailRequest(`/messages/${encodeURIComponent(messageId)}?format=full`, accessToken) as GmailMessage;
      const credit = parsedCredit(message);
      await mutateDatabase((database) => {
        const processed = database.gmailProcessedMessageIds ||= [];
        if (processed.includes(messageId)) return;
        processed.push(messageId);
        if (processed.length > MAX_PROCESSED_MESSAGE_IDS) processed.splice(0, processed.length - MAX_PROCESSED_MESSAGE_IDS);
        if (!credit) return;
        const alerts = database.bankPaymentAlerts ||= [];
        if (alerts.some((alert) => alert.transactionReference.toLowerCase() === credit.transactionReference.toLowerCase())) return;
        alerts.push({
          id: messageId,
          amount: credit.amount,
          transactionReference: credit.transactionReference,
          receivedAt: credit.receivedAt,
          status: 'pending',
        });
      });
      knownIds.add(entry.id);
    }

    pageToken = typeof listed.nextPageToken === 'string' ? listed.nextPageToken : undefined;
  } while (pageToken);

  await mutateDatabase((current) => { current.gmailLastScannedAt = scanStartedAt; });
}

export function startGmailPaymentAlertWatcher(): void {
  if (!gmailPaymentAlertsConfigured()) {
    const configuredPartially = Boolean(process.env.GMAIL_CLIENT_ID || process.env.GMAIL_CLIENT_SECRET || process.env.GMAIL_REFRESH_TOKEN);
    if (configuredPartially) console.error('Gmail payment alert watcher is disabled: configure the client ID, client secret, and refresh token');
    return;
  }

  let running = false;
  const scan = async () => {
    if (running) return;
    running = true;
    try {
      await scanGmailPaymentAlerts();
    } catch (error) {
      console.error('Gmail payment alert scan failed:', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      running = false;
    }
  };
  void scan();
  setInterval(() => void scan(), 60 * 1000).unref();
  console.info(`Gmail payment alert watcher enabled for ${BANK_DOMAIN}; alerts require owner review`);
}
