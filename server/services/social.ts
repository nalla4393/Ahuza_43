import { randomUUID } from 'node:crypto';
import { getDatabase, mutateDatabase, type Product, type SocialPlatform, type SocialPost, type SocialSchedule } from './database.js';
import { generateSocialPost } from './ai.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export const socialTones = ['Warm and elegant', 'Playful', 'Premium', 'Festive'];
export const socialPlatforms: SocialPlatform[] = ['facebook', 'instagram'];

export function socialStatus(): Record<SocialPlatform, boolean> {
  const token = Boolean(process.env.META_PAGE_ACCESS_TOKEN?.trim());
  return {
    facebook: token && Boolean(process.env.META_PAGE_ID?.trim()),
    instagram: token && Boolean(process.env.META_IG_USER_ID?.trim()),
  };
}

function publicImageUrl(url: string): string {
  if (/^https:\/\//i.test(url)) return url;
  const base = (process.env.PUBLIC_URL?.trim() || 'https://www.ahuzawear.com').replace(/\/$/, '');
  return url.startsWith('/') ? `${base}${url}` : '';
}

function productImage(product: Product): string {
  const main = product.images?.find((image) => image.id === product.mainImageId)?.url || product.imageUrl;
  return publicImageUrl(main || '');
}

export function validateSchedule(input: unknown): Omit<SocialSchedule, 'id' | 'createdAt' | 'lastRunDate'> | string {
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80) return 'Give the schedule a name (max 80 characters)';
  const platforms = Array.isArray(body.platforms) ? [...new Set(body.platforms)] as SocialPlatform[] : [];
  if (!platforms.length || platforms.some((platform) => !socialPlatforms.includes(platform))) return 'Choose Facebook, Instagram or both';
  const days = Array.isArray(body.days) ? [...new Set(body.days)] as number[] : [];
  if (!days.length || days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return 'Choose at least one day of the week';
  const time = typeof body.time === 'string' ? body.time : '';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return 'Choose a valid posting time';
  const productMode = body.productMode === 'newest' ? 'newest' : body.productMode === 'rotate' ? 'rotate' : null;
  if (!productMode) return 'Choose how products are picked';
  const tone = typeof body.tone === 'string' && socialTones.includes(body.tone) ? body.tone : '';
  if (!tone) return 'Choose a tone';
  return { name, platforms, days: days.sort(), time, productMode, tone, autoPublish: body.autoPublish === true, enabled: body.enabled !== false };
}

async function graphPost(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(`${GRAPH}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, access_token: process.env.META_PAGE_ACCESS_TOKEN!.trim() }),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown> & { error?: { message?: string } };
  if (!response.ok) throw new Error(result.error?.message || `Meta returned HTTP ${response.status}`);
  return result;
}

async function publishToFacebook(post: SocialPost): Promise<string> {
  const result = await graphPost(`${process.env.META_PAGE_ID!.trim()}/photos`, { url: post.imageUrl, caption: post.caption });
  return String(result.post_id || result.id || '');
}

async function publishToInstagram(post: SocialPost): Promise<string> {
  const igId = process.env.META_IG_USER_ID!.trim();
  const container = await graphPost(`${igId}/media`, { image_url: post.imageUrl, caption: post.caption });
  const creationId = String(container.id || '');
  if (!creationId) throw new Error('Instagram did not return a media container');
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const status = await fetch(`${GRAPH}/${creationId}?fields=status_code&access_token=${encodeURIComponent(process.env.META_PAGE_ACCESS_TOKEN!.trim())}`, { signal: AbortSignal.timeout(15000) });
    const code = (await status.json().catch(() => ({})) as { status_code?: string }).status_code;
    if (code === 'FINISHED') break;
    if (code === 'ERROR' || code === 'EXPIRED') throw new Error('Instagram could not process the image');
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const published = await graphPost(`${igId}/media_publish`, { creation_id: creationId });
  return String(published.id || '');
}

export async function publishSocialPost(postId: string, captionOverride?: string): Promise<SocialPost> {
  const database = await getDatabase();
  const post = database.socialPosts?.find((entry) => entry.id === postId);
  if (!post) throw new Error('POST_NOT_FOUND');
  if (post.status === 'posted') return post;
  const caption = captionOverride?.trim() ? captionOverride.trim().slice(0, 2000) : post.caption;
  let outcome: Pick<SocialPost, 'status' | 'detail' | 'externalId' | 'postedAt'>;
  if (!socialStatus()[post.platform]) outcome = { status: 'failed', detail: `${post.platform === 'facebook' ? 'Facebook' : 'Instagram'} is not connected yet` };
  else if (!post.imageUrl) outcome = { status: 'failed', detail: 'This product has no public image to post' };
  else {
    try {
      const externalId = await (post.platform === 'facebook' ? publishToFacebook({ ...post, caption }) : publishToInstagram({ ...post, caption }));
      outcome = { status: 'posted', externalId, postedAt: new Date().toISOString(), detail: undefined };
    } catch (error) {
      outcome = { status: 'failed', detail: (error instanceof Error ? error.message : 'Posting failed').slice(0, 200) };
    }
  }
  return mutateDatabase((db) => {
    const current = db.socialPosts!.find((entry) => entry.id === postId)!;
    Object.assign(current, { caption }, outcome);
    return structuredClone(current);
  });
}

function pickProduct(schedule: SocialSchedule, products: Product[], posts: SocialPost[]): Product | null {
  const live = products.filter((product) => product.active && product.stock > 0 && productImage(product));
  if (!live.length) return null;
  if (schedule.productMode === 'newest') return [...live].sort((a, b) => b.id.localeCompare(a.id))[0];
  const lastUsed = (productId: string) => Math.max(0, ...posts.filter((post) => post.scheduleId === schedule.id && post.productId === productId).map((post) => new Date(post.createdAt).getTime()));
  return [...live].sort((a, b) => lastUsed(a.id) - lastUsed(b.id))[0];
}

export async function runSchedule(scheduleId: string): Promise<SocialPost[]> {
  const database = await getDatabase();
  const schedule = database.socialSchedules?.find((entry) => entry.id === scheduleId);
  if (!schedule) throw new Error('SCHEDULE_NOT_FOUND');
  const product = pickProduct(schedule, database.products, database.socialPosts || []);
  if (!product) throw new Error('NO_PRODUCT_AVAILABLE');
  const caption = await generateSocialPost(product.name, `${product.description} Category: ${product.category} Tone: ${schedule.tone}`);
  const imageUrl = productImage(product);
  const created: SocialPost[] = schedule.platforms.map((platform) => ({
    id: randomUUID(), scheduleId: schedule.id, productId: product.id, productName: product.name, caption, imageUrl, platform, status: 'draft', createdAt: new Date().toISOString(),
  }));
  await mutateDatabase((db) => {
    db.socialPosts ||= [];
    db.socialPosts.push(...created);
    if (db.socialPosts.length > 300) db.socialPosts.splice(0, db.socialPosts.length - 300);
  });
  if (!schedule.autoPublish) return created;
  const results: SocialPost[] = [];
  for (const post of created) results.push(await publishSocialPost(post.id));
  return results;
}

let scanning = false;

// Runs once per scheduled day, at or after the chosen India time.
export async function runDueSchedules(): Promise<void> {
  if (scanning) return;
  scanning = true;
  try {
    const ist = new Date(Date.now() + IST_OFFSET_MS);
    const today = ist.toISOString().slice(0, 10);
    const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const database = await getDatabase();
    for (const schedule of database.socialSchedules || []) {
      if (!schedule.enabled || schedule.lastRunDate === today || !schedule.days.includes(ist.getUTCDay())) continue;
      const [hour, minute] = schedule.time.split(':').map(Number);
      if (minutes < hour * 60 + minute) continue;
      await mutateDatabase((db) => { const current = db.socialSchedules?.find((entry) => entry.id === schedule.id); if (current) current.lastRunDate = today; });
      try { await runSchedule(schedule.id); }
      catch (error) { console.error(`Social schedule "${schedule.name}" failed:`, error instanceof Error ? error.message : error); }
    }
  } finally { scanning = false; }
}

export function startSocialScheduler(): void {
  void runDueSchedules().catch((error) => console.error('Social scan failed:', error));
  setInterval(() => void runDueSchedules().catch((error) => console.error('Social scan failed:', error)), 5 * 60 * 1000).unref();
}
