export type ProductImage = {
  id: string;
  url: string;
  originalUrl: string;
  variants: { width: number; url: string }[];
  width: number;
  height: number;
  size: number;
  mimeType: string;
  hasAlpha: boolean;
  originalName: string;
};

export type ImageSettings = {
  aspectRatio: '1:1' | '3:4' | '4:5' | '4:3' | 'original';
  fit: 'contain' | 'cover' | 'fill';
  alignment: 'center' | 'top' | 'bottom' | 'left' | 'right';
  background: 'white' | 'ivory' | 'neutral' | 'transparent';
  cornerRadius: number;
  displaySize: number;
  thumbnailSize: number;
  spacing: number;
  mobile: { aspectRatio: ImageSettings['aspectRatio']; displaySize: number; spacing: number };
  quality: { preserveOriginal: boolean; optimizedVersions: boolean; preserveTransparency: boolean };
  layout: { mode: 'single' | 'gallery'; thumbnails: boolean; thumbnailPlacement: 'bottom' | 'left' | 'right'; zoom: boolean; cardImage: 'main' | 'hover-second' };
};

export const defaultImageSettings: ImageSettings = {
  aspectRatio: '3:4', fit: 'contain', alignment: 'center', background: 'neutral', cornerRadius: 0, displaySize: 80, thumbnailSize: 64, spacing: 17,
  mobile: { aspectRatio: '3:4', displaySize: 100, spacing: 11 },
  quality: { preserveOriginal: true, optimizedVersions: true, preserveTransparency: true },
  layout: { mode: 'gallery', thumbnails: true, thumbnailPlacement: 'bottom', zoom: true, cardImage: 'main' },
};

const backgrounds = { white: '#ffffff', ivory: '#f5efe0', neutral: '#eeece5', transparent: 'transparent' };
const alignments = { center: 'center', top: 'center top', bottom: 'center bottom', left: 'left center', right: 'right center' };
const ratio = (value: ImageSettings['aspectRatio']) => value === 'original' ? 'auto' : value.replace(':', ' / ');

// Scoped CSS variables so settings only affect product imagery.
export function imageSettingsVars(settings: ImageSettings): Record<string, string> {
  return {
    '--pi-ratio': ratio(settings.aspectRatio), '--pi-ratio-mobile': ratio(settings.mobile.aspectRatio),
    '--pi-fit': settings.fit, '--pi-position': alignments[settings.alignment], '--pi-bg': backgrounds[settings.background],
    '--pi-radius': `${settings.cornerRadius}px`, '--pi-size': `${settings.displaySize}%`, '--pi-size-mobile': `${settings.mobile.displaySize}%`,
    '--pi-thumb': `${settings.thumbnailSize}px`, '--pi-gap': `${settings.spacing}px`, '--pi-gap-mobile': `${settings.mobile.spacing}px`,
    '--pi-blend': 'normal',
  };
}

export function mainImage(product: { imageUrl: string; images?: ProductImage[]; mainImageId?: string }): ProductImage | undefined {
  return product.images?.find((image) => image.id === product.mainImageId) || product.images?.[0];
}

export function srcSet(image: ProductImage): string | undefined {
  return image.variants.length > 1 ? image.variants.map((variant) => `${variant.url} ${variant.width}w`).join(', ') : undefined;
}
