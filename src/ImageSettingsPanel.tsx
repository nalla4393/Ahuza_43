import { useState, type FormEvent, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import type { ImageSettings } from './imageTypes';

type Props = { settings: ImageSettings; maxUploadMb: number; busy: boolean; onSave: (settings: ImageSettings) => Promise<void> };

const ratios: ImageSettings['aspectRatio'][] = ['1:1', '3:4', '4:5', '4:3', 'original'];
const cap = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

function Select<T extends string>({ label, value, options, onChange, names = {} }: { label: string; value: T; options: readonly T[]; onChange: (value: T) => void; names?: Partial<Record<T, string>> }) {
  return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value as T)}>{options.map((option) => <option key={option} value={option}>{names[option] || cap(option)}</option>)}</select></label>;
}
function Slider({ label, value, min, max, unit = 'px', onChange }: { label: string; value: number; min: number; max: number; unit?: string; onChange: (value: number) => void }) {
  return <label>{label}: {value}{unit}<input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
function Check2({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (value: boolean) => void; hint?: string }) {
  return <label className="is-check"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}{hint && <small>{hint}</small>}</span></label>;
}
const Group = ({ title, children }: { title: string; children: ReactNode }) => <section className="studio-panel"><div className="studio-panel-heading"><h2>{title}</h2></div><div className="studio-form-grid ims-grid">{children}</div></section>;

export default function ImageSettingsPanel({ settings, maxUploadMb, busy, onSave }: Props) {
  const [draft, setDraft] = useState<ImageSettings>(settings);
  const set = <K extends keyof ImageSettings>(key: K, value: ImageSettings[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const ratioNames = { original: 'Original' } as const;
  const submit = (event: FormEvent) => { event.preventDefault(); void onSave(draft); };

  return <form className="studio-section ims" onSubmit={submit}>
    <Group title="Image display (desktop)">
      <Select label="Aspect ratio" value={draft.aspectRatio} options={ratios} names={ratioNames} onChange={(value) => set('aspectRatio', value)} />
      <Select label="Image fit" value={draft.fit} options={['contain', 'cover', 'fill'] as const} onChange={(value) => set('fit', value)} />
      <Select label="Alignment" value={draft.alignment} options={['center', 'top', 'bottom', 'left', 'right'] as const} onChange={(value) => set('alignment', value)} />
      <Select label="Background" value={draft.background} options={['white', 'ivory', 'neutral', 'transparent'] as const} names={{ white: 'White', ivory: 'Warm Ivory', neutral: 'Light Neutral', transparent: 'Transparent (PNG/WebP)' }} onChange={(value) => set('background', value)} />
      <Slider label="Corner radius" value={draft.cornerRadius} min={0} max={48} onChange={(value) => set('cornerRadius', value)} />
      <Slider label="Image display size" value={draft.displaySize} min={40} max={100} unit="%" onChange={(value) => set('displaySize', value)} />
      <Slider label="Thumbnail size" value={draft.thumbnailSize} min={40} max={140} onChange={(value) => set('thumbnailSize', value)} />
      <Slider label="Image spacing" value={draft.spacing} min={0} max={64} onChange={(value) => set('spacing', value)} />
      <p className="wide studio-muted">“Fill” stretches the image to the frame; “Contain” and “Cover” never distort it. Transparent shows through only for PNG/WebP with transparency.</p>
    </Group>
    <Group title="Image display (mobile)">
      <Select label="Aspect ratio" value={draft.mobile.aspectRatio} options={ratios} names={ratioNames} onChange={(value) => setDraft((current) => ({ ...current, mobile: { ...current.mobile, aspectRatio: value } }))} />
      <Slider label="Image display size" value={draft.mobile.displaySize} min={40} max={100} unit="%" onChange={(value) => setDraft((current) => ({ ...current, mobile: { ...current.mobile, displaySize: value } }))} />
      <Slider label="Image spacing" value={draft.mobile.spacing} min={0} max={48} onChange={(value) => setDraft((current) => ({ ...current, mobile: { ...current.mobile, spacing: value } }))} />
    </Group>
    <Group title="Image quality">
      <Check2 label="Preserve the original image file" hint="Keeps the uploaded original untouched. Applies to new uploads." checked={draft.quality.preserveOriginal} onChange={(value) => setDraft((current) => ({ ...current, quality: { ...current.quality, preserveOriginal: value } }))} />
      <Check2 label="Generate optimized responsive versions" hint="High-quality WebP copies at several widths for phones and desktops. Applies to new uploads." checked={draft.quality.optimizedVersions} onChange={(value) => setDraft((current) => ({ ...current, quality: { ...current.quality, optimizedVersions: value } }))} />
      <Check2 label="Preserve transparency" hint="Off flattens transparent areas onto white in optimized versions." checked={draft.quality.preserveTransparency} onChange={(value) => setDraft((current) => ({ ...current, quality: { ...current.quality, preserveTransparency: value } }))} />
      <p className="wide studio-muted">Colours and patterns are never altered and images are never stretched except when you choose “Fill”. Maximum upload size: {maxUploadMb} MB (server setting MAX_UPLOAD_MB).</p>
    </Group>
    <Group title="Image layout">
      <Select label="Product page images" value={draft.layout.mode} options={['gallery', 'single'] as const} names={{ gallery: 'Multi-image gallery', single: 'Single image' }} onChange={(value) => setDraft((current) => ({ ...current, layout: { ...current.layout, mode: value } }))} />
      <Select label="Thumbnail placement" value={draft.layout.thumbnailPlacement} options={['bottom', 'left', 'right'] as const} onChange={(value) => setDraft((current) => ({ ...current, layout: { ...current.layout, thumbnailPlacement: value } }))} />
      <Select label="Product card image" value={draft.layout.cardImage} options={['main', 'hover-second'] as const} names={{ main: 'Main image only', 'hover-second': 'Show second image on hover' }} onChange={(value) => setDraft((current) => ({ ...current, layout: { ...current.layout, cardImage: value } }))} />
      <Check2 label="Show thumbnails" checked={draft.layout.thumbnails} onChange={(value) => setDraft((current) => ({ ...current, layout: { ...current.layout, thumbnails: value } }))} />
      <Check2 label="Enable image zoom" checked={draft.layout.zoom} onChange={(value) => setDraft((current) => ({ ...current, layout: { ...current.layout, zoom: value } }))} />
    </Group>
    <button className="studio-primary" disabled={busy}>{busy ? 'Saving…' : 'Save Settings'} <Check size={15} /></button>
  </form>;
}
