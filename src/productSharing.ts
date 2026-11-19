import { productPath } from '../shared/productUrl';

type ShareProduct = { id: string; name: string };
type SharingNavigator = { clipboard?: Pick<Clipboard, 'writeText'>; share?: Navigator['share'] };

export function productLink(product: ShareProduct, origin: string): string {
  return new URL(productPath(product), origin).href;
}

export async function copyProductLink(product: ShareProduct, origin: string, device: SharingNavigator): Promise<void> {
  if (!device.clipboard?.writeText) throw new Error('Copying is unavailable in this browser.');
  await device.clipboard.writeText(productLink(product, origin));
}

export async function shareProduct(product: ShareProduct, origin: string, device: SharingNavigator): Promise<void> {
  if (!device.share) throw new Error('Sharing is unavailable on this device. Use Copy Link instead.');
  await device.share({ title: product.name, url: productLink(product, origin) });
}
