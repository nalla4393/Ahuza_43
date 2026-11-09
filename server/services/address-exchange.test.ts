import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countries, isValidCountryRegion, regionsForCountry } from '../../shared/address.js';
import { parseExchangeRate } from './exchangeRate.js';

test('validates countries and their regions including countries without regions', () => {
  assert.ok(countries.length > 200);
  assert.ok(regionsForCountry('India').some((state) => state.name === 'Tamil Nadu'));
  assert.equal(isValidCountryRegion('India', 'Tamil Nadu'), true);
  assert.equal(isValidCountryRegion('India', 'California'), false);
  assert.equal(isValidCountryRegion('United States', 'California'), true);
  const withoutRegions = countries.find((country) => regionsForCountry(country.name).length === 0);
  assert.ok(withoutRegions);
  assert.equal(isValidCountryRegion(withoutRegions.name, ''), true);
  assert.equal(isValidCountryRegion('Unknown country', ''), false);
});

test('rejects invalid and stale exchange rates', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  assert.deepEqual(parseExchangeRate({ base: 'INR', date: '2026-11-06', rates: { USD: 0.011 } }, now), { usdPerInr: 0.011, date: '2026-11-06' });
  assert.throws(() => parseExchangeRate({ base: 'INR', date: '2026-10-01', rates: { USD: 0.011 } }, now));
  assert.throws(() => parseExchangeRate({ base: 'USD', date: '2026-11-06', rates: { USD: 1 } }, now));
});
