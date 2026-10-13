import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { mergeImageSettings, type ImageSettings, type ProductImage } from './database.js';

export const uploadRoot = path.resolve(process.env.UPLOAD_DIR || path.join(path.dirname(process.env.DATA_FILE || '.data/ahuza-db.json'), 'uploads'));
export const maxUploadBytes = Math.max(1, Number(process.env.MAX_UPLOAD_MB) || 10) * 1024 * 1024;
const variantWidths = [400, 800, 1600];
const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
type Mime = keyof typeof extensions;

export function detectImageType(buffer: Buffer): Mime | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// Stores the untouched original plus resized WebP copies (alpha is preserved by WebP).
export async function saveProductImage(buffer: Buffer, mimeType: Mime, originalName: string, settings: ImageSettings): Promise<ProductImage> {
  const id = randomUUID();
  const directory = path.join(uploadRoot, id);
  const base = `/uploads/${id}`;
  const metadata = await sharp(buffer, { limitInputPixels: 80_000_000 }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('INVALID_IMAGE');
  await mkdir(directory, { recursive: true });
  try {
    const originalFile = `original.${extensions[mimeType]}`;
    await writeFile(path.join(directory, originalFile), buffer);
    const variants: ProductImage['variants'] = [];
    if (settings.quality.optimizedVersions) {
      for (const width of variantWidths) {
        const target = Math.min(width, metadata.width);
        let pipeline = sharp(buffer, { limitInputPixels: 80_000_000 }).rotate();
        if (!settings.quality.preserveTransparency) pipeline = pipeline.flatten({ background: '#ffffff' });
        await pipeline.resize({ width: target, withoutEnlargement: true }).webp({ quality: 90 }).toFile(path.join(directory, `w${width}.webp`));
        variants.push({ width: target, url: `${base}/w${width}.webp` });
        if (width >= metadata.width) break;
      }
    }
    let originalUrl = `${base}/${originalFile}`;
    if (!settings.quality.preserveOriginal && variants.length) {
      await rm(path.join(directory, originalFile), { force: true });
      originalUrl = variants[variants.length - 1]!.url;
    }
    return {
      id, url: variants.length ? variants[variants.length - 1]!.url : originalUrl, originalUrl, variants,
      width: metadata.width, height: metadata.height, size: buffer.length, mimeType,
      hasAlpha: Boolean(metadata.hasAlpha), originalName: originalName.slice(0, 120), createdAt: new Date().toISOString(),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function deleteProductImageFiles(id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return;
  await rm(path.join(uploadRoot, id), { recursive: true, force: true });
}

const choice = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => allowed.includes(value as T) ? value as T : fallback;
const range = (value: unknown, min: number, max: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
const flag = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback;
const ratios = ['1:1', '3:4', '4:5', '4:3', 'original'] as const;

export function sanitizeImageSettings(value: unknown): ImageSettings {
  const input = mergeImageSettings(value);
  return {
    aspectRatio: choice(input.aspectRatio, ratios, '3:4'),
    fit: choice(input.fit, ['contain', 'cover', 'fill'], 'contain'),
    alignment: choice(input.alignment, ['center', 'top', 'bottom', 'left', 'right'], 'center'),
    background: choice(input.background, ['white', 'ivory', 'neutral', 'transparent'], 'neutral'),
    cornerRadius: range(input.cornerRadius, 0, 48, 0),
    displaySize: range(input.displaySize, 40, 100, 80),
    thumbnailSize: range(input.thumbnailSize, 40, 140, 64),
    spacing: range(input.spacing, 0, 64, 17),
    mobile: { aspectRatio: choice(input.mobile.aspectRatio, ratios, '3:4'), displaySize: range(input.mobile.displaySize, 40, 100, 100), spacing: range(input.mobile.spacing, 0, 48, 11) },
    quality: { preserveOriginal: flag(input.quality.preserveOriginal, true), optimizedVersions: flag(input.quality.optimizedVersions, true), preserveTransparency: flag(input.quality.preserveTransparency, true) },
    layout: {
      mode: choice(input.layout.mode, ['single', 'gallery'], 'gallery'), thumbnails: flag(input.layout.thumbnails, true),
      thumbnailPlacement: choice(input.layout.thumbnailPlacement, ['bottom', 'left', 'right'], 'bottom'), zoom: flag(input.layout.zoom, true),
      cardImage: choice(input.layout.cardImage, ['main', 'hover-second'], 'main'),
    },
  };
}
