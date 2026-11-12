import 'dotenv/config';
import { closeStorefrontDatabase, importStorefrontDatabase } from '../services/database.js';

const file = process.argv[2];
try {
  if (!file || process.argv.length !== 3) throw new Error('Usage: npm run db:import -- /absolute/path/to/ahuza-db.json');
  await importStorefrontDatabase(file);
  console.info('Storefront data imported into PostgreSQL. The source file was not modified.');
} catch (error) {
  console.error('Storefront import failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeStorefrontDatabase();
}
