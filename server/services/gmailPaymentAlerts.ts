import { mutateDatabase } from './database.js';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const BANK_DOMAINS = new Set(['axisbank.com', 'axis.bank.in']);

type GmailHeader = { name?: unknown; value?: unknown };
type GmailPart = {
  mimeType?: unknown;
  filename?: unknown;
  body?: { data?: unknown; attachmentId?: unknown };
  parts?: GmailPart[];
};
type GmailMessage = {
  id?: unknown;
  internalDate?: unknown;
  payload?: GmailPart & { headers?: GmailHeader[] };
};
class GmailApiError extends Error {
  constructor(readonly status: number) {
    super(`Gmail API returned HTTP ${status}`);
  }
}
class GmailHistoryExpiredError extends Error {}

export type ParsedBankCredit = {
  amount: number;
  transactionReference: string;
  receivedAt: string;
  transactionAt?: string;
  transactionTimezone?: 'IST';
  transactionType?: 'UPI/P2A';
  accountSuffix?: string;
  additionalReference?: string;
  sender?: string;
};

function trustedSenders(env: NodeJS.ProcessEnv = process.env): string[] {
  const entries = (env.GMAIL_TRUSTED_BANK_SENDERS || '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  if (entries.some((entry) => !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(entry))) {
    throw new Error('GMAIL_TRUSTED_BANK_SENDERS must contain comma-separated email addresses');
  }
  return [...new Set(entries)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function htmlText(html: string): string {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39|#\d+|#x[0-9a-f]+);/gi, (entity) => {
      const named: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
      const key = entity.toLowerCase();
      if (key in named) return named[key]!;
      const value = key.startsWith('&#x') ? parseInt(key.slice(3, -1), 16) : parseInt(key.slice(2, -1), 10);
      return Number.isInteger(value) && value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
        ? String.fromCodePoint(value) : ' ';
    });
}

function textParts(part: GmailPart): { plain: string[]; html: string[] } {
  const contents: { plain: string[]; html: string[] } = { plain: [], html: [] };
  if (typeof part.filename === 'string' && part.filename) return contents;
  if ((part.mimeType === 'text/plain' || part.mimeType === 'text/html') && typeof part.body?.data === 'string') {
    const text = Buffer.from(part.body.data, 'base64url').toString('utf8');
    (part.mimeType === 'text/plain' ? contents.plain : contents.html).push(part.mimeType === 'text/html' ? htmlText(text) : text);
  }
  if (part.mimeType !== 'message/rfc822') {
    for (const child of part.parts || []) {
      const nested = textParts(child);
      contents.plain.push(...nested.plain);
      contents.html.push(...nested.html);
    }
  }
  return contents;
}

function amountInPaise(value: string): number | null {
  if (!/^(?:\d+|\d{1,3}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.replace(/,/g, '').split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(amount) && amount >= 100 ? amount : null;
}

function axisTransactionTime(value: string): string | null {
  const match = /^(\d{2})-(\d{2})-(\d{2}),\s*(\d{2}):(\d{2})\s+IST$/i.exec(value);
  if (!match) return null;
  const [, dayText, monthText, yearText, hourText, minuteText] = match;
  const day = Number(dayText), month = Number(monthText), year = 2000 + Number(yearText), hour = Number(hourText), minute = Number(minuteText);
  if (hour > 23 || minute > 59 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day) return null;
  return new Date(local.getTime() - 330 * 60 * 1000).toISOString();
}

function parseObservedAxisFormat(subject: string, body: string, receivedAt: string, sender: string): ParsedBankCredit | null {
  const subjectMatch = /^INR\s+([0-9][0-9,.]*)\s+was credited to your A\/c\.\s*$/i.exec(subject.trim());
  if (!subjectMatch) return null;
  const fields = body.replace(/\s+/g, ' ');
  const amountMatches = [...fields.matchAll(/\bAmount Credited\s*:\s*INR\s+([0-9][0-9,.]*)(?=\s|$)/gi)];
  const accountMatches = [...fields.matchAll(/\bAccount Number\s*:\s*([Xx*]+[0-9]{4})(?=\s|$)/gi)];
  const dateMatches = [...fields.matchAll(/\bDate\s*&\s*Time\s*:\s*(\d{2}-\d{2}-\d{2},\s*\d{2}:\d{2}\s+IST)(?=\s|$)/gi)];
  const infoMatches = [...fields.matchAll(/\bTransaction Info\s*:\s*UPI\/P2A\/([A-Z0-9-]{6,100})\/([A-Z0-9-]{1,100})\/UTIUPI(?=\s|$)/gi)];
  if ([amountMatches, accountMatches, dateMatches, infoMatches].some((matches) => matches.length !== 1)) return null;
  const amount = amountInPaise(amountMatches[0]![1]!);
  const subjectAmount = amountInPaise(subjectMatch[1]!);
  const transactionAt = axisTransactionTime(dateMatches[0]![1]!);
  if (amount === null || amount !== subjectAmount || !transactionAt) return null;
  return {
    amount, transactionReference: infoMatches[0]![1]!.toUpperCase(), additionalReference: infoMatches[0]![2]!,
    transactionAt, transactionTimezone: 'IST', transactionType: 'UPI/P2A',
    accountSuffix: accountMatches[0]![1]!.slice(-4), sender, receivedAt,
  };
}

export function parseAxisBankCreditEmail(input: {
  from: string;
  authenticationResults: string[];
  subject: string;
  body: string;
  internalDate: string;
}, senders: string[] = trustedSenders()): ParsedBankCredit | null {
  const address = input.from.match(/^[^<>]*<([^<>]+)>\s*$/)?.[1] || input.from.trim();
  const sender = address.trim().toLowerCase();
  const senderDomain = sender.split('@').at(-1);
  if (!senders.includes(sender)) return null;
  if (!senderDomain || !BANK_DOMAINS.has(senderDomain)) return null;

  const googleResults = input.authenticationResults.filter((value) => /^mx\.google\.com;/i.test(value.trim()));
  if (googleResults.length !== 1) return null;
  const segments = googleResults[0]!.split(';').map((part) => part.trim());
  const domainMatches = segments.filter((part) => /^dmarc=pass\b/i.test(part) && new RegExp(`\\bheader\\.from=${senderDomain.replaceAll('.', '\\.')}(?=[;\\s]|$)`, 'i').test(part));
  if (domainMatches.length !== 1 || segments.some((part) => /^(?:dkim|spf|dmarc)=(?:fail|softfail|temperror|permerror)\b/i.test(part))) return null;

  const body = `${input.subject}\n${input.body}`.replace(/\s+/g, ' ');
  if (/\b(debited|debit alert|you paid|you sent|withdrawn|failed|unsuccessful|declined|reversed|reversal|cancelled|canceled|pending|will be credited|not credited)\b/i.test(body)
    || !/\bcredited\b/i.test(body) || /^(?:fw|fwd)\s*:/i.test(input.subject.trim())) return null;

  const receivedAtMs = Number(input.internalDate);
  if (!Number.isSafeInteger(receivedAtMs) || receivedAtMs <= 0 || !Number.isFinite(new Date(receivedAtMs).getTime())) return null;
  const receivedAt = new Date(receivedAtMs).toISOString();
  if (senderDomain === 'axis.bank.in') return parseObservedAxisFormat(input.subject, input.body, receivedAt, sender);

  const amountMatch = /\bcredited\s+(?:by|with)\s*(?:INR|Rs\.?|₹)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i.exec(body);
  if (!amountMatch) return null;
  const amount = amountInPaise(amountMatch[1]);
  if (amount === null) return null;

  const referenceMatch = /\bUPI\s*(?:ref(?:erence)?|transaction)\s*(?:no\.?|number|id)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{5,39})/i.exec(body);
  if (!referenceMatch) return null;

  return {
    amount,
    transactionReference: referenceMatch[1]!,
    receivedAt,
  };
}

export function gmailPaymentAlertsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GMAIL_CLIENT_ID?.trim() && env.GMAIL_CLIENT_SECRET?.trim() && env.GMAIL_REFRESH_TOKEN?.trim() && trustedSenders(env).length);
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
  const response = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new GmailApiError(response.status);
  return responseJson(response, 'Gmail API');
}

export function parsedCredit(message: GmailMessage, senders: string[] = trustedSenders()): ParsedBankCredit | null {
  if (!message.payload || typeof message.id !== 'string' || typeof message.internalDate !== 'string') return null;
  const headers = message.payload.headers || [];
  const getHeader = (name: string) => headers
    .filter((header) => typeof header.name === 'string' && header.name.toLowerCase() === name.toLowerCase())
    .map((header) => typeof header.value === 'string' ? header.value : '');
  const from = getHeader('From');
  const subject = getHeader('Subject');
  if (from.length !== 1 || subject.length !== 1) return null;
  const parts = textParts(message.payload);
  return parseAxisBankCreditEmail({
    from: from[0]!,
    authenticationResults: getHeader('Authentication-Results'),
    subject: subject[0]!,
    body: (parts.plain.length ? parts.plain : parts.html).join('\n'),
    internalDate: message.internalDate,
  }, senders);
}

function historyId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) throw new Error('Gmail returned an invalid history ID');
  return value;
}

function nextPage(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value) throw new Error('Gmail returned an invalid page token');
  return value;
}

function messageFromTrustedSender(message: GmailMessage, senders: string[]): boolean {
  const headers = message.payload?.headers;
  if (!Array.isArray(headers)) return false;
  const from = headers.filter((header) => typeof header.name === 'string' && header.name.toLowerCase() === 'from');
  if (from.length !== 1 || typeof from[0]?.value !== 'string') return false;
  const value = from[0].value;
  return senders.includes((value.match(/^[^<>]*<([^<>]+)>\s*$/)?.[1] || value.trim()).trim().toLowerCase());
}

export async function scanGmailPaymentAlerts(): Promise<void> {
  if (!gmailPaymentAlertsConfigured()) return;
  const accessToken = await getAccessToken();
  const senders = trustedSenders().sort();
  const senderKey = JSON.stringify(senders);
  const profile = await gmailRequest('/profile', accessToken);
  if (typeof profile.emailAddress !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(profile.emailAddress)) throw new Error('Gmail returned an invalid account address');
  const account = profile.emailAddress.toLowerCase();
  const initialHistory = historyId(profile.historyId);
  const database = await mutateDatabase((current) => {
    if (current.gmailAccountEmail && current.gmailAccountEmail !== account) throw new Error('Gmail account changed; refusing to reuse another mailbox checkpoint');
    current.gmailAccountEmail = account;
    if (current.gmailSenderKey !== senderKey) {
      current.gmailSenderKey = senderKey;
      delete current.gmailHistoryId;
    }
    return { history: current.gmailHistoryId, processed: [...(current.gmailProcessedMessageIds || [])] };
  });
  const knownIds = new Set(database.processed);
  const checkConfiguration = (current: { gmailAccountEmail?: string; gmailSenderKey?: string }) => {
    if (current.gmailAccountEmail !== account || current.gmailSenderKey !== senderKey) throw new Error('Gmail synchronization configuration changed during scan');
  };
  const processMessage = async (messageId: string) => {
    if (knownIds.has(messageId)) return;
    let message: GmailMessage;
    try {
      message = await gmailRequest(`/messages/${encodeURIComponent(messageId)}?format=full`, accessToken) as GmailMessage;
    } catch (error) {
      if (!(error instanceof GmailApiError) || error.status !== 404) throw error;
      console.error(`Gmail message ${messageId} was deleted before it could be reviewed`);
      knownIds.add(messageId);
      return;
    }
    if (message.id !== messageId || !message.payload || typeof message.internalDate !== 'string') throw new Error('Gmail returned an invalid message');
    if (!messageFromTrustedSender(message, senders)) return;
    const loadTextAttachments = async (part: GmailPart): Promise<void> => {
      if (part.filename || part.mimeType === 'message/rfc822') return;
      if ((part.mimeType === 'text/plain' || part.mimeType === 'text/html') && part.body?.data === undefined && part.body?.attachmentId !== undefined) {
        if (typeof part.body.attachmentId !== 'string' || !part.body.attachmentId) throw new Error('Gmail returned an invalid text attachment ID');
        const attachment = await gmailRequest(`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(part.body.attachmentId)}`, accessToken);
        if (typeof attachment.data !== 'string') throw new Error('Gmail returned invalid text attachment data');
        part.body.data = attachment.data;
      }
      for (const child of part.parts || []) await loadTextAttachments(child);
    };
    await loadTextAttachments(message.payload);
    const credit = parsedCredit(message, senders);
    await mutateDatabase((current) => {
      checkConfiguration(current);
      const processed = current.gmailProcessedMessageIds ||= [];
      if (processed.includes(messageId)) return;
      processed.push(messageId);
      if (!credit) return;
      const alerts = current.bankPaymentAlerts ||= [];
      const duplicate = alerts.find((alert) => alert.id === messageId || alert.transactionReference.toLowerCase() === credit.transactionReference.toLowerCase());
      if (duplicate) {
        const conflict = duplicate.amount !== credit.amount
          || (duplicate.transactionAt && credit.transactionAt && duplicate.transactionAt !== credit.transactionAt)
          || (duplicate.accountSuffix && credit.accountSuffix && duplicate.accountSuffix !== credit.accountSuffix);
        (duplicate.history ||= []).push({ at: new Date().toISOString(), action: conflict ? 'duplicate_conflict' : 'duplicate', messageId });
        if (conflict) {
          duplicate.duplicateConflict = true;
          console.error(`Conflicting Gmail bank alerts share transaction reference for message ${messageId}; owner review required`);
        }
        return;
      }
      alerts.push({ id: messageId, ...credit, status: 'review_required', history: [{ at: new Date().toISOString(), action: 'received', messageId }] });
    });
    knownIds.add(messageId);
  };
  const fullScan = async () => {
    let pageToken: string | undefined;
    const seenTokens = new Set<string>();
    do {
      const query = new URLSearchParams({ q: `{${senders.map((sender) => `from:${sender}`).join(' ')}}`, maxResults: '500', includeSpamTrash: 'true' });
      if (pageToken) query.set('pageToken', pageToken);
      const page = await gmailRequest(`/messages?${query}`, accessToken);
      if (page.messages !== undefined && !Array.isArray(page.messages)) throw new Error('Gmail returned an invalid message list');
      for (const entry of page.messages || []) {
        if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id) throw new Error('Gmail returned an invalid message ID');
        await processMessage(entry.id);
      }
      pageToken = nextPage(page.nextPageToken);
      if (pageToken && seenTokens.has(pageToken)) throw new Error('Gmail repeated a message-list page token');
      if (pageToken) seenTokens.add(pageToken);
    } while (pageToken);
    return initialHistory;
  };
  const historyScan = async (start: string) => {
    let pageToken: string | undefined;
    const seenTokens = new Set<string>();
    let end = start;
    do {
      const query = new URLSearchParams({ startHistoryId: start, historyTypes: 'messageAdded', maxResults: '500' });
      if (pageToken) query.set('pageToken', pageToken);
      let page: Record<string, unknown>;
      try {
        page = await gmailRequest(`/history?${query}`, accessToken);
      } catch (error) {
        if (error instanceof GmailApiError && error.status === 404) throw new GmailHistoryExpiredError('Gmail history expired');
        throw error;
      }
      if (page.history !== undefined && !Array.isArray(page.history)) throw new Error('Gmail returned invalid history');
      for (const record of page.history || []) {
        if (!isRecord(record) || (record.messagesAdded !== undefined && !Array.isArray(record.messagesAdded))) throw new Error('Gmail returned invalid history entries');
        for (const added of record.messagesAdded || []) {
          if (!isRecord(added) || !isRecord(added.message) || typeof added.message.id !== 'string' || !added.message.id) throw new Error('Gmail returned an invalid history message ID');
          await processMessage(added.message.id);
        }
      }
      end = historyId(page.historyId);
      pageToken = nextPage(page.nextPageToken);
      if (pageToken && seenTokens.has(pageToken)) throw new Error('Gmail repeated a history page token');
      if (pageToken) seenTokens.add(pageToken);
    } while (pageToken);
    return end;
  };
  let end: string;
  if (database.history) {
    try {
      end = await historyScan(historyId(database.history));
    } catch (error) {
      if (!(error instanceof GmailHistoryExpiredError)) throw error;
      console.error('Gmail history expired; rescanning all configured sender messages');
      end = await fullScan();
    }
  } else {
    end = await fullScan();
  }
  await mutateDatabase((current) => {
    checkConfiguration(current);
    if (!current.gmailHistoryId || BigInt(end) > BigInt(historyId(current.gmailHistoryId))) current.gmailHistoryId = end;
    current.gmailLastScannedAt = Math.max(current.gmailLastScannedAt ?? 0, Date.now());
  });
}

export function startGmailPaymentAlertWatcher(): void {
  if (!gmailPaymentAlertsConfigured()) {
    const configuredPartially = Boolean(process.env.GMAIL_CLIENT_ID || process.env.GMAIL_CLIENT_SECRET || process.env.GMAIL_REFRESH_TOKEN || process.env.GMAIL_TRUSTED_BANK_SENDERS);
    if (configuredPartially) console.error('Gmail payment alert watcher is disabled: configure OAuth credentials and trusted bank sender addresses');
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
  console.info('Gmail payment alert watcher enabled for configured senders; alerts require owner review');
}
