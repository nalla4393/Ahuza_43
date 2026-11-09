import assert from 'node:assert/strict';
import test from 'node:test';
import { outOfStockItems } from './paymentSync.js';
import type { Database } from './database.js';

test('stock check combines separate size lines for each product', () => {
  const database = { products: [{ id: 'a', stock: 3 }, { id: 'b', stock: 0 }] } as unknown as Database;
  const order = { items: [
    { productId: 'a', name: 'Saree', quantity: 2 },
    { productId: 'a', name: 'Saree', quantity: 2 },
    { productId: 'b', name: 'Shawl', quantity: 1 },
  ] };
  assert.deepEqual(outOfStockItems(database, order as never), ['Saree', 'Shawl']);
});
