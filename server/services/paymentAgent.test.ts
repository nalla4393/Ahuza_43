import assert from 'node:assert/strict';
import test from 'node:test';
import { outOfStockItems, recordAgentEvent } from './paymentAgent.js';
import type { Database } from './database.js';

const database = { products: [{ id: 'a', stock: 3 }, { id: 'b', stock: 0 }], paymentAgentLog: [] } as unknown as Database;

test('inventory check passes when stock covers every line', () => {
  assert.deepEqual(outOfStockItems(database, { items: [{ productId: 'a', name: 'Saree', quantity: 3 }] } as never), []);
});

test('inventory check adds sizes of one product and flags shortages', () => {
  const order = { items: [{ productId: 'a', name: 'Saree', quantity: 2 }, { productId: 'a', name: 'Saree', quantity: 2 }, { productId: 'b', name: 'Shawl', quantity: 1 }] };
  assert.deepEqual(outOfStockItems(database, order as never), ['Saree', 'Shawl']);
});

test('agent log keeps newest first and is capped', () => {
  for (let index = 0; index < 205; index += 1) recordAgentEvent(database, { orderId: `o${index}`, trigger: 'poll', decision: 'confirmed', detail: '' });
  assert.equal(database.paymentAgentLog!.length, 200);
  assert.equal(database.paymentAgentLog![0].orderId, 'o204');
});
