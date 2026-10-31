// Reads bank credit-alert emails (Axis Bank, Google Pay) from an IMAP inbox and reports each credit to Ahuza Pay.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

const DEFAULT_SENDERS = ['axisbank.com', 'axis.bank.in', 'google.com', 'pay.google.com'];

const CREDIT_WORDS = /\b(credited|received|has been credited|credit alert|sent you|paid you)\b/i;
const DEBIT_WORDS = /\b(debited|debit alert|you paid|you sent|payment to|withdrawn)\b/i;

// Returns { amount_paise, reference, note } for a genuine credit email, otherwise null.
export function parseCreditEmail({ from = '', subject = '', text = '', messageId = '', authResults = '' }, allowedSenders = DEFAULT_SENDERS) {
  const domain = from.toLowerCase().split('@').pop().replace(/[>\s]/g, '');
  if (!allowedSenders.some((s) => domain === s || domain.endsWith(`.${s}`))) return null;
  // Anyone can forge a "From"; only accept mail whose sender domain the receiving server verified.
  if (!/\b(dkim|dmarc|spf)=pass\b/i.test(authResults)) return null;
  const body = `${subject}\n${text}`.replace(/\s+/g, ' ');
  if (DEBIT_WORDS.test(body) || !CREDIT_WORDS.test(body)) return null;
  const match = /(?:INR|Rs\.?|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i.exec(body);
  if (!match) return null;
  const amount_paise = Math.round(Number(match[1].replace(/,/g, '')) * 100);
  if (!Number.isInteger(amount_paise) || amount_paise <= 0) return null;
  const utr = /\b(\d{12})\b/.exec(body)?.[1];
  const reference = utr || String(messageId).replace(/[<>]/g, '').slice(0, 64);
  if (!reference) return null;
  return { amount_paise, reference, note: body.slice(0, 500) };
}

export function startBankMailWatcher({ onCredit, env = process.env }) {
  const user = env.IMAP_USER;
  const pass = env.IMAP_PASS;
  if (!user || !pass) return false;
  const allowed = env.BANK_MAIL_SENDERS ? env.BANK_MAIL_SENDERS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : DEFAULT_SENDERS;
  const intervalMs = Math.max(5, Number(env.IMAP_POLL_SECONDS) || 15) * 1000;

  async function scan() {
    const client = new ImapFlow({ host: env.IMAP_HOST || 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false });
    client.on('error', () => {});
    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        const uids = await client.search({ seen: false, since });
        for (const uid of uids || []) {
          const message = await client.fetchOne(uid, { source: true }, { uid: true });
          const mail = await simpleParser(message.source);
          const parsed = parseCreditEmail({
            from: mail.from?.value?.[0]?.address || '',
            subject: mail.subject || '',
            text: mail.text || '',
            messageId: mail.messageId || '',
            authResults: String(mail.headers.get('authentication-results') || ''),
          }, allowed);
          if (parsed) await onCredit(parsed);
          await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
        }
      } finally { lock.release(); }
    } catch (error) {
      console.error('Bank mail scan failed:', error.message);
    } finally {
      await client.logout().catch(() => {});
    }
  }

  let running = false;
  const tick = async () => { if (running) return; running = true; try { await scan(); } finally { running = false; } };
  void tick();
  setInterval(tick, intervalMs).unref();
  console.log(`Bank mail watcher on for ${user}`);
  return true;
}
