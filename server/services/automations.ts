import { randomUUID } from 'node:crypto';
import { getDatabase, mutateDatabase, type AutomationRule, type AutomationRun, type AutomationTrigger, type Order } from './database.js';
import { generateMarketingEmail } from './ai.js';
import { isEmailConfigured, sendEmail } from './integrations.js';

export const automationTriggers: AutomationTrigger[] = ['order_placed', 'order_delivered', 'win_back'];
const DAY = 24 * 60 * 60 * 1000;
const MAX_PER_SCAN = 25;

export function validateRule(input: unknown): Omit<AutomationRule, 'id' | 'createdAt'> | string {
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
  if (!name || name.length > 80) return 'Give the automation a name (max 80 characters).';
  if (!goal || goal.length > 500) return 'Describe what the email should say (max 500 characters).';
  if (!automationTriggers.includes(body.trigger as AutomationTrigger)) return 'Choose a valid trigger.';
  const delayDays = Number(body.delayDays);
  if (!Number.isInteger(delayDays) || delayDays < 0 || delayDays > 365) return 'Delay must be 0 to 365 days.';
  return { name, goal, trigger: body.trigger as AutomationTrigger, delayDays, enabled: body.enabled !== false };
}

function orderTime(order: Order, trigger: AutomationTrigger): number | null {
  if (trigger === 'order_placed') return new Date(order.createdAt).getTime();
  if (trigger === 'order_delivered') return order.deliveredAt ? new Date(order.deliveredAt).getTime() : null;
  return null;
}

async function log(run: Omit<AutomationRun, 'at'>): Promise<void> {
  await mutateDatabase((database) => {
    database.automationRuns ||= [];
    database.automationRuns.push({ ...run, at: new Date().toISOString() });
    if (database.automationRuns.length > 500) database.automationRuns.splice(0, database.automationRuns.length - 500);
  });
}

// Only customers who opted in to marketing at checkout are ever contacted.
export async function runAutomations(): Promise<number> {
  if (!isEmailConfigured()) return 0;
  const database = await getDatabase();
  const rules = (database.automations || []).filter((rule) => rule.enabled);
  if (!rules.length) return 0;
  const done = new Set((database.automationRuns || []).filter((run) => run.status !== 'failed').map((run) => run.key));
  const now = Date.now();
  let sent = 0;
  for (const rule of rules) {
    const targets: { key: string; order: Order; email: string }[] = [];
    if (rule.trigger === 'win_back') {
      for (const customer of database.customers) {
        const orders = database.orders.filter((order) => order.userId === customer.id);
        if (!orders.length || !orders.some((order) => order.marketingConsent)) continue;
        const last = Math.max(...orders.map((order) => new Date(order.createdAt).getTime()));
        if (now - last < rule.delayDays * DAY) continue;
        const latest = orders.find((order) => new Date(order.createdAt).getTime() === last)!;
        targets.push({ key: `${rule.id}:${customer.id}:${new Date(last).toISOString()}`, order: latest, email: customer.email });
      }
    } else {
      for (const order of database.orders) {
        if (!order.marketingConsent || order.status === 'cancelled' || order.status === 'pending_payment') continue;
        const time = orderTime(order, rule.trigger);
        if (time === null || now - time < rule.delayDays * DAY) continue;
        const email = database.customers.find((customer) => customer.id === order.userId)?.email;
        if (email) targets.push({ key: `${rule.id}:${order.id}`, order, email });
      }
    }
    for (const target of targets) {
      if (done.has(target.key) || sent >= MAX_PER_SCAN) continue;
      done.add(target.key);
      try {
        const { subject, body } = await generateMarketingEmail(rule.goal, JSON.stringify({ customerName: target.order.shippingAddress.name, lastOrderItems: target.order.items.map((item) => item.name) }));
        await sendEmail(target.email, subject, body);
        await log({ key: target.key, ruleId: rule.id, ruleName: rule.name, to: target.email, status: 'sent' });
        sent += 1;
      } catch (error) {
        await log({ key: target.key, ruleId: rule.id, ruleName: rule.name, to: target.email, status: 'failed', detail: error instanceof Error ? error.message.slice(0, 160) : 'Unknown error' });
      }
    }
  }
  return sent;
}

export async function listAutomations(): Promise<{ rules: AutomationRule[]; runs: AutomationRun[]; emailReady: boolean }> {
  const database = await getDatabase();
  return { rules: database.automations || [], runs: (database.automationRuns || []).slice(-30).reverse(), emailReady: isEmailConfigured() };
}

export async function createRule(rule: Omit<AutomationRule, 'id' | 'createdAt'>): Promise<AutomationRule> {
  const created: AutomationRule = { ...rule, id: randomUUID(), createdAt: new Date().toISOString() };
  await mutateDatabase((database) => { (database.automations ||= []).push(created); });
  return created;
}
