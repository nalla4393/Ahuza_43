import { getDatabase, mutateDatabase } from './database.js';
import { isEmailConfigured, sendEmail } from './integrations.js';

export async function sendRestockAlerts(): Promise<void> {
  if (!isEmailConfigured()) return;
  const database = await getDatabase();
  const pending = (database.stockAlerts || []).filter((alert) => {
    const product = database.products.find((entry) => entry.id === alert.productId && entry.active && entry.stock > 0);
    return !alert.notifiedAt && Boolean(product);
  });

  for (const alert of pending) {
    const snapshot = await getDatabase();
    const product = snapshot.products.find((entry) => entry.id === alert.productId && entry.active && entry.stock > 0);
    const customer = snapshot.customers.find((entry) => entry.id === alert.customerId);
    if (!product || !customer || snapshot.stockAlerts?.find((entry) => entry.id === alert.id)?.notifiedAt) continue;

    try {
      await sendEmail(
        customer.email,
        `${product.name} is back in stock`,
        `Hi ${customer.email},\n\nThe item you asked us to watch, ${product.name}, is available again. Visit AHUZA Apparel to shop while stock lasts.\n\nAHUZA Customer Care`,
      );
      await mutateDatabase((current) => {
        const saved = current.stockAlerts?.find((entry) => entry.id === alert.id);
        if (saved && !saved.notifiedAt) saved.notifiedAt = new Date().toISOString();
      });
    } catch (error) {
      console.error(`Restock notification failed for product ${product.id}:`, error);
    }
  }
}
