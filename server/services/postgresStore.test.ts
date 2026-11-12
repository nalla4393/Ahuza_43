import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const testUrl = process.env.TEST_STOREFRONT_DATABASE_URL;

test('PostgreSQL import, persistence, rollback and cross-process updates', { skip: !testUrl && 'Set TEST_STOREFRONT_DATABASE_URL to run PostgreSQL integration tests' }, async () => {
  assert.ok(testUrl);
  const schema = `storefront_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: testUrl });
  const url = new URL(testUrl);
  url.searchParams.set('options', `-csearch_path=${schema}`);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ahuza-pg-test-'));
  const file = path.join(directory, 'store.json');
  const originalEnv = process.env.STOREFRONT_DATABASE_URL;
  const input = {
    products: [], customers: [], orders: [{ id: 'preserved-order', paymentStatus: 'pending' }],
    events: [], supportTickets: [], content: {}, bankPaymentAlerts: [{ id: 'preserved-alert' }],
    customData: { retained: true },
  };
  await writeFile(file, JSON.stringify(input));
  await admin.query(`CREATE SCHEMA "${schema}"`);
  process.env.STOREFRONT_DATABASE_URL = url.toString();
  const store = await import('./database.js');
  try {
    await assert.rejects(store.getDatabase());
    const invalidFile = path.join(directory, 'invalid.json');
    await writeFile(invalidFile, '{"orders":[]}');
    await assert.rejects(store.importStorefrontDatabase(invalidFile), /missing a valid products array/);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', 'server/scripts/import-storefront.ts', file], {
        env: { ...process.env, STOREFRONT_DATABASE_URL: url.toString() },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Import failed (${code}): ${stderr}`)));
    });
    await assert.rejects(store.importStorefrontDatabase(file), /already contains data/);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), input);
    const imported = await store.getDatabase();
    assert.equal(imported.orders[0]?.id, 'preserved-order');
    assert.equal(imported.orders[0]?.paymentStatus, 'pending');
    assert.equal(imported.bankPaymentAlerts?.[0]?.id, 'preserved-alert');

    await assert.rejects(store.mutateDatabase((db) => {
      db.orders[0]!.paymentStatus = 'paid';
      throw new Error('test rollback');
    }), /test rollback/);
    assert.equal((await store.getDatabase()).orders[0]?.paymentStatus, 'pending');

    const moduleUrl = pathToFileURL(path.resolve('server/services/database.ts')).href;
    const program = `
      const { mutateDatabase, closeStorefrontDatabase } = await import(${JSON.stringify(moduleUrl)});
      for (let i = 0; i < 10; i++) {
        await mutateDatabase(async (db) => {
          const value = db.events.length;
          await new Promise((resolve) => setTimeout(resolve, 5));
          db.events.push({ id: String(value), name: 'concurrent', createdAt: new Date().toISOString() });
        });
      }
      await closeStorefrontDatabase();
    `;
    const worker = () => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', program], {
        env: { ...process.env, STOREFRONT_DATABASE_URL: url.toString() },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Worker failed (${code}): ${stderr}`)));
    });
    await Promise.all([worker(), worker()]);
    const final = await store.getDatabase();
    assert.equal(final.events.length, 20);
    assert.equal(new Set(final.events.map((event) => event.id)).size, 20);
    const persisted = await admin.query<{ data: { customData: { retained: boolean } } }>(`SELECT data FROM "${schema}".ahuza_storefront_state WHERE id = 1`);
    assert.equal(persisted.rows[0]?.data.customData.retained, true);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', '--test', 'server/services/manualUpi.test.ts'], {
        env: { ...process.env, STOREFRONT_DATABASE_URL: url.toString() },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (data: Buffer) => { output += data.toString(); });
      child.stderr.on('data', (data: Buffer) => { output += data.toString(); });
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`PostgreSQL checkout test failed (${code}): ${output}`)));
    });
  } finally {
    await store.closeStorefrontDatabase();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.STOREFRONT_DATABASE_URL;
    else process.env.STOREFRONT_DATABASE_URL = originalEnv;
  }
});
