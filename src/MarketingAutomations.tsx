import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Play, Sparkles, Trash2, Zap } from 'lucide-react';

type Rule = { id: string; name: string; trigger: 'order_placed' | 'order_delivered' | 'win_back'; delayDays: number; goal: string; enabled: boolean };
type Run = { key: string; ruleName: string; to: string; status: 'sent' | 'failed' | 'skipped'; detail?: string; at: string };

const triggerLabels: Record<Rule['trigger'], string> = {
  order_placed: 'After a customer places an order',
  order_delivered: 'After an order is delivered',
  win_back: 'When a customer has not ordered for a while',
};

async function request<T>(key: string, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', 'X-Owner-Key': key } as HeadersInit, ...(init.body ? { body: init.body } : {}), method: init.method });
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error((payload as { error?: string }).error || 'The request could not be completed.');
  return payload as T;
}

export default function MarketingAutomations({ ownerKey }: { ownerKey: string }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [emailReady, setEmailReady] = useState(true);
  const [form, setForm] = useState({ name: '', trigger: 'order_delivered' as Rule['trigger'], delayDays: 7, goal: '' });
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await request<{ rules: Rule[]; runs: Run[]; emailReady: boolean }>(ownerKey, '/api/owner/marketing-automations');
    setRules(data.rules); setRuns(data.runs); setEmailReady(data.emailReady);
  }, [ownerKey]);
  useEffect(() => { void load().catch((error: Error) => setMessage(error.message)); }, [load]);

  async function act(work: () => Promise<void>, success: string) {
    setBusy(true); setMessage('');
    try { await work(); await load(); setMessage(success); } catch (error) { setMessage(error instanceof Error ? error.message : 'Something went wrong.'); }
    finally { setBusy(false); }
  }

  const submit = (event: FormEvent) => { event.preventDefault(); void act(async () => { await request(ownerKey, '/api/owner/marketing-automations', { method: 'POST', body: JSON.stringify(form) }); setForm({ ...form, name: '', goal: '' }); setPreview(null); }, 'Automation saved and running.'); };

  return <section className="studio-panel studio-automations">
    <div className="studio-panel-heading"><div><h2>Marketing automation agent</h2><span>Set a goal; the AI writes each email and sends it automatically. Only customers who opted in to marketing are contacted.</span></div><Zap size={18} /></div>
    {!emailReady && <p className="studio-email-warning" role="status">Automations are paused until email sending is configured on the server.</p>}
    <form onSubmit={submit} className="automation-form">
      <label>Name<input value={form.name} maxLength={80} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
      <label>When<select value={form.trigger} onChange={(event) => setForm({ ...form, trigger: event.target.value as Rule['trigger'] })}>{Object.entries(triggerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Wait (days)<input type="number" min={0} max={365} value={form.delayDays} onChange={(event) => setForm({ ...form, delayDays: Number(event.target.value) })} required /></label>
      <label>What should the email achieve?<textarea rows={3} maxLength={500} value={form.goal} onChange={(event) => setForm({ ...form, goal: event.target.value })} placeholder="e.g. Thank them and invite them to browse our new arrivals" required /></label>
      <div className="automation-actions">
        <button type="button" className="studio-secondary" disabled={busy || !form.goal.trim()} onClick={() => void act(async () => setPreview(await request(ownerKey, '/api/owner/marketing-automations/preview', { method: 'POST', body: JSON.stringify(form) })), 'Preview ready.')}>Preview AI email <Sparkles size={15} /></button>
        <button className="studio-primary" disabled={busy}>Save automation</button>
      </div>
    </form>
    {preview && <div className="automation-preview"><strong>{preview.subject}</strong><p style={{ whiteSpace: 'pre-wrap' }}>{preview.body}</p></div>}
    {message && <p role="status">{message}</p>}
    <h3>Your automations</h3>
    {rules.length === 0 && <p>No automations yet.</p>}
    {rules.map((rule) => <div className="automation-rule" key={rule.id}>
      <div><strong>{rule.name}</strong><small>{triggerLabels[rule.trigger]} · wait {rule.delayDays}d</small><small>{rule.goal}</small></div>
      <button className="studio-secondary" disabled={busy} onClick={() => void act(() => request(ownerKey, `/api/owner/marketing-automations/${rule.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !rule.enabled }) }), rule.enabled ? 'Paused.' : 'Resumed.')}>{rule.enabled ? 'Pause' : 'Resume'}</button>
      <button className="studio-secondary" aria-label={`Delete ${rule.name}`} disabled={busy} onClick={() => void act(() => request(ownerKey, `/api/owner/marketing-automations/${rule.id}`, { method: 'DELETE' }), 'Deleted.')}><Trash2 size={15} /></button>
    </div>)}
    <button className="studio-secondary" disabled={busy || rules.length === 0} onClick={() => void act(async () => { const result = await request<{ sent: number }>(ownerKey, '/api/owner/marketing-automations/run', { method: 'POST' }); setMessage(`${result.sent} email(s) sent.`); }, 'Run complete.')}>Run now <Play size={15} /></button>
    <h3>Recent activity</h3>
    {runs.length === 0 && <p>Nothing sent yet. The agent checks every 15 minutes.</p>}
    {runs.map((run) => <p key={run.key + run.at} className="automation-run">{new Date(run.at).toLocaleString('en-IN')} · {run.ruleName} → {run.to} · <strong>{run.status}</strong>{run.detail ? ` (${run.detail})` : ''}</p>)}
  </section>;
}
