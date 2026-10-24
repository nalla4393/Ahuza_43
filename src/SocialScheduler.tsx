import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CalendarClock, Play, Send, Trash2 } from 'lucide-react';
import { removeSentenceFullStops } from './siteCopy';

type Platform = 'facebook' | 'instagram';
type Schedule = { id: string; name: string; platforms: Platform[]; days: number[]; time: string; productMode: 'rotate' | 'newest'; tone: string; autoPublish: boolean; enabled: boolean };
type Post = { id: string; productName: string; caption: string; imageUrl: string; platform: Platform; status: 'draft' | 'posted' | 'failed'; detail?: string; createdAt: string };

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const tones = ['Warm and elegant', 'Playful', 'Premium', 'Festive'];
const platformNames: Record<Platform, string> = { facebook: 'Facebook', instagram: 'Instagram' };

async function request<T>(key: string, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', 'X-Owner-Key': key } });
  const payload = response.status === 204 ? {} : removeSentenceFullStops(await response.json().catch(() => ({})) as { error?: string });
  if (!response.ok) throw new Error((payload as { error?: string }).error || 'The request could not be completed');
  return payload as T;
}

export default function SocialScheduler({ ownerKey }: { ownerKey: string }) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [connected, setConnected] = useState<Record<Platform, boolean>>({ facebook: false, instagram: false });
  const [form, setForm] = useState({ name: '', platforms: ['instagram', 'facebook'] as Platform[], days: [1, 3, 5], time: '18:00', productMode: 'rotate' as Schedule['productMode'], tone: tones[0], autoPublish: false });
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await request<{ schedules: Schedule[]; posts: Post[]; connected: Record<Platform, boolean> }>(ownerKey, '/api/owner/social/schedules');
      setSchedules(result.schedules); setPosts(result.posts); setConnected(result.connected);
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Could not load schedules'); }
  }, [ownerKey]);
  useEffect(() => { void load(); }, [load]);

  async function act(work: () => Promise<unknown>, done: string) {
    setBusy(true); setMessage('');
    try { await work(); setMessage(done); await load(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Something went wrong'); }
    finally { setBusy(false); }
  }

  const toggle = <T,>(list: T[], value: T) => list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  const createSchedule = (event: FormEvent) => {
    event.preventDefault();
    void act(() => request(ownerKey, '/api/owner/social/schedules', { method: 'POST', body: JSON.stringify(form) }).then(() => setForm({ ...form, name: '' })), 'Schedule saved');
  };

  return <section className="studio-section studio-social">
    <section className="studio-panel">
      <div className="studio-panel-heading"><div><h2>Auto-post schedule</h2><span>The agent picks a product, writes the caption and posts at your chosen time (India time)</span></div><CalendarClock size={18} /></div>
      <div className="integration-grid">{(Object.keys(platformNames) as Platform[]).map((platform) => <div className="integration-row" key={platform}><span className={connected[platform] ? 'integration-on' : 'integration-off'} />{platformNames[platform]}<b>{connected[platform] ? 'Connected' : 'Not connected'}</b></div>)}</div>
      {!(connected.facebook || connected.instagram) && <p className="studio-agent-setup" role="status">Connect your accounts first Until then, posts are saved as drafts you can copy Add META_PAGE_ID, META_PAGE_ACCESS_TOKEN and META_IG_USER_ID on the server</p>}
      <form onSubmit={createSchedule}>
        <div className="studio-form-grid">
          <label>Schedule name<input value={form.name} maxLength={80} required onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Evening product spotlight" /></label>
          <label>Time (IST)<input type="time" value={form.time} required onChange={(event) => setForm({ ...form, time: event.target.value })} /></label>
          <label>Product choice<select value={form.productMode} onChange={(event) => setForm({ ...form, productMode: event.target.value as Schedule['productMode'] })}><option value="rotate">Rotate through all in-stock products</option><option value="newest">Always the newest product</option></select></label>
          <label>Tone<select value={form.tone} onChange={(event) => setForm({ ...form, tone: event.target.value })}>{tones.map((tone) => <option key={tone}>{tone}</option>)}</select></label>
          <div className="wide"><span>Post on</span><div className="event-chips">{dayNames.map((day, index) => <label key={day} className="check-filter"><input type="checkbox" checked={form.days.includes(index)} onChange={() => setForm({ ...form, days: toggle(form.days, index) })} /> {day}</label>)}</div></div>
          <div className="wide"><span>Platforms</span><div className="event-chips">{(Object.keys(platformNames) as Platform[]).map((platform) => <label key={platform} className="check-filter"><input type="checkbox" checked={form.platforms.includes(platform)} onChange={() => setForm({ ...form, platforms: toggle(form.platforms, platform) })} /> {platformNames[platform]}</label>)}</div></div>
          <label className="wide check-filter"><input type="checkbox" checked={form.autoPublish} onChange={(event) => setForm({ ...form, autoPublish: event.target.checked })} /> Post automatically without my approval (otherwise posts wait below as drafts)</label>
        </div>
        <button className="studio-primary" disabled={busy || !form.days.length || !form.platforms.length}>{busy ? 'Saving…' : 'Save schedule'} <CalendarClock size={15} /></button>
      </form>
      {message && <p className="studio-muted" role="status">{message}</p>}
    </section>

    <section className="studio-panel">
      <div className="studio-panel-heading"><div><h2>Your schedules</h2><span>{schedules.length ? 'Turn them on or off any time' : 'No schedules yet'}</span></div></div>
      {schedules.map((schedule) => <div className="integration-row" key={schedule.id}>
        <span className={schedule.enabled ? 'integration-on' : 'integration-off'} />
        <div><strong>{schedule.name}</strong><br /><small>{schedule.days.map((day) => dayNames[day]).join(', ')} at {schedule.time} · {schedule.platforms.map((platform) => platformNames[platform]).join(' and ')} · {schedule.autoPublish ? 'auto-post' : 'needs approval'}</small></div>
        <button className="studio-secondary" type="button" disabled={busy} onClick={() => void act(() => request(ownerKey, `/api/owner/social/schedules/${schedule.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !schedule.enabled }) }), schedule.enabled ? 'Schedule paused' : 'Schedule resumed')}>{schedule.enabled ? 'Pause' : 'Resume'}</button>
        <button className="studio-secondary" type="button" disabled={busy} onClick={() => void act(() => request(ownerKey, `/api/owner/social/schedules/${schedule.id}/run`, { method: 'POST', body: '{}' }), 'Post prepared, see the list below')}>Run now <Play size={14} /></button>
        <button className="studio-link-button" type="button" aria-label={`Delete ${schedule.name}`} disabled={busy} onClick={() => void act(() => request(ownerKey, `/api/owner/social/schedules/${schedule.id}`, { method: 'DELETE' }), 'Schedule deleted')}><Trash2 size={15} /></button>
      </div>)}
    </section>

    <section className="studio-panel">
      <div className="studio-panel-heading"><div><h2>Posts</h2><span>Review drafts, edit the caption and publish</span></div><Send size={18} /></div>
      {posts.length === 0 && <p className="studio-muted">Posts will appear here</p>}
      {posts.map((post) => <div className="caption-output" key={post.id}>
        <strong>{platformNames[post.platform]} · {post.productName} · {post.status === 'posted' ? 'Posted' : post.status === 'failed' ? 'Failed' : 'Draft'}</strong>
        {post.imageUrl && <img className="studio-image-preview" src={post.imageUrl} alt={post.productName} style={{ maxWidth: 160 }} />}
        <textarea rows={4} value={captions[post.id] ?? post.caption} disabled={post.status === 'posted'} onChange={(event) => setCaptions({ ...captions, [post.id]: event.target.value })} />
        {post.detail && <small role="alert">{post.detail}</small>}
        {post.status !== 'posted' && <div className="event-chips">
          <button className="studio-primary" type="button" disabled={busy} onClick={() => void act(() => request(ownerKey, `/api/owner/social/posts/${post.id}/publish`, { method: 'POST', body: JSON.stringify(captions[post.id] ? { caption: captions[post.id] } : {}) }), 'Publish attempted, check the status above')}>Publish now <Send size={14} /></button>
          <button className="studio-secondary" type="button" disabled={busy} onClick={() => void act(() => request(ownerKey, `/api/owner/social/posts/${post.id}`, { method: 'DELETE' }), 'Post discarded')}>Discard</button>
        </div>}
      </div>)}
    </section>
  </section>;
}
