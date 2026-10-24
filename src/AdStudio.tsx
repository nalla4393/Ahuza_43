import { useState } from 'react';
import { Download, ImagePlus, Sparkles } from 'lucide-react';
import { removeSentenceFullStops } from './siteCopy';

type AdProduct = { id: string; name: string; active: boolean; stock: number };
type AdCopy = { headlines: string[]; primaryText: string; description: string; callToAction: string; hashtags: string[] };
type AdImage = { mimeType: string; data: string };

const platforms = ['Instagram', 'Facebook', 'Google Search', 'WhatsApp'];
const goals = ['Drive sales', 'Promote a new arrival', 'Festive offer', 'Build brand awareness'];
const tones = ['Warm and elegant', 'Playful', 'Premium', 'Festive'];
const imageStyles = ['Studio product shot', 'Lifestyle outdoor', 'Festive celebration', 'Minimal colour backdrop'];
const formats = ['Square', 'Portrait', 'Landscape'];

async function request<T>(key: string, url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Key': key }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(removeSentenceFullStops(payload.error || 'The request could not be completed'));
  return payload;
}

export default function AdStudio({ ownerKey, products, aiReady }: { ownerKey: string; products: AdProduct[]; aiReady: boolean }) {
  const active = products.filter((product) => product.active);
  const [productId, setProductId] = useState(active[0]?.id || '');
  const [platform, setPlatform] = useState(platforms[0]);
  const [goal, setGoal] = useState(goals[0]);
  const [tone, setTone] = useState(tones[0]);
  const [audience, setAudience] = useState('');
  const [style, setStyle] = useState(imageStyles[0]);
  const [format, setFormat] = useState(formats[0]);
  const [notes, setNotes] = useState('');
  const [copy, setCopy] = useState<AdCopy | null>(null);
  const [image, setImage] = useState<AdImage | null>(null);
  const [busy, setBusy] = useState<'copy' | 'image' | null>(null);
  const [message, setMessage] = useState('');

  async function writeCopy() {
    setBusy('copy'); setMessage('');
    try { setCopy((await request<{ copy: AdCopy }>(ownerKey, '/api/owner/ads/copy', { productId, platform, goal, tone, audience })).copy); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Ad copy failed'); }
    finally { setBusy(null); }
  }

  async function makeImage() {
    setBusy('image'); setMessage('');
    try { setImage((await request<{ image: AdImage }>(ownerKey, '/api/owner/ads/image', { productId, style, format, notes })).image); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Ad image failed'); }
    finally { setBusy(null); }
  }

  const imageUrl = image ? `data:${image.mimeType};base64,${image.data}` : '';
  const productName = active.find((product) => product.id === productId)?.name || 'ad';
  const extension = image?.mimeType === 'image/jpeg' ? 'jpg' : image?.mimeType === 'image/webp' ? 'webp' : 'png';

  return <section className="studio-section studio-social">
    <section className="studio-panel">
      <div className="studio-panel-heading"><div><h2>Ad agent</h2><span>Writes ad copy and creates ad images from your live products</span></div><Sparkles size={18} /></div>
      {!aiReady && <p className="studio-agent-setup" role="status">The ad agent needs an AI key (GEMINI_API_KEY) on the server</p>}
      <div className="studio-form-grid">
        <label className="wide">Product<select value={productId} onChange={(event) => setProductId(event.target.value)}>{active.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
      </div>
    </section>

    <section className="studio-panel">
      <div className="studio-panel-heading"><div><h2>Ad copy</h2><span>Headlines, main text and call to action</span></div><Sparkles size={18} /></div>
      <div className="studio-form-grid">
        <label>Where will it run<select value={platform} onChange={(event) => setPlatform(event.target.value)}>{platforms.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Goal<select value={goal} onChange={(event) => setGoal(event.target.value)}>{goals.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Tone<select value={tone} onChange={(event) => setTone(event.target.value)}>{tones.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Audience (optional)<input value={audience} maxLength={120} onChange={(event) => setAudience(event.target.value)} placeholder="For example college students in Hyderabad" /></label>
      </div>
      <button className="studio-primary" type="button" onClick={() => void writeCopy()} disabled={!aiReady || !productId || busy !== null}>{busy === 'copy' ? 'Writing…' : 'Write ad copy'} <Sparkles size={15} /></button>
      {copy && <div className="caption-output">
        <label>Headlines<textarea rows={copy.headlines.length || 3} value={copy.headlines.join('\n')} onChange={(event) => setCopy({ ...copy, headlines: event.target.value.split('\n') })} /></label>
        <label>Main text<textarea rows={6} value={copy.primaryText} onChange={(event) => setCopy({ ...copy, primaryText: event.target.value })} /></label>
        <label>Short description<input value={copy.description} onChange={(event) => setCopy({ ...copy, description: event.target.value })} /></label>
        <label>Call to action<input value={copy.callToAction} onChange={(event) => setCopy({ ...copy, callToAction: event.target.value })} /></label>
        <label>Hashtags<input value={copy.hashtags.join(' ')} onChange={(event) => setCopy({ ...copy, hashtags: event.target.value.split(/\s+/) })} /></label>
        <small>Check product claims and pricing before you publish</small>
      </div>}
    </section>

    <section className="studio-panel">
      <div className="studio-panel-heading"><div><h2>Ad image</h2><span>Uses the product photo as the reference so the garment stays accurate</span></div><ImagePlus size={18} /></div>
      <div className="studio-form-grid">
        <label>Style<select value={style} onChange={(event) => setStyle(event.target.value)}>{imageStyles.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Shape<select value={format} onChange={(event) => setFormat(event.target.value)}>{formats.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="wide">Extra notes (optional)<input value={notes} maxLength={300} onChange={(event) => setNotes(event.target.value)} placeholder="For example sunset garden background" /></label>
      </div>
      <button className="studio-primary" type="button" onClick={() => void makeImage()} disabled={!aiReady || !productId || busy !== null}>{busy === 'image' ? 'Creating, this can take a minute…' : 'Create ad image'} <ImagePlus size={15} /></button>
      {imageUrl && <div className="caption-output">
        <img className="studio-image-preview" src={imageUrl} alt="Generated ad" />
        <a className="studio-secondary" href={imageUrl} download={`${productName.replace(/[^\w-]+/g, '-')}-ad.${extension}`}>Download image <Download size={15} /></a>
        <small>AI images can contain mistakes, so check the garment details before you use it</small>
      </div>}
    </section>
    {message && <p className="studio-agent-setup" role="alert">{message}</p>}
  </section>;
}
