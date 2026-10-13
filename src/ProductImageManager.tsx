import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ArrowLeft, ArrowRight, ImagePlus, RefreshCw, Replace, Star, Trash2, X } from 'lucide-react';
import type { ProductImage } from './imageTypes';

type QueueItem = { id: string; file: File; preview: string; progress: number; status: 'uploading' | 'error'; error?: string; replaceId?: string };
type Props = {
  ownerKey: string;
  images: ProductImage[];
  mainImageId?: string;
  legacyUrl: string;
  maxMb: number;
  onChange: (images: ProductImage[], mainImageId?: string) => void;
  onPendingChange: (pending: boolean) => void;
  onMessage: (text: string) => void;
};

const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
const uploadTimeoutMs = 5 * 60 * 1000;

function sendFile(ownerKey: string, file: File, onProgress: (percent: number) => void, signal: AbortSignal): Promise<ProductImage> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/owner/images');
    request.timeout = uploadTimeoutMs;
    request.setRequestHeader('Content-Type', file.type);
    request.setRequestHeader('X-Owner-Key', ownerKey);
    request.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); };
    request.onload = () => {
      let payload: { image?: ProductImage; error?: string } = {};
      try { payload = JSON.parse(request.responseText); } catch { /* non-JSON error body */ }
      if (request.status === 201 && payload.image) resolve(payload.image);
      else reject(new Error(request.status === 413 ? 'The file is larger than the allowed upload size.' : payload.error || 'Upload failed. Please retry.'));
    };
    request.onerror = () => reject(new Error('Network problem. Check your connection and retry.'));
    request.ontimeout = () => reject(new Error('The upload timed out on a slow connection. Please retry.'));
    signal.addEventListener('abort', () => { request.abort(); reject(new DOMException('Aborted', 'AbortError')); });
    request.send(file);
  });
}

export default function ProductImageManager({ ownerKey, images, mainImageId, legacyUrl, maxMb, onChange, onPendingChange, onMessage }: Props) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const addInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);
  const controllers = useRef(new Map<string, AbortController>());
  const latest = useRef({ images, mainImageId });
  latest.current = { images, mainImageId };
  const mainId = mainImageId || images[0]?.id;

  useEffect(() => { onPendingChange(queue.length > 0); }, [queue.length, onPendingChange]);
  useEffect(() => () => { controllers.current.forEach((controller) => controller.abort()); }, []);

  function patchItem(id: string, patch: Partial<QueueItem>) { setQueue((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item)); }
  function dropItem(id: string) {
    controllers.current.get(id)?.abort(); controllers.current.delete(id);
    setQueue((current) => { current.filter((item) => item.id === id).forEach((item) => URL.revokeObjectURL(item.preview)); return current.filter((item) => item.id !== id); });
  }

  async function run(item: QueueItem) {
    const controller = new AbortController();
    controllers.current.set(item.id, controller);
    patchItem(item.id, { status: 'uploading', progress: 0, error: undefined });
    try {
      const uploaded = await sendFile(ownerKey, item.file, (progress) => patchItem(item.id, { progress }), controller.signal);
      const { images: current, mainImageId: currentMain } = latest.current;
      let next: ProductImage[];
      let nextMain = currentMain || current[0]?.id;
      if (item.replaceId && current.some((image) => image.id === item.replaceId)) {
        next = current.map((image) => image.id === item.replaceId ? uploaded : image);
        if (nextMain === item.replaceId) nextMain = uploaded.id;
      } else {
        next = [...current, uploaded];
        if (!current.length) nextMain = uploaded.id;
      }
      latest.current = { images: next, mainImageId: nextMain };
      onChange(next, nextMain);
      dropItem(item.id);
      onMessage(`${item.file.name} uploaded successfully.`);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      controllers.current.delete(item.id);
      patchItem(item.id, { status: 'error', error: reason instanceof Error ? reason.message : 'Upload failed.' });
    }
  }

  function enqueue(files: File[], replaceId?: string) {
    const items: QueueItem[] = files.map((file) => {
      const rejected = !allowedTypes.includes(file.type) ? 'Only JPG, PNG and WebP images are supported.' : file.size > maxMb * 1024 * 1024 ? `The file is larger than the ${maxMb} MB limit.` : '';
      return { id: crypto.randomUUID(), file, preview: URL.createObjectURL(file), progress: 0, status: rejected ? 'error' : 'uploading', error: rejected || undefined, replaceId };
    });
    setQueue((current) => [...current, ...items]);
    items.filter((item) => item.status === 'uploading').forEach((item) => void run(item));
  }

  function onAdd(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length) enqueue(files);
  }

  function onReplace(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) enqueue([file], replaceTarget.current || undefined);
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= images.length) return;
    const next = [...images];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next, mainId);
  }

  const showLegacy = images.length === 0 && Boolean(legacyUrl);
  return <div className="pim">
    <div className="pim-head">
      <div><strong>Product images</strong><small>JPG, PNG or WebP · up to {maxMb} MB each · select several at once</small></div>
      <button type="button" className="pim-upload" onClick={() => addInput.current?.click()}><ImagePlus size={16} /> Upload Image</button>
    </div>
    <input ref={addInput} className="pim-input" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={onAdd} />
    <input ref={replaceInput} className="pim-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={onReplace} />
    <div className="pim-grid">
      {showLegacy && <figure className="pim-tile is-main"><img src={legacyUrl} alt="Current main product" /><span className="pim-badge">Current main image</span>
        <div className="pim-actions"><button type="button" onClick={() => { replaceTarget.current = null; replaceInput.current?.click(); }}><Replace size={14} /> Replace</button></div></figure>}
      {images.map((image, index) => <figure key={image.id} className={`pim-tile ${image.id === mainId ? 'is-main' : ''}`}>
        <img src={image.variants[0]?.url || image.url} alt={image.originalName || 'Product'} />
        {image.id === mainId && <span className="pim-badge"><Star size={11} /> Main</span>}
        <div className="pim-actions">
          {image.id !== mainId && <button type="button" onClick={() => onChange(images, image.id)} aria-label="Make main image"><Star size={14} /></button>}
          <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move earlier"><ArrowLeft size={14} /></button>
          <button type="button" onClick={() => move(index, 1)} disabled={index === images.length - 1} aria-label="Move later"><ArrowRight size={14} /></button>
          <button type="button" onClick={() => { replaceTarget.current = image.id; replaceInput.current?.click(); }} aria-label="Replace image"><Replace size={14} /></button>
          <button type="button" onClick={() => { const next = images.filter((entry) => entry.id !== image.id); onChange(next, image.id === mainId ? next[0]?.id : mainId); }} aria-label="Delete image"><Trash2 size={14} /></button>
        </div>
      </figure>)}
      {queue.map((item) => <figure key={item.id} className={`pim-tile is-pending ${item.status === 'error' ? 'has-error' : ''}`}>
        <img src={item.preview} alt="Selected upload preview" />
        {item.status === 'uploading' ? <div className="pim-progress" role="progressbar" aria-valuenow={item.progress} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${item.progress}%` }} /><span>{item.progress >= 100 ? 'Processing…' : `Uploading ${item.progress}%`}</span></div>
          : <div className="pim-error" role="alert"><span>{item.error}</span>{allowedTypes.includes(item.file.type) && item.file.size <= maxMb * 1024 * 1024 && <button type="button" onClick={() => void run(item)}><RefreshCw size={13} /> Retry</button>}</div>}
        <button type="button" className="pim-cancel" onClick={() => dropItem(item.id)} aria-label="Remove selected image"><X size={14} /></button>
      </figure>)}
    </div>
    {images.length === 0 && !showLegacy && queue.length === 0 && <p className="studio-muted">No images yet. Tap Upload Image to choose photos from your gallery or computer.</p>}
    {queue.length > 0 && <p className="pim-note">Finish or remove pending uploads before saving the product.</p>}
  </div>;
}
