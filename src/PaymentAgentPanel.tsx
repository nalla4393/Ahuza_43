import { useCallback, useEffect, useState } from 'react';
import { Bot } from 'lucide-react';

type Entry = { id: string; orderId: string; at: string; trigger: string; decision: 'confirmed' | 'held_out_of_stock'; detail: string };
type Held = { id: string; amount: number; items: { name: string; quantity: number }[] };

const triggerLabels: Record<string, string> = { ahuza_pay_notify: 'Bank alert', poll: 'Auto check', customer_check: 'Customer page', owner_manual: 'Owner' };

export default function PaymentAgentPanel({ ownerKey }: { ownerKey: string }) {
  const [log, setLog] = useState<Entry[]>([]);
  const [held, setHeld] = useState<Held[]>([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/owner/payment-agent', { headers: { 'X-Owner-Key': ownerKey } });
      if (!response.ok) throw new Error('Could not load the payment agent');
      const data = await response.json() as { log: Entry[]; held: Held[] };
      setLog(data.log); setHeld(data.held); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load the payment agent'); }
  }, [ownerKey]);

  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 15000); return () => window.clearInterval(timer); }, [load]);

  async function confirmAnyway(order: Held) {
    if (!window.confirm(`Confirm ${order.id}? Stock is short, so check you can still supply it`)) return;
    setBusyId(order.id);
    try {
      const response = await fetch(`/api/owner/orders/${encodeURIComponent(order.id)}/confirm-upi-payment`, { method: 'PATCH', headers: { 'X-Owner-Key': ownerKey } });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not confirm the order');
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not confirm the order'); }
    finally { setBusyId(''); }
  }

  return <section className="studio-section studio-marketing">
    <section className="studio-panel">
      <div className="studio-panel-heading"><div><h2>Payment verification agent</h2><span>Confirms an order by itself once the bank credit is matched and stock is available</span></div><Bot size={18} /></div>
      {error && <p className="studio-agent-setup" role="alert">{error}</p>}
      {held.length > 0 && <div role="status"><h3>Paid but out of stock, needs you</h3>{held.map((order) => <p key={order.id}>{order.id} · {order.items.map((item) => `${item.quantity} × ${item.name}`).join(', ')} <button className="studio-primary" disabled={busyId === order.id} onClick={() => void confirmAnyway(order)}>Confirm anyway</button></p>)}</div>}
      <h3>Recent decisions</h3>
      {log.length === 0 ? <p>No payments handled yet</p> : <ul>{log.map((entry) => <li key={entry.id}>{new Date(entry.at).toLocaleString()} · {entry.orderId} · {entry.decision === 'confirmed' ? 'Confirmed' : 'Held'} ({triggerLabels[entry.trigger] || entry.trigger}) · {entry.detail}</li>)}</ul>}
    </section>
  </section>;
}
